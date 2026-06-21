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
    const data = (await res.json()) as { itemSummaries?: { price?: { value?: string; currency?: string } }[] };
    const items = data.itemSummaries || [];
    const prices = items
      .map((it) => Number(it.price?.value))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    if (prices.length < 3) return null;
    // Trim the top/bottom 10% to drop junk and graded/lot outliers.
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
  } catch {
    return null;
  }
}
