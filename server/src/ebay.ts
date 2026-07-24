// Real card prices from eBay's Browse API (current listings). Configure with
// EBAY_CLIENT_ID + EBAY_CLIENT_SECRET (a free eBay developer "production" app).
// Returns a robust price range from matching listings; null when not configured
// or too few matches, so callers fall back to the model's estimate.
//
// NOTE: the Browse API exposes ACTIVE listings (asking prices), not sold prices
// (sold data needs eBay's gated Marketplace Insights API). Asking prices skew a
// bit high, so we trim outliers and lean on the lower-middle of the range.

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID || "";
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || "";
export const hasEbay = Boolean(EBAY_CLIENT_ID && EBAY_CLIENT_SECRET);

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const IMAGE_SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image";

let token = "";
let tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (token && Date.now() < tokenExpiry) return token;
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString("base64"),
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) throw new Error(`eBay auth failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return token;
}

export interface EbayPrice {
  low: number;
  mid: number;
  high: number;
  currency: string;
  count: number;
  image?: string; // a representative listing image (real photo of the card)
}

// Map a market region to an eBay marketplace; defaults to the US.
const MARKETPLACE: Record<string, string> = {
  "United States": "EBAY_US", "Canada": "EBAY_CA", "United Kingdom": "EBAY_GB",
  Australia: "EBAY_AU", Germany: "EBAY_DE", France: "EBAY_FR", Italy: "EBAY_IT",
  Spain: "EBAY_ES", Ireland: "EBAY_IE",
};

type Item = {
  title?: string;
  price?: { value?: string; currency?: string };
  image?: { imageUrl?: string };
  thumbnailImages?: { imageUrl?: string }[];
};
// eBay serves images at a size baked into the URL (…/s-l140.jpg). Bump it to the
// largest so the card fills the binder frame sharply instead of a tiny padded thumb.
const upsize = (url: string) => url ? url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)/i, "/s-l1600.$1") : url;
const itemImage = (it?: Item) => upsize(it?.image?.imageUrl || it?.thumbnailImages?.[0]?.imageUrl || "");

// Reprints, novelty/custom cards, stickers, lots, and "read description" junk
// pollute a search with cheap listings that aren't the real card — this is how a
// genuine grail (e.g. a T206 Wagner) shows up as "$20". Drop them.
const JUNK = /\b(reprint|re-print|\brp\b|repro|reproduction|novelty|aceo|sticker|decal|custom|fantasy|facsimile|proxy|art card|fridge magnet|magnet|poster|mini|read desc|not real|replica|homage|fan art)\b/i;
const isRealCard = (it: Item) => !JUNK.test(it.title || "");
// Graded slabs (PSA/BGS/etc.) sell for many times a raw copy — pricing a RAW card
// against slabs badly overstates it. Detect them so we can exclude when raw.
const GRADED = /\b(psa|bgs|beckett|sgc|cgc|graded|gem\s?mint|slab(bed)?)\b/i;
const isGradedListing = (it: Item) => GRADED.test(it.title || "");
// Parallels / refractors / autos / relics / numbered hits sell for far more than a
// base card — pricing a BASE card against them badly overstates it. Detect them so
// we can exclude when the scanned card is a plain base card.
const PARALLEL = /\b(refractor|x-?fractor|superfractor|autograph|auto|signed|on[- ]card|patch|relic|jersey|memorabilia|one[- ]of[- ]one|1\s?\/\s?1|mojo|shimmer|disco|cracked\s?ice|die-?cut|ssp|numbered)\b|\/\s?\d{1,2}\b/i;
const isParallelListing = (it: Item) => PARALLEL.test(it.title || "");

// Robust price range from a set of listings; trims outliers, excludes obvious
// reprints/novelty items, and (for a raw card) drops graded slabs.
function summarize(items: Item[], opts?: { excludeGraded?: boolean; excludeParallels?: boolean }): EbayPrice | null {
  let real = items.filter(isRealCard);
  if (opts?.excludeGraded) {
    const raw = real.filter((it) => !isGradedListing(it));
    if (raw.length >= 3) real = raw; // only if enough raw comps remain
  }
  if (opts?.excludeParallels) {
    // Price a base card against base copies only — drop refractors/autos/numbered.
    const base = real.filter((it) => !isParallelListing(it));
    if (base.length >= 3) real = base;
  }
  // Keep price+item together so we can pick a representative image near the median.
  const priced = real
    .map((it) => ({ it, p: Number(it.price?.value) }))
    .filter((x) => Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.p - b.p);
  const prices = priced.map((x) => x.p);
  if (prices.length < 3) return null;
  const trim = Math.floor(prices.length * 0.1);
  const core = prices.slice(trim, prices.length - trim || prices.length);
  const at = (p: number) => core[Math.min(core.length - 1, Math.max(0, Math.floor(core.length * p)))];
  const mid = at(0.5);
  // Representative image: the TOP (most-relevant, Best-Match) real listing that
  // has a photo — eBay orders by relevance, so the first is the best match for
  // the card, not a random mid-priced lot.
  let image = "";
  for (const it of real) { const img = itemImage(it); if (img) { image = img; break; } }
  return {
    low: at(0.2),
    mid,
    high: at(0.8),
    currency: items.find((it) => it.price?.currency)?.price?.currency || "USD",
    count: prices.length,
    image: image || undefined,
  };
}

export async function ebayPrice(
  query: string,
  region?: string,
  opts: { excludeGraded?: boolean; excludeParallels?: boolean } = {}
): Promise<EbayPrice | null> {
  if (!hasEbay || !query.trim()) return null;
  try {
    const tok = await getToken();
    const market = (region && MARKETPLACE[region]) || "EBAY_US";
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query.trim())}&filter=buyingOptions:%7BFIXED_PRICE%7D&limit=60`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": market },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { itemSummaries?: Item[] };
    return summarize(data.itemSummaries || [], opts);
  } catch {
    return null;
  }
}

