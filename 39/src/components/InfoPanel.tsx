import { useState } from 'react';
import { Info, Download, Trash2, Pencil } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';

interface InfoPanelProps {
  projectId: string;
}

export default function InfoPanel({ projectId }: InfoPanelProps) {
  const { annotations, updateAnnotation, deleteAnnotation } = useProjectStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editing, setEditing] = useState(false);

  const selected = annotations.find((a) => a.id === selectedId);

  const handleSelect = (id: string) => {
    const ann = annotations.find((a) => a.id === id);
    setSelectedId(id);
    setEditLabel(ann?.label ?? '');
    setEditing(false);
  };

  const handleSaveLabel = async () => {
    if (!selectedId || !editLabel.trim()) return;
    await updateAnnotation(projectId, selectedId, { label: editLabel.trim() });
    setEditing(false);
  };

  const handleDelete = async (id: string) => {
    await deleteAnnotation(projectId, id);
    if (selectedId === id) {
      setSelectedId(null);
      setEditing(false);
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(annotations, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${projectId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-gpr-cyan" />
          <h3 className="text-sm font-medium text-gpr-text">标注信息</h3>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gpr-dim hover:text-gpr-cyan"
        >
          <Download className="h-3 w-3" />
          导出
        </button>
      </div>

      <div className="mb-3 max-h-40 space-y-1 overflow-y-auto">
        {annotations.length === 0 ? (
          <p className="py-4 text-center text-xs text-gpr-dim">暂无标注</p>
        ) : (
          annotations.map((a) => (
            <div
              key={a.id}
              onClick={() => handleSelect(a.id)}
              className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                selectedId === a.id
                  ? 'bg-gpr-cyan/10 text-gpr-cyan'
                  : 'text-gpr-dim hover:bg-gpr-border/30 hover:text-gpr-text'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: a.color }}
                />
                <span>{a.label}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                className="text-gpr-dim hover:text-gpr-red"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      {selected && (
        <div className="border-t border-gpr-border pt-3">
          <p className="mb-2 text-xs font-medium text-gpr-text">标注详情</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gpr-dim">标签</span>
              {editing ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-24 rounded border border-gpr-border bg-gpr-bg px-1 py-0.5 text-gpr-text outline-none focus:border-gpr-cyan"
                  />
                  <button onClick={handleSaveLabel} className="text-gpr-cyan">✓</button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="text-gpr-text">{selected.label}</span>
                  <button onClick={() => setEditing(true)} className="text-gpr-dim hover:text-gpr-cyan">
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gpr-dim">颜色</span>
              <div className="flex items-center gap-1">
                <span
                  className="inline-block h-3 w-3 rounded"
                  style={{ backgroundColor: selected.color }}
                />
                <span className="font-mono text-gpr-text">{selected.color}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gpr-dim">包围盒 Min</span>
              <span className="font-mono text-gpr-text">
                [{selected.box_min.map((v) => v.toFixed(2)).join(', ')}]
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gpr-dim">包围盒 Max</span>
              <span className="font-mono text-gpr-text">
                [{selected.box_max.map((v) => v.toFixed(2)).join(', ')}]
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gpr-dim">点数量</span>
              <span className="font-mono text-gpr-text">{Array.isArray(selected.points) ? selected.points.length : selected.points}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
