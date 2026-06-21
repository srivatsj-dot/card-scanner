import { useEffect, useState } from "react";
import type { Settings, DigestResult } from "../types";
import { getDigest } from "../api";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  players: string[];
  wishlist: string[];
  cacheKey: string;
}

// The archive (and the digest's news) officially begins here.
const LAUNCH = "2026-06-19";

const SPORT_EMOJI: Record<string, string> = {
  pokémon: "⚡", pokemon: "⚡", baseball: "⚾", soccer: "⚽", cricket: "🏏",
  basketball: "🏀", football: "🏈", hockey: "🏒",
};
const emojiFor = (s: string) => SPORT_EMOJI[s.toLowerCase()] || "🃏";

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => fmt(new Date());
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const human = (s: string) => parse(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

type Archive = Record<string, DigestResult>;

function Bucket({ icon, title, tone, items }: { icon: string; title: string; tone: string; items: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`digest-bucket tone-${tone}`}>
      <div className="digest-bucket-head">{icon} {title}</div>
      <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}

/** Compact month calendar; days outside [min,max] are disabled, archived days dotted. */
function MonthCalendar({ value, min, max, has, onPick }: {
  value: string; min: string; max: string; has: (d: string) => boolean; onPick: (d: string) => void;
}) {
  const [view, setView] = useState(() => { const d = parse(value); return { y: d.getFullYear(), m: d.getMonth() }; });
  const first = new Date(view.y, view.m, 1);
  const startPad = first.getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const monthStr = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(fmt(new Date(view.y, view.m, d)));
  const prevMonth = () => setView((v) => ({ y: v.m === 0 ? v.y - 1 : v.y, m: v.m === 0 ? 11 : v.m - 1 }));
  const nextMonth = () => setView((v) => ({ y: v.m === 11 ? v.y + 1 : v.y, m: v.m === 11 ? 0 : v.m + 1 }));
  return (
    <div className="cal">
      <div className="cal-head">
        <button className="iconbtn" onClick={prevMonth} aria-label="Previous month">‹</button>
        <strong>{monthStr}</strong>
        <button className="iconbtn" onClick={nextMonth} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={`h${i}`} className="cal-dow">{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const disabled = c < min || c > max;
          const day = parse(c).getDate();
          return (
            <button
              key={i}
              className={`cal-day ${c === value ? "sel" : ""} ${has(c) ? "has" : ""}`}
              disabled={disabled}
              onClick={() => onPick(c)}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function DigestView({ settings, players, wishlist, cacheKey }: Props) {
  const t = useT();
  const [archive, setArchive] = useState<Archive>({});
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCal, setShowCal] = useState(false);

  const today = todayStr();
  const isToday = date === today;
  const digest = archive[date] || null;

  function readArchive(): Archive {
    try {
      const raw = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      if (raw && raw.sections) return {}; // old single-digest format — discard
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  }

  // Generate the briefing for a specific date. Immutable: never regenerate a
  // day that already has one saved.
  async function load(target: string, force = false) {
    if (loading || (archive[target] && !force) || target < LAUNCH || target > today) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getDigest(target, settings.digestSports, players, wishlist, settings);
      const withTime = { ...d, generatedAt: Date.now() };
      const next = { ...readArchive(), [target]: withTime };
      setArchive(next);
      setDate(target);
      try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* quota */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the briefing.");
    } finally {
      setLoading(false);
    }
  }

  // On open: load the saved archive and auto-generate today's briefing if it
  // isn't there yet — you never have to kick it off yourself.
  useEffect(() => {
    const arc = readArchive();
    setArchive(arc);
    if (!arc[today]) load(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totallyQuiet = digest &&
    !digest.yourCards.length && !digest.yourWishlist.length &&
    digest.sections.every((s) => !(s.risingStars.length || s.declining.length || s.storylines.length || s.trades.length || s.chase.length || s.news.length));

  return (
    <div>
      <div className="card digest-hero">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div className="digest-eyebrow">☀️ {t("Morning update")}</div>
            <div className="digest-datebar">
              <button className="iconbtn" disabled={date <= LAUNCH} onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">‹</button>
              <button className="digest-datebtn" onClick={() => setShowCal((s) => !s)}>📅 {isToday ? t("Today") : human(date)}</button>
              <button className="iconbtn" disabled={isToday} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">›</button>
            </div>
            {digest && <h2 style={{ margin: "8px 0 0", fontSize: 22 }}>{digest.overview}</h2>}
          </div>
          {!digest && !loading && date >= LAUNCH && date <= today && (
            <button className="btn secondary small" onClick={() => load(date)}>
              {isToday ? t("Load briefing") : t("Generate this day's briefing")}
            </button>
          )}
          {digest && isToday && !loading && (
            <button className="btn ghost small" onClick={() => load(today, true)} title={t("Pull a fresh briefing for today")}>
              ↻ {t("Regenerate")}
            </button>
          )}
        </div>

        {showCal && (
          <MonthCalendar
            value={date}
            min={LAUNCH}
            max={today}
            has={(d) => !!archive[d]}
            onPick={(d) => { setDate(d); setShowCal(false); }}
          />
        )}

        {loading && <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}><span className="spinner" />{t("Reading the wire…")}</p>}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
        {!digest && !loading && !error && (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            {t("No briefing saved for this day yet — generate one to lock it in. Once made, a day's briefing never changes.")}
          </p>
        )}
      </div>

      {digest && digest.yourCards.length > 0 && (
        <div className="card digest-yours">
          <h3 style={{ marginTop: 0 }}>📒 {t("In your binder")}</h3>
          <ul className="digest-yours-list">{digest.yourCards.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      )}

      {digest && digest.yourWishlist.length > 0 && (
        <div className="card digest-yours">
          <h3 style={{ marginTop: 0 }}>♡ {t("From your wishlist")}</h3>
          <ul className="digest-yours-list">{digest.yourWishlist.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      )}

      {totallyQuiet && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>{t("No major card news today — enjoy the quiet, and check back tomorrow.")}</p>
        </div>
      )}

      {digest?.sections.map((sec, i) => {
        const empty = !sec.risingStars.length && !sec.declining.length && !sec.storylines.length && !sec.trades.length && !sec.chase.length && !sec.news.length;
        if (empty) return null;
        return (
          <div className="card" key={i}>
            <div className="digest-sport">{emojiFor(sec.sport)} {sec.sport}</div>
            <div className="digest-buckets">
              <Bucket icon="📈" title={t("Rising stars")} tone="up" items={sec.risingStars} />
              <Bucket icon="📉" title={t("Slumping")} tone="down" items={sec.declining} />
              <Bucket icon="🔥" title={t("Storylines")} tone="hot" items={sec.storylines} />
              <Bucket icon="🔄" title={t("Roster moves")} tone="info" items={sec.trades} />
              <Bucket icon="👀" title={t("Ones to watch")} tone="chase" items={sec.chase} />
              <Bucket icon="💰" title={t("Market")} tone="news" items={sec.news} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
