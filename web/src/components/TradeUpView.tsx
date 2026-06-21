import { useState } from "react";
import type { Settings, SavedCard, TradeUpResult } from "../types";
import { planTradeUp } from "../api";
import { describeCard } from "../utils";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  saved: SavedCard[];
  onSaveLater: (target: string, result: TradeUpResult) => void;
}

export default function TradeUpView({ settings, saved, onSaveLater }: Props) {
  const t = useT();
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<TradeUpResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedThis, setSavedThis] = useState(false);

  async function plan() {
    if (!target.trim() || loading) return;
    setLoading(true);
    setError(null);
    setSavedThis(false);
    try {
      const owned = saved.map((s) => describeCard(s.result));
      setResult(await planTradeUp(target.trim(), owned, settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't plan a path.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>📈 {t("Trade-up planner")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("Name a grail you can't get in one trade, and we'll map a chain of fair trades — starting from your binder — to climb your way there.")}
        </p>
        {saved.length === 0 ? (
          <div className="error-box">{t("Add some cards to your binder first — the path starts from what you own.")}</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              value={target}
              placeholder={t("e.g. 1986 Fleer Michael Jordan PSA 8, or Pikachu Illustrator")}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") plan(); }}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn" onClick={plan} disabled={loading || !target.trim()}>
              {loading ? <><span className="spinner" />{t("Planning…")}</> : t("Plan path")}
            </button>
          </div>
        )}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {result && (
        <div className="card">
          {!result.feasible && (
            <div className="error-box" style={{ marginBottom: 14 }}>{t("No realistic path found.")} {result.note}</div>
          )}
          {result.feasible && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{result.summary}</p>
              <button
                className="btn secondary small"
                onClick={() => { onSaveLater(target.trim() || "Trade-up", result); setSavedThis(true); }}
                disabled={savedThis}
              >
                {savedThis ? t("✓ Saved") : `🔖 ${t("Save for later")}`}
              </button>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            {result.steps.map((s, i) => (
              <div className="tradeup-step" key={i}>
                <div className="tradeup-num">{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tradeup-flow">
                    <span className="give">{s.giveUp.join(" + ")}</span>
                    <span className="arrow">→</span>
                    <span className="get">{s.receive}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{s.valueNote}</div>
                  <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14, marginTop: 4 }}>{s.rationale}</div>
                </div>
              </div>
            ))}
          </div>
          {result.feasible && result.note && (
            <p className="muted" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>{result.note}</p>
          )}
        </div>
      )}
    </div>
  );
}
