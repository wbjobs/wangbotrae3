import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useMemo } from 'react';
import type { DeviceStatus } from '../../shared/types';
import { DeviceStatusLabels, DeviceStatusColors } from '../../shared/types';

interface StatisticsData {
  totalCount: number;
  normalCount: number;
  faultCount: number;
  warningCount: number;
  byStatus: Record<string, number>;
  byDevice: Record<string, number>;
  byTime?: { time: string; count: number }[];
}

interface StatisticsChartsProps {
  data?: StatisticsData;
}

export function StatisticsCharts({ data }: StatisticsChartsProps) {
  const mockData = useMemo((): StatisticsData => ({
    totalCount: 1256,
    normalCount: 987,
    faultCount: 189,
    warningCount: 80,
    byStatus: {
      normal: 987,
      bearing_fault: 87,
      gear_fault: 62,
      imbalance: 40,
    },
    byDevice: {
      'dev-001': 456,
      'dev-002': 523,
      'dev-003': 277,
    },
    byTime: Array.from({ length: 24 }, (_, i) => ({
      time: `${String(i).padStart(2, '0')}:00`,
      count: Math.floor(Math.random() * 80) + 20,
    })),
  }), []);

  const chartData = data || mockData;

  const statusPieOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: '#1E293B',
      borderColor: '#334155',
      textStyle: { color: '#fff' },
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: '#94A3B8', fontSize: 12 },
      formatter: (name) => DeviceStatusLabels[name as DeviceStatus] || name,
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 4,
        borderColor: '#0F172A',
        borderWidth: 2,
      },
      label: { show: false },
      emphasis: {
        label: {
          show: true,
          fontSize: 14,
          fontWeight: 'bold',
          color: '#fff',
          formatter: (params) => `${DeviceStatusLabels[params.name as DeviceStatus] || params.name}\n${params.value}`,
        },
      },
      data: Object.entries(chartData.byStatus).map(([name, value]) => ({
        value,
        name,
        itemStyle: { color: DeviceStatusColors[name as DeviceStatus] },
      })),
    }],
  };

  const deviceBarOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1E293B',
      borderColor: '#334155',
      textStyle: { color: '#fff' },
      axisPointer: { type: 'shadow' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: Object.keys(chartData.byDevice),
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#334155' } },
      splitLine: { lineStyle: { color: '#1E293B' } },
    },
    series: [{
      type: 'bar',
      data: Object.values(chartData.byDevice),
      itemStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#165DFF' },
            { offset: 1, color: '#165DFF40' },
          ],
        },
        borderRadius: [4, 4, 0, 0],
      },
      barWidth: '40%',
    }],
  };

  const timeLineOption: EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1E293B',
      borderColor: '#334155',
      textStyle: { color: '#fff' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      top: '10%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: chartData.byTime?.map(d => d.time) || [],
      axisLabel: { color: '#94A3B8', fontSize: 10 },
      axisLine: { lineStyle: { color: '#334155' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#94A3B8', fontSize: 11 },
      axisLine: { lineStyle: { color: '#334155' } },
      splitLine: { lineStyle: { color: '#1E293B' } },
    },
    series: [{
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: chartData.byTime?.map(d => d.count) || [],
      lineStyle: { color: '#165DFF', width: 2 },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: '#165DFF40' },
            { offset: 1, color: '#165DFF00' },
          ],
        },
      },
    }],
  };

  const stats = [
    { label: '总诊断次数', value: chartData.totalCount, color: '#165DFF' },
    { label: '正常次数', value: chartData.normalCount, color: '#00B42A' },
    { label: '故障次数', value: chartData.faultCount, color: '#F53F3F' },
    { label: '警告次数', value: chartData.warningCount, color: '#FF7D00' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="glass-card p-4">
            <div className="text-slate-400 text-sm mb-2">{stat.label}</div>
            <div className="text-3xl font-bold font-mono" style={{ color: stat.color }}>
              {stat.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="glass-card p-4">
          <h3 className="text-white font-medium mb-4">故障类型分布</h3>
          <div style={{ height: 280 }}>
            <ReactECharts option={statusPieOption} style={{ height: '100%' }} />
          </div>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-white font-medium mb-4">设备诊断统计</h3>
          <div style={{ height: 280 }}>
            <ReactECharts option={deviceBarOption} style={{ height: '100%' }} />
          </div>
        </div>
      </div>

      <div className="glass-card p-4">
        <h3 className="text-white font-medium mb-4">24小时诊断趋势</h3>
        <div style={{ height: 240 }}>
          <ReactECharts option={timeLineOption} style={{ height: '100%' }} />
        </div>
      </div>
    </div>
  );
}

export default StatisticsCharts;
