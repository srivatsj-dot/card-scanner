export interface Settings {
  customInstructions: string;
  liveData: boolean;
  autoRefresh: boolean;
  language: string;
  wishlist?: string[]; // injected at call time (the user's wishlist), not persisted
  minValue: number | null;
  maxValue: number | null;
  excludeMinorLeague: boolean;
  excludeRookies: boolean;
  sameKindOnly: boolean;
  gradedOnly: boolean;
  blockedCategories: string[];
  collectorType: "any" | "money" | "talent";
  sport: string; // preferred category; "" means any
  currency: string;
  region: string; // market location for pricing, "" = global/auto
  morningUpdate: boolean; // show the daily card digest
  digestSports: string[]; // sports included in the morning update
  emailOffers?: boolean; // email me when a trade offer arrives / is answered
  tradeRequestsFrom?: "anyone" | "friends" | "list"; // who may send me offers
  tradeAllowList?: string[]; // usernames allowed when tradeRequestsFrom = "list"
  binderMode?: "list" | "grid" | "pages"; // how the binder is laid out
}

/** A card as shown in the marketplace (someone else's binder, or your picks). */
export interface MarketCard { id: string; label: string; sport: string; value: number; currency: string; thumb: string }

/** A directed trade offer between two accounts. */
export interface MarketOffer {
  id: string;
  fromUser: string; fromDisplay: string;
  toUser: string; toDisplay: string;
  give: SavedCard[]; // sender gives (recipient receives)
  want: SavedCard[]; // sender wants (recipient gives)
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: number; respondedAt: number | null;
}

export const CATEGORIES = [
  "Any",
  "Pokémon",
  "Baseball",
  "Soccer",
  "Cricket",
  "Basketball",
  "Football",
  "Hockey",
] as const;

// Categories that can be blocked (everything except "Any").
export const BLOCKABLE_CATEGORIES = CATEGORIES.filter((c) => c !== "Any");

// Market regions for pricing ("" = global/auto).
export const REGIONS = [
  "United States", "Canada", "Mexico", "Brazil", "Argentina", "Chile", "Colombia", "Peru", "Venezuela", "Ecuador", "Uruguay", "Paraguay", "Bolivia",
  "United Kingdom", "Ireland", "France", "Germany", "Spain", "Portugal", "Italy", "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland", "Iceland", "Poland", "Czechia", "Slovakia", "Hungary", "Romania", "Bulgaria", "Greece", "Croatia", "Serbia", "Ukraine", "Russia", "Turkey", "Luxembourg", "Slovenia", "Lithuania", "Latvia", "Estonia",
  "Japan", "China", "South Korea", "Taiwan", "Hong Kong", "Singapore", "Malaysia", "Indonesia", "Thailand", "Vietnam", "Philippines", "India", "Pakistan", "Bangladesh", "Sri Lanka", "Nepal", "Kazakhstan",
  "Australia", "New Zealand", "Fiji",
  "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Israel", "Jordan", "Lebanon",
  "South Africa", "Nigeria", "Kenya", "Egypt", "Morocco", "Ghana", "Tanzania", "Ethiopia", "Uganda",
] as const;

// Top ~20 most-spoken languages for translated results.
export const LANGUAGES = [
  "English",
  "Mandarin Chinese",
  "Hindi",
  "Spanish",
  "Arabic",
  "French",
  "Bengali",
  "Portuguese",
  "Russian",
  "Indonesian",
  "Japanese",
  "German",
  "Korean",
  "Vietnamese",
  "Turkish",
  "Italian",
  "Thai",
  "Polish",
  "Ukrainian",
  "Dutch",
] as const;

export const defaultSettings: Settings = {
  customInstructions: "",
  liveData: true,
  autoRefresh: true,
  language: "English",
  minValue: null,
  maxValue: null,
  excludeMinorLeague: false,
  excludeRookies: false,
  sameKindOnly: false,
  gradedOnly: false,
  blockedCategories: [],
  collectorType: "any",
  sport: "",
  currency: "USD",
  region: "",
  morningUpdate: true,
  digestSports: [...BLOCKABLE_CATEGORIES],
  emailOffers: false,
  tradeRequestsFrom: "anyone",
  tradeAllowList: [],
  binderMode: "list",
};

