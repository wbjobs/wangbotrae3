import { Scissors, RotateCcw } from 'lucide-react';
import { useProjectStore } from '@/stores/useProjectStore';

const AXES = [
  { key: 'x' as const, label: 'X 轴', color: 'text-gpr-red' },
  { key: 'y' as const, label: 'Y 轴', color: 'text-gpr-cyan' },
  { key: 'z' as const, label: 'Z 轴', color: 'text-blue-400' },
];

export default function ClippingPanel() {
  const { clipping, setClipping } = useProjectStore();

  const toggle = (axis: 'x' | 'y' | 'z') =>
    setClipping({
      [axis]: { ...clipping[axis], enabled: !clipping[axis].enabled },
    });

  const setValue = (axis: 'x' | 'y' | 'z', value: number) =>
    setClipping({
      [axis]: { ...clipping[axis], value },
    });

  const reset = () =>
    setClipping({
      x: { enabled: false, value: 0 },
      y: { enabled: false, value: 0 },
      z: { enabled: false, value: 0 },
    });

  return (
    <div className="panel-surface p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-gpr-cyan" />
          <h3 className="text-sm font-medium text-gpr-text">裁剪平面</h3>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gpr-dim hover:text-gpr-text"
        >
          <RotateCcw className="h-3 w-3" />
          重置
        </button>
      </div>
      <div className="space-y-3">
        {AXES.map(({ key, label, color }) => (
          <div key={key}>
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(key)}
                  className={`h-4 w-4 rounded border ${
                    clipping[key].enabled
                      ? 'border-gpr-cyan bg-gpr-cyan/20'
                      : 'border-gpr-border bg-transparent'
                  }`}
                />
                <span className={`text-xs font-medium ${color}`}>{label}</span>
              </div>
              <span className="font-mono text-xs text-gpr-dim">
                {clipping[key].value.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="-50"
              max="50"
              step="0.5"
              value={clipping[key].value}
              onChange={(e) => setValue(key, +e.target.value)}
              disabled={!clipping[key].enabled}
              className={`w-full ${!clipping[key].enabled ? 'opacity-30' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
