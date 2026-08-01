// Shared digest generation so the morning briefing is produced once and shows
// up instantly. Both the app-load background prefetch and the Today view call
// ensureDigest(); an in-flight map means a day is never generated twice even if
// they race. Results are cached immutably per date in localStorage.
import type { DigestResult, Settings } from "./types";
import { getDigest } from "./api";

type Archive = Record<string, DigestResult>;
const inflight = new Map<string, Promise<DigestResult | null>>();

// Bump when the CLIENT's handling changes. The server also stamps every briefing
// with its own generation version (`gen`), and that's the one that matters: it
// changes whenever the briefing rules change, and a cached day written under an
// older `gen` is stale. Without this check each account kept whatever it first
// cached, which is why two accounts showed completely different briefings for the
// same day.
const DIGEST_VERSION = 7;
let serverGen: string | null = null;
/** Learn the server's current briefing generation (once per session). */
export async function loadDigestGen(): Promise<void> {
  try {
    const r = await fetch("/api/health");
    const d = (await r.json()) as { digestGen?: string };
    if (d?.digestGen) serverGen = String(d.digestGen);
  } catch { /* offline — fall back to whatever is cached */ }
}
export const isFresh = (d: DigestResult | undefined): d is DigestResult => {
  if (!d || (d as { __v?: number }).__v !== DIGEST_VERSION) return false;
  const gen = (d as { __gen?: string }).__gen;
  // Once we know the server's generation, anything from a different one is stale.
  return !serverGen || !gen || gen === serverGen;
};

// Does a briefing actually have anything in it? Used so a temporarily-empty
// regeneration never replaces a good cached briefing with a blank one.
function hasContent(d: DigestResult | undefined): boolean {
  if (!d) return false;
  if (d.yourCards?.length || d.yourWishlist?.length) return true;
  return (d.sections || []).some(
    (s) => s.risingStars.length || s.declining.length || s.storylines.length || s.trades.length || s.chase.length || s.news.length
  );
}

export function readDigestArchive(cacheKey: string): Archive {
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey) || "{}");
    if (raw && raw.sections) return {}; // old single-digest format — discard
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function write(cacheKey: string, date: string, digest: DigestResult) {
  const next = { ...readDigestArchive(cacheKey), [date]: digest };
  try {
    localStorage.setItem(cacheKey, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

async function generate(
  cacheKey: string, date: string, sports: string[], players: string[], wishlist: string[], settings: Settings,
  refresh = false
): Promise<DigestResult | null> {
  try {
    const d = await getDigest(date, sports, players, wishlist, settings, refresh);
    const withTime = { ...d, generatedAt: Date.now(), __v: DIGEST_VERSION, __gen: (d as { gen?: string }).gen ?? serverGen ?? undefined };
    // Never downgrade a good briefing to a blank one: if this regeneration came
    // back empty but we already had real content cached, keep the good one (just
    // re-stamp its version so we don't keep retrying it forever).
    const prev = readDigestArchive(cacheKey)[date];
    if (!refresh && !hasContent(withTime) && hasContent(prev)) {
      const kept = { ...prev, __v: DIGEST_VERSION, __gen: serverGen ?? undefined } as DigestResult;
      write(cacheKey, date, kept);
      return kept;
    }
    write(cacheKey, date, withTime);
    return withTime;
  } catch {
    return null;
  }
}

/** Return the cached briefing for a date, generating it once if missing. */
export function ensureDigest(
  cacheKey: string, date: string, sports: string[], players: string[], wishlist: string[], settings: Settings
): Promise<DigestResult | null> {
  const existing = readDigestArchive(cacheKey)[date];
  if (isFresh(existing)) return Promise.resolve(existing);
  const key = `${cacheKey}|${date}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = generate(cacheKey, date, sports, players, wishlist, settings).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Force a fresh briefing for a date, overwriting any cached one. */
export function regenerateDigest(
  cacheKey: string, date: string, sports: string[], players: string[], wishlist: string[], settings: Settings
): Promise<DigestResult | null> {
  const key = `${cacheKey}|${date}`;
  // Force the SERVER to rebuild too — otherwise it just hands back the same
  // cached briefing and nothing actually changes.
  const p = generate(cacheKey, date, sports, players, wishlist, settings, true).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
