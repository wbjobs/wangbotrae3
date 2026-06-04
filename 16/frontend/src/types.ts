export type IpcType = 'UnixDomainSocket' | 'DBus' | 'Pipe';
export type MessageDirection = 'Send' | 'Recv';

export interface IpcMessage {
  id: string;
  timestamp: number;
  source_pid: number;
  target_pid: number;
  ipc_type: IpcType;
  fd: number;
  content: number[];
  direction: MessageDirection;
  captured_at: string;
  has_overrun: boolean;
  dropped_count: number;
}

export interface BufferStats {
  current_size: number;
  max_size: number;
  dropped_total: number;
  backpressure_active: boolean;
  consumer_threads: number;
}

export interface ProcessNode {
  pid: number;
  name: string;
  cmdline: string;
  connections: ProcessConnection[];
}

export interface ProcessConnection {
  remote_pid: number;
  ipc_type: IpcType;
  fd: number;
  message_count: number;
}

export interface ProcessTree {
  nodes: ProcessNode[];
}

export interface MessageFilter {
  source_pid?: number;
  target_pid?: number;
  ipc_type?: IpcType;
  search_text?: string;
  time_start?: number;
  time_end?: number;
  limit?: number;
  offset?: number;
}

export interface ReplayState {
  id: string;
  messages: IpcMessage[];
  current_index: number;
  is_paused: boolean;
  speed: number;
}

export interface InjectRequest {
  original_message_id: string;
  modified_content: number[];
  target_pid: number;
  ipc_type: IpcType;
  fd: number;
}

export interface CaptureConfig {
  monitored_pids: number[];
  ipc_types: IpcType[];
  max_ring_buffer_size: number;
  capture_content: boolean;
  consumer_threads: number;
}

export const DEFAULT_BUFFER_SIZE = 8 * 1024 * 1024;
export const MAX_BUFFER_SIZE = 64 * 1024 * 1024;
export const MIN_BUFFER_SIZE = 1 * 1024 * 1024;
export const BUFFER_SIZE_OPTIONS = [
  { value: 1 * 1024 * 1024, label: '1 MB' },
  { value: 2 * 1024 * 1024, label: '2 MB' },
  { value: 4 * 1024 * 1024, label: '4 MB' },
  { value: 8 * 1024 * 1024, label: '8 MB (默认)' },
  { value: 16 * 1024 * 1024, label: '16 MB' },
  { value: 32 * 1024 * 1024, label: '32 MB' },
  { value: 64 * 1024 * 1024, label: '64 MB' },
];