export interface ScanResult {
  identified: boolean;
  idConfidence?: number; // 1-10, how sure the identification is
  player: string | null;
  sport: string | null;
  team: string | null;
  year: string | null;
  manufacturer: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  specialEdition: string | null;
  serialNumber: string | null;
  estimatedCondition: string | null;
  conditionReport: {
    grade: string;
    flaws: string[];
    summary: string;
  };
  estimatedValue: {
    low: number;
    mid: number;
    high: number;
    currency: string;
    note: string;
  };
  rating: { score: number; label: string; summary: string };
  hiddenInsights: { label: string; detail: string }[];
  playerOutlook: { trend: string; summary: string };
  pokemon?: {
    setNumber: string | null;
    rarity: string | null;
    variant: string | null;
    edition: string | null;
    hp: string | null;
    types: string | null;
    stage: string | null;
    language: string | null;
    regulationMark: string | null;
  } | null;
  recommendedTrades: {
    player: string;
    cardSuggestion: string;
    reason: string;
    comparableValue: string;
  }[];
  similarValueTargets: {
    player: string;
    cardSuggestion: string;
    estimatedValue: string;
    reason: string;
  }[];
  generalAssessment: string;
  warnings: string[];
}

/** One card on a side of a trade: a description and/or a captured photo. */
export interface CardEntry {
  id: number;
  text: string;
  dataUrl?: string; // data: URL of a photo, if attached
}

/** A single card detected within a bulk-scan photo (lean — identity + value). */
export interface BulkCard {
  identified: boolean;
  player: string | null;
  sport: string | null;
  team: string | null;
  year: string | null;
  manufacturer: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  specialEdition: string | null;
  serialNumber: string | null;
  estimatedValue: { low: number; mid: number; high: number; currency: string; note: string };
  conditionGrade: string | null;
  note: string;
}

export interface AskResult {
  givingValueNote: string;
  targets: {
    player: string;
    cardSuggestion: string;
    estimatedValue: string;
    reason: string;
    likelihood: string;
  }[];
  note: string;
}

export type Theme = "dark" | "light";

/** A scan saved to the local binder. */
export interface SavedCard {
  id: string;
  savedAt: number;
  thumbnail: string; // small JPEG data URL
  result: ScanResult;
  lastRefreshedAt?: number; // when the value was last auto-refreshed
  previousMid?: number | null; // prior mid value, to show ▲/▼ change
  history?: { t: number; mid: number }[]; // value points over time, for the chart
  conditionLog?: { t: number; grade: string; flaws: string[] }[]; // condition over time
  favorite?: boolean; // protected: keep out of trade suggestions
  notNeeded?: boolean; // trade bait: offer this up first
}

/** A card on the wishlist (wanted, with an estimated price). */
export interface WishItem {
  id: string;
  addedAt: number;
  text: string; // what the user typed
  result?: ScanResult; // looked-up details/value
  lastRefreshedAt?: number;
  previousMid?: number | null;
}

export interface TradeResult {
  fairness: "fair" | "favors_you" | "favors_them" | "lopsided" | string;
  verdict: string;
  yourSide: { valueLow: number; valueHigh: number; notes: string };
  theirSide: { valueLow: number; valueHigh: number; notes: string };
  valueGapNote: string;
  reasoning: string;
  suggestions: string[];
}

/** A shareable trade offer: the sender's side of the deal plus its fairness
 * snapshot. The recipient opens the link and responds — no account needed. */
export interface TradeOffer {
  id: string;
  from: string;
  give: string[]; // sender gives (recipient receives)
  get: string[]; // sender wants (recipient gives)
  trade: TradeResult | null;
  currency: string;
  status: "pending" | "accepted" | "declined" | "change_requested";
  message: string;
  createdAt: number;
  respondedAt: number | null;
}

/** Locally-remembered offer the user sent (id + summary for the status list). */
export interface SentOffer {
  id: string;
  give: string[];
  get: string[];
  createdAt: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** A planned chain of fair trades from cards you own toward a target card. */
export interface TradeUpResult {
  feasible: boolean;
  steps: { giveUp: string[]; receive: string; valueNote: string; rationale: string }[];
  summary: string;
  note: string;
}

/** Anything saved to the "For later" list — a card to acquire, optionally with a
 * trade-up path and/or the cards you'd give for it. "Add to binder" lands it. */
export interface LaterItem {
  id: string;
  savedAt: number;
  target: string; // the card you'd acquire / land
  give: string[]; // cards you'd trade away (best-effort removed on add-to-binder)
  steps?: { giveUp: string[]; receive: string; valueNote: string; rationale: string }[];
}

/** The daily "morning update" digest, grouped by sport. */
export interface DigestResult {
  generatedAt: number;
  overview: string;
  yourCards: string[];
  yourWishlist: string[];
  sections: {
    sport: string;
    risingStars: string[];
    declining: string[];
    storylines: string[];
    trades: string[];
    chase: string[];
    news: string[];
  }[];
}

/** Set-completion checklist result from the AI. */
export interface ChecklistResult {
  setName: string;
  baseSetSize: number;
  sizeConfidence: string; // high | medium | low
  notableMissing: {
    cardNumber: string;
    player: string;
    note: string;
    estimatedValue: string;
  }[];
  summary: string;
}
