import { useState } from "react";
import type { ScanResult, Settings } from "../types";
import { searchCardCached, getCachedSearch } from "../cache";
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

  async function run() {
    const q = text.trim();
    if (!q) return;
    setError(null);
    setSaved(false);
    setWished(false);
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
      onResult(await searchCardCached(q, settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
      setPending(null);
    }
  }

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
        <button className="btn" onClick={run} disabled={loading || !text.trim()}>
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
    </div>
  );
}
