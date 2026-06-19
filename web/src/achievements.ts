import type { SavedCard, WishItem } from "./types";

export interface AchStats {
  cards: number;
  totalValue: number;
  maxSingle: number;
  scans: number;
  trades: number;
  wishlist: number;
  sportsCount: number;
  sportsOwned: Set<string>;
  distinctPlayers: number;
  distinctSets: number;
  distinctDecades: number;
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
  progress?: (s: AchStats) => string;
}

const has = (s: AchStats, sport: string) => s.sportsOwned.has(sport);

export const ACHIEVEMENTS: Achievement[] = [
  // Scans
  { id: "scan_1", emoji: "🔍", title: "Curious", desc: "Scan or search your first card.", earned: (s) => s.scans >= 1 },
  { id: "scan_10", emoji: "📷", title: "Scanner", desc: "Identify 10 cards.", earned: (s) => s.scans >= 10, progress: (s) => `${Math.min(s.scans, 10)}/10` },
  { id: "scan_50", emoji: "⚡", title: "Power User", desc: "Identify 50 cards.", earned: (s) => s.scans >= 50, progress: (s) => `${Math.min(s.scans, 50)}/50` },
  { id: "scan_100", emoji: "🤖", title: "Obsessed", desc: "Identify 100 cards.", earned: (s) => s.scans >= 100, progress: (s) => `${Math.min(s.scans, 100)}/100` },
  { id: "scan_500", emoji: "🛰️", title: "Scan Machine", desc: "Identify 500 cards.", earned: (s) => s.scans >= 500, progress: (s) => `${Math.min(s.scans, 500)}/500` },
  // Collection size
  { id: "cards_1", emoji: "🃏", title: "First Card", desc: "Save your first card.", earned: (s) => s.cards >= 1 },
  { id: "cards_5", emoji: "🪙", title: "Starter Pack", desc: "Save 5 cards.", earned: (s) => s.cards >= 5, progress: (s) => `${Math.min(s.cards, 5)}/5` },
  { id: "cards_10", emoji: "📚", title: "Getting Serious", desc: "Save 10 cards.", earned: (s) => s.cards >= 10, progress: (s) => `${Math.min(s.cards, 10)}/10` },
  { id: "cards_25", emoji: "👟", title: "Shoebox", desc: "Save 25 cards.", earned: (s) => s.cards >= 25, progress: (s) => `${Math.min(s.cards, 25)}/25` },
  { id: "cards_50", emoji: "🗂️", title: "Big Collection", desc: "Save 50 cards.", earned: (s) => s.cards >= 50, progress: (s) => `${Math.min(s.cards, 50)}/50` },
  { id: "cards_100", emoji: "💯", title: "Century", desc: "Save 100 cards.", earned: (s) => s.cards >= 100, progress: (s) => `${Math.min(s.cards, 100)}/100` },
  { id: "cards_250", emoji: "🐳", title: "Whale", desc: "Save 250 cards.", earned: (s) => s.cards >= 250, progress: (s) => `${Math.min(s.cards, 250)}/250` },
  { id: "cards_500", emoji: "🏛️", title: "Archivist", desc: "Save 500 cards.", earned: (s) => s.cards >= 500, progress: (s) => `${Math.min(s.cards, 500)}/500` },
  // Total value
  { id: "val_100", emoji: "🪙", title: "Pocket Change", desc: "Binder worth 100+.", earned: (s) => s.totalValue >= 100 },
  { id: "val_500", emoji: "💵", title: "Lunch Money", desc: "Binder worth 500+.", earned: (s) => s.totalValue >= 500 },
  { id: "val_1k", emoji: "💰", title: "Four Figures", desc: "Binder worth 1,000+.", earned: (s) => s.totalValue >= 1000 },
  { id: "val_5k", emoji: "💸", title: "Stacked", desc: "Binder worth 5,000+.", earned: (s) => s.totalValue >= 5000 },
  { id: "val_10k", emoji: "🏦", title: "Heavy Hitter", desc: "Binder worth 10,000+.", earned: (s) => s.totalValue >= 10000 },
  { id: "val_50k", emoji: "👑", title: "Baller", desc: "Binder worth 50,000+.", earned: (s) => s.totalValue >= 50000 },
  { id: "val_100k", emoji: "🏆", title: "The Vault", desc: "Binder worth 100,000+.", earned: (s) => s.totalValue >= 100000 },
  // Single-card value
  { id: "single_100", emoji: "✨", title: "Nice Pull", desc: "Own a card worth 100+.", earned: (s) => s.maxSingle >= 100 },
  { id: "single_500", emoji: "🌠", title: "Big Hit", desc: "Own a card worth 500+.", earned: (s) => s.maxSingle >= 500 },
  { id: "single_1k", emoji: "💎", title: "Grail", desc: "Own a card worth 1,000+.", earned: (s) => s.maxSingle >= 1000 },
  { id: "single_5k", emoji: "👑", title: "Crown Jewel", desc: "Own a card worth 5,000+.", earned: (s) => s.maxSingle >= 5000 },
  // Wishlist
  { id: "wish_1", emoji: "🛒", title: "Window Shopper", desc: "Add a card to your wishlist.", earned: (s) => s.wishlist >= 1 },
  { id: "wish_5", emoji: "⭐", title: "Wishful Thinking", desc: "Wishlist 5 cards.", earned: (s) => s.wishlist >= 5, progress: (s) => `${Math.min(s.wishlist, 5)}/5` },
  { id: "wish_10", emoji: "🌟", title: "Dreamer", desc: "Wishlist 10 cards.", earned: (s) => s.wishlist >= 10, progress: (s) => `${Math.min(s.wishlist, 10)}/10` },
  { id: "wish_25", emoji: "🔮", title: "Manifesting", desc: "Wishlist 25 cards.", earned: (s) => s.wishlist >= 25, progress: (s) => `${Math.min(s.wishlist, 25)}/25` },
  // Categories owned
  { id: "cat_pokemon", emoji: "⚡", title: "Gotta Catch 'Em", desc: "Own a Pokémon card.", earned: (s) => has(s, "pokemon") },
  { id: "cat_baseball", emoji: "⚾", title: "Diamond King", desc: "Own a baseball card.", earned: (s) => has(s, "baseball") },
  { id: "cat_soccer", emoji: "⚽", title: "Pitch Perfect", desc: "Own a soccer card.", earned: (s) => has(s, "soccer") },
  { id: "cat_cricket", emoji: "🏏", title: "Howzat!", desc: "Own a cricket card.", earned: (s) => has(s, "cricket") },
  { id: "cat_basketball", emoji: "🏀", title: "Hoops", desc: "Own a basketball card.", earned: (s) => has(s, "basketball") },
  { id: "cat_football", emoji: "🏈", title: "Gridiron", desc: "Own a football card.", earned: (s) => has(s, "football") },
  { id: "cat_hockey", emoji: "🏒", title: "Ice Cold", desc: "Own a hockey card.", earned: (s) => has(s, "hockey") },
  // Diversity
  { id: "multi_3", emoji: "🌐", title: "Dabbler", desc: "Collect 3+ categories.", earned: (s) => s.sportsCount >= 3, progress: (s) => `${Math.min(s.sportsCount, 3)}/3` },
  { id: "multi_5", emoji: "🧩", title: "Generalist", desc: "Collect 5+ categories.", earned: (s) => s.sportsCount >= 5, progress: (s) => `${Math.min(s.sportsCount, 5)}/5` },
  { id: "multi_all", emoji: "🌎", title: "Completionist", desc: "Collect all 7 categories.", earned: (s) => s.sportsCount >= 7, progress: (s) => `${Math.min(s.sportsCount, 7)}/7` },
  { id: "players_10", emoji: "🧑‍🤝‍🧑", title: "People Person", desc: "Own 10 different players/subjects.", earned: (s) => s.distinctPlayers >= 10, progress: (s) => `${Math.min(s.distinctPlayers, 10)}/10` },
  { id: "sets_5", emoji: "🎴", title: "Set Collector", desc: "Own cards from 5 different sets.", earned: (s) => s.distinctSets >= 5, progress: (s) => `${Math.min(s.distinctSets, 5)}/5` },
  { id: "decades_3", emoji: "⏳", title: "Time Traveler", desc: "Own cards from 3 different decades.", earned: (s) => s.distinctDecades >= 3, progress: (s) => `${Math.min(s.distinctDecades, 3)}/3` },
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
  { id: "riser", emoji: "📈", title: "Picked a Winner", desc: "Hold a card up 15%+.", earned: (s) => s.bestRiserPct >= 0.15 },
  { id: "moon", emoji: "🚀", title: "Diamond Hands", desc: "Hold a card up 50%+.", earned: (s) => s.bestRiserPct >= 0.5 },
  { id: "faller", emoji: "📉", title: "Bag Holder", desc: "Hold a card down 15%+.", earned: (s) => s.worstFallerPct <= -0.15 },
  // Activity / misc
  { id: "trade_1", emoji: "🤝", title: "Wheeler Dealer", desc: "Evaluate a trade.", earned: (s) => s.trades >= 1 },
  { id: "trade_10", emoji: "♟️", title: "Trade Shark", desc: "Evaluate 10 trades.", earned: (s) => s.trades >= 10, progress: (s) => `${Math.min(s.trades, 10)}/10` },
  { id: "polyglot", emoji: "🗣️", title: "Polyglot", desc: "Use the app in another language.", earned: (s) => s.nonEnglish },
];

