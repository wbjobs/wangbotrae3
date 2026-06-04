import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import dayjs from 'dayjs';
import type { DeviceData } from '@/types';

interface RealTimeChartProps {
  data: (DeviceData & { is_injected: boolean })[];
  metric: 'temperature' | 'humidity' | 'voltage' | 'current' | 'pressure';
  title: string;
  unit: string;
  color?: string;
}

const RealTimeChart: React.FC<RealTimeChartProps> = ({
  data,
  metric,
  title,
  unit,
  color = '#3b82f6',
}) => {
  const chartData = useMemo(() => {
    return data
      .filter((d) => d[metric] !== undefined)
      .map((d) => ({
        time: dayjs(d.timestamp).format('HH:mm:ss'),
        timestamp: d.timestamp,
        original: d.is_injected ? null : d[metric],
        injected: d.is_injected ? d[metric] : null,
        is_injected: d.is_injected,
      }))
      .slice(-100);
  }, [data, metric]);

  const customTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-slate-600 rounded p-3 shadow-lg">
          <p className="text-slate-300 text-sm mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {entry.value?.toFixed(2)} {unit}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <h3 className="text-base font-medium mb-3 text-slate-200">{title}</h3>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="time"
            stroke="#64748b"
            fontSize={11}
            tick={{ fill: '#94a3b8' }}
          />
          <YAxis
            stroke="#64748b"
            fontSize={11}
            tick={{ fill: '#94a3b8' }}
            unit={` ${unit}`}
          />
          <Tooltip content={customTooltip} />
          <Legend
            wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
            formatter={(value) => <span className="text-slate-300">{value}</span>}
          />
          <Line
            type="monotone"
            dataKey="original"
            name="原始数据"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="injected"
            name="注入后数据"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3, fill: '#ef4444' }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default RealTimeChart;
