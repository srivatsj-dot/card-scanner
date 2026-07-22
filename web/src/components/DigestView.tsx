import { useEffect, useRef, useState } from "react";
import type { Settings, DigestResult } from "../types";
import { ensureDigest, regenerateDigest, readDigestArchive, isFresh } from "../digest";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  players: string[];
  wishlist: string[];
  cacheKey: string;
  collected: string[]; // categories the user actually collects (from their binder)
}

// Keep each bucket short so the briefing is a quick read, not a wall of text.
const MAX_PER_BUCKET = 4;

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
  const shown = items.slice(0, MAX_PER_BUCKET);
  return (
    <div className={`digest-bucket tone-${tone}`}>
      <div className="digest-bucket-head">{icon} {title}</div>
      <ul>{shown.map((it, i) => <li key={i}>{it}</li>)}</ul>
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

// Newest cached briefing on or before today, so we open onto a ready one.
function newestCached(arc: Archive, today: string): string {
  const keys = Object.keys(arc).filter((k) => k >= LAUNCH && k <= today).sort();
  return keys.length ? keys[keys.length - 1] : today;
}

export default function DigestView({ settings, players, wishlist, cacheKey, collected }: Props) {
  // Personalize the briefing to what the collector actually owns: when their
  // binder has cards, only cover those categories (so a no-Pokémon collector
  // never gets an all-Pokémon briefing). Fall back to their chosen digest
  // categories only when the binder is empty.
  const sportsFollowed = collected.length ? collected : settings.digestSports;
  const t = useT();
  const today = todayStr();
  // Start from what's already cached so there's no loading state to see.
  const [archive, setArchive] = useState<Archive>(() => readDigestArchive(cacheKey));
  const [date, setDate] = useState(() => newestCached(readDigestArchive(cacheKey), today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCal, setShowCal] = useState(false);
  const navigated = useRef(false); // did the user pick a day manually?
  const tried = useRef<Set<string>>(new Set());

  const isToday = date === today;
  const digest = archive[date] || null;

  const refresh = () => setArchive(readDigestArchive(cacheKey));

  // Foreground generate for a day the user is looking at (or regenerating).
  async function generate(target: string, force = false) {
    if (target < LAUNCH || target > today) return;
    setBusy(true);
    setError(null);
    const got = force
      ? await regenerateDigest(cacheKey, target, sportsFollowed, players, wishlist, settings)
      : await ensureDigest(cacheKey, target, sportsFollowed, players, wishlist, settings);
    setBusy(false);
    if (got) {
      refresh();
      setDate(target);
    } else {
      setError(t("Couldn't load the briefing."));
    }
  }

  // On open: make sure today's briefing exists (generated here or by the app's
  // background prefetch — de-duplicated), then quietly slide to it when ready, so
  // you never sit on a loading screen. Until then you see the newest cached day.
  useEffect(() => {
    let alive = true;
    const nothingToShow = !readDigestArchive(cacheKey)[date]; // first-ever open
    if (nothingToShow) setBusy(true);
    ensureDigest(cacheKey, today, sportsFollowed, players, wishlist, settings).then((got) => {
      if (!alive) return;
      if (nothingToShow) setBusy(false);
      if (got) {
        refresh();
        if (!navigated.current) setDate(today);
      } else if (nothingToShow) {
        setError(t("Couldn't load the briefing."));
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigating to a past day with no saved (or stale-version) briefing
  // regenerates it silently.
  useEffect(() => {
    if (date === today || isFresh(archive[date]) || busy || tried.current.has(date)) return;
    if (date < LAUNCH || date > today) return;
    tried.current.add(date);
    generate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, archive]);

  function goTo(target: string) {
    navigated.current = true;
    setDate(target);
  }
  function retry(d: string) {
    tried.current.delete(d);
    generate(d);
  }

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
              <button className="iconbtn" disabled={date <= LAUNCH} onClick={() => goTo(addDays(date, -1))} aria-label="Previous day">‹</button>
              <button className="digest-datebtn" onClick={() => setShowCal((s) => !s)}>📅 {isToday ? t("Today") : human(date)}</button>
              <button className="iconbtn" disabled={isToday} onClick={() => goTo(addDays(date, 1))} aria-label="Next day">›</button>
            </div>
            {digest && <h2 style={{ margin: "8px 0 0", fontSize: 22 }}>{digest.overview}</h2>}
          </div>
        </div>

        {showCal && (
          <MonthCalendar
            value={date}
            min={LAUNCH}
            max={today}
            has={(d) => !!archive[d]}
            onPick={(d) => { goTo(d); setShowCal(false); }}
          />
        )}

        {error && !busy && (
          <div style={{ marginTop: 12 }}>
            <div className="error-box">{error}</div>
            <button className="btn secondary small" style={{ marginTop: 8 }} onClick={() => retry(date)}>{t("Try again")}</button>
          </div>
        )}
      </div>

      {digest && players.length > 0 && digest.yourCards.length > 0 && (
        <div className="card digest-yours">
          <h3 style={{ marginTop: 0 }}>📒 {t("In your binder")}</h3>
          <ul className="digest-yours-list">{digest.yourCards.map((it, i) => <li key={i}>{it}</li>)}</ul>
        </div>
      )}

      {digest && wishlist.length > 0 && digest.yourWishlist.length > 0 && (
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
