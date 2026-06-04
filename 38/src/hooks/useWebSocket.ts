import { useEffect, useRef, useCallback, useState } from 'react';
import { useDiagnosisStore } from '../store/diagnosisStore';
import type { WebSocketMessage, RealtimeSignalData, RealtimeDiagnosisData, DeviceStatus } from '../../shared/types';
import { generateId } from '../utils/format';

interface UseWebSocketOptions {
  url: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseWebSocketReturn {
  send: (data: object) => void;
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  reconnectAttempts: number;
}

export function useWebSocket({
  url,
  autoReconnect = true,
  reconnectInterval = 3000,
  maxReconnectAttempts = 10,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<object[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manuallyDisconnectedRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const {
    setConnectionStatus,
    addWaveformData,
    addDiagnosisResult,
    addAlert,
    devices,
  } = useDiagnosisStore();

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (message.type === 'signal_data') {
        const signalData = message as RealtimeSignalData;
        addWaveformData(signalData.signal);
      } else if (message.type === 'diagnosis_result') {
        const diagnosisData = message as RealtimeDiagnosisData;
        addDiagnosisResult(diagnosisData.data);

        const status = diagnosisData.data.status;
        if (status !== 'normal') {
          const device = devices.find(d => d.id === diagnosisData.data.deviceId);
          addAlert({
            id: generateId(),
            deviceId: diagnosisData.data.deviceId,
            deviceName: device?.name || '未知设备',
            status: status as DeviceStatus,
            confidence: diagnosisData.data.confidence,
            timestamp: diagnosisData.data.timestamp,
            message: status === 'bearing_fault' ? '检测到轴承故障' :
                     status === 'gear_fault' ? '检测到齿轮故障' :
                     status === 'imbalance' ? '检测到不平衡状态' : '设备异常',
          });
        }
      }
    } catch (error) {
      console.error('WebSocket message parsing error:', error);
    }
  }, [addWaveformData, addDiagnosisResult, addAlert, devices]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || isConnecting) return;

    manuallyDisconnectedRef.current = false;
    setIsConnecting(true);
    setConnectionStatus('connecting');

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        setConnectionStatus('connected');
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);

        while (messageQueueRef.current.length > 0) {
          const data = messageQueueRef.current.shift();
          if (data && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
          }
        }
      };

      wsRef.current.onmessage = handleMessage;

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        setIsConnecting(false);
        setConnectionStatus('disconnected');
      };

      wsRef.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        setConnectionStatus('disconnected');

        if (autoReconnect && !manuallyDisconnectedRef.current &&
            reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          setReconnectAttempts(reconnectAttemptsRef.current);

          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };
    } catch (error) {
      console.error('WebSocket connection error:', error);
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    }
  }, [url, autoReconnect, reconnectInterval, maxReconnectAttempts, handleMessage, setConnectionStatus, isConnecting]);

  const disconnect = useCallback(() => {
    manuallyDisconnectedRef.current = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setConnectionStatus('disconnected');
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
  }, [setConnectionStatus]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      messageQueueRef.current.push(data);
      if (!isConnecting && !isConnected) {
        connect();
      }
    }
  }, [connect, isConnected, isConnecting]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    send,
    connect,
    disconnect,
    isConnected,
    isConnecting,
    reconnectAttempts,
  };
}

export default useWebSocket;
