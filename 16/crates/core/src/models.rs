use serde::{Deserialize, Serialize};

pub const DEFAULT_BUFFER_SIZE: usize = 8 * 1024 * 1024;
pub const MAX_BUFFER_SIZE: usize = 64 * 1024 * 1024;
pub const MIN_BUFFER_SIZE: usize = 1 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum IpcType {
    UnixDomainSocket,
    DBus,
    Pipe,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FieldType {
    String,
    Number,
    Boolean,
    Bytes,
    Object,
    Array,
    Null,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedField {
    pub name: String,
    pub field_type: FieldType,
    pub value: serde_json::Value,
    pub description: Option<String>,
    pub children: Option<Vec<ParsedField>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResult {
    pub success: bool,
    pub protocol_name: String,
    pub protocol_version: String,
    pub message_name: Option<String>,
    pub fields: Vec<ParsedField>,
    pub raw_json: Option<serde_json::Value>,
    pub error: Option<String>,
    pub parse_time_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolParser {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub ipc_types: Vec<IpcType>,
    pub port_filters: Option<Vec<u32>>,
    pub content_pattern: Option<String>,
    pub script: String,
    pub is_builtin: bool,
    pub created_at: String,
    pub updated_at: String,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseRequest {
    pub content: Vec<u8>,
    pub ipc_type: IpcType,
    pub fd: Option<u32>,
    pub source_pid: u32,
    pub target_pid: u32,
    pub direction: MessageDirection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializeRequest {
    pub fields: Vec<ParsedField>,
    pub raw_json: Option<serde_json::Value>,
    pub protocol_name: String,
    pub protocol_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMessage {
    pub id: String,
    pub timestamp: i64,
    pub source_pid: u32,
    pub target_pid: u32,
    pub ipc_type: IpcType,
    pub fd: u32,
    pub content: Vec<u8>,
    pub direction: MessageDirection,
    pub captured_at: String,
    pub has_overrun: bool,
    pub dropped_count: u64,
    pub parse_result: Option<ParseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageDirection {
    Send,
    Recv,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferStats {
    pub current_size: usize,
    pub max_size: usize,
    pub dropped_total: u64,
    pub backpressure_active: bool,
    pub consumer_threads: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverflowWarning {
    pub id: String,
    pub timestamp: i64,
    pub ipc_type: IpcType,
    pub dropped_count: u64,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessNode {
    pub pid: u32,
    pub name: String,
    pub cmdline: String,
    pub connections: Vec<ProcessConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessConnection {
    pub remote_pid: u32,
    pub ipc_type: IpcType,
    pub fd: u32,
    pub message_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessTree {
    pub nodes: Vec<ProcessNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageFilter {
    pub source_pid: Option<u32>,
    pub target_pid: Option<u32>,
    pub ipc_type: Option<IpcType>,
    pub search_text: Option<String>,
    pub time_start: Option<i64>,
    pub time_end: Option<i64>,
    pub limit: Option<u64>,
    pub offset: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayState {
    pub id: String,
    pub messages: Vec<IpcMessage>,
    pub current_index: usize,
    pub is_paused: bool,
    pub speed: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InjectRequest {
    pub original_message_id: String,
    pub modified_content: Vec<u8>,
    pub target_pid: u32,
    pub ipc_type: IpcType,
    pub fd: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    pub monitored_pids: Vec<u32>,
    pub ipc_types: Vec<IpcType>,
    pub max_ring_buffer_size: usize,
    pub capture_content: bool,
    pub consumer_threads: usize,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            monitored_pids: Vec::new(),
            ipc_types: vec![IpcType::UnixDomainSocket, IpcType::DBus, IpcType::Pipe],
            max_ring_buffer_size: DEFAULT_BUFFER_SIZE,
            capture_content: true,
            consumer_threads: 2,
        }
    }
}

impl CaptureConfig {
    pub fn validate(&mut self) {
        if self.max_ring_buffer_size < MIN_BUFFER_SIZE {
            self.max_ring_buffer_size = MIN_BUFFER_SIZE;
        }
        if self.max_ring_buffer_size > MAX_BUFFER_SIZE {
            self.max_ring_buffer_size = MAX_BUFFER_SIZE;
        }
        if self.max_ring_buffer_size.count_ones() != 1 {
            self.max_ring_buffer_size = self.max_ring_buffer_size.next_power_of_two();
            if self.max_ring_buffer_size > MAX_BUFFER_SIZE {
                self.max_ring_buffer_size = MAX_BUFFER_SIZE;
            }
        }
        if self.consumer_threads < 1 {
            self.consumer_threads = 1;
        }
        if self.consumer_threads > 8 {
            self.consumer_threads = 8;
        }
    }
}
