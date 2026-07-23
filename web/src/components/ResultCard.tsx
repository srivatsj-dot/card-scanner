import type { ScanResult } from "../types";
import { useT } from "../translator";

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

function trendPill(trend: string, tr: (s: string) => string) {
  const t = trend.toLowerCase();
  if (t === "rising") return <span className="pill green">▲ {tr("Rising")}</span>;
  if (t === "declining") return <span className="pill red">▼ {tr("Declining")}</span>;
  if (t === "stable") return <span className="pill blue">→ {tr("Stable")}</span>;
  return <span className="pill">{tr("Outlook unknown")}</span>;
}

export default function ResultCard({
  result,
  onWishAll,
}: {
  result: ScanResult;
  onWishAll?: (texts: string[]) => void;
}) {
  const tr = useT();
  if (!result.identified) {
    return (
      <div className="card">
        <h2><span className="pill red">{tr("Not identified")}</span></h2>
        <p className="muted">
          {tr("The photo didn't clearly show a trading card. Try a sharper, well-lit shot of the front of the card filling most of the frame.")}
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

  const v = result.estimatedValue || { low: 0, mid: 0, high: 0, currency: "USD", note: "" };
  const rating = result.rating || { score: 0, label: "", summary: "" };
  const outlook = result.playerOutlook || { trend: "unknown", summary: "" };
  const score = Math.max(0, Math.min(100, Math.round(rating.score || 0)));

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          {result.imageUrl && (
            <img className="result-photo" src={result.imageUrl} alt={result.player || "card"} loading="lazy" />
          )}
          <div style={{ flex: 1, minWidth: 180 }}>
            <h2 style={{ marginBottom: 4 }}>{result.player || tr("Unknown player")}</h2>
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
              {result.pokemon?.edition && result.pokemon.edition !== "Unlimited" && (
                <span className="pill gold">{result.pokemon.edition}</span>
              )}
              {result.pokemon?.variant && result.pokemon.variant !== "Non-holo" && (
                <span className="pill gold">{result.pokemon.variant}</span>
              )}
              {result.pokemon?.rarity && <span className="pill">{result.pokemon.rarity}</span>}
            </div>
            {typeof result.idConfidence === "number" && (
              <div style={{ marginTop: 10 }}>
                <span
                  className={`pill ${result.idConfidence >= 8 ? "green" : result.idConfidence >= 5 ? "blue" : "red"}`}
                  title={tr("How sure the identification is, from 1 to 10, based on photo clarity and eBay/reverse-image matches.")}
                >
                  🎯 {tr("ID accuracy")} {Math.round(result.idConfidence)}/10
                </span>
                {result.idConfidence < 5 && (
                  <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                    {tr("Low — try a sharper, straight-on photo.")}
                  </span>
                )}
              </div>
            )}
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="score-ring" style={{ ["--p" as any]: score }}>
              <div className="inner">{score}</div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
              {rating.label}
            </div>
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>{tr("Estimated value")}</h3>
          {result.ambiguous ? (
            <p style={{ marginTop: 0, fontSize: 15 }}>{v.note}</p>
          ) : (
            <>
              <div className="value-row">
                <span className="value-big">{money(v.mid, v.currency)}</span>
                <span className="range">
                  {money(v.low, v.currency)} – {money(v.high, v.currency)}
                </span>
              </div>
              <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>{v.note}</p>
            </>
          )}
          {result.estimatedCondition && (
            <div className="kv" style={{ marginTop: 10 }}>
              <span className="k">{tr("Condition (est.)")}</span>
              <span>{result.estimatedCondition}</span>
            </div>
          )}
        </div>

        <div className="card">
          <h3>{tr("Player outlook")}</h3>
          <div style={{ marginBottom: 8 }}>{trendPill(outlook.trend || "unknown", tr)}</div>
          <p style={{ marginTop: 0, fontSize: 15 }}>{outlook.summary}</p>
        </div>
      </div>

      <div className="card">
        <h3>{tr("Overall take")}</h3>
        <p style={{ marginTop: 0 }}>{rating.summary}</p>
        <p style={{ marginBottom: 0 }} className="muted">{result.generalAssessment}</p>
      </div>

      {result.pokemon && Object.values(result.pokemon).some(Boolean) && (
        <div className="card">
          <h3>{tr("Pokémon details")}</h3>
          <div className="kv">
            {result.pokemon.setNumber && (<><span className="k">{tr("Set number")}</span><span>{result.pokemon.setNumber}</span></>)}
            {result.pokemon.rarity && (<><span className="k">{tr("Rarity")}</span><span>{result.pokemon.rarity}</span></>)}
            {result.pokemon.variant && (<><span className="k">{tr("Variant")}</span><span>{result.pokemon.variant}</span></>)}
            {result.pokemon.edition && (<><span className="k">{tr("Edition")}</span><span>{result.pokemon.edition}</span></>)}
            {result.pokemon.hp && (<><span className="k">{tr("HP")}</span><span>{result.pokemon.hp}</span></>)}
            {result.pokemon.types && (<><span className="k">{tr("Type")}</span><span>{result.pokemon.types}</span></>)}
            {result.pokemon.stage && (<><span className="k">{tr("Stage")}</span><span>{result.pokemon.stage}</span></>)}
            {result.pokemon.language && (<><span className="k">{tr("Language")}</span><span>{result.pokemon.language}</span></>)}
            {result.pokemon.regulationMark && (<><span className="k">{tr("Regulation mark")}</span><span>{result.pokemon.regulationMark}</span></>)}
          </div>
        </div>
      )}

      {result.conditionReport && (
        <div className="card">
          <h3>{tr("Condition & flaws")}</h3>
          <div style={{ marginBottom: 8 }}>
            <span className="pill">{result.conditionReport.grade}</span>
          </div>
          {(result.conditionReport.flaws?.length ?? 0) > 0 ? (
            <ul style={{ marginTop: 0 }}>
              {(result.conditionReport.flaws || []).map((f, i) => (
                <li key={i} className="warn">{f}</li>
              ))}
            </ul>
          ) : /no photo|not assessed/i.test(result.conditionReport.grade) ? null : (
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>{tr("No obvious flaws spotted in the photo.")}</p>
          )}
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{result.conditionReport.summary}</p>
        </div>
      )}

      {(result.hiddenInsights?.length ?? 0) > 0 && (
        <div className="card">
          <h3>{tr("Stats you might not notice")}</h3>
          {result.hiddenInsights.map((ins, i) => (
            <div className="insight" key={i}>
              <div className="label">{ins.label}</div>
              <div className="detail">{ins.detail}</div>
            </div>
          ))}
        </div>
      )}

      {(() => {
        // One combined "Trade ideas" section. Upgrades to chase and fair same-
        // value asks were two near-identical lists; merge them, tag each by kind,
        // and drop duplicate players so there's one clear list.
        const ideas = [
          ...(result.recommendedTrades || []).map((t) => ({
            player: t.player, card: t.cardSuggestion, value: t.comparableValue,
            reason: t.reason, kind: "upgrade" as const,
          })),
          ...(result.similarValueTargets || []).map((t) => ({
            player: t.player, card: t.cardSuggestion, value: t.estimatedValue,
            reason: t.reason, kind: "swap" as const,
          })),
        ];
        const seen = new Set<string>();
        const merged = ideas.filter((x) => {
          const k = `${x.player}|${x.card}`.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (merged.length === 0) return null;
        return (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>{tr("Trade ideas")}</h3>
              {onWishAll && (
                <button className="btn ghost small" onClick={() => onWishAll(merged.map((x) => `${x.player} ${x.card}`))}>
                  ♡ {tr("Add all to wishlist")}
                </button>
              )}
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              {tr("Upgrades worth chasing, and comparable-caliber players you could fairly swap for — judged on the player, not just the price.")}
            </p>
            {merged.map((x, i) => (
              <div className="trade-rec" key={i}>
                <div className="name">
                  {x.player}{" "}
                  <span className={`pill ${x.kind === "upgrade" ? "green" : "blue"}`} style={{ fontSize: 11 }}>
                    {x.kind === "upgrade" ? `⬆ ${tr("Upgrade")}` : `⇄ ${tr("Fair swap")}`}
                  </span>
                </div>
                <div className="sub">
                  {x.card}
                  {x.value ? ` · ${x.value}` : ""}
                </div>
                <div style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14 }}>{x.reason}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {(result.warnings?.length ?? 0) > 0 && (
        <div className="card">
          <h3>{tr("Heads up")}</h3>
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
