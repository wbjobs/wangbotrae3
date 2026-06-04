import { io, Socket } from 'socket.io-client';

class SocketManager {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('Socket connected');
      this.emit('connect', {});
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
      this.emit('disconnect', {});
    });

    this.socket.on('doc-update', (data) => {
      this.emit('doc-update', data);
    });

    this.socket.on('doc-state', (data) => {
      this.emit('doc-state', data);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  joinTable(tableId: string) {
    if (this.socket) {
      this.socket.emit('join-table', tableId);
    }
  }

  leaveTable(tableId: string) {
    if (this.socket) {
      this.socket.emit('leave-table', tableId);
    }
  }

  sendSyncUpdate(data: {
    tableId: string;
    update: Uint8Array;
    userId: string;
    changes: any[];
  }) {
    if (this.socket?.connected) {
      this.socket.emit('sync-update', data);
      return true;
    }
    return false;
  }

  send(event: string, data: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
      return true;
    }
    return false;
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    if (this.socket) {
      this.socket.on(event, callback as any);
    }
  }

  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
    if (this.socket) {
      this.socket.off(event, callback as any);
    }
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((callback) => callback(data));
  }
}

export const socketManager = new SocketManager();
