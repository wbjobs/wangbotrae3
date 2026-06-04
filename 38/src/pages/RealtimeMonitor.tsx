import { useEffect, useCallback, useState } from 'react';
import { WaveformChart } from '../components/WaveformChart';
import { StatusCard } from '../components/StatusCard';
import { AlertList } from '../components/AlertList';
import { useDiagnosis } from '../hooks/useDiagnosis';
import { useWebSocket } from '../hooks/useWebSocket';
import { useDiagnosisStore } from '../store/diagnosisStore';
import type { Device } from '../../shared/types';
import { DeviceStatus } from '../../shared/types';
import { generateId } from '../utils/format';

export function RealtimeMonitor() {
  const { currentDevice, devices, waveformData, latestDiagnosis, selectDevice, simulateWaveform } = useDiagnosis();
  const { setConnectionStatus, addWaveformData, addDiagnosisResult } = useDiagnosisStore();
  const [useMockData, setUseMockData] = useState(true);

  const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
  const { connect, disconnect, isConnected, isConnecting } = useWebSocket({
    url: wsUrl,
    autoReconnect: true,
  });

  const generateMockDiagnosis = useCallback(() => {
    const rand = Math.random();
    let status: DeviceStatus;
    let confidence: number;
    let probabilities: Record<DeviceStatus, number>;

    if (rand < 0.7) {
      status = DeviceStatus.NORMAL;
      confidence = 0.85 + Math.random() * 0.15;
      probabilities = {
        normal: confidence,
        bearing_fault: (1 - confidence) * 0.4,
        gear_fault: (1 - confidence) * 0.3,
        imbalance: (1 - confidence) * 0.3,
      };
    } else if (rand < 0.85) {
      status = DeviceStatus.IMBALANCE;
      confidence = 0.7 + Math.random() * 0.25;
      probabilities = {
        normal: (1 - confidence) * 0.5,
        bearing_fault: (1 - confidence) * 0.2,
        gear_fault: (1 - confidence) * 0.1,
        imbalance: confidence,
      };
    } else if (rand < 0.95) {
      status = DeviceStatus.BEARING_FAULT;
      confidence = 0.75 + Math.random() * 0.2;
      probabilities = {
        normal: (1 - confidence) * 0.3,
        bearing_fault: confidence,
        gear_fault: (1 - confidence) * 0.4,
        imbalance: (1 - confidence) * 0.3,
      };
    } else {
      status = DeviceStatus.GEAR_FAULT;
      confidence = 0.7 + Math.random() * 0.25;
      probabilities = {
        normal: (1 - confidence) * 0.3,
        bearing_fault: (1 - confidence) * 0.4,
        gear_fault: confidence,
        imbalance: (1 - confidence) * 0.3,
      };
    }

    return {
      id: generateId(),
      deviceId: currentDevice?.id || 'dev-001',
      timestamp: Date.now(),
      status,
      confidence,
      probabilities,
      signalDuration: 10,
      sampleRate: currentDevice?.sampleRate || 10000,
    };
  }, [currentDevice]);

  useEffect(() => {
    if (!useMockData) {
      connect();
      return () => disconnect();
    } else {
      setConnectionStatus('connected');

      const waveformInterval = setInterval(() => {
        if (currentDevice?.status === 'online') {
          const data = simulateWaveform();
          addWaveformData(data);
        }
      }, 20);

      const diagnosisInterval = setInterval(() => {
        if (currentDevice?.status === 'online') {
          const diagnosis = generateMockDiagnosis();
          addDiagnosisResult(diagnosis);
        }
      }, 3000);

      return () => {
        clearInterval(waveformInterval);
        clearInterval(diagnosisInterval);
      };
    }
  }, [useMockData, connect, disconnect, currentDevice, simulateWaveform, generateMockDiagnosis, setConnectionStatus, addWaveformData, addDiagnosisResult]);

  const handleDeviceSelect = (device: Device) => {
    selectDevice(device);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">实时监测</h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">数据源:</span>
            <div className="flex rounded-lg overflow-hidden border border-slate-600">
              <button
                onClick={() => setUseMockData(true)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  useMockData ? 'bg-[#165DFF] text-white' : 'bg-transparent text-slate-400 hover:text-white'
                }`}
              >
                模拟数据
              </button>
              <button
                onClick={() => setUseMockData(false)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  !useMockData ? 'bg-[#165DFF] text-white' : 'bg-transparent text-slate-400 hover:text-white'
                }`}
              >
                WebSocket
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {devices.map((device) => (
              <button
                key={device.id}
                onClick={() => handleDeviceSelect(device)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  currentDevice?.id === device.id
                    ? 'bg-[#165DFF] text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                } ${device.status !== 'online' ? 'opacity-50 cursor-not-allowed' : ''}`}
                disabled={device.status !== 'online'}
              >
                {device.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              isConnected || useMockData ? 'bg-[#00B42A] animate-pulse' :
              isConnecting ? 'bg-[#FF7D00] animate-pulse' : 'bg-[#F53F3F]'
            }`} />
            <span className="text-sm text-slate-400">
              {isConnected || useMockData ? '已连接' : isConnecting ? '连接中' : '未连接'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <WaveformChart
            data={waveformData}
            sampleRate={currentDevice?.sampleRate || 10000}
            duration={10}
            height={280}
          />

          {latestDiagnosis && (
            <StatusCard
              status={latestDiagnosis.status}
              confidence={latestDiagnosis.confidence}
              deviceName={currentDevice?.name}
              timestamp={latestDiagnosis.timestamp}
              signalDuration={latestDiagnosis.signalDuration}
              probabilities={latestDiagnosis.probabilities}
            />
          )}
        </div>

        <div>
          <AlertList maxItems={15} />
        </div>
      </div>
    </div>
  );
}

export default RealtimeMonitor;