// A representative eBay photo for a text query — works even when there aren't
// enough listings to PRICE the card, so search results still get a card image.
// Prefers a plain listing photo (many eBay card photos are clean scans).
export async function ebayImageFor(query: string, region?: string): Promise<string> {
  if (!hasEbay || !query.trim()) return "";
  try {
    const tok = await getToken();
    const market = (region && MARKETPLACE[region]) || "EBAY_US";
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query.trim())}&filter=buyingOptions:%7BFIXED_PRICE%7D&limit=40`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": market },
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { itemSummaries?: Item[] };
    const items = (data.itemSummaries || []).filter(isRealCard);
    // Prefer a raw (non-slab) listing's photo — those are usually the plain card.
    const raw = items.filter((it) => !isGradedListing(it) && itemImage(it));
    return itemImage((raw[0] || items.find((it) => itemImage(it)))) || "";
  } catch {
    return "";
  }
}

// Identify a card by its PHOTO using eBay's image search: matches the image
// against live listings, whose titles already carry the right player/set/year/
// number. Returns the top listing titles (a strong ID hint) plus a price range.
export async function ebayImageSearch(
  imageBase64: string,
  region?: string
): Promise<{ titles: string[]; price: EbayPrice | null; image: string }> {
  if (!hasEbay || !imageBase64) return { titles: [], price: null, image: "" };
  try {
    const tok = await getToken();
    const market = (region && MARKETPLACE[region]) || "EBAY_US";
    const image = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const res = await fetch(`${IMAGE_SEARCH_URL}?limit=30`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "X-EBAY-C-MARKETPLACE-ID": market,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image }),
    });
    if (!res.ok) return { titles: [], price: null, image: "" };
    const data = (await res.json()) as { itemSummaries?: Item[] };
    const items = data.itemSummaries || [];
    const titles = items.map((it) => it.title || "").filter(Boolean).slice(0, 8);
    const price = summarize(items);
    // A real web photo of the matched card: the median-priced listing's image
    // (from summarize), else the first real listing that has one.
    const photo = price?.image || itemImage(items.filter(isRealCard).find((it) => itemImage(it)));
    return { titles, price, image: photo || "" };
  } catch {
    return { titles: [], price: null, image: "" };
  }
}
