import { Bell, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { useDiagnosisStore } from '../../store/diagnosisStore';
import { useDiagnosis } from '../../hooks/useDiagnosis';
import { formatTimestamp } from '../../utils/format';
import { useState, useEffect } from 'react';

export function Header() {
  const { connectionStatus, alerts } = useDiagnosisStore();
  const { currentDevice } = useDiagnosis();
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const unreadAlerts = alerts.filter(a => a.status !== 'normal').length;

  const connectionConfig = {
    connected: { icon: Wifi, color: 'text-[#00B42A]', label: '已连接' },
    connecting: { icon: RefreshCw, color: 'text-[#FF7D00] animate-spin', label: '连接中' },
    disconnected: { icon: WifiOff, color: 'text-[#F53F3F]', label: '未连接' },
  };

  const config = connectionConfig[connectionStatus];
  const StatusIcon = config.icon;

  return (
    <header className="h-16 bg-slate-900/50 backdrop-blur-sm border-b border-slate-700/50 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-lg font-semibold text-white">
            {currentDevice ? currentDevice.name : '设备故障诊断系统'}
          </h1>
          {currentDevice && (
            <div className="text-xs text-slate-400">
              {currentDevice.type} · {currentDevice.location} · 采样率 {currentDevice.sampleRate / 1000}kHz
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-white font-mono text-sm">{formatTimestamp(currentTime)}</div>
          <div className="flex items-center justify-end gap-1.5 text-xs">
            <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
            <span className={config.color}>{config.label}</span>
          </div>
        </div>

        <div className="relative">
          <button className="relative p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
            <Bell className="w-5 h-5 text-slate-400" />
            {unreadAlerts > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#F53F3F] text-white text-xs rounded-full flex items-center justify-center font-medium">
                {unreadAlerts > 99 ? '99+' : unreadAlerts}
              </span>
            )}
          </button>
        </div>

        <div className="w-px h-8 bg-slate-700/50" />

        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#165DFF] to-[#00B42A] flex items-center justify-center text-white font-semibold">
            管
          </div>
          <div className="text-sm">
            <div className="text-white font-medium">管理员</div>
            <div className="text-xs text-slate-400">系统管理员</div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
