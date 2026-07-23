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
}

// Map a market region to an eBay marketplace; defaults to the US.
const MARKETPLACE: Record<string, string> = {
  "United States": "EBAY_US", "Canada": "EBAY_CA", "United Kingdom": "EBAY_GB",
  Australia: "EBAY_AU", Germany: "EBAY_DE", France: "EBAY_FR", Italy: "EBAY_IT",
  Spain: "EBAY_ES", Ireland: "EBAY_IE",
};

type Item = { title?: string; price?: { value?: string; currency?: string } };

// Reprints, novelty/custom cards, stickers, lots, and "read description" junk
// pollute a search with cheap listings that aren't the real card — this is how a
// genuine grail (e.g. a T206 Wagner) shows up as "$20". Drop them.
const JUNK = /\b(reprint|re-print|\brp\b|repro|reproduction|novelty|aceo|sticker|decal|custom|fantasy|facsimile|proxy|art card|fridge magnet|magnet|poster|mini|read desc|not real|replica|homage|fan art)\b/i;
const isRealCard = (it: Item) => !JUNK.test(it.title || "");

// Robust price range from a set of listings; trims outliers / graded lots and
// excludes obvious reprints/novelty items.
function summarize(items: Item[]): EbayPrice | null {
  const real = items.filter(isRealCard);
  const prices = real
    .map((it) => Number(it.price?.value))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (prices.length < 3) return null;
  const trim = Math.floor(prices.length * 0.1);
  const core = prices.slice(trim, prices.length - trim || prices.length);
  const at = (p: number) => core[Math.min(core.length - 1, Math.max(0, Math.floor(core.length * p)))];
  return {
    low: at(0.2),
    mid: at(0.5),
    high: at(0.8),
    currency: items.find((it) => it.price?.currency)?.price?.currency || "USD",
    count: prices.length,
  };
}

export async function ebayPrice(query: string, region?: string): Promise<EbayPrice | null> {
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
    return summarize(data.itemSummaries || []);
  } catch {
    return null;
  }
}

// Identify a card by its PHOTO using eBay's image search: matches the image
// against live listings, whose titles already carry the right player/set/year/
// number. Returns the top listing titles (a strong ID hint) plus a price range.
export async function ebayImageSearch(
  imageBase64: string,
  region?: string
): Promise<{ titles: string[]; price: EbayPrice | null }> {
  if (!hasEbay || !imageBase64) return { titles: [], price: null };
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
    if (!res.ok) return { titles: [], price: null };
    const data = (await res.json()) as { itemSummaries?: Item[] };
    const items = data.itemSummaries || [];
    const titles = items.map((it) => it.title || "").filter(Boolean).slice(0, 8);
    return { titles, price: summarize(items) };
  } catch {
    return { titles: [], price: null };
  }
}
