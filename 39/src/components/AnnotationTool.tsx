import { useState } from 'react';
import { BoxSelect, Plus, Trash2 } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';

const PRESET_COLORS = ['#FF8C42', '#00E5CC', '#FF4757', '#5B8DEF'];

interface AnnotationToolProps {
  projectId: string;
  annotationMode: boolean;
  onToggleMode: () => void;
}

export default function AnnotationTool({ projectId, annotationMode, onToggleMode }: AnnotationToolProps) {
  const { annotations, addAnnotation, deleteAnnotation } = useProjectStore();
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSave = async () => {
    if (!label.trim()) return;
    await addAnnotation(projectId, {
      label: label.trim(),
      color,
      box_min: [0, 0, 0],
      box_max: [1, 1, 1],
    });
    setLabel('');
  };

  const handleDelete = async (id: string) => {
    await deleteAnnotation(projectId, id);
    if (selectedId === id) setSelectedId(null);
  };

  const handleSelect = async (id: string) => {
    setSelectedId(id);
  };

  return (
    <div className="panel-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BoxSelect className="h-4 w-4 text-gpr-cyan" />
          <h3 className="text-sm font-medium text-gpr-text">标注工具</h3>
        </div>
        <button
          onClick={onToggleMode}
          className={`rounded px-2 py-0.5 text-xs transition-colors ${
            annotationMode
              ? 'bg-gpr-orange/20 text-gpr-orange'
              : 'bg-gpr-border/30 text-gpr-dim hover:text-gpr-text'
          }`}
        >
          {annotationMode ? '标注中' : '开启'}
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs text-gpr-dim">标签名称</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="输入标注名称"
            className="w-full rounded-md border border-gpr-border bg-gpr-bg px-2 py-1 text-xs text-gpr-text outline-none focus:border-gpr-cyan"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gpr-dim">颜色</label>
          <div className="flex gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 transition-transform ${
                  color === c ? 'scale-110 border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={!label.trim()}
          className="flex w-full items-center justify-center gap-1 rounded-md bg-gpr-cyan/10 px-3 py-1.5 text-xs text-gpr-cyan transition-colors hover:bg-gpr-cyan/20 disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
          保存标注
        </button>

        <div>
          <p className="mb-1 text-xs text-gpr-dim">已有标注 ({annotations.length})</p>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {annotations.map((a) => (
              <div
                key={a.id}
                onClick={() => handleSelect(a.id)}
                className={`flex cursor-pointer items-center justify-between rounded px-2 py-1 text-xs transition-colors ${
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
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
