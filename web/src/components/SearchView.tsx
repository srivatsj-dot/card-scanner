import { useEffect, useState } from "react";
import type { ScanResult, Settings } from "../types";
import { searchCardCached, getCachedSearch } from "../cache";
import { verifyPrice } from "../api";
import { useT } from "../translator";
import ResultCard from "./ResultCard";
import ResultSkeleton from "./ResultSkeleton";

interface Props {
  settings: Settings;
  result: ScanResult | null;
  onResult: (r: ScanResult | null) => void;
  onSave: (result: ScanResult, frontDataUrl: string | undefined) => void;
  onWishAll?: (texts: string[]) => void;
  onWishResult?: (result: ScanResult) => void;
}

export default function SearchView({ settings, result, onResult, onSave, onWishAll, onWishResult }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [wished, setWished] = useState(false);
  const t = useT();

  const [pending, setPending] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState(""); // the query behind the current result
  // Clarify popup for a too-vague search: collect year/brand/parallel and retry.
  const [clarify, setClarify] = useState(false);
  const [clarYear, setClarYear] = useState("");
  const [clarBrand, setClarBrand] = useState("");
  const [clarParallel, setClarParallel] = useState("");

  async function run(query?: string) {
    const q = (query ?? text).trim();
    if (!q) return;
    setText(q);
    setError(null);
    setSaved(false);
    setWished(false);
    setLastQuery(q);
    // Instant if we've looked this card up recently.
    const cached = getCachedSearch(q, settings);
    if (cached) {
      onResult(cached);
      return;
    }
    // Otherwise show a result-shaped skeleton with the query as the title right
    // away, and fill it in when the lookup lands.
    onResult(null);
    setPending(q);
    setLoading(true);
    try {
      const r = await searchCardCached(q, settings);
      onResult(r);
      if (r.identified) {
        verifyPrice(r, settings)
          .then((v) => { if (v?.estimatedValue) onResult({ ...r, estimatedValue: v.estimatedValue }); })
          .catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
      setPending(null);
    }
  }

  function submitClarify() {
    const extra = [clarYear, clarBrand, clarParallel].map((s) => s.trim()).filter(Boolean).join(" ");
    setClarify(false);
    if (extra) run(`${lastQuery} ${extra}`.trim());
  }

  // When a search comes back too vague to price, pop up to ask for the details
  // that would pin the exact card.
  useEffect(() => {
    if (result?.ambiguous) {
      setClarYear(""); setClarBrand(""); setClarParallel("");
      setClarify(true);
    }
  }, [result?.ambiguous]);

  return (
    <div>
      <div className="card">
        <h2>{t("Search cards")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("No photo? Just describe the card — player/subject, set, year, parallel, serial — and get the same value, stats, and trade ideas.")}
        </p>
        <label className="field">
          <span>{t("Describe a card")}</span>
          <input
            type="text"
            value={text}
            placeholder={t("Describe a card — player or subject, set, year, and any parallel or serial")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          />
        </label>
        <button className="btn" onClick={() => run()} disabled={loading || !text.trim()}>
          {loading ? <><span className="spinner" />{t("Searching…")}</> : t("Search")}
        </button>
        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {loading && !result && (
        <div style={{ marginTop: 16 }}>
          <ResultSkeleton title={pending || undefined} />
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          {result.identified && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 14 }}>{t("Keep this in your collection?")}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {onWishResult && (
                  <button className="btn secondary" onClick={() => { onWishResult(result); setWished(true); }} disabled={wished}>
                    {wished ? t("✓ Wishlisted") : `♡ ${t("Add to wishlist")}`}
                  </button>
                )}
                <button
                  className="btn"
                  onClick={() => { onSave(result, undefined); setSaved(true); }}
                  disabled={saved}
                >
                  {t(saved ? "✓ Saved to binder" : "★ Save to binder")}
                </button>
              </div>
            </div>
          )}
          <ResultCard result={result} onWishAll={onWishAll} />
        </div>
      )}

      {clarify && (
        <div className="backdrop" onClick={() => setClarify(false)}>
          <div className="card login-modal" onClick={(e) => e.stopPropagation()} style={{ width: "min(440px, 94vw)" }}>
            <button className="modal-x" onClick={() => setClarify(false)}>✕</button>
            <h3 style={{ marginTop: 0 }}>🔎 {t("Which one is it?")}</h3>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              {t("There are many")} <strong>{lastQuery}</strong> {t("cards. Add a few details and we'll price the exact one — leave blank what you don't know.")}
            </p>
            <label className="field">
              <span>{t("Year")}</span>
              <input type="text" value={clarYear} placeholder="e.g. 2024" onChange={(e) => setClarYear(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitClarify(); }} />
            </label>
            <label className="field">
              <span>{t("Brand / set")}</span>
              <input type="text" value={clarBrand} placeholder="e.g. Topps Chrome" onChange={(e) => setClarBrand(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitClarify(); }} />
            </label>
            <label className="field">
              <span>{t("Parallel / serial / card #")} ({t("optional")})</span>
              <input type="text" value={clarParallel} placeholder="e.g. Gold /50, #150" onChange={(e) => setClarParallel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitClarify(); }} />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn ghost small" onClick={() => setClarify(false)}>{t("Skip")}</button>
              <button className="btn" onClick={submitClarify} disabled={![clarYear, clarBrand, clarParallel].some((s) => s.trim())}>
                {t("Look it up")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
