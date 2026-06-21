import { useState } from "react";
import type { LaterItem } from "../types";
import { useT } from "../translator";

interface Props {
  later: LaterItem[];
  onRemove: (id: string) => void;
  onAddToBinder: (item: LaterItem) => void;
}

export default function LaterView({ later, onRemove, onAddToBinder }: Props) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);

  if (later.length === 0) {
    return (
      <div className="card">
        <h2>🔖 {t("For later")}</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {t("Nothing saved yet. Park trade ideas or cards to chase here, then add them to your binder once you land them.")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h2 style={{ margin: 0 }}>🔖 {t("For later")}</h2>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
          {t("Trades and cards you've parked. Hit Add to binder once you've made the trade.")}
        </p>
      </div>

      {later.map((w) => {
        const open = openId === w.id;
        return (
          <div className="card" key={w.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{w.target}</div>
                {w.give.length > 0 && (
                  <div className="muted" style={{ fontSize: 13 }}>{t("Give")}: {w.give.join(" + ")}</div>
                )}
                <div className="muted" style={{ fontSize: 12 }}>{new Date(w.savedAt).toLocaleDateString()}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {w.steps && w.steps.length > 0 && (
                  <button className="btn ghost small" onClick={() => setOpenId(open ? null : w.id)}>
                    {open ? t("Hide") : t("View path")}
                  </button>
                )}
                <button className="btn small" onClick={() => onAddToBinder(w)}>★ {t("Add to binder")}</button>
                <button className="btn ghost small" onClick={() => onRemove(w.id)}>{t("Remove")}</button>
              </div>
            </div>
            {open && w.steps && (
              <div style={{ marginTop: 10 }}>
                {w.steps.map((s, i) => (
                  <div className="tradeup-step" key={i}>
                    <div className="tradeup-num">{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tradeup-flow">
                        <span className="give">{s.giveUp.join(" + ")}</span>
                        <span className="arrow">→</span>
                        <span className="get">{s.receive}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{s.valueNote}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
