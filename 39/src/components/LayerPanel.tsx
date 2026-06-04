import { Layers, Eye, EyeOff } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';
import type { ColorMapping } from '@/types';

const COLOR_OPTIONS: { value: ColorMapping; label: string }[] = [
  { value: 'depth', label: '深度' },
  { value: 'amplitude', label: '振幅' },
  { value: 'flat', label: '纯色' },
];

export default function LayerPanel() {
  const { pointSize, opacity, colorMapping, visible } = useProjectStore();
  const store = useProjectStore;

  const setPointSize = (v: number) => store.setState({ pointSize: v });
  const setOpacity = (v: number) => store.setState({ opacity: v });
  const setColorMapping = (v: ColorMapping) => store.setState({ colorMapping: v });
  const toggleVisible = () => store.setState({ visible: !visible });

  return (
    <div className="panel-surface p-3">
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-gpr-cyan" />
        <h3 className="text-sm font-medium text-gpr-text">图层控制</h3>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gpr-dim">点云可见</span>
          <button
            onClick={toggleVisible}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gpr-dim hover:text-gpr-text"
          >
            {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {visible ? '显示' : '隐藏'}
          </button>
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs text-gpr-dim">
            <span>着色模式</span>
          </label>
          <div className="flex gap-1">
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setColorMapping(opt.value)}
                className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                  colorMapping === opt.value
                    ? 'bg-gpr-cyan/20 text-gpr-cyan'
                    : 'bg-gpr-border/30 text-gpr-dim hover:text-gpr-text'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs text-gpr-dim">
            <span>点大小</span>
            <span className="font-mono text-gpr-cyan">{pointSize.toFixed(1)}</span>
          </label>
          <input
            type="range" min="0.5" max="5" step="0.1"
            value={pointSize}
            onChange={(e) => setPointSize(+e.target.value)}
            className="w-full"
          />
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs text-gpr-dim">
            <span>透明度</span>
            <span className="font-mono text-gpr-cyan">{opacity.toFixed(2)}</span>
          </label>
          <input
            type="range" min="0.1" max="1" step="0.01"
            value={opacity}
            onChange={(e) => setOpacity(+e.target.value)}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
