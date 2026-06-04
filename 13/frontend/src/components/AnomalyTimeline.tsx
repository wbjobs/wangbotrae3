import React, { useMemo } from 'react';
import { Timeline, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import {
  AlertOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  SyncOutlined,
  DeleteOutlined,
  RiseOutlined,
  SoundOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { AnomalyEvent } from '@/types';

interface AnomalyTimelineProps {
  events: AnomalyEvent[];
  limit?: number;
}

const anomalyConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  packet_loss: {
    color: 'red',
    icon: <DeleteOutlined />,
    label: '丢包',
  },
  out_of_order: {
    color: 'orange',
    icon: <SyncOutlined />,
    label: '乱序',
  },
  delay: {
    color: 'gold',
    icon: <ClockCircleOutlined />,
    label: '延迟',
  },
  value_spike: {
    color: 'magenta',
    icon: <ThunderboltOutlined />,
    label: '数值突变',
  },
  timestamp_drift: {
    color: 'geekblue',
    icon: <HistoryOutlined />,
    label: '时间戳漂移',
  },
  value_drift: {
    color: 'purple',
    icon: <RiseOutlined />,
    label: '数值漂移',
  },
  data_stagnation: {
    color: 'cyan',
    icon: <WarningOutlined />,
    label: '数据停滞',
  },
  noise_injection: {
    color: 'lime',
    icon: <SoundOutlined />,
    label: '噪声注入',
  },
  time_travel_start: {
    color: 'blue',
    icon: <HistoryOutlined />,
    label: '时间旅行开始',
  },
  time_travel_complete: {
    color: 'green',
    icon: <HistoryOutlined />,
    label: '时间旅行完成',
  },
  time_travel_stopped: {
    color: 'red',
    icon: <HistoryOutlined />,
    label: '时间旅行停止',
  },
  timestamp_monotonicity_correction: {
    color: 'volcano',
    icon: <SafetyCertificateOutlined />,
    label: '时间戳修正',
  },
};

const AnomalyTimeline: React.FC<AnomalyTimelineProps> = ({ events, limit = 20 }) => {
  const displayEvents = useMemo(() => events.slice(0, limit), [events, limit]);

  const formatValue = (value: any) => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 h-full">
      <h3 className="text-base font-medium mb-4 text-slate-200 flex items-center gap-2">
        <AlertOutlined className="text-warning-500" />
        异常事件时间轴
      </h3>
      <div className="overflow-y-auto max-h-[calc(100%-48px)]">
        {displayEvents.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <AlertOutlined className="text-3xl mb-2 opacity-50" />
            <p>暂无异常事件</p>
          </div>
        ) : (
          <Timeline
            mode="left"
            items={displayEvents.map((event) => {
              const config = anomalyConfig[event.anomaly_type] || {
                color: 'gray',
                icon: <AlertOutlined />,
                label: event.anomaly_type,
              };
              return {
                color: config.color as any,
                dot: config.icon,
                label: (
                  <span className="text-xs text-slate-400">
                    {dayjs(event.timestamp).format('HH:mm:ss.SSS')}
                  </span>
                ),
                children: (
                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Tag color={config.color} className="m-0">
                        {config.label}
                      </Tag>
                      <span className="text-xs text-slate-400">{event.device_id}</span>
                    </div>
                    {(event.original_value !== undefined || event.injected_value !== undefined) && (
                      <Tooltip
                        title={
                          <div>
                            {event.original_value !== undefined && (
                              <div>原值: {formatValue(event.original_value)}</div>
                            )}
                            {event.injected_value !== undefined && (
                              <div>注入后: {formatValue(event.injected_value)}</div>
                            )}
                          </div>
                        }
                      >
                        <div className="text-xs text-slate-500 cursor-help">
                          原值 → 注入后
                        </div>
                      </Tooltip>
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </div>
    </div>
  );
};

export default AnomalyTimeline;
