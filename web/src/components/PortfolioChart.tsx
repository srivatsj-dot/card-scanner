import { useMemo, useState } from "react";
import type { SavedCard } from "../types";
import { money } from "../utils";
import { useT } from "../translator";

const DAY = 24 * 60 * 60 * 1000;
type Range = 30 | 90 | 365;

/**
 * Total collection value over time. Each card keeps its own `history` of value
 * points; we roll them into one daily series by taking, for every day, each
 * card's most recent known value at that point (cards only count from the day
 * they were saved). That makes the line reflect real growth — both new cards
 * and price moves — instead of just re-plotting today's total.
 */
function series(saved: SavedCard[], days: number): { t: number; v: number }[] {
  if (!saved.length) return [];
  const now = Date.now();
  const start = now - days * DAY;
  // One point per day, plus today.
  const out: { t: number; v: number }[] = [];
  for (let d = 0; d <= days; d++) {
    const at = start + d * DAY;
    let total = 0;
    for (const c of saved) {
      if ((c.savedAt || 0) > at) continue; // not owned yet on this day
      const pts = (c.history || []).filter((h) => h.t <= at).sort((a, b) => a.t - b.t);
      const last = pts.length ? pts[pts.length - 1].mid : c.result.estimatedValue?.mid;
      total += Number(last) || 0;
    }
    out.push({ t: at, v: total });
  }
  return out;
}

export default function PortfolioChart({ saved, currency }: { saved: SavedCard[]; currency: string }) {
  const t = useT();
  const [range, setRange] = useState<Range>(30);
  const pts = useMemo(() => series(saved, range), [saved, range]);
  const cur = saved[0]?.result.estimatedValue?.currency || currency;

  // Only meaningful once the collection has a little history behind it.
  if (saved.length === 0) return null;
  const values = pts.map((p) => p.v);
  const now = values[values.length - 1] ?? 0;
  const then = values.find((v) => v > 0) ?? 0;
  const change = now - then;
  const pct = then > 0 ? (change / then) * 100 : 0;
  const flat = values.every((v) => v === values[0]);

  const W = 640, H = 160, PAD = 6;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const stepX = W / Math.max(1, values.length - 1);
  const xy = values.map((v, i) => [i * stepX, H - PAD - ((v - min) / span) * (H - PAD * 2)] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const up = change >= 0;
  const stroke = up ? "var(--good, #3ad29f)" : "var(--bad, #ff6b6b)";

  // Biggest movers over the window, so the number has a "why" next to it.
  const movers = saved
    .map((c) => {
      const h = (c.history || []).filter((x) => x.t >= Date.now() - range * DAY).sort((a, b) => a.t - b.t);
      const from = h.length ? h[0].mid : c.previousMid ?? null;
      const to = c.result.estimatedValue?.mid ?? 0;
      if (from == null || from <= 0) return null;
      return { name: c.result.player || t("Card"), diff: to - from, pct: ((to - from) / from) * 100 };
    })
    .filter((x): x is { name: string; diff: number; pct: number } => !!x && Math.abs(x.pct) >= 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>📈 {t("Collection value")}</h3>
          <div className="value-big" style={{ fontSize: 26 }}>{money(now, cur)}</div>
          {!flat && (
            <div className={`muted`} style={{ fontSize: 13, color: up ? "var(--good, #3ad29f)" : "var(--bad, #ff6b6b)" }}>
              {up ? "▲" : "▼"} {money(Math.abs(change), cur)} ({Math.abs(pct).toFixed(1)}%) · {t("last")} {range} {t("days")}
            </div>
          )}
        </div>
        <div className="auth-tabs" style={{ margin: 0 }}>
          {([30, 90, 365] as Range[]).map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r === 365 ? "1y" : `${r}d`}
            </button>
          ))}
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="portfolio-svg" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pf-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      {flat ? (
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          {t("Your value history builds as prices refresh each day — check back tomorrow to see the line move.")}
        </p>
      ) : movers.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{t("Biggest movers")}</div>
          {movers.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "2px 0" }}>
              <span>{m.name}</span>
              <span className={m.diff >= 0 ? "pill green" : "pill red"}>
                {m.diff >= 0 ? "▲" : "▼"} {money(Math.abs(m.diff), cur)} ({Math.abs(m.pct).toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
