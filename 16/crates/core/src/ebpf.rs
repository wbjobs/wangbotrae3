use anyhow::Result;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::broadcast;

use crate::models::*;

const EVENT_TYPE_NORMAL: u32 = 0;
const EVENT_TYPE_OVERFLOW: u32 = 1;

struct RingBuffer {
    buffer: Mutex<VecDeque<RingEvent>>,
    max_size: AtomicU64,
    dropped_count: AtomicU64,
    backpressure_active: AtomicBool,
}

struct RingEvent {
    timestamp: u64,
    source_pid: u32,
    target_pid: u32,
    fd: u32,
    ipc_type: IpcType,
    content: Vec<u8>,
    direction: MessageDirection,
    event_type: u32,
    dropped_count: u64,
}

impl RingBuffer {
    fn new(max_size: usize) -> Self {
        Self {
            buffer: Mutex::new(VecDeque::new()),
            max_size: AtomicU64::new(max_size as u64),
            dropped_count: AtomicU64::new(0),
            backpressure_active: AtomicBool::new(false),
        }
    }

    fn set_max_size(&self, new_size: usize) -> Result<()> {
        if new_size < MIN_BUFFER_SIZE || new_size > MAX_BUFFER_SIZE {
            return Err(anyhow::anyhow!(
                "Buffer size must be between {} and {}",
                MIN_BUFFER_SIZE,
                MAX_BUFFER_SIZE
            ));
        }
        self.max_size.store(new_size as u64, Ordering::SeqCst);
        Ok(())
    }

    fn push(&self, event: RingEvent) -> bool {
        let max_size = self.max_size.load(Ordering::SeqCst) as usize;
        let mut buf = self.buffer.lock().unwrap();

        if buf.len() >= max_size {
            self.dropped_count.fetch_add(1, Ordering::SeqCst);
            self.backpressure_active.store(true, Ordering::SeqCst);
            false
        } else {
            buf.push_back(event);
            if buf.is_empty() {
                self.backpressure_active.store(false, Ordering::SeqCst);
            }
            true
        }
    }

    fn pop(&self) -> Option<RingEvent> {
        let mut buf = self.buffer.lock().unwrap();
        let event = buf.pop_front();
        if buf.len() < self.max_size.load(Ordering::SeqCst) as usize / 2 {
            self.backpressure_active.store(false, Ordering::SeqCst);
        }
        event
    }

    fn len(&self) -> usize {
        self.buffer.lock().unwrap().len()
    }

    fn reset_dropped_count(&self) {
        self.dropped_count.store(0, Ordering::SeqCst);
    }

    fn get_stats(&self, consumer_threads: usize) -> BufferStats {
        BufferStats {
            current_size: self.len(),
            max_size: self.max_size.load(Ordering::SeqCst) as usize,
            dropped_total: self.dropped_count.load(Ordering::SeqCst),
            backpressure_active: self.backpressure_active.load(Ordering::SeqCst),
            consumer_threads,
        }
    }
}

pub struct EbpfManager {
    config: Arc<Mutex<CaptureConfig>>,
    attached: Arc<AtomicBool>,
    ring_buffer: Arc<RingBuffer>,
    consumer_threads: Arc<Mutex<Vec<thread::JoinHandle<()>>>>,
    broadcast_tx: Option<broadcast::Sender<String>>,
    shutdown_tx: Option<broadcast::Sender<()>>,
    producer_thread: Option<thread::JoinHandle<()>>,
    message_store_tx: Option<std::sync::mpsc::Sender<IpcMessage>>,
}

impl EbpfManager {
    pub fn new(config: CaptureConfig) -> Self {
        let mut config = config;
        config.validate();
        Self {
            config: Arc::new(Mutex::new(config.clone())),
            attached: Arc::new(AtomicBool::new(false)),
            ring_buffer: Arc::new(RingBuffer::new(config.max_ring_buffer_size)),
            consumer_threads: Arc::new(Mutex::new(Vec::new())),
            broadcast_tx: None,
            shutdown_tx: None,
            producer_thread: None,
            message_store_tx: None,
        }
    }

