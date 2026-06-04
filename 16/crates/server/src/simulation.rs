use ipc_debugger_core::models::*;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

use crate::AppState;

pub fn start_simulator(state: Arc<AppState>) {
    let sim_running = state.simulation_running.clone();
    let state_clone = state.clone();

    tokio::spawn(async move {
        let mut running = sim_running.lock().await;
        *running = true;
        drop(running);

        let mut counter: u32 = 0;
        loop {
            let is_running = *sim_running.lock().await;
            if !is_running {
                sleep(Duration::from_millis(500)).await;
                continue;
            }

            counter += 1;
            let ipc_type = match counter % 3 {
                0 => IpcType::UnixDomainSocket,
                1 => IpcType::DBus,
                _ => IpcType::Pipe,
            };

            let source_pid = 1000 + (counter % 5) * 100;
            let target_pid = 2000 + (counter % 3) * 100;

            let content = match ipc_type {
                IpcType::UnixDomainSocket => {
                    format!("{{\"id\":{counter},\"method\":\"getStatus\",\"params\":{{\"service\":\"api\"}}}}").into_bytes()
                }
                IpcType::DBus => {
                    format!("method_call\torg.example.Service{counter}\t/org/example/Service{counter}\tGetMethod").into_bytes()
                }
                IpcType::Pipe => {
                    format!("{{\"seq\":{counter},\"type\":\"event\",\"data\":{{\"value\":{}}}}}", counter * 7).into_bytes()
                }
            };

            let msg = IpcMessage {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                source_pid,
                target_pid,
                ipc_type,
                fd: 3 + (counter % 5),
                content,
                direction: if counter % 2 == 0 {
                    MessageDirection::Send
                } else {
                    MessageDirection::Recv
                },
                captured_at: chrono::Utc::now().to_rfc3339(),
                has_overrun: false,
                dropped_count: 0,
            };

            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = state_clone.tx.send(json);
            }

            if let Err(e) = state_clone.store.insert(&msg).await {
                tracing::warn!("Simulator insert error: {e}");
            }

            sleep(Duration::from_millis((300 + (counter % 5) * 100) as u64)).await;
        }
    });
}
