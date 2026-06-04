import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import {
  ApartmentOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  SyncOutlined,
  RiseOutlined,
  SoundOutlined,
  HistoryOutlined,
  QuestionCircleOutlined,
  BranchOutlined,
  GatewayOutlined,
  HourglassOutlined,
} from '@ant-design/icons';

const anomalyIcons: Record<string, React.ReactNode> = {
  packet_loss: <DeleteOutlined />,
  out_of_order: <SyncOutlined />,
  delay: <ClockCircleOutlined />,
  value_spike: <ThunderboltOutlined />,
  timestamp_drift: <HistoryOutlined />,
  value_drift: <RiseOutlined />,
  data_stagnation: <WarningOutlined />,
  noise_injection: <SoundOutlined />,
};

const anomalyColors: Record<string, string> = {
  packet_loss: 'border-red-500 bg-red-900/30',
  out_of_order: 'border-orange-500 bg-orange-900/30',
  delay: 'border-yellow-500 bg-yellow-900/30',
  value_spike: 'border-pink-500 bg-pink-900/30',
  timestamp_drift: 'border-blue-500 bg-blue-900/30',
  value_drift: 'border-purple-500 bg-purple-900/30',
  data_stagnation: 'border-cyan-500 bg-cyan-900/30',
  noise_injection: 'border-green-500 bg-green-900/30',
};

export const DeviceNode = memo(({ data, selected }: NodeProps) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 ${
      selected ? 'border-blue-400' : 'border-blue-600'
    } bg-blue-900/40 min-w-[120px]`}
  >
    <Handle type="source" position={Position.Right} className="!bg-blue-500" />
    <div className="flex items-center gap-2">
      <ApartmentOutlined className="text-blue-400 text-lg" />
      <div>
        <div className="font-medium text-sm text-blue-200">{data.label}</div>
        <div className="text-xs text-blue-400">{data.deviceId || '设备'}</div>
      </div>
    </div>
  </div>
));

export const DelayNode = memo(({ data, selected }: NodeProps) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 ${
      selected ? 'border-yellow-400' : 'border-yellow-600'
    } bg-yellow-900/40 min-w-[120px]`}
  >
    <Handle type="target" position={Position.Left} className="!bg-yellow-500" />
    <Handle type="source" position={Position.Right} className="!bg-yellow-500" />
    <div className="flex items-center gap-2">
      <HourglassOutlined className="text-yellow-400 text-lg" />
      <div>
        <div className="font-medium text-sm text-yellow-200">{data.label || '延迟'}</div>
        <div className="text-xs text-yellow-400">
          {data.delaySeconds || data.config?.delay_seconds || 2}秒
        </div>
      </div>
    </div>
  </div>
));

export const ConditionNode = memo(({ data, selected }: NodeProps) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 ${
      selected ? 'border-purple-400' : 'border-purple-600'
    } bg-purple-900/40 min-w-[140px]`}
  >
    <Handle type="target" position={Position.Left} className="!bg-purple-500" />
    <Handle type="source" position={Position.Right} className="!bg-purple-500" />
    <div className="flex items-center gap-2">
      <QuestionCircleOutlined className="text-purple-400 text-lg" />
      <div>
        <div className="font-medium text-sm text-purple-200">{data.label || '条件'}</div>
        <div className="text-xs text-purple-400 truncate max-w-[100px]">
          {data.expression || data.config?.expression || 'condition'}
        </div>
      </div>
    </div>
  </div>
));

export const ParallelNode = memo(({ data, selected }: NodeProps) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 ${
      selected ? 'border-indigo-400' : 'border-indigo-600'
    } bg-indigo-900/40 min-w-[130px]`}
  >
    <Handle type="target" position={Position.Left} className="!bg-indigo-500" />
    <Handle type="source" position={Position.Right} className="!bg-indigo-500" />
    <div className="flex items-center gap-2">
      <BranchOutlined className="text-indigo-400 text-lg" />
      <div>
        <div className="font-medium text-sm text-indigo-200">{data.label || '并行分支'}</div>
        <div className="text-xs text-indigo-400">
          {data.branchCount || data.config?.branch_count || 2}路并行
        </div>
      </div>
    </div>
  </div>
));

export const AnomalyNode = memo(({ data, selected }: NodeProps) => {
  const anomalyType = data.anomalyType || 'value_spike';
  const icon = anomalyIcons[anomalyType] || <ThunderboltOutlined />;
  const colorClass = anomalyColors[anomalyType] || 'border-slate-500 bg-slate-800';
  const displayName = data.label || anomalyType;

  return (
    <div
      className={`px-4 py-3 rounded-lg border-2 ${colorClass} ${
        selected ? 'ring-2 ring-white/30' : ''
      } min-w-[140px] ${data.parallelGroup ? 'border-dashed' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <div>
          <div className="font-medium text-sm">{displayName}</div>
          <div className="text-xs text-slate-400">
            概率: {((data.config?.probability || 1) * 100).toFixed(0)}%
            {data.delaySeconds ? ` | 延迟${data.delaySeconds}s` : ''}
          </div>
        </div>
      </div>
      {data.parallelGroup && (
        <div className="mt-1 text-xs text-indigo-400">
          [并行组: {data.parallelGroup}]
        </div>
      )}
    </div>
  );
});

export const OutputNode = memo(({ data, selected }: NodeProps) => (
  <div
    className={`px-4 py-3 rounded-lg border-2 ${
      selected ? 'border-green-400' : 'border-green-600'
    } bg-green-900/40 min-w-[120px]`}
  >
    <Handle type="target" position={Position.Left} className="!bg-green-500" />
    <div className="flex items-center gap-2">
      <DatabaseOutlined className="text-green-400 text-lg" />
      <div>
        <div className="font-medium text-sm text-green-200">{data.label || '输出'}</div>
        <div className="text-xs text-green-400">InfluxDB</div>
      </div>
    </div>
  </div>
));

export const nodeTypes = {
  device: DeviceNode,
  delay: DelayNode,
  condition: ConditionNode,
  parallel: ParallelNode,
  anomaly: AnomalyNode,
  output: OutputNode,
};

export default nodeTypes;
