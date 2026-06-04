import { Clock, CheckCircle, XCircle, Loader2, Download, FileAudio } from 'lucide-react';
import type { BatchTask } from '../../shared/types';
import { formatTimestamp, formatFileSize } from '../utils/format';
import { cn } from '@/lib/utils';

interface TaskListProps {
  tasks: BatchTask[];
  onCancel?: (id: string) => void;
  onDownload?: (id: string) => void;
}

const statusConfig = {
  pending: {
    label: '等待中',
    icon: Clock,
    color: 'text-slate-400',
    bgColor: 'bg-slate-700/50',
  },
  processing: {
    label: '处理中',
    icon: Loader2,
    color: 'text-[#165DFF]',
    bgColor: 'bg-[#165DFF]/20',
  },
  completed: {
    label: '已完成',
    icon: CheckCircle,
    color: 'text-[#00B42A]',
    bgColor: 'bg-[#00B42A]/20',
  },
  failed: {
    label: '失败',
    icon: XCircle,
    color: 'text-[#F53F3F]',
    bgColor: 'bg-[#F53F3F]/20',
  },
};

export function TaskList({ tasks, onCancel, onDownload }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-white font-medium mb-4">批量任务</h3>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileAudio className="w-12 h-12 text-slate-600 mb-3" />
          <div className="text-slate-400 text-sm">暂无批量任务</div>
          <div className="text-slate-500 text-xs mt-1">上传文件后将显示在此处</div>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-4">
      <h3 className="text-white font-medium mb-4">批量任务</h3>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {tasks.map((task) => {
          const config = statusConfig[task.status];
          const StatusIcon = config.icon;

          return (
            <div
              key={task.id}
              className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800/70 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', config.bgColor)}>
                    <StatusIcon className={cn('w-5 h-5', config.color, task.status === 'processing' && 'animate-spin')} />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{task.fileName}</div>
                    <div className="text-xs text-slate-500">{formatFileSize(task.fileSize)}</div>
                  </div>
                </div>
                <span className={cn('px-2 py-0.5 text-xs rounded-full', config.bgColor, config.color)}>
                  {config.label}
                </span>
              </div>

              {task.status === 'processing' && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400">诊断进度</span>
                    <span className="text-[#165DFF] font-mono">{task.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#165DFF] rounded-full transition-all duration-300"
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500 mt-1">
                    <span>{task.completedCount} / {task.totalCount} 个文件</span>
                  </div>
                </div>
              )}

              {task.status === 'completed' && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-slate-400">完成</span>
                    <span className="text-[#00B42A]">100%</span>
                  </div>
                  <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-[#00B42A] rounded-full" style={{ width: '100%' }} />
                  </div>
                </div>
              )}

              {task.status === 'failed' && task.errorMessage && (
                <div className="mb-3 p-2 rounded bg-[#F53F3F]/10 border border-[#F53F3F]/30">
                  <div className="text-xs text-[#F53F3F]">{task.errorMessage}</div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {formatTimestamp(task.createdAt)}
                  {task.completedAt && (
                    <span className="ml-2">
                      耗时 {((task.completedAt - task.createdAt) / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {task.status === 'processing' && onCancel && (
                    <button
                      onClick={() => onCancel(task.id)}
                      className="text-xs text-slate-400 hover:text-[#F53F3F] transition-colors"
                    >
                      取消
                    </button>
                  )}
                  {task.status === 'completed' && onDownload && (
                    <button
                      onClick={() => onDownload(task.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs text-[#165DFF] hover:bg-[#165DFF]/20 rounded transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载结果
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TaskList;
