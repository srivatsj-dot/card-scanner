// A small, device-local cache for card lookups so re-searching a card you've
// already looked up is instant instead of a fresh ~5s model call. Card data
// isn't user-specific, so the cache is shared across accounts on the device.
//
// Entries expire (prices drift) and the cache is capped with LRU eviction so it
// can't grow without bound. Price *refreshes* deliberately bypass this — they
// call searchCard directly — so the binder always re-prices live.

import type { ScanResult, Settings } from "./types";
import { searchCard } from "./api";

const CACHE_KEY = "card-scanner-search-cache";
const TTL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES = 120;

interface Entry {
  at: number;
  result: ScanResult;
}
type Cache = Record<string, Entry>;

// Key on the query plus the settings that actually change the answer (market,
// currency, language, live-data). The wishlist and other settings don't.
function keyFor(text: string, settings: Settings): string {
  return JSON.stringify({
    q: text.trim().toLowerCase().replace(/\s+/g, " "),
    r: settings.region || "",
    c: settings.currency || "",
    l: settings.language || "",
    g: settings.liveData === false ? 0 : 1,
  });
}

function read(): Cache {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function write(cache: Cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — fine, it's only a cache */
  }
}

/** A fresh, non-expired cached result, or null. Synchronous — for instant UI. */
export function getCachedSearch(text: string, settings: Settings): ScanResult | null {
  if (!text.trim()) return null;
  const entry = read()[keyFor(text, settings)];
  if (entry && Date.now() - entry.at < TTL) return entry.result;
  return null;
}

/** Look up a card, returning a cached result instantly when one is fresh. */
export async function searchCardCached(text: string, settings: Settings): Promise<ScanResult> {
  const key = keyFor(text, settings);
  const cache = read();
  const hit = cache[key];
  if (hit && Date.now() - hit.at < TTL) return hit.result;

  const result = await searchCard(text, settings);
  // Only cache confident identifications — don't pin a "couldn't identify" miss.
  if (result.identified) {
    cache[key] = { at: Date.now(), result };
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => cache[a].at - cache[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete cache[k]);
    }
    write(cache);
  }
  return result;
}
