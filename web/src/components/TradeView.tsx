import { useState } from "react";
import type { Settings, TradeResult } from "../types";
import { evaluateTrade } from "../api";

function fairnessPill(f: string) {
  switch (f) {
    case "fair": return <span className="pill green">Fair trade</span>;
    case "favors_you": return <span className="pill green">Favors you</span>;
    case "favors_them": return <span className="pill red">Favors them</span>;
    case "lopsided": return <span className="pill red">Lopsided</span>;
    default: return <span className="pill">{f}</span>;
  }
}

export default function TradeView({ settings }: { settings: Settings }) {
  const [yourSide, setYourSide] = useState("");
  const [theirSide, setTheirSide] = useState("");
  const [result, setResult] = useState<TradeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setLoading(true);
    setError(null);
    try {
      const r = await evaluateTrade(yourSide, theirSide, settings);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Trade check failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>Is this trade fair?</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Describe each side in plain English — list the cards, players, years, parallels, and any
          serial numbering you know.
        </p>
        <div className="grid2">
          <label className="field">
            <span>You give up</span>
            <textarea
              value={yourSide}
              placeholder="e.g. 2016 Topps Chrome Kyle Schwarber rookie auto /150"
              onChange={(e) => setYourSide(e.target.value)}
            />
          </label>
          <label className="field">
            <span>You receive</span>
            <textarea
              value={theirSide}
              placeholder="e.g. 2018 Bowman Chrome Julio Rodriguez prospect refractor"
              onChange={(e) => setTheirSide(e.target.value)}
            />
          </label>
        </div>
        <button className="btn" onClick={check} disabled={loading || !yourSide.trim() || !theirSide.trim()}>
          {loading ? <><span className="spinner" />Evaluating…</> : "Check fairness"}
        </button>
        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {fairnessPill(result.fairness)}
            <h2 style={{ margin: 0 }}>{result.verdict}</h2>
          </div>

          <div className="grid2" style={{ marginTop: 14 }}>
            <div>
              <h3>Your side</h3>
              <div className="value-big" style={{ fontSize: 22 }}>
                {settings.currency} {result.yourSide.valueLow}–{result.yourSide.valueHigh}
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{result.yourSide.notes}</p>
            </div>
            <div>
              <h3>Their side</h3>
              <div className="value-big" style={{ fontSize: 22 }}>
                {settings.currency} {result.theirSide.valueLow}–{result.theirSide.valueHigh}
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{result.theirSide.notes}</p>
            </div>
          </div>

          <p style={{ fontWeight: 600 }}>{result.valueGapNote}</p>
          <p>{result.reasoning}</p>

          {result.suggestions.length > 0 && (
            <>
              <h3>How to even it out</h3>
              <ul style={{ marginTop: 0 }}>
                {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
