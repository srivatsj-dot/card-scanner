/** Tiny inline value-history chart. */
export default function Sparkline({ points, width = 96, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - 2 - ((p - min) / span) * (height - 4);
    return [x, y] as const;
  });
  const d = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.5" fill={color} />
    </svg>
  );
}
