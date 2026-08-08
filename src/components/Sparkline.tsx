export default function Sparkline({
  points,
  width = 240,
  height = 56,
  color = "#0F766E",
}: {
  points: { date: string; price: number }[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const prices = points.map((p) => p.price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.price - min) / span) * (height - 8) - 4;
    return [x, y] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `${path} L${width},${height} L0,${height} Z`;
  const last = coords[coords.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.14" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sparkFill)" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.75" fill={color} />}
    </svg>
  );
}
