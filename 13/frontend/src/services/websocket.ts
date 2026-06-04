import type { WebSocketMessage, DeviceData, AnomalyEvent } from '@/types';

type MessageHandler = (message: WebSocketMessage) => void;
type DataHandler = (data: DeviceData & { is_injected: boolean }) => void;
type EventHandler = (event: AnomalyEvent) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private messageHandlers: Set<MessageHandler> = new Set();
  private dataHandlers: Set<DataHandler> = new Set();
  private eventHandlers: Set<EventHandler> = new Set();
  private deviceId: string | null = null;

  connect(deviceId?: string) {
    this.deviceId = deviceId || null;
    const url = deviceId ? `/ws?device_id=${deviceId}` : '/ws';
    
    try {
      this.ws = new WebSocket(`ws://${window.location.host}${url}`);
      
      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.reconnect();
      };
    } catch (e) {
      console.error('Failed to connect WebSocket:', e);
      this.reconnect();
    }
  }

  private reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Reconnecting attempt ${this.reconnectAttempts}...`);
    
    setTimeout(() => {
      this.connect(this.deviceId || undefined);
    }, this.reconnectDelay);
  }

  private handleMessage(message: WebSocketMessage) {
    this.messageHandlers.forEach((handler) => handler(message));

    switch (message.type) {
      case 'device_data':
        this.dataHandlers.forEach((handler) =>
          handler({
            device_id: message.device_id!,
            timestamp: message.timestamp!,
            temperature: message.data?.temperature,
            humidity: message.data?.humidity,
            voltage: message.data?.voltage,
            current: message.data?.current,
            pressure: message.data?.pressure,
            is_injected: message.is_injected || false,
          })
        );
        break;
      case 'anomaly_event':
        this.eventHandlers.forEach((handler) =>
          handler({
            id: message.id!,
            device_id: message.device_id!,
            anomaly_type: message.anomaly_type!,
            timestamp: message.timestamp!,
            parameters: message.parameters || {},
            original_value: message.original_value,
            injected_value: message.injected_value,
          })
        );
        break;
    }
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onDeviceData(handler: DataHandler) {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onAnomalyEvent(handler: EventHandler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.messageHandlers.clear();
    this.dataHandlers.clear();
    this.eventHandlers.clear();
  }
}

export const wsService = new WebSocketService();
