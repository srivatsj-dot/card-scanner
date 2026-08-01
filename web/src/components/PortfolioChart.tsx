import { useMemo, useState } from "react";
import type { SavedCard } from "../types";
import { money, convertMoney } from "../utils";
import { useT } from "../translator";

const DAY = 24 * 60 * 60 * 1000;
type Range = 1 | 7 | 30 | 90 | 365 | 0; // 0 = all time

/** Value of one card as of a moment in time (its latest known point by then). */
function valueAt(c: SavedCard, at: number): number {
  const pts = (c.history || []).filter((h) => h.t <= at);
  if (pts.length) return Number(pts.reduce((a, b) => (a.t > b.t ? a : b)).mid) || 0;
  // No history yet at that moment — fall back to its current value.
  return Number(c.result.estimatedValue?.mid) || 0;
}

/**
 * Total collection value over time. Each card carries its own `history`; we roll
 * them into a daily series, counting a card only from the day it was saved. The
 * FINAL point is always "right now" computed from the live binder, so adding or
 * removing a card moves the line immediately instead of waiting for a refresh.
 */
/**
 * Build the line from the RECORDED value log — the only source that tells the
 * truth about the past. Reconstructing from cards you still own quietly deletes
 * history: a card you held for a week and then sold takes its peak with it.
 * `log` is stored in USD, so convert it into whatever you're viewing in.
 */
function fromLog(
  log: { t: number; v: number }[], days: number, since: number | null | undefined,
  cur: string, liveNow: number, saved: SavedCard[]
): { t: number; v: number }[] {
  const now = Date.now();
  const logStart = log[0]?.t ?? now;
  const start = days > 0 ? now - days * DAY : Math.min(since || now, logStart);

  // The recorded log only begins when logging was switched on. On its own it made
  // every range — 1d through all-time — show the same two or three points, so a
  // single big change looked like the entire history of the collection. Rebuild
  // the stretch BEFORE the log from the cards' own value histories, then hand over
  // to the log (which is the truth, including cards since removed).
  const head: { t: number; v: number }[] = [];
  if (start < logStart) {
    const span = logStart - start;
    const steps = Math.min(60, Math.max(4, Math.round(span / DAY)));
    for (let i = 0; i < steps; i++) {
      const at = start + (span / steps) * i;
      let total = 0;
      for (const c of saved) {
        if ((c.savedAt || 0) > at) continue;
        total += convertMoney(valueAt(c, at), c.result.estimatedValue?.currency, cur);
      }
      head.push({ t: at, v: total });
    }
  }
  // Carry the last pre-window value forward so a flat stretch isn't cut off.
  const before = log.filter((p) => p.t < start).pop();
  if (!head.length && before) head.push({ t: start, v: convertMoney(before.v, "USD", cur) });

  const inRange = log.filter((p) => p.t >= start).map((p) => ({ t: p.t, v: convertMoney(p.v, "USD", cur) }));
  return [...head, ...inRange, { t: now, v: liveNow }];
}

function series(saved: SavedCard[], days: number, since?: number | null): { t: number; v: number }[] {
  const now = Date.now();
  if (!saved.length) return [{ t: now, v: 0 }];
  // "All time" means since you JOINED, not since your first card — so the empty
  // stretch before your first scan is part of the story.
  const earliest = Math.min(since || Infinity, ...saved.map((c) => c.savedAt || now));
  const span = days > 0 ? days * DAY : Math.max(now - earliest, 7 * DAY);
  const start = now - span;
  const steps = Math.min(120, Math.max(12, Math.round(span / DAY))); // cap the point count
  const stepMs = span / steps;

  const out: { t: number; v: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const at = start + i * stepMs;
    let total = 0;
    for (const c of saved) {
      if ((c.savedAt || 0) > at) continue; // not owned yet
      total += valueAt(c, at);
    }
    out.push({ t: at, v: total });
  }
  // Live "now" point — every card currently in the binder, at today's value.
  out.push({ t: now, v: saved.reduce((s, c) => s + (Number(c.result.estimatedValue?.mid) || 0), 0) });
  return out;
}

