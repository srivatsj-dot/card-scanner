import type { SavedCard, WishItem } from "./types";

export interface AchStats {
  cards: number;
  totalValue: number;
  maxSingle: number;
  scans: number;
  trades: number;
  wishlist: number;
  wishlistValue: number;
  sportsCount: number;
  sportsOwned: Set<string>;
  distinctPlayers: number;
  distinctSets: number;
  distinctDecades: number;
  hasDupe: boolean;
  hasVintage: boolean;
  hasModern: boolean;
  hasAuto: boolean;
  hasNumbered: boolean;
  hasRookie: boolean;
  hasRelic: boolean;
  hasRefractor: boolean;
  hasGraded: boolean;
  hasShortPrint: boolean;
  hasCleanCard: boolean;
  bestRiserPct: number;
  worstFallerPct: number;
  nonEnglish: boolean;
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  earned: (s: AchStats) => boolean;
}

const has = (s: AchStats, sport: string) => s.sportsOwned.has(sport);

// All of these are realistically reachable for a hobbyist collector.
export const ACHIEVEMENTS: Achievement[] = [
  // Scans
  { id: "scan_1", emoji: "🔍", title: "Curious", desc: "Scan or search your first card.", earned: (s) => s.scans >= 1 },
  { id: "scan_10", emoji: "📷", title: "Scanner", desc: "Identify 10 cards.", earned: (s) => s.scans >= 10 },
  { id: "scan_25", emoji: "⚡", title: "Power User", desc: "Identify 25 cards.", earned: (s) => s.scans >= 25 },
  { id: "scan_50", emoji: "🤖", title: "On a Roll", desc: "Identify 50 cards.", earned: (s) => s.scans >= 50 },
  // Collection size
  { id: "cards_1", emoji: "🃏", title: "First Card", desc: "Save your first card.", earned: (s) => s.cards >= 1 },
  { id: "cards_5", emoji: "🪙", title: "Starter Pack", desc: "Save 5 cards.", earned: (s) => s.cards >= 5 },
  { id: "cards_10", emoji: "📚", title: "Getting Serious", desc: "Save 10 cards.", earned: (s) => s.cards >= 10 },
  { id: "cards_25", emoji: "👟", title: "Shoebox", desc: "Save 25 cards.", earned: (s) => s.cards >= 25 },
  { id: "cards_50", emoji: "🗂️", title: "Real Collection", desc: "Save 50 cards.", earned: (s) => s.cards >= 50 },
  // Total value
  { id: "val_50", emoji: "🪙", title: "Pocket Change", desc: "Binder worth $50+.", earned: (s) => s.totalValue >= 50 },
  { id: "val_100", emoji: "💵", title: "Lunch Money", desc: "Binder worth $100+.", earned: (s) => s.totalValue >= 100 },
  { id: "val_500", emoji: "💰", title: "Stacking Up", desc: "Binder worth $500+.", earned: (s) => s.totalValue >= 500 },
  { id: "val_1k", emoji: "💸", title: "Four Figures", desc: "Binder worth $1,000+.", earned: (s) => s.totalValue >= 1000 },
  { id: "val_2500", emoji: "🏦", title: "Serious Money", desc: "Binder worth $2,500+.", earned: (s) => s.totalValue >= 2500 },
  // Single-card value (USD)
  { id: "single_50", emoji: "✨", title: "Nice Card", desc: "Own a card worth $50+.", earned: (s) => s.maxSingle >= 50 },
  { id: "single_100", emoji: "🌠", title: "Nice Pull", desc: "Own a card worth $100+.", earned: (s) => s.maxSingle >= 100 },
  { id: "single_250", emoji: "💎", title: "Big Hit", desc: "Own a card worth $250+.", earned: (s) => s.maxSingle >= 250 },
  // Wishlist
  { id: "wish_1", emoji: "🛒", title: "Window Shopper", desc: "Add a card to your wishlist.", earned: (s) => s.wishlist >= 1 },
  { id: "wish_5", emoji: "⭐", title: "Wishful Thinking", desc: "Wishlist 5 cards.", earned: (s) => s.wishlist >= 5 },
  { id: "wish_10", emoji: "🌟", title: "Dreamer", desc: "Wishlist 10 cards.", earned: (s) => s.wishlist >= 10 },
  // Categories owned
  { id: "cat_pokemon", emoji: "⚡", title: "Gotta Catch 'Em", desc: "Own a Pokémon card.", earned: (s) => has(s, "pokemon") },
  { id: "cat_baseball", emoji: "⚾", title: "Diamond King", desc: "Own a baseball card.", earned: (s) => has(s, "baseball") },
  { id: "cat_soccer", emoji: "⚽", title: "Pitch Perfect", desc: "Own a soccer card.", earned: (s) => has(s, "soccer") },
  { id: "cat_cricket", emoji: "🏏", title: "Howzat!", desc: "Own a cricket card.", earned: (s) => has(s, "cricket") },
  { id: "cat_basketball", emoji: "🏀", title: "Hoops", desc: "Own a basketball card.", earned: (s) => has(s, "basketball") },
  { id: "cat_football", emoji: "🏈", title: "Gridiron", desc: "Own a football card.", earned: (s) => has(s, "football") },
  { id: "cat_hockey", emoji: "🏒", title: "Ice Cold", desc: "Own a hockey card.", earned: (s) => has(s, "hockey") },
  // Diversity
  { id: "multi_2", emoji: "🔀", title: "Branching Out", desc: "Collect 2+ categories.", earned: (s) => s.sportsCount >= 2 },
  { id: "multi_3", emoji: "🌐", title: "Dabbler", desc: "Collect 3+ categories.", earned: (s) => s.sportsCount >= 3 },
  { id: "multi_5", emoji: "🧩", title: "Generalist", desc: "Collect 5+ categories.", earned: (s) => s.sportsCount >= 5 },
  { id: "players_10", emoji: "🧑‍🤝‍🧑", title: "People Person", desc: "Own 10 different players.", earned: (s) => s.distinctPlayers >= 10 },
  { id: "sets_5", emoji: "🎴", title: "Set Collector", desc: "Own cards from 5 different sets.", earned: (s) => s.distinctSets >= 5 },
  { id: "decades_3", emoji: "⏳", title: "Time Traveler", desc: "Own cards from 3 different decades.", earned: (s) => s.distinctDecades >= 3 },
  { id: "dupe", emoji: "👯", title: "Two of a Kind", desc: "Own two cards of the same player.", earned: (s) => s.hasDupe },
  { id: "vintage", emoji: "🕰️", title: "Old School", desc: "Own a pre-1990 card.", earned: (s) => s.hasVintage },
  { id: "modern", emoji: "🆕", title: "Fresh", desc: "Own a 2020-or-newer card.", earned: (s) => s.hasModern },
  // Special editions
  { id: "auto", emoji: "✍️", title: "Sign Here", desc: "Own an autographed card.", earned: (s) => s.hasAuto },
  { id: "numbered", emoji: "#️⃣", title: "Numbered", desc: "Own a serial-numbered card.", earned: (s) => s.hasNumbered },
  { id: "rookie", emoji: "🌱", title: "Rookie Hunter", desc: "Own a rookie card.", earned: (s) => s.hasRookie },
  { id: "relic", emoji: "🧵", title: "Relic Hunter", desc: "Own a relic/patch card.", earned: (s) => s.hasRelic },
  { id: "refractor", emoji: "🌈", title: "Shiny", desc: "Own a refractor/parallel.", earned: (s) => s.hasRefractor },
  { id: "graded", emoji: "🛡️", title: "Slabbed", desc: "Own a graded card.", earned: (s) => s.hasGraded },
  { id: "shortprint", emoji: "🎯", title: "Short Print", desc: "Own a short print (SP/SSP).", earned: (s) => s.hasShortPrint },
  { id: "clean", emoji: "🧼", title: "Mint Condition", desc: "Own a card with no visible flaws.", earned: (s) => s.hasCleanCard },
  // Market movement
  { id: "riser", emoji: "📈", title: "Picked a Winner", desc: "Hold a card that's up 15%+.", earned: (s) => s.bestRiserPct >= 0.15 },
  { id: "faller", emoji: "📉", title: "Bag Holder", desc: "Hold a card that's down 15%+.", earned: (s) => s.worstFallerPct <= -0.15 },
  // Activity / misc
  { id: "trade_1", emoji: "🤝", title: "Wheeler Dealer", desc: "Evaluate a trade.", earned: (s) => s.trades >= 1 },
  { id: "trade_5", emoji: "♟️", title: "Trade Shark", desc: "Evaluate 5 trades.", earned: (s) => s.trades >= 5 },
  { id: "polyglot", emoji: "🗣️", title: "Polyglot", desc: "Use the app in another language.", earned: (s) => s.nonEnglish },
];

