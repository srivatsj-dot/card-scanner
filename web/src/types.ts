export interface Settings {
  customInstructions: string;
  minValue: number | null;
  excludeMinorLeague: boolean;
  excludeRookies: boolean;
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

export const defaultSettings: Settings = {
  customInstructions: "",
  minValue: null,
  excludeMinorLeague: false,
  excludeRookies: false,
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
  generalAssessment: string;
  warnings: string[];
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
