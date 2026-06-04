import { IpcMessage, MessageFilter, ProcessTree, ReplayState, InjectRequest, CaptureConfig, BufferStats } from '../types';

const API_BASE = 'http://localhost:9222/api';

export async function fetchMessages(filter: MessageFilter): Promise<IpcMessage[]> {
  const params = new URLSearchParams();
  if (filter.source_pid) params.set('source_pid', String(filter.source_pid));
  if (filter.target_pid) params.set('target_pid', String(filter.target_pid));
  if (filter.ipc_type) params.set('ipc_type', JSON.stringify(filter.ipc_type));
  if (filter.search_text) params.set('search', filter.search_text);
  if (filter.time_start) params.set('time_start', String(filter.time_start));
  if (filter.time_end) params.set('time_end', String(filter.time_end));
  if (filter.limit) params.set('limit', String(filter.limit));
  if (filter.offset) params.set('offset', String(filter.offset));

  const res = await fetch(`${API_BASE}/messages?${params}`);
  return res.json();
}

export async function fetchMessage(id: string): Promise<IpcMessage | null> {
  const res = await fetch(`${API_BASE}/messages/${id}`);
  return res.json();
}

export async function fetchProcessTree(): Promise<ProcessTree> {
  const res = await fetch(`${API_BASE}/process-tree`);
  return res.json();
}

export async function startCapture(): Promise<void> {
  await fetch(`${API_BASE}/capture/start`, { method: 'POST' });
}

export async function stopCapture(): Promise<void> {
  await fetch(`${API_BASE}/capture/stop`, { method: 'POST' });
}

export async function getConfig(): Promise<CaptureConfig> {
  const res = await fetch(`${API_BASE}/capture/config`);
  return res.json();
}

export async function updateConfig(config: CaptureConfig): Promise<void> {
  await fetch(`${API_BASE}/capture/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export async function injectMessage(req: InjectRequest): Promise<any> {
  const res = await fetch(`${API_BASE}/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return res.json();
}

export async function startReplay(filter: MessageFilter): Promise<ReplayState> {
  const res = await fetch(`${API_BASE}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  return res.json();
}

export async function getBufferStats(): Promise<BufferStats> {
  const res = await fetch(`${API_BASE}/capture/stats`);
  return res.json();
}

export async function resetDroppedCount(): Promise<void> {
  await fetch(`${API_BASE}/capture/reset-dropped`, { method: 'POST' });
}

export type WsMessageCallback = (msg: IpcMessage) => void;

let wsInstance: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function createWsConnection(onMessage: WsMessageCallback): WebSocket {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const ws = new WebSocket('ws://localhost:9222/ws');
  wsInstance = ws;
  ws.onmessage = (event) => {
    try {
      const msg: IpcMessage = JSON.parse(event.data);
      onMessage(msg);
    } catch (e) {
      console.error('WS parse error:', e);
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    if (wsInstance === ws) {
      wsInstance = null;
      reconnectTimer = setTimeout(() => createWsConnection(onMessage), 2000);
    }
  };
  return ws;
}

export function closeWsConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsInstance) {
    wsInstance.onclose = null;
    wsInstance.close();
    wsInstance = null;
  }
}
