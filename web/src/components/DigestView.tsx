import { useEffect, useState } from "react";
import type { Settings, DigestResult } from "../types";
import { getDigest } from "../api";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  players: string[];
  cacheKey: string;
}

const SPORT_EMOJI: Record<string, string> = {
  pokémon: "⚡", pokemon: "⚡", baseball: "⚾", soccer: "⚽", cricket: "🏏",
  basketball: "🏀", football: "🏈", hockey: "🏒",
};
const emojiFor = (s: string) => SPORT_EMOJI[s.toLowerCase()] || "🃏";

const isToday = (t: number) => new Date(t).toDateString() === new Date().toDateString();

function Bucket({ title, items }: { title: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="digest-bucket">{title}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {items.map((it, i) => <li key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>{it}</li>)}
      </ul>
    </div>
  );
}

export default function DigestView({ settings, players, cacheKey }: Props) {
  const t = useT();
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force: boolean) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getDigest(settings.digestSports, players, settings);
      const withTime = { ...d, generatedAt: Date.now() };
      setDigest(withTime);
      try { localStorage.setItem(cacheKey, JSON.stringify(withTime)); } catch { /* quota */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the update.");
    } finally {
      setLoading(false);
    }
    void force;
  }

  // Load today's update once; reuse the cache if it's already from today.
  useEffect(() => {
    let cached: DigestResult | null = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { /* ignore */ }
    if (cached && isToday(cached.generatedAt)) {
      setDigest(cached);
    } else if (settings.morningUpdate) {
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>☀️ {t("Morning update")}</h2>
          <button className="btn secondary small" onClick={() => load(true)} disabled={loading}>
            {loading ? <><span className="spinner" />{t("Updating…")}</> : `↻ ${t("Refresh")}`}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>{dateLabel}</p>
        {digest && <p style={{ marginBottom: 0 }}>{digest.overview}</p>}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        {!digest && !loading && !error && (
          <p className="muted" style={{ marginBottom: 0 }}>
            {settings.morningUpdate
              ? t("Loading your daily market update…")
              : t("The morning update is turned off. Enable it in Settings, or hit Refresh to load it now.")}
          </p>
        )}
      </div>

      {digest?.sections.map((sec, i) => {
        const empty = !sec.risingStars.length && !sec.declining.length && !sec.majorTrades.length && !sec.toChase.length && !sec.other.length;
        return (
          <div className="card" key={i}>
            <h3 style={{ fontSize: 15, textTransform: "none", letterSpacing: 0, color: "var(--text)" }}>
              {emojiFor(sec.sport)} {sec.sport}
            </h3>
            {empty && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("Nothing major today.")}</p>}
            <Bucket title={`📈 ${t("Rising stars")}`} items={sec.risingStars} />
            <Bucket title={`📉 ${t("Cooling off")}`} items={sec.declining} />
            <Bucket title={`🔄 ${t("Trades & moves")}`} items={sec.majorTrades} />
            <Bucket title={`🎯 ${t("Worth chasing")}`} items={sec.toChase} />
            <Bucket title={`📰 ${t("Other news")}`} items={sec.other} />
          </div>
        );
      })}
    </div>
  );
}
