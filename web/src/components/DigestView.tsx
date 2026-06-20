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

function Bucket({ icon, title, tone, items }: { icon: string; title: string; tone: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`digest-bucket tone-${tone}`}>
      <div className="digest-bucket-head">{icon} {title}</div>
      <ul>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

export default function DigestView({ settings, players, cacheKey }: Props) {
  const t = useT();
  const [digest, setDigest] = useState<DigestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
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
  }

  // Load today's update once; reuse the cache if it's already from today.
  useEffect(() => {
    let cached: DigestResult | null = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { /* ignore */ }
    // Only reuse a cache from today that matches the current digest shape.
    const valid = cached && isToday(cached.generatedAt) && Array.isArray(cached.yourCards);
    if (valid) {
      setDigest(cached);
    } else if (settings.morningUpdate) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div>
      <div className="card digest-hero">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="digest-eyebrow">☀️ {t("Morning update")} · {dateLabel}</div>
            {digest ? (
              <h2 style={{ margin: "6px 0 0", fontSize: 22 }}>{digest.overview}</h2>
            ) : (
              <h2 style={{ margin: "6px 0 0", fontSize: 22 }}>
                {loading ? t("Reading the wire…") : t("Your daily card market briefing")}
              </h2>
            )}
          </div>
          <button className="btn secondary small" onClick={load} disabled={loading}>
            {loading ? <><span className="spinner" />{t("Updating…")}</> : `↻ ${t("Refresh")}`}
          </button>
        </div>
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        {!digest && !loading && !error && !settings.morningUpdate && (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("The morning update is off. Turn it on in Settings, or hit Refresh to load it now.")}
          </p>
        )}
      </div>

      {digest && digest.yourCards.length > 0 && (
        <div className="card digest-yours">
          <h3 style={{ marginTop: 0 }}>📒 {t("In your binder")}</h3>
          <ul className="digest-yours-list">
            {digest.yourCards.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </div>
      )}

      {digest?.sections.map((sec, i) => {
        const empty =
          !sec.risingStars.length && !sec.declining.length && !sec.storylines.length &&
          !sec.trades.length && !sec.chase.length && !sec.news.length;
        return (
          <div className="card" key={i}>
            <div className="digest-sport">{emojiFor(sec.sport)} {sec.sport}</div>
            {empty ? (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("Quiet day here.")}</p>
            ) : (
              <div className="digest-buckets">
                <Bucket icon="📈" title={t("Rising stars")} tone="up" items={sec.risingStars} />
                <Bucket icon="📉" title={t("Cooling off")} tone="down" items={sec.declining} />
                <Bucket icon="🔥" title={t("Storylines")} tone="hot" items={sec.storylines} />
                <Bucket icon="🔄" title={t("Trades & moves")} tone="info" items={sec.trades} />
                <Bucket icon="🎯" title={t("Worth chasing")} tone="chase" items={sec.chase} />
                <Bucket icon="📰" title={t("Market news")} tone="news" items={sec.news} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
