import { useState } from "react";
import type { ScanResult, Settings } from "../types";
import { searchCardCached, getCachedSearch } from "../cache";
import { verifyPrice } from "../api";
import { peopleSearch, type PeopleHit } from "../cloud";
import { money } from "../utils";
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
  cloudOn: boolean;
  isGuest: boolean;
  onTradeWith: (username: string) => void;
  onRequireLogin: () => void;
}

export default function SearchView({ settings, result, onResult, onSave, onWishAll, onWishResult, cloudOn, isGuest, onTradeWith, onRequireLogin }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [wished, setWished] = useState(false);
  const [mode, setMode] = useState<"cards" | "people">("cards");
  const [people, setPeople] = useState<PeopleHit[] | null>(null);
  const t = useT();

  async function runPeople() {
    const q = text.trim();
    if (!q) return;
    if (isGuest) { onRequireLogin(); return; }
    setError(null); setPeople(null); setLoading(true);
    try {
      setPeople((await peopleSearch(q)).results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "People search failed.");
    } finally { setLoading(false); }
  }

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

  return (
    <div>
      <div className="card">
        <h2>{t("Search")}</h2>
        <div className="auth-tabs" style={{ marginBottom: 10 }}>
          <button className={mode === "cards" ? "active" : ""} onClick={() => setMode("cards")}>🃏 {t("Search cards")}</button>
          <button className={mode === "people" ? "active" : ""} onClick={() => setMode("people")}>👤 {t("Search people")}</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === "cards"
            ? t("No photo? Just describe the card — player/subject, set, year, parallel, serial — and get the same value, stats, and trade ideas.")
            : t("Find collectors who have a card in their binder — search by player, set, or year, then trade or message them.")}
        </p>
        <label className="field">
          <span>{mode === "cards" ? t("Describe a card") : t("Which card are you looking for?")}</span>
          <input
            type="text"
            value={text}
            placeholder={mode === "cards"
              ? t("Describe a card — player or subject, set, year, and any parallel or serial")
              : t("e.g. 2023 Topps Chrome Julio Rodriguez")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") mode === "cards" ? run() : runPeople(); }}
          />
        </label>
        <button className="btn" onClick={() => (mode === "cards" ? run() : runPeople())} disabled={loading || !text.trim()}>
          {loading ? <><span className="spinner" />{t("Searching…")}</> : mode === "cards" ? t("Search") : t("Search people")}
        </button>
        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {mode === "people" && !cloudOn && (
        <div className="card"><p className="muted">{t("People search needs cloud accounts (DATABASE_URL) enabled on the server.")}</p></div>
      )}
      {mode === "people" && people && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{people.length} {t("collectors have a match")}</h3>
          {people.length === 0 && <p className="muted">{t("No one's binder has that card yet.")}</p>}
          {people.map((h) => (
            <div className="trade-rec" key={h.username}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div className="name">{h.display}</div>
                <button className="btn small" onClick={() => onTradeWith(h.username)}>🛒 {t("Trade")}</button>
              </div>
              <div className="sub">
                {h.matches.slice(0, 4).map((m) => `${m.label} (${money(m.value, m.currency)})`).join(" · ")}
                {h.matches.length > 4 ? ` +${h.matches.length - 4}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

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