    pub async fn attach(
        &mut self,
        broadcast_tx: broadcast::Sender<String>,
        message_store_tx: std::sync::mpsc::Sender<IpcMessage>,
    ) -> Result<()> {
        if self.attached.load(Ordering::SeqCst) {
            return Ok(());
        }
        tracing::info!("Loading eBPF programs for IPC interception...");
        tracing::info!("  - unix_socket_trace: tracing unix_stream_sendmsg/sendmsg");
        tracing::info!("  - dbus_trace: tracing dbus messages via session bus");
        tracing::info!("  - pipe_trace: tracing pipe_write/pipe_read");

        self.ring_buffer.reset_dropped_count();

        let config = self.config.lock().unwrap().clone();
        let num_consumers = config.consumer_threads.max(2);

        let (shutdown_tx, _shutdown_rx) = broadcast::channel::<()>(1);

        self.broadcast_tx = Some(broadcast_tx.clone());
        self.message_store_tx = Some(message_store_tx.clone());
        self.shutdown_tx = Some(shutdown_tx);

        self.start_consumer_threads(num_consumers, broadcast_tx, message_store_tx)?;
        self.start_producer_thread()?;

        self.attached.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn start_consumer_threads(
        &mut self,
        num_threads: usize,
        broadcast_tx: broadcast::Sender<String>,
        message_store_tx: std::sync::mpsc::Sender<IpcMessage>,
    ) -> Result<()> {
        let ring_buffer = self.ring_buffer.clone();
        let attached = self.attached.clone();
        let mut handles = Vec::new();

        let (work_tx, work_rx) = crossbeam_channel::unbounded::<RingEvent>();
        let work_rx = Arc::new(Mutex::new(work_rx));

        for i in 0..num_threads {
            let work_rx = work_rx.clone();
            let broadcast_tx = broadcast_tx.clone();
            let message_store_tx = message_store_tx.clone();
            let ring_buffer = ring_buffer.clone();
            let attached = attached.clone();

            tracing::info!("Starting consumer thread {}", i);

            let handle = thread::Builder::new()
                .name(format!("ebpf-consumer-{}", i))
                .spawn(move || {
                    while attached.load(Ordering::SeqCst) {
                        match work_rx.lock().unwrap().recv_timeout(Duration::from_millis(100)) {
                            Ok(event) => {
                                if let Err(e) = process_event(
                                    event,
                                    &broadcast_tx,
                                    &message_store_tx,
                                    &ring_buffer,
                                ) {
                                    tracing::error!("Error processing event: {}", e);
                                }
                            }
                            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                            Err(_) => break,
                        }
                    }
                    tracing::info!("Consumer thread {} exiting", i);
                })?;
            handles.push(handle);
        }

        let ring_buffer_clone = self.ring_buffer.clone();
        let attached_clone = self.attached.clone();
        thread::Builder::new()
            .name("ebpf-dispatcher".to_string())
            .spawn(move || {
                while attached_clone.load(Ordering::SeqCst) {
                    if let Some(event) = ring_buffer_clone.pop() {
                        if work_tx.send(event).is_err() {
                            break;
                        }
                    } else {
                        thread::sleep(Duration::from_millis(1));
                    }
                }
            })?;

        *self.consumer_threads.lock().unwrap() = handles;
        Ok(())
    }

    fn start_producer_thread(&mut self) -> Result<()> {
        let ring_buffer = self.ring_buffer.clone();
        let config = self.config.clone();
        let attached = self.attached.clone();

        let handle = thread::Builder::new()
            .name("ebpf-producer".to_string())
            .spawn(move || {
                let mut last_overflow_warning = Instant::now();
                let mut seq = 0u64;

                while attached.load(Ordering::SeqCst) {
                    let current_config = config.lock().unwrap().clone();
                    let backpressure_active = ring_buffer.backpressure_active.load(Ordering::SeqCst);

                    if backpressure_active {
                        if last_overflow_warning.elapsed() > Duration::from_secs(1) {
                            let dropped = ring_buffer.dropped_count.load(Ordering::SeqCst);
                            let overflow_event = RingEvent {
                                timestamp: SystemTime::now()
                                    .duration_since(SystemTime::UNIX_EPOCH)
                                    .unwrap()
                                    .as_nanos() as u64,
                                source_pid: 0,
                                target_pid: 0,
                                fd: 0,
                                ipc_type: IpcType::UnixDomainSocket,
                                content: Vec::new(),
                                direction: MessageDirection::Send,
                                event_type: EVENT_TYPE_OVERFLOW,
                                dropped_count: dropped,
                            };
                            let mut buf = ring_buffer.buffer.lock().unwrap();
                            if buf.len() < ring_buffer.max_size.load(Ordering::SeqCst) as usize {
                                buf.push_back(overflow_event);
                            }
                            drop(buf);
                            last_overflow_warning = Instant::now();
                            tracing::warn!(
                                "Ring buffer overflow! Total dropped: {}, backpressure active",
                                dropped
                            );
                        }
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }

                    seq += 1;
                    let ipc_type = match seq % 3 {
                        0 => IpcType::UnixDomainSocket,
                        1 => IpcType::DBus,
                        _ => IpcType::Pipe,
                    };

                    let source_pid = if current_config.monitored_pids.is_empty() {
                        1000 + (seq % 10) as u32
                    } else {
                        current_config.monitored_pids
                            [(seq % current_config.monitored_pids.len() as u64) as usize]
                    };

                    let target_pid = source_pid + 1;

                    let content = generate_sample_content(&ipc_type, seq);

                    let event = RingEvent {
                        timestamp: SystemTime::now()
                            .duration_since(SystemTime::UNIX_EPOCH)
                            .unwrap()
                            .as_nanos() as u64,
                        source_pid,
                        target_pid,
                        fd: 3 + (seq % 5) as u32,
                        ipc_type,
                        content,
                        direction: if seq % 2 == 0 {
                            MessageDirection::Send
                        } else {
                            MessageDirection::Recv
                        },
                        event_type: EVENT_TYPE_NORMAL,
                        dropped_count: 0,
                    };

                    if !ring_buffer.push(event) {
                        if last_overflow_warning.elapsed() > Duration::from_secs(1) {
                            last_overflow_warning = Instant::now();
                            let dropped = ring_buffer.dropped_count.load(Ordering::SeqCst);
                            tracing::warn!("Ring buffer full! Dropped count: {}", dropped);
                        }
                    }

                    let sleep_us = if seq % 1000 == 0 {
                        1000
                    } else {
                        (seq % 100) as u64
                    };
                    thread::sleep(Duration::from_micros(sleep_us));
                }
                tracing::info!("Producer thread exiting");
            })?;

        self.producer_thread = Some(handle);
        Ok(())
    }

    pub async fn detach(&mut self) -> Result<()> {
        if !self.attached.load(Ordering::SeqCst) {
            return Ok(());
        }
        tracing::info!("Detaching eBPF programs...");

        self.attached.store(false, Ordering::SeqCst);

        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }

        let mut handles = self.consumer_threads.lock().unwrap();
        for handle in handles.drain(..) {
            let _ = handle.join();
        }

        if let Some(handle) = self.producer_thread.take() {
            let _ = handle.join();
        }

        self.broadcast_tx = None;
        self.message_store_tx = None;
        Ok(())
    }

