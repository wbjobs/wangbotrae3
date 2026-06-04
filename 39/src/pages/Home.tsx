import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Settings, Radar, Eye, Loader2 } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import type { BScanPreview } from '@/types';
import * as api from '@/api';

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  uploading: { label: '上传中', cls: 'text-gpr-orange' },
  processing: { label: '处理中', cls: 'text-gpr-cyan' },
  completed: { label: '已完成', cls: 'text-green-400' },
  failed: { label: '失败', cls: 'text-gpr-red' },
};

export default function Home() {
  const { projects, params, loading, uploading, fetchProjects, uploadProject, updateParams } =
    useProjectStore();
  const [dragOver, setDragOver] = useState(false);
  const [bscanPreview, setBscanPreview] = useState<BScanPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!bscanPreview || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/png;base64,${bscanPreview.image_base64}`;
  }, [bscanPreview]);

  const handleFile = useCallback(
    async (file: File) => {
      const project = await uploadProject(file);
      if (project) {
        try {
          const preview = await api.getBScanPreview(project.id);
          setBscanPreview(preview);
        } catch (_e) { void _e; }
      }
    },
    [uploadProject]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="min-h-screen bg-gpr-bg p-6">
      <header className="mb-8 flex items-center gap-3">
        <Radar className="h-8 w-8 text-gpr-cyan" />
        <h1 className="text-2xl font-semibold text-gpr-text">
          地下管线探地雷达点云重建系统
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center gap-2 text-gpr-text">
            <Upload className="h-5 w-5 text-gpr-cyan" />
            <h2 className="font-medium">数据上传</h2>
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
              dragOver
                ? 'border-gpr-cyan bg-gpr-cyan/5'
                : 'border-gpr-border hover:border-gpr-cyan/50'
            }`}
          >
            {uploading ? (
              <Loader2 className="mb-3 h-10 w-10 animate-spin text-gpr-cyan" />
            ) : (
              <Upload className="mb-3 h-10 w-10 text-gpr-dim" />
            )}
            <p className="text-sm text-gpr-dim">
              {uploading ? '正在上传...' : '拖拽 B-scan JSON 文件到此处，或点击选择'}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={onFileChange}
              className="hidden"
            />
          </div>
        </div>

        <div className="panel-surface p-5">
          <div className="mb-4 flex items-center gap-2 text-gpr-text">
            <Settings className="h-5 w-5 text-gpr-cyan" />
            <h2 className="font-medium">重建参数</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1 flex justify-between text-sm text-gpr-dim">
                <span>介电常数</span>
                <span className="font-mono text-gpr-cyan">{params.dielectric_constant.toFixed(1)}</span>
              </label>
              <input
                type="range" min="1" max="20" step="0.1"
                value={params.dielectric_constant}
                onChange={(e) => updateParams({ dielectric_constant: +e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 flex justify-between text-sm text-gpr-dim">
                <span>滤波窗口</span>
                <span className="font-mono text-gpr-cyan">{params.filter_window_size}</span>
              </label>
              <input
                type="range" min="1" max="15" step="1"
                value={params.filter_window_size}
                onChange={(e) => updateParams({ filter_window_size: +e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 flex justify-between text-sm text-gpr-dim">
                <span>拟合阈值</span>
                <span className="font-mono text-gpr-cyan">{params.fitting_threshold.toFixed(2)}</span>
              </label>
              <input
                type="range" min="0.1" max="1.0" step="0.01"
                value={params.fitting_threshold}
                onChange={(e) => updateParams({ fitting_threshold: +e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gpr-dim">波速 (m/ns)</label>
              <input
                type="number" step="0.001" min="0.01" max="0.3"
                value={params.velocity}
                onChange={(e) => updateParams({ velocity: +e.target.value })}
                className="w-full rounded-md border border-gpr-border bg-gpr-bg px-3 py-1.5 font-mono text-sm text-gpr-text outline-none focus:border-gpr-cyan"
              />
            </div>
          </div>
        </div>
      </div>

      {bscanPreview && (
        <div className="panel-surface mt-6 p-5">
          <h2 className="mb-3 font-medium text-gpr-text">B-scan 预览</h2>
          <div className="overflow-auto rounded-md bg-black/30 p-2">
            <canvas ref={canvasRef} className="mx-auto max-w-full" />
          </div>
          <div className="mt-2 flex gap-6 text-xs text-gpr-dim">
            <span>道数: <span className="font-mono text-gpr-text">{bscanPreview.traces}</span></span>
            <span>采样点: <span className="font-mono text-gpr-text">{bscanPreview.samples_per_trace}</span></span>
            <span>时间范围: <span className="font-mono text-gpr-text">{bscanPreview.time_range[0]}–{bscanPreview.time_range[1]} ns</span></span>
          </div>
        </div>
      )}

      <div className="panel-surface mt-6 p-5">
        <h2 className="mb-4 font-medium text-gpr-text">项目列表</h2>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gpr-cyan" />
          </div>
        ) : projects.length === 0 ? (
          <p className="py-8 text-center text-sm text-gpr-dim">暂无项目，请上传数据</p>
        ) : (
          <div className="space-y-2">
            {projects.map((p) => {
              const st = STATUS_MAP[p.status] ?? { label: p.status, cls: 'text-gpr-dim' };
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-lg border border-gpr-border bg-gpr-bg/50 px-4 py-3 transition-colors hover:border-gpr-cyan/30"
                >
                  <div className="flex items-center gap-3">
                    <Radar className="h-4 w-4 text-gpr-dim" />
                    <div>
                      <p className="text-sm font-medium text-gpr-text">{p.name}</p>
                      <p className="text-xs text-gpr-dim">{p.filename}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-medium ${st.cls}`}>
                      {p.status === 'processing' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                      {st.label}
                    </span>
                    {p.status === 'completed' && (
                      <Link
                        to={`/viewer/${p.id}`}
                        className="flex items-center gap-1 rounded-md bg-gpr-cyan/10 px-3 py-1 text-xs text-gpr-cyan transition-colors hover:bg-gpr-cyan/20"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        查看
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
