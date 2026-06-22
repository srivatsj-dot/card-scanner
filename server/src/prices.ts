// Free, real Pokémon card prices from pokemontcg.io (TCGplayer + Cardmarket
// market data). No key required — an optional POKEMONTCGIO_API_KEY raises the
// rate limit. This gives genuine market prices for the biggest TCG without any
// eBay/age-gated signup. Best-effort: returns null on any miss so the model's
// estimate stands.

const PTCG_KEY = process.env.POKEMONTCGIO_API_KEY || "";
const PTCG_URL = "https://api.pokemontcg.io/v2/cards";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string, ms = 8000): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (PTCG_KEY) headers["X-Api-Key"] = PTCG_KEY;
    const res = await fetch(url, { signal: ctrl.signal, headers });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface CardPrice {
  low: number;
  mid: number;
  high: number;
  currency: string;
  source: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function priceFromCard(c: any): CardPrice | null {
  const tp = c?.tcgplayer?.prices;
  if (tp && typeof tp === "object") {
    const variants = Object.values(tp).filter(Boolean) as Record<string, number>[];
    const markets = variants.map((v) => Number(v.market ?? v.mid)).filter((n) => Number.isFinite(n) && n > 0);
    if (markets.length) {
      const lows = variants.map((v) => Number(v.low)).filter((n) => Number.isFinite(n) && n > 0);
      const highs = variants.map((v) => Number(v.high)).filter((n) => Number.isFinite(n) && n > 0);
      const mid = median(markets);
      return { low: lows.length ? Math.min(...lows) : mid, mid, high: highs.length ? Math.max(...highs) : mid, currency: "USD", source: "TCGplayer" };
    }
  }
  const cm = c?.cardmarket?.prices;
  const avg = Number(cm?.averageSellPrice);
  if (Number.isFinite(avg) && avg > 0) {
    return { low: Number(cm.lowPrice) || avg, mid: avg, high: Number(cm.trendPrice) || avg, currency: "EUR", source: "Cardmarket" };
  }
  return null;
}

export interface PokemonMatch {
  price: CardPrice | null;
  name?: string;     // canonical card name from the catalog
  setName?: string;  // canonical set name
  number?: string;   // e.g. "4/102"
  rarity?: string;
}

// Look a Pokémon card up in the official catalog (pokemontcg.io): both its real
// market price AND its canonical identity (set, number, rarity), so a scan can
// be corrected against the real card database — the Ludex-style "match a known
// card" idea, for Pokémon. Returns null if no card matches the name.
export async function pokemonLookup(name: string, number?: string | null): Promise<PokemonMatch | null> {
  const nm = (name || "").trim();
  if (!nm) return null;
  const num = (number || "").split("/")[0].replace(/\s+/g, "").trim();
  const q = num ? `name:"${nm}" number:"${num}"` : `name:"${nm}"`;
  const data = await getJson(`${PTCG_URL}?q=${encodeURIComponent(q)}&pageSize=12`);
  let cards = data?.data;
  if ((!Array.isArray(cards) || cards.length === 0) && num) {
    const d2 = await getJson(`${PTCG_URL}?q=${encodeURIComponent(`name:"${nm}"`)}&pageSize=12`);
    cards = d2?.data;
  }
  if (!Array.isArray(cards) || cards.length === 0) return null;

  // Prefer the matching card that has a price; otherwise the first match.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chosen: any = null;
  let price: CardPrice | null = null;
  for (const c of cards) {
    const p = priceFromCard(c);
    if (p) { chosen = c; price = p; break; }
  }
  if (!chosen) chosen = cards[0];

  const printed = Number(chosen?.set?.printedTotal);
  const number2 = chosen?.number
    ? Number.isFinite(printed) && printed > 0 ? `${chosen.number}/${printed}` : String(chosen.number)
    : undefined;
  return {
    price,
    name: chosen?.name || undefined,
    setName: chosen?.set?.name || undefined,
    number: number2,
    rarity: chosen?.rarity || undefined,
  };
}