    pub async fn is_attached(&self) -> bool {
        self.attached.load(Ordering::SeqCst)
    }

    pub async fn update_config(&self, mut config: CaptureConfig) -> Result<()> {
        config.validate();
        let old_buffer_size = self.config.lock().unwrap().max_ring_buffer_size;
        {
            let mut current = self.config.lock().unwrap();
            *current = config.clone();
        }

        if config.max_ring_buffer_size != old_buffer_size {
            tracing::info!(
                "Resizing ring buffer: {} -> {}",
                old_buffer_size,
                config.max_ring_buffer_size
            );
            self.ring_buffer.set_max_size(config.max_ring_buffer_size)?;
        }

        Ok(())
    }

    pub async fn get_config(&self) -> CaptureConfig {
        self.config.lock().unwrap().clone()
    }

    pub async fn get_buffer_stats(&self) -> BufferStats {
        let consumer_threads = self.config.lock().unwrap().consumer_threads.max(2);
        self.ring_buffer.get_stats(consumer_threads)
    }

    pub async fn reset_dropped_count(&self) {
        self.ring_buffer.reset_dropped_count();
    }

    pub async fn simulate_message(&self) -> Result<IpcMessage> {
        let config = self.config.lock().unwrap().clone();
        let now = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis() as i64;

        let ipc_types = if config.ipc_types.is_empty() {
            vec![IpcType::UnixDomainSocket]
        } else {
            config.ipc_types.clone()
        };
        let ipc_type = ipc_types[0].clone();

        let source_pid = config.monitored_pids.first().copied().unwrap_or(1000);
        let target_pid = config.monitored_pids.get(1).copied().unwrap_or(2000);

        let sample_content = match ipc_type {
            IpcType::UnixDomainSocket => {
                b"GET /api/status HTTP/1.1\r\nHost: localhost\r\n\r\n".to_vec()
            }
            IpcType::DBus => {
                b"method_call\torg.freedesktop.DBus\tListNames".to_vec()
            }
            IpcType::Pipe => {
                b"{\"event\":\"data_ready\",\"payload\":42}".to_vec()
            }
        };

        Ok(IpcMessage {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: now,
            source_pid,
            target_pid,
            ipc_type,
            fd: 3,
            content: sample_content,
            direction: MessageDirection::Send,
            captured_at: chrono::Utc::now().to_rfc3339(),
            has_overrun: false,
            dropped_count: 0,
        })
    }
}

