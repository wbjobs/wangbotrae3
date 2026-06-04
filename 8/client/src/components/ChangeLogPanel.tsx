import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { dataService } from '../services/dataService';
import { ChangeLog } from '../types';

interface ChangeLogPanelProps {
  rowId: string | null;
  onClose: () => void;
}

export default function ChangeLogPanel({ rowId, onClose }: ChangeLogPanelProps) {
  const { currentTable, columns, changeLogs, setChangeLogs } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLogs = async () => {
      if (!currentTable) return;
      setLoading(true);
      const logs = await dataService.getChangeLogs(currentTable.id, rowId || undefined);
      setChangeLogs(logs);
      setLoading(false);
    };

    fetchLogs();
  }, [currentTable?.id, rowId, setChangeLogs]);

  const getColumnName = (columnId: string) => {
    if (!columnId) return '';
    const column = columns.find((c) => c.id === columnId);
    return column?.name || '未知列';
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '(空)';
    if (typeof value === 'object') {
      if (value.tombstone) return '🗑️ 已删除';
      if (value.restored) return '↩️ 已恢复';
      return JSON.stringify(value);
    }
    return String(value);
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getActionLabel = (action: string, log: ChangeLog): string => {
    switch (action) {
      case 'delete':
        return '删除了此行';
      case 'undelete':
        return '恢复了此行';
      case 'create':
        return '创建了此行';
      case 'update':
        return `修改了 ${getColumnName(log.column_id)}`;
      default:
        return action;
    }
  };

  const getActionIcon = (action: string): string => {
    switch (action) {
      case 'delete': return '🗑️';
      case 'undelete': return '↩️';
      case 'create': return '✨';
      case 'update': return '✏️';
      default: return '📝';
    }
  };

  const getActionBg = (action: string): string => {
    switch (action) {
      case 'delete': return 'bg-red-50 border-l-4 border-red-400';
      case 'undelete': return 'bg-green-50 border-l-4 border-green-400';
      case 'create': return 'bg-blue-50 border-l-4 border-blue-400';
      default: return 'bg-gray-50';
    }
  };

  const groupLogsByRow = () => {
    const groups: Record<string, ChangeLog[]> = {};
    changeLogs.forEach((log) => {
      const key = log.row_id || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(log);
    });
    return groups;
  };

  const groupedLogs = groupLogsByRow();

  return (
    <div className="w-96 bg-white rounded-lg shadow-lg border flex flex-col max-h-[calc(100vh-120px)]">
      <div className="p-4 border-b flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">变更日志</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {rowId ? '当前行的修改历史' : '表格所有变更记录'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : changeLogs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>暂无变更记录</p>
            <p className="text-sm text-gray-400 mt-1">编辑单元格后会在此显示修改历史</p>
          </div>
        ) : rowId ? (
          <div className="space-y-3">
            {changeLogs.map((log) => (
              <div key={log.id} className={`rounded-lg p-3 ${getActionBg(log.action)}`}>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-medium">
                      {log.user_name?.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {log.user_name || '未知用户'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatTime(log.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{getActionIcon(log.action)}</span>
                    <span className="text-xs text-gray-400">
                      L:{log.lamport_timestamp}
                    </span>
                  </div>
                </div>

                <div className="mt-1 text-sm">
                  <span className="text-gray-600">
                    {getActionLabel(log.action, log)}
                  </span>
                  {log.action === 'update' && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span className="px-2 py-1 bg-red-100 text-red-700 rounded line-through">
                        {formatValue(log.old_value)}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
                        {formatValue(log.new_value)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedLogs).map(([rowId, logs]) => (
              <div key={rowId}>
                <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-2">
                  <span className="w-2 h-2 bg-gray-300 rounded-full"></span>
                  行 {rowId.slice(0, 8)}...
                </div>
                <div className="space-y-2 ml-4">
                  {logs.slice(0, 5).map((log) => (
                    <div key={log.id} className={`rounded p-2 text-sm ${getActionBg(log.action)}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-700">
                          {getActionIcon(log.action)}{' '}
                          <strong>{log.user_name?.slice(0, 2)}</strong> ·{' '}
                          {getActionLabel(log.action, log)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {formatTime(log.created_at)}
                        </span>
                      </div>
                      {log.action === 'update' && (
                        <div className="text-xs text-gray-500 mt-1">
                          {formatValue(log.old_value)} → {formatValue(log.new_value)}
                        </div>
                      )}
                    </div>
                  ))}
                  {logs.length > 5 && (
                    <p className="text-xs text-blue-600 cursor-pointer hover:underline">
                      还有 {logs.length - 5} 条记录...
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t bg-gray-50 text-xs text-gray-500 space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
          使用 Lamport 时间戳解决并发冲突 (Last-Write-Win)
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-red-500 rounded-full"></span>
          删除操作使用墓碑标记，确保跨副本正确传播
        </div>
      </div>
    </div>
  );
}
