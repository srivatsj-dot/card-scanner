import { useState } from "react";
import type { ScanResult, Settings } from "../types";
import { searchCard } from "../api";
import { useT } from "../translator";
import ResultCard from "./ResultCard";

interface Props {
  settings: Settings;
  result: ScanResult | null;
  onResult: (r: ScanResult | null) => void;
  onSave: (result: ScanResult, frontDataUrl: string | undefined) => void;
}

export default function SearchView({ settings, result, onResult, onSave }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const t = useT();

  async function run() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      onResult(await searchCard(text.trim(), settings));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setLoading(false);
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
            placeholder={t("e.g. 2023 Topps Chrome Nolan Ryan refractor, or Charizard ex 199/165")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
          />
        </label>
        <button className="btn" onClick={run} disabled={loading || !text.trim()}>
          {loading ? <><span className="spinner" />{t("Searching…")}</> : t("Search")}
        </button>
        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          {result.identified && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 14 }}>{t("Keep this in your collection?")}</span>
              <button
                className="btn"
                onClick={() => { onSave(result, undefined); setSaved(true); }}
                disabled={saved}
              >
                {t(saved ? "✓ Saved to binder" : "★ Save to binder")}
              </button>
            </div>
          )}
          <ResultCard result={result} />
        </div>
      )}
    </div>
  );
}
