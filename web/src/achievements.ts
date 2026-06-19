import type { SavedCard, WishItem } from "./types";

export interface AchStats {
  cards: number;
  totalValue: number;
  sports: number;
  hasAuto: boolean;
  hasNumbered: boolean;
  hasRookie: boolean;
  wishlist: number;
  hasRiser: boolean;
  scans: number;
}

export interface Achievement {
  id: string;
  emoji: string;
  title: string;
  desc: string;
  earned: (s: AchStats) => boolean;
  progress?: (s: AchStats) => string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_scan", emoji: "🔍", title: "First Scan", desc: "Scan or search your first card.", earned: (s) => s.scans >= 1 },
  { id: "ten_cards", emoji: "📚", title: "Getting Serious", desc: "Save 10 cards to your binder.", earned: (s) => s.cards >= 10, progress: (s) => `${Math.min(s.cards, 10)}/10` },
  { id: "fifty_cards", emoji: "🗂️", title: "Big Collection", desc: "Save 50 cards to your binder.", earned: (s) => s.cards >= 50, progress: (s) => `${Math.min(s.cards, 50)}/50` },
  { id: "value_1k", emoji: "💰", title: "Four Figures", desc: "Binder worth over 1,000.", earned: (s) => s.totalValue >= 1000 },
  { id: "value_10k", emoji: "🏦", title: "Heavy Hitter", desc: "Binder worth over 10,000.", earned: (s) => s.totalValue >= 10000 },
  { id: "autograph", emoji: "✍️", title: "Sign Here", desc: "Own an autographed card.", earned: (s) => s.hasAuto },
  { id: "numbered", emoji: "#️⃣", title: "Numbered", desc: "Own a serial-numbered card.", earned: (s) => s.hasNumbered },
  { id: "rookie", emoji: "🌟", title: "Rookie Hunter", desc: "Own a rookie card.", earned: (s) => s.hasRookie },
  { id: "multisport", emoji: "🌐", title: "Multi-Sport", desc: "Collect 3+ different categories.", earned: (s) => s.sports >= 3, progress: (s) => `${Math.min(s.sports, 3)}/3` },
  { id: "wishful", emoji: "⭐", title: "Wishful Thinking", desc: "Add 5 cards to your wishlist.", earned: (s) => s.wishlist >= 5, progress: (s) => `${Math.min(s.wishlist, 5)}/5` },
  { id: "riser", emoji: "📈", title: "Picked a Winner", desc: "Hold a card that jumped 15%+ in value.", earned: (s) => s.hasRiser },
];

export function computeStats(saved: SavedCard[], wishlist: WishItem[], scans: number): AchStats {
  const txt = (s: SavedCard) => `${s.result.specialEdition || ""} ${s.result.parallel || ""}`.toLowerCase();
  return {
    cards: saved.length,
    totalValue: saved.reduce((sum, s) => sum + (s.result.estimatedValue.mid || 0), 0),
    sports: new Set(saved.map((s) => s.result.sport).filter(Boolean)).size,
    hasAuto: saved.some((s) => /auto|signed|signature/.test(txt(s))),
    hasNumbered: saved.some((s) => !!s.result.serialNumber),
    hasRookie: saved.some((s) => /rookie|\brc\b/.test(txt(s))),
    wishlist: wishlist.length,
    hasRiser: saved.some(
      (s) => s.previousMid != null && s.previousMid > 0 && (s.result.estimatedValue.mid - s.previousMid) / s.previousMid >= 0.15
    ),
    scans,
  };
}

export function earnedIds(stats: AchStats): string[] {
  return ACHIEVEMENTS.filter((a) => a.earned(stats)).map((a) => a.id);
}
