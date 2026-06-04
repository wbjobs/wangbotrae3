import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Eye, Download } from 'lucide-react';
import type { DiagnosisResult, DeviceStatus } from '../../shared/types';
import { DeviceStatusLabels, DeviceStatusColors } from '../../shared/types';
import { formatTimestamp, formatConfidence, formatDuration, formatSampleRate } from '../utils/format';

interface HistoryTableProps {
  data: DiagnosisResult[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onView?: (item: DiagnosisResult) => void;
  onDownload?: (item: DiagnosisResult) => void;
}

interface SortConfig {
  key: keyof DiagnosisResult;
  direction: 'asc' | 'desc';
}

export function HistoryTable({
  data,
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
  onView,
  onDownload,
}: HistoryTableProps) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: 'timestamp',
    direction: 'desc',
  });

  const totalPages = Math.ceil(total / pageSize);

  const handleSort = (key: keyof DiagnosisResult) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof DiagnosisResult }) => {
    if (sortConfig.key !== columnKey) {
      return <ChevronDown className="w-3 h-3 opacity-30" />;
    }
    return sortConfig.direction === 'desc'
      ? <ChevronDown className="w-3 h-3 text-[#165DFF]" />
      : <ChevronUp className="w-3 h-3 text-[#165DFF]" />;
  };

  const getStatusBadge = (status: DeviceStatus) => {
    const color = DeviceStatusColors[status];
    return (
      <span
        className="px-2 py-0.5 text-xs rounded-full font-medium"
        style={{ backgroundColor: color + '20', color }}
      >
        {DeviceStatusLabels[status]}
      </span>
    );
  };

  if (data.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <div className="text-slate-400 text-sm">暂无诊断记录</div>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/30">
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('timestamp')}
              >
                <div className="flex items-center gap-1">
                  诊断时间
                  <SortIcon columnKey="timestamp" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('deviceId')}
              >
                <div className="flex items-center gap-1">
                  设备ID
                  <SortIcon columnKey="deviceId" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  诊断结果
                  <SortIcon columnKey="status" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('confidence')}
              >
                <div className="flex items-center gap-1">
                  置信度
                  <SortIcon columnKey="confidence" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('signalDuration')}
              >
                <div className="flex items-center gap-1">
                  信号时长
                  <SortIcon columnKey="signalDuration" />
                </div>
              </th>
              <th
                className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:bg-slate-700/30"
                onClick={() => handleSort('sampleRate')}
              >
                <div className="flex items-center gap-1">
                  采样率
                  <SortIcon columnKey="sampleRate" />
                </div>
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {data.map((item) => (
              <tr
                key={item.id}
                className="hover:bg-slate-700/20 transition-colors"
              >
                <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                  {formatTimestamp(item.timestamp)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                  {item.deviceId}
                </td>
                <td className="px-4 py-3">
                  {getStatusBadge(item.status)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                  {formatConfidence(item.confidence)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                  {formatDuration(item.signalDuration)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                  {formatSampleRate(item.sampleRate)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {onView && (
                      <button
                        onClick={() => onView(item)}
                        className="p-1.5 rounded hover:bg-slate-700/50 transition-colors group"
                        title="查看详情"
                      >
                        <Eye className="w-4 h-4 text-slate-400 group-hover:text-[#165DFF]" />
                      </button>
                    )}
                    {onDownload && (
                      <button
                        onClick={() => onDownload(item)}
                        className="p-1.5 rounded hover:bg-slate-700/50 transition-colors group"
                        title="下载结果"
                      >
                        <Download className="w-4 h-4 text-slate-400 group-hover:text-[#165DFF]" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-700/50">
          <div className="text-sm text-slate-400">
            共 {total} 条记录，第 {page} / {totalPages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page <= 1}
              className="p-2 rounded hover:bg-slate-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-slate-300" />
            </button>
            <span className="px-3 py-1 text-sm text-slate-300">
              {page}
            </span>
            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded hover:bg-slate-700/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-slate-300" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryTable;