const decade = (year: string | null) => {
  const n = parseInt((year || "").replace(/\D/g, "").slice(0, 4), 10);
  return n >= 1900 && n <= 2099 ? Math.floor(n / 10) : NaN;
};

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
    else if (sp.includes("soccer") || sp.includes("football") === false && sp.includes("fútbol")) sportsOwned.add("soccer");
    else if (sp.includes("cricket")) sportsOwned.add("cricket");
    else if (sp.includes("basket")) sportsOwned.add("basketball");
    else if (sp.includes("football") || sp.includes("nfl") || sp.includes("gridiron")) sportsOwned.add("football");
    else if (sp.includes("hockey")) sportsOwned.add("hockey");
    else if (sp.includes("soccer")) sportsOwned.add("soccer");
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

  return {
    cards: saved.length,
    totalValue: saved.reduce((sum, s) => sum + (s.result.estimatedValue.mid || 0), 0),
    maxSingle: saved.reduce((m, s) => Math.max(m, s.result.estimatedValue.mid || 0), 0),
    scans,
    trades,
    wishlist: wishlist.length,
    sportsCount: sportsOwned.size,
    sportsOwned,
    distinctPlayers: new Set(saved.map((s) => (s.result.player || "").toLowerCase()).filter(Boolean)).size,
    distinctSets: new Set(saved.map((s) => (s.result.setName || "").toLowerCase()).filter(Boolean)).size,
    distinctDecades: new Set(saved.map((s) => decade(s.result.year)).filter((d) => !Number.isNaN(d))).size,
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
