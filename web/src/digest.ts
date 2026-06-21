// Shared digest generation so the morning briefing is produced once and shows
// up instantly. Both the app-load background prefetch and the Today view call
// ensureDigest(); an in-flight map means a day is never generated twice even if
// they race. Results are cached immutably per date in localStorage.
import type { DigestResult, Settings } from "./types";
import { getDigest } from "./api";

type Archive = Record<string, DigestResult>;
const inflight = new Map<string, Promise<DigestResult | null>>();

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
    const withTime = { ...d, generatedAt: Date.now() };
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
  if (existing) return Promise.resolve(existing);
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
