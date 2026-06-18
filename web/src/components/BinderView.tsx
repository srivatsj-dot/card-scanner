import { useState } from "react";
import type { SavedCard } from "../types";
import ResultCard from "./ResultCard";

interface Props {
  saved: SavedCard[];
  onRemove: (id: string) => void;
  onClear: () => void;
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

export default function BinderView({ saved, onRemove, onClear }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (saved.length === 0) {
    return (
      <div className="card">
        <h2>Your binder</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          No saved cards yet. Scan a card and tap <strong>★ Save to binder</strong> to keep it here
          with a running total value.
        </p>
      </div>
    );
  }

  const currency = saved[0]?.result.estimatedValue.currency || "USD";
  const total = saved.reduce((sum, s) => sum + (s.result.estimatedValue.mid || 0), 0);

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Your binder</h2>
          <div style={{ textAlign: "right" }}>
            <div className="value-big">{money(total, currency)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {saved.length} card{saved.length > 1 ? "s" : ""} · estimated total
            </div>
          </div>
        </div>
      </div>

      {saved.map((s) => {
        const r = s.result;
        const open = openId === s.id;
        return (
          <div className="card" key={s.id}>
            <div className="binder-row">
              {s.thumbnail ? (
                <img className="thumb" src={s.thumbnail} alt={r.player || "card"} />
              ) : (
                <div className="thumb placeholder">★</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name" style={{ fontWeight: 700, fontSize: 16 }}>
                  {r.player || "Unknown card"}
                </div>
                <div className="muted" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 13 }}>
                  {[r.year, r.manufacturer, r.setName].filter(Boolean).join(" · ") || "—"}
                </div>
                <div style={{ marginTop: 4 }}>
                  {r.sport && <span className="pill">{r.sport}</span>}
                  {r.parallel && <span className="pill gold">{r.parallel}</span>}
                  {r.specialEdition && <span className="pill gold">★</span>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="value-big" style={{ fontSize: 20 }}>
                  {money(r.estimatedValue.mid, r.estimatedValue.currency)}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                  <button className="btn ghost small" onClick={() => setOpenId(open ? null : s.id)}>
                    {open ? "Hide" : "View"}
                  </button>
                  <button className="btn ghost small" onClick={() => onRemove(s.id)}>Remove</button>
                </div>
              </div>
            </div>
            {open && <div style={{ marginTop: 14 }}><ResultCard result={r} /></div>}
          </div>
        );
      })}

      <div className="card" style={{ textAlign: "center" }}>
        <button className="btn ghost" onClick={onClear}>Clear binder</button>
      </div>
    </div>
  );
}