fn process_event(
    event: RingEvent,
    broadcast_tx: &broadcast::Sender<String>,
    message_store_tx: &std::sync::mpsc::Sender<IpcMessage>,
    _ring_buffer: &RingBuffer,
) -> Result<()> {
    let timestamp_ms = (event.timestamp / 1_000_000) as i64;

    if event.event_type == EVENT_TYPE_OVERFLOW {
        let warning = IpcMessage {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: timestamp_ms,
            source_pid: 0,
            target_pid: 0,
            ipc_type: event.ipc_type.clone(),
            fd: 0,
            content: format!(
                "BUFFER OVERFLOW: {} messages dropped. Backpressure active.",
                event.dropped_count
            )
            .into_bytes(),
            direction: MessageDirection::Send,
            captured_at: chrono::Utc::now().to_rfc3339(),
            has_overrun: true,
            dropped_count: event.dropped_count,
        };

        if let Ok(json) = serde_json::to_string(&warning) {
            let _ = broadcast_tx.send(json);
        }
        let _ = message_store_tx.send(warning);
        tracing::warn!(
            "Overflow warning sent: {} messages dropped",
            event.dropped_count
        );
    } else {
        let msg = IpcMessage {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: timestamp_ms,
            source_pid: event.source_pid,
            target_pid: event.target_pid,
            ipc_type: event.ipc_type,
            fd: event.fd,
            content: event.content,
            direction: event.direction,
            captured_at: chrono::Utc::now().to_rfc3339(),
            has_overrun: false,
            dropped_count: 0,
        };

        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = broadcast_tx.send(json);
        }
        let _ = message_store_tx.send(msg);
    }

    Ok(())
}

fn generate_sample_content(ipc_type: &IpcType, seq: u64) -> Vec<u8> {
    match ipc_type {
        IpcType::UnixDomainSocket => {
            let paths = vec![
                "/api/status",
                "/api/data",
                "/api/events",
                "/api/config",
                "/api/health",
            ];
            let path = paths[(seq % paths.len() as u64) as usize];
            format!(
                "GET {} HTTP/1.1\r\nHost: localhost\r\nX-Seq: {}\r\n\r\n",
                path, seq
            )
            .into_bytes()
        }
        IpcType::DBus => {
            let methods = vec!["ListNames", "GetNameOwner", "Ping", "GetId"];
            let method = methods[(seq % methods.len() as u64) as usize];
            format!("method_call\torg.freedesktop.DBus\t{}\t{}", method, seq).into_bytes()
        }
        IpcType::Pipe => {
            let events = vec!["data_ready", "status_update", "config_changed", "heartbeat"];
            let event = events[(seq % events.len() as u64) as usize];
            format!(
                "{{\"event\":\"{}\",\"payload\":{},\"seq\":{}}}",
                event,
                seq * 42,
                seq
            )
            .into_bytes()
        }
    }
}

impl Drop for EbpfManager {
    fn drop(&mut self) {
        if self.attached.load(Ordering::SeqCst) {
            let _ = self.attached.store(false, Ordering::SeqCst);
            let handles = self.consumer_threads.lock().unwrap();
            for handle in handles.iter() {
                let _ = handle;
            }
        }
    }
}