export default function PortfolioChart({ saved, currency, since, log }: { saved: SavedCard[]; currency: string; since?: number | null; log?: { t: number; v: number }[] }) {
  const t = useT();
  const [range, setRange] = useState<Range>(30);
  const [hover, setHover] = useState<number | null>(null); // index of hovered point
  // `saved` is a new array on every change, so this recomputes the moment a card
  // is added, removed, graded, or re-priced.
  const cur = saved[0]?.result.estimatedValue?.currency || currency;
  const pts = useMemo(() => {
    const liveNow = saved.reduce((s2, c) => s2 + convertMoney(c.result.estimatedValue?.mid || 0, c.result.estimatedValue?.currency, cur), 0);
    // Prefer the recorded log; fall back to reconstruction for collections that
    // predate it (they simply have no log yet).
    return log && log.length > 1
      ? fromLog(log, range, since, cur, liveNow, saved)
      : series(saved, range, since);
  }, [saved, range, since, log, cur]);

  if (saved.length === 0) return null;
  const values = pts.map((p) => p.v);
  const now = values[values.length - 1] ?? 0;
  const first = values.find((v) => v > 0) ?? 0;
  const change = now - first;
  const pct = first > 0 ? (change / first) * 100 : 0;
  const flat = values.every((v) => v === values[0]);

  const W = 640, H = 160, PAD = 8;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || Math.max(1, max || 1);
  // Position points by WHEN they happened, not by their position in the array.
  // Log entries are irregular, so index-based spacing stretched a twenty-minute
  // spike across as much width as a quiet month.
  const t0 = pts[0]?.t ?? 0;
  const t1 = pts[pts.length - 1]?.t ?? t0 + 1;
  const tSpan = Math.max(1, t1 - t0);
  const x = (i: number) => (((pts[i]?.t ?? t0) - t0) / tSpan) * W;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const up = change >= 0;
  const stroke = up ? "var(--good, #3ad29f)" : "var(--bad, #ff6b6b)";

  // Map a pointer position to the nearest data point, so hovering reads a value.
  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    // Find the point nearest that MOMENT (points aren't evenly spaced in time).
    const at = t0 + frac * tSpan;
    let best = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].t - at) < Math.abs(pts[best].t - at)) best = i;
    }
    setHover(best);
  }

  const shown = hover != null ? pts[hover] : null;
  const dateLabel = (ms: number) =>
    range === 1
      ? new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: range === 0 || range === 365 ? "numeric" : undefined });

  const movers = saved
    .map((c) => {
      const since = range > 0 ? Date.now() - range * DAY : 0;
      const h = (c.history || []).filter((p) => p.t >= since).sort((a, b) => a.t - b.t);
      const from = h.length ? h[0].mid : c.previousMid ?? null;
      const to = c.result.estimatedValue?.mid ?? 0;
      if (from == null || from <= 0) return null;
      return { name: c.result.player || t("Card"), diff: to - from, pct: ((to - from) / from) * 100 };
    })
    .filter((x2): x2 is { name: string; diff: number; pct: number } => !!x2 && Math.abs(x2.pct) >= 1)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);

  const RANGES: { r: Range; label: string }[] = [
    { r: 1, label: "1d" }, { r: 7, label: "7d" }, { r: 30, label: "30d" }, { r: 90, label: "90d" },
    { r: 365, label: "1y" }, { r: 0, label: t("All") },
  ];

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>📈 {t("Collection value")}</h3>
          <div className="value-big" style={{ fontSize: 26 }}>{money(shown ? shown.v : now, cur)}</div>
          <div className="muted" style={{ fontSize: 13, minHeight: 18 }}>
            {shown
              ? dateLabel(shown.t)
              : flat
                ? `${saved.length} ${saved.length === 1 ? t("card") : t("cards")}`
                : (
                  <span style={{ color: up ? "var(--good, #3ad29f)" : "var(--bad, #ff6b6b)" }}>
                    {up ? "▲" : "▼"} {money(Math.abs(change), cur)} ({Math.abs(pct).toFixed(1)}%)
                  </span>
                )}
          </div>
        </div>
        <div className="auth-tabs" style={{ margin: 0 }}>
          {RANGES.map(({ r, label }) => (
            <button key={label} className={range === r ? "active" : ""} onClick={() => { setRange(r); setHover(null); }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`} className="portfolio-svg" preserveAspectRatio="none"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="pf-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pf-fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover != null && (
          <>
            <line x1={x(hover)} y1="0" x2={x(hover)} y2={H} stroke="var(--line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover)} cy={y(values[hover])} r="4" fill={stroke} />
          </>
        )}
      </svg>
      <p className="muted" style={{ fontSize: 11, margin: "0 0 6px" }}>
        {t("Hover the line to read the value on any day.")}
      </p>

      {movers.length > 0 && (
        <div style={{ marginTop: 4 }}>
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
