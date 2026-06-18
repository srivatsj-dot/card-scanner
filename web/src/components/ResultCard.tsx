import type { ScanResult } from "../types";

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: n >= 100 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

function trendPill(trend: string) {
  const t = trend.toLowerCase();
  if (t === "rising") return <span className="pill green">▲ Rising</span>;
  if (t === "declining") return <span className="pill red">▼ Declining</span>;
  if (t === "stable") return <span className="pill blue">→ Stable</span>;
  return <span className="pill">Outlook unknown</span>;
}

export default function ResultCard({ result }: { result: ScanResult }) {
  if (!result.identified) {
    return (
      <div className="card">
        <h2>Couldn't identify a card</h2>
        <p className="muted">
          The photo didn't clearly show a trading card. Try a sharper, well-lit shot of the front of
          the card filling most of the frame.
        </p>
        {result.warnings?.length > 0 && (
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i} className="warn">{w}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const v = result.estimatedValue;
  const score = Math.max(0, Math.min(100, Math.round(result.rating.score)));

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{result.player || "Unknown player"}</h2>
            <div className="muted" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>
              {[result.year, result.manufacturer, result.setName].filter(Boolean).join(" · ")}
            </div>
            <div style={{ marginTop: 10 }}>
              {result.sport && <span className="pill">{result.sport}</span>}
              {result.team && <span className="pill">{result.team}</span>}
              {result.cardNumber && <span className="pill">#{result.cardNumber}</span>}
              {result.parallel && <span className="pill gold">{result.parallel}</span>}
              {result.specialEdition && <span className="pill gold">★ {result.specialEdition}</span>}
              {result.serialNumber && <span className="pill gold">/{result.serialNumber.replace(/^.*\//, "")}</span>}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="score-ring" style={{ ["--p" as any]: score }}>
              <div className="inner">{score}</div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
              {result.rating.label}
            </div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Estimated value</h3>
          <div className="value-row">
            <span className="value-big">{money(v.mid, v.currency)}</span>
            <span className="range">
              {money(v.low, v.currency)} – {money(v.high, v.currency)}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{v.note}</p>
          {result.estimatedCondition && (
            <div className="kv" style={{ marginTop: 10 }}>
              <span className="k">Condition (est.)</span>
              <span>{result.estimatedCondition}</span>
            </div>
          )}
        </div>

        <div className="card">
          <h3>Player outlook</h3>
          <div style={{ marginBottom: 8 }}>{trendPill(result.playerOutlook.trend)}</div>
          <p style={{ marginTop: 0, fontSize: 15 }}>{result.playerOutlook.summary}</p>
        </div>
      </div>

      <div className="card">
        <h3>Overall take</h3>
        <p style={{ marginTop: 0 }}>{result.rating.summary}</p>
        <p style={{ marginBottom: 0 }} className="muted">{result.generalAssessment}</p>
      </div>

      {result.conditionReport && (
        <div className="card">
          <h3>Condition &amp; flaws</h3>
          <div style={{ marginBottom: 8 }}>
            <span className="pill">{result.conditionReport.grade}</span>
          </div>
          {result.conditionReport.flaws.length > 0 ? (
            <ul style={{ marginTop: 0 }}>
              {result.conditionReport.flaws.map((f, i) => (
                <li key={i} className="warn">{f}</li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>No obvious flaws spotted in the photo.</p>
          )}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{result.conditionReport.summary}</p>
        </div>
      )}

      {result.hiddenInsights.length > 0 && (
        <div className="card">
          <h3>Stats you might not notice</h3>
          {result.hiddenInsights.map((ins, i) => (
            <div className="insight" key={i}>
              <div className="label">{ins.label}</div>
              <div className="detail">{ins.detail}</div>
            </div>
          ))}
        </div>
      )}

      {result.recommendedTrades.length > 0 && (
        <div className="card">
          <h3>Good trades to chase</h3>
          {result.recommendedTrades.map((t, i) => (
            <div className="trade-rec" key={i}>
              <div className="name">{t.player}</div>
              <div className="sub">
                {t.cardSuggestion}
                {t.comparableValue ? ` · ${t.comparableValue}` : ""}
              </div>
              <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{t.reason}</div>
            </div>
          ))}
        </div>
      )}

      {result.similarValueTargets?.length > 0 && (
        <div className="card">
          <h3>Similar value — what to ask for</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            If you traded this card away, these are fair same-value asks the other side would likely
            accept.
          </p>
          {result.similarValueTargets.map((t, i) => (
            <div className="trade-rec" key={i}>
              <div className="name">{t.player}</div>
              <div className="sub">
                {t.cardSuggestion}
                {t.estimatedValue ? ` · ${t.estimatedValue}` : ""}
              </div>
              <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{t.reason}</div>
            </div>
          ))}
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="card">
          <h3>Heads up</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {result.warnings.map((w, i) => (
              <li key={i} className="warn">{w}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
