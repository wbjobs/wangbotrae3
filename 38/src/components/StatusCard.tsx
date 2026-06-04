import { DeviceStatus, DeviceStatusLabels, DeviceStatusColors } from '../../shared/types';
import { ConfidenceRing } from './ConfidenceRing';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface StatusCardProps {
  status: DeviceStatus;
  confidence: number;
  deviceName?: string;
  timestamp?: number;
  signalDuration?: number;
  probabilities?: Record<DeviceStatus, number>;
}

const statusIcons = {
  normal: CheckCircle,
  bearing_fault: XCircle,
  gear_fault: XCircle,
  imbalance: AlertTriangle,
};

const statusStyles = {
  normal: 'border-[#00B42A] bg-[#00B42A]/5',
  bearing_fault: 'border-[#F53F3F] bg-[#F53F3F]/5',
  gear_fault: 'border-[#F53F3F] bg-[#F53F3F]/5',
  imbalance: 'border-[#FF7D00] bg-[#FF7D00]/5',
};

export function StatusCard({
  status,
  confidence,
  deviceName,
  timestamp,
  signalDuration,
  probabilities,
}: StatusCardProps) {
  const color = DeviceStatusColors[status];
  const label = DeviceStatusLabels[status];
  const StatusIcon = statusIcons[status];
  const style = statusStyles[status];

  const formatTime = (ts?: number) => {
    if (!ts) return '--';
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  };

  return (
    <div className={`glass-card p-6 border-2 ${style}`}>
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon className={`w-5 h-5`} style={{ color }} />
            <span className="text-sm text-slate-400">当前状态</span>
          </div>
          <div className="text-4xl font-bold" style={{ color }}>
            {label}
          </div>
        </div>
        <ConfidenceRing
          value={confidence * 100}
          size={100}
          strokeWidth={8}
          color={color}
          label="置信度"
        />
      </div>

      {deviceName && (
        <div className="flex items-center justify-between py-2 border-t border-slate-700/50">
          <span className="text-sm text-slate-400">设备</span>
          <span className="text-sm text-white font-medium">{deviceName}</span>
        </div>
      )}

      {timestamp && (
        <div className="flex items-center justify-between py-2 border-t border-slate-700/50">
          <span className="text-sm text-slate-400">诊断时间</span>
          <span className="text-sm text-white font-mono">{formatTime(timestamp)}</span>
        </div>
      )}

      {signalDuration !== undefined && (
        <div className="flex items-center justify-between py-2 border-t border-slate-700/50">
          <span className="text-sm text-slate-400">信号时长</span>
          <span className="text-sm text-white font-mono">{signalDuration.toFixed(2)}s</span>
        </div>
      )}

      {probabilities && (
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <div className="text-xs text-slate-400 mb-3">各类别概率</div>
          <div className="space-y-2">
            {Object.entries(probabilities).map(([key, value]) => {
              const status = key as DeviceStatus;
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-slate-300 w-20">
                    {DeviceStatusLabels[status]}
                  </span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${value * 100}%`,
                        backgroundColor: DeviceStatusColors[status],
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 font-mono w-12 text-right">
                    {(value * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default StatusCard;