const decade = (year: string | null) => {
  const n = parseInt((year || "").replace(/\D/g, "").slice(0, 4), 10);
  return n >= 1900 && n <= 2099 ? Math.floor(n / 10) : NaN;
};

// Value thresholds in the achievement list are in USD, but a card's stored value
// is in whatever currency the collector picked — so a ₹8,000 card must not count
// as "$8,000". Convert every value to USD with approximate rates before tallying,
// so the milestones mean the same thing in any currency.
const USD_PER_UNIT: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, INR: 0.012, JPY: 0.0067,
};
const toUSD = (n: number, currency?: string) =>
  (n || 0) * (USD_PER_UNIT[(currency || "USD").toUpperCase()] ?? 1);

export function computeStats(
  saved: SavedCard[],
  wishlist: WishItem[],
  scans: number,
  trades: number,
  language: string
): AchStats {
  const blob = (s: SavedCard) =>
    `${s.result.specialEdition || ""} ${s.result.parallel || ""} ${s.result.setName || ""}`.toLowerCase();
  const sportsOwned = new Set<string>();
  saved.forEach((s) => {
    const sp = (s.result.sport || "").toLowerCase();
    if (sp.includes("pok")) sportsOwned.add("pokemon");
    else if (sp.includes("base")) sportsOwned.add("baseball");
    else if (sp.includes("cricket")) sportsOwned.add("cricket");
    else if (sp.includes("basket")) sportsOwned.add("basketball");
    else if (sp.includes("hockey")) sportsOwned.add("hockey");
    else if (sp.includes("soccer") || sp.includes("fútbol") || sp.includes("futbol")) sportsOwned.add("soccer");
    else if (sp.includes("football") || sp.includes("nfl") || sp.includes("gridiron")) sportsOwned.add("football");
  });

  let bestRiser = 0;
  let worstFaller = 0;
  saved.forEach((s) => {
    if (s.previousMid != null && s.previousMid > 0) {
      const pct = (s.result.estimatedValue.mid - s.previousMid) / s.previousMid;
      bestRiser = Math.max(bestRiser, pct);
      worstFaller = Math.min(worstFaller, pct);
    }
  });

  const players = saved.map((s) => (s.result.player || "").toLowerCase()).filter(Boolean);
  const decades = saved.map((s) => decade(s.result.year)).filter((d) => !Number.isNaN(d));

  return {
    cards: saved.length,
    totalValue: saved.reduce((sum, s) => sum + toUSD(s.result.estimatedValue.mid, s.result.estimatedValue.currency), 0),
    maxSingle: saved.reduce((m, s) => Math.max(m, toUSD(s.result.estimatedValue.mid, s.result.estimatedValue.currency)), 0),
    scans,
    trades,
    wishlist: wishlist.length,
    wishlistValue: wishlist.reduce((sum, w) => sum + toUSD(w.result?.estimatedValue.mid || 0, w.result?.estimatedValue.currency), 0),
    sportsCount: sportsOwned.size,
    sportsOwned,
    distinctPlayers: new Set(players).size,
    distinctSets: new Set(saved.map((s) => (s.result.setName || "").toLowerCase()).filter(Boolean)).size,
    distinctDecades: new Set(decades).size,
    hasDupe: players.length > new Set(players).size,
    hasVintage: decades.some((d) => d <= 198),
    hasModern: decades.some((d) => d >= 202),
    hasAuto: saved.some((s) => /auto|signed|signature/.test(blob(s))),
    hasNumbered: saved.some((s) => !!s.result.serialNumber),
    hasRookie: saved.some((s) => /rookie|\brc\b/.test(blob(s))),
    hasRelic: saved.some((s) => /relic|patch|jersey|memorabilia/.test(blob(s))),
    hasRefractor: saved.some((s) => /refractor|prizm|parallel|holo|foil|cracked ice/.test(blob(s))),
    hasGraded: saved.some((s) => /\bpsa\b|\bbgs\b|\bsgc\b|\bcgc\b|graded|slab/.test(blob(s))),
    hasShortPrint: saved.some((s) => /short print|\bssp\b|\bsp\b/.test(blob(s))),
    hasCleanCard: saved.some((s) => s.result.conditionReport && s.result.conditionReport.flaws.length === 0),
    bestRiserPct: bestRiser,
    worstFallerPct: worstFaller,
    nonEnglish: language !== "English",
  };
}

export function earnedIds(stats: AchStats): string[] {
  return ACHIEVEMENTS.filter((a) => a.earned(stats)).map((a) => a.id);
}
