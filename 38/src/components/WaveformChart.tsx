import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface WaveformChartProps {
  data: number[];
  sampleRate?: number;
  duration?: number;
  color?: string;
  height?: number;
}

export function WaveformChart({
  data,
  sampleRate = 10000,
  duration = 10,
  color = '#165DFF',
  height = 200,
}: WaveformChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const [isPaused, setIsPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState(0);

  const maxPoints = sampleRate * duration;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, width, height);

    const gridColor = 'rgba(51, 65, 85, 0.5)';
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const centerY = height / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (data.length === 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.font = '14px JetBrains Mono';
      ctx.textAlign = 'center';
      ctx.fillText('等待数据...', width / 2, centerY);
      return;
    }

    const visiblePoints = Math.floor(maxPoints / zoom);
    const startIndex = Math.max(0, data.length - visiblePoints - offset);
    const endIndex = data.length - offset;
    const visibleData = data.slice(Math.max(0, startIndex), endIndex);

    if (visibleData.length === 0) return;

    const step = width / visiblePoints;
    const amplitude = Math.max(1, Math.abs(Math.max(...visibleData) - Math.min(...visibleData)));
    const scale = (height * 0.4) / (amplitude || 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < visiblePoints; i++) {
      const dataIndex = Math.floor((i / visiblePoints) * visibleData.length);
      const value = visibleData[dataIndex] || 0;
      const x = i * step;
      const y = centerY - value * scale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, color + '20');
    gradient.addColorStop(0.5, color + '10');
    gradient.addColorStop(1, color + '00');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    for (let i = 0; i < visiblePoints; i++) {
      const dataIndex = Math.floor((i / visiblePoints) * visibleData.length);
      const value = visibleData[dataIndex] || 0;
      const x = i * step;
      const y = centerY - value * scale;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, centerY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px JetBrains Mono';
    ctx.textAlign = 'left';
    for (let i = 0; i <= 10; i++) {
      const time = ((i / 10) * duration) / zoom;
      const x = (width / 10) * i + 4;
      ctx.fillText(`${time.toFixed(1)}s`, x, height - 4);
    }

    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const normalized = 1 - (i / 2);
      const y = (height / 4) * i - 4;
      ctx.fillText(`${normalized.toFixed(1)}`, width - 4, y > 14 ? y : 14);
    }

    const infoText = `${data.length} points · ${sampleRate / 1000}kHz · ${(data.length / sampleRate).toFixed(2)}s`;
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'left';
    ctx.fillText(infoText, 8, 18);
  }, [data, sampleRate, duration, color, height, maxPoints, zoom, offset]);

  useEffect(() => {
    if (!isPaused) {
      const animate = () => {
        draw();
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw, isPaused]);

  useEffect(() => {
    if (isPaused) {
      draw();
    }
  }, [isPaused, draw]);

  const handleZoomIn = () => setZoom(z => Math.min(z * 1.5, 10));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.5, 1));
  const handleReset = () => {
    setZoom(1);
    setOffset(0);
  };

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-medium text-sm">实时波形</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
            title={isPaused ? '继续' : '暂停'}
          >
            {isPaused ? <Play className="w-4 h-4 text-[#00B42A]" /> : <Pause className="w-4 h-4 text-[#FF7D00]" />}
          </button>
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
            title="放大"
          >
            <ZoomIn className="w-4 h-4 text-slate-300" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-4 h-4 text-slate-300" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
            title="重置"
          >
            <RotateCcw className="w-4 h-4 text-slate-300" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="relative w-full rounded overflow-hidden bg-[#0F172A]">
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}

export default WaveformChart;
