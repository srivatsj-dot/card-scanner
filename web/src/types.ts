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
};

export interface ScanResult {
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
