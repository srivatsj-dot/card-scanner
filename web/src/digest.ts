// Shared digest generation so the morning briefing is produced once and shows
// up instantly. Both the app-load background prefetch and the Today view call
// ensureDigest(); an in-flight map means a day is never generated twice even if
// they race. Results are cached immutably per date in localStorage.
import type { DigestResult, Settings } from "./types";
import { getDigest } from "./api";

type Archive = Record<string, DigestResult>;
const inflight = new Map<string, Promise<DigestResult | null>>();

// Bump when the digest's generation logic changes, so already-cached days are
// silently regenerated with the new logic instead of showing stale results.
// (There's no "regenerate" button by design — this is how fixes propagate.)
const DIGEST_VERSION = 5;
export const isFresh = (d: DigestResult | undefined): d is DigestResult =>
  !!d && (d as { __v?: number }).__v === DIGEST_VERSION;

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
  cacheKey: string, date: string, sports: string[], players: string[], wishlist: string[], settings: Settings
): Promise<DigestResult | null> {
  try {
    const d = await getDigest(date, sports, players, wishlist, settings);
    const withTime = { ...d, generatedAt: Date.now(), __v: DIGEST_VERSION };
    // Never downgrade a good briefing to a blank one: if this regeneration came
    // back empty but we already had real content cached, keep the good one (just
    // re-stamp its version so we don't keep retrying it forever).
    const prev = readDigestArchive(cacheKey)[date];
    if (!hasContent(withTime) && hasContent(prev)) {
      const kept = { ...prev, __v: DIGEST_VERSION } as DigestResult;
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
  const p = generate(cacheKey, date, sports, players, wishlist, settings).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
