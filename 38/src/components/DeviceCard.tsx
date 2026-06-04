import { Settings, Power, Wrench, Cpu, MapPin, Activity } from 'lucide-react';
import type { Device } from '../../shared/types';
import { cn } from '@/lib/utils';
import { formatTimestamp, formatSampleRate } from '../utils/format';

interface DeviceCardProps {
  device: Device;
  selected?: boolean;
  onSelect?: (device: Device) => void;
  onEdit?: (device: Device) => void;
}

const statusConfig = {
  online: {
    label: '在线',
    color: 'text-[#00B42A]',
    bgColor: 'bg-[#00B42A]/10',
    borderColor: 'border-[#00B42A]/30',
    dotColor: 'bg-[#00B42A]',
  },
  offline: {
    label: '离线',
    color: 'text-slate-500',
    bgColor: 'bg-slate-700/50',
    borderColor: 'border-slate-600/30',
    dotColor: 'bg-slate-500',
  },
  maintenance: {
    label: '维护中',
    color: 'text-[#FF7D00]',
    bgColor: 'bg-[#FF7D00]/10',
    borderColor: 'border-[#FF7D00]/30',
    dotColor: 'bg-[#FF7D00]',
  },
};

export function DeviceCard({ device, selected = false, onSelect, onEdit }: DeviceCardProps) {
  const config = statusConfig[device.status];

  return (
    <div
      className={cn(
        'glass-card p-5 cursor-pointer transition-all duration-200 hover:scale-[1.02]',
        selected && 'ring-2 ring-[#165DFF] border-[#165DFF]/50'
      )}
      onClick={() => onSelect?.(device)}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center',
            config.bgColor,
            config.borderColor,
            'border'
          )}>
            <Cpu className={cn('w-6 h-6', config.color)} />
          </div>
          <div>
            <h3 className="text-white font-semibold">{device.name}</h3>
            <p className="text-slate-400 text-sm">{device.type}</p>
          </div>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
          config.bgColor
        )}>
          <span className={cn('w-2 h-2 rounded-full animate-pulse', config.dotColor)} />
          <span className={cn('text-xs font-medium', config.color)}>{config.label}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-slate-500" />
          <span className="text-slate-400">位置:</span>
          <span className="text-slate-300">{device.location}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4 text-slate-500" />
          <span className="text-slate-400">采样率:</span>
          <span className="text-slate-300 font-mono">{formatSampleRate(device.sampleRate)}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Power className="w-4 h-4 text-slate-500" />
          <span className="text-slate-400">传感器:</span>
          <span className="text-slate-300">{device.sensorCount} 个</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
        <div className="text-xs text-slate-500">
          更新于 {formatTimestamp(device.updatedAt)}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.(device);
          }}
          className="p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors group"
        >
          <Settings className="w-4 h-4 text-slate-400 group-hover:text-[#165DFF]" />
        </button>
      </div>

      {device.status === 'maintenance' && (
        <div className="mt-4 flex items-center gap-2 p-2 rounded-lg bg-[#FF7D00]/10 border border-[#FF7D00]/30">
          <Wrench className="w-4 h-4 text-[#FF7D00]" />
          <span className="text-xs text-[#FF7D00]">设备正在维护中，暂停监测</span>
        </div>
      )}
    </div>
  );
}

export default DeviceCard;
