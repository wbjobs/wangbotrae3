import { AlertTriangle, XCircle, Bell, X, CheckCircle } from 'lucide-react';
import { DeviceStatus, DeviceStatusLabels, DeviceStatusColors } from '../../shared/types';
import { formatTimestamp, formatConfidence } from '../utils/format';
import { useDiagnosisStore } from '../store/diagnosisStore';

interface Alert {
  id: string;
  deviceId: string;
  deviceName: string;
  status: DeviceStatus;
  confidence: number;
  timestamp: number;
  message: string;
}

interface AlertListProps {
  maxItems?: number;
}

const alertIcons = {
  normal: CheckCircle,
  bearing_fault: XCircle,
  gear_fault: XCircle,
  imbalance: AlertTriangle,
};

export function AlertList({ maxItems = 20 }: AlertListProps) {
  const { alerts, removeAlert } = useDiagnosisStore();

  const displayAlerts = alerts.slice(0, maxItems);

  if (displayAlerts.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="w-5 h-5 text-slate-400" />
          <h3 className="text-white font-medium">告警列表</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="w-12 h-12 text-[#00B42A] mb-3" />
          <div className="text-slate-400 text-sm">暂无告警信息</div>
          <div className="text-slate-500 text-xs mt-1">系统运行正常</div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#F53F3F]" />
          <h3 className="text-white font-medium">告警列表</h3>
          <span className="px-2 py-0.5 bg-[#F53F3F]/20 text-[#F53F3F] text-xs rounded-full">
            {alerts.length}
          </span>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {displayAlerts.map((alert) => {
          const color = DeviceStatusColors[alert.status];
          const Icon = alertIcons[alert.status];

          return (
            <div
              key={alert.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800/70 transition-colors group"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: color + '20' }}
              >
                <Icon className="w-4 h-4" style={{ color }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-white truncate">
                    {alert.deviceName}
                  </span>
                  <span
                    className="px-1.5 py-0.5 text-xs rounded"
                    style={{ backgroundColor: color + '20', color }}
                  >
                    {DeviceStatusLabels[alert.status]}
                  </span>
                </div>
                <div className="text-xs text-slate-400 mb-1">{alert.message}</div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-500">
                    {formatTimestamp(alert.timestamp)}
                  </span>
                  <span className="text-slate-500">
                    置信度: {formatConfidence(alert.confidence)}
                  </span>
                </div>
              </div>

              <button
                onClick={() => removeAlert(alert.id)}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-700/50 transition-all"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AlertList;
