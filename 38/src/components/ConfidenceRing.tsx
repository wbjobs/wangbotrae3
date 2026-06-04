interface ConfidenceRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  showLabel?: boolean;
  label?: string;
}

export function ConfidenceRing({
  value,
  size = 120,
  strokeWidth = 10,
  color = '#165DFF',
  showLabel = true,
  label,
}: ConfidenceRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1E293B"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease',
          }}
        />
        <defs>
          <linearGradient id={`gradient-${size}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.6" />
          </linearGradient>
        </defs>
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white font-mono">
            {value.toFixed(1)}%
          </span>
          {label && (
            <span className="text-xs text-slate-400 mt-0.5">{label}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ConfidenceRing;
