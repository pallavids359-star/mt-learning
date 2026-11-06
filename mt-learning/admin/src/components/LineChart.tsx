/** A small, to-scale line chart: an area fill, a faint grid, and the latest point emphasised. */
export function LineChart({
  points,
  label,
  unit = '%',
  height = 210,
}: {
  points: { x: string; y: number }[];
  label: string;
  unit?: string;
  height?: number;
}) {
  if (points.length === 0) return <p className="muted">No data yet.</p>;
  const W = 640;
  const H = height;
  const left = 44;
  const right = 16;
  const top = 22;
  const bottom = 30;
  const ys = points.map((p) => p.y);
  // Round the axis to steps of 5 around the data, so small changes stay visible but honest.
  let lo = Math.floor((Math.min(...ys) - 2) / 5) * 5;
  let hi = Math.ceil((Math.max(...ys) + 1) / 5) * 5;
  if (unit === '%') {
    lo = Math.max(0, lo);
    hi = Math.min(100, Math.max(hi, lo + 10));
  }
  if (hi === lo) hi = lo + 5;
  const step = (hi - lo) / 2;
  const ticks = [lo, lo + step, hi];
  const px = (i: number) => left + (points.length === 1 ? (W - left - right) / 2 : (i * (W - left - right)) / (points.length - 1));
  const py = (v: number) => top + ((hi - v) / (hi - lo)) * (H - top - bottom);
  const line = points.map((p, i) => `${px(i)},${py(p.y)}`).join(' L');
  const last = points[points.length - 1];
  const every = Math.max(1, Math.ceil(points.length / 6));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${points.map((p) => `${p.x} ${p.y}${unit}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left - 6} x2={W - right} y1={py(t)} y2={py(t)} stroke="var(--line)" />
            <text x={4} y={py(t) + 4}>
              {Math.round(t)}
              {unit}
            </text>
          </g>
        ))}
        <path d={`M${line} L${px(points.length - 1)},${py(lo)} L${px(0)},${py(lo)}Z`} fill="var(--board-soft)" />
        <path d={`M${line}`} fill="none" stroke="var(--board)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.x} cx={px(i)} cy={py(p.y)} r={i === points.length - 1 ? 5.5 : 3} fill={i === points.length - 1 ? 'var(--marigold)' : 'var(--board)'} />
        ))}
        <text x={Math.min(px(points.length - 1) - 8, W - right - 40)} y={py(last.y) - 12} textAnchor="end" style={{ fill: 'var(--ink)', fontWeight: 700, fontSize: 12 }}>
          {last.y}
          {unit}
        </text>
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={`l${p.x}`} x={px(i)} y={H - 8} textAnchor="middle">
              {p.x}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function HBar({ label, value, max = 100, suffix = '%', color }: { label: string; value: number | null; max?: number; suffix?: string; color?: string }) {
  const w = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="hbar">
      <span className="small">{label}</span>
      <div className="bar" style={{ ['--c' as string]: color ?? 'var(--board)' }}>
        <i style={{ width: `${w}%` }} />
      </div>
      <b className="num small">{value === null ? '—' : `${value}${suffix}`}</b>
    </div>
  );
}
