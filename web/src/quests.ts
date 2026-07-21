// Daily briefing streak + weekly quests, generated from the collector's own
// collection. All pure functions over plain state so they're easy to test;
// App owns persistence (localStorage, per user).

export interface Streak {
  last: string; // YYYY-MM-DD of the last briefing check
  count: number; // consecutive days as of `last`
  best: number; // longest streak ever (achievements latch on this)
}

export interface QuestCounters {
  scans: number;
  trades: number;
  cards: number; // binder size
  wishlist: number;
  briefingDays: number; // days the briefing was checked THIS week
  bestSetPct: number; // 0..1
}

export interface Quest {
  id: string;
  emoji: string;
  title: string; // English; UI translates
  metric: keyof QuestCounters;
  target: number; // absolute target for the metric (baseline + goal)
}

export interface QuestState {
  week: string; // Monday of the quest week, YYYY-MM-DD
  baseline: QuestCounters;
  briefingDays: number;
  quests: Quest[];
}

export const dayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dayISO(dt);
};

/** Monday of the week containing `iso` — the quest-week key. */
export function weekOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = (dt.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(iso, -dow);
}

/** Advance the streak for a briefing check on `today`. Pure — returns the SAME
 * object when today is already counted, so callers can skip persisting. */
export function bumpStreak(prev: Streak | null, today: string): Streak {
  if (!prev || !prev.last) return { last: today, count: 1, best: Math.max(1, prev?.best || 0) };
  if (prev.last === today) return prev;
  const count = addDays(prev.last, 1) === today ? prev.count + 1 : 1;
  return { last: today, count, best: Math.max(count, prev.best || prev.count) };
}

/** The streak to DISPLAY right now: alive if last check was today or yesterday
 * (yesterday keeps it visible before today's check); otherwise it's broken. */
export function liveStreak(prev: Streak | null, today: string): number {
  if (!prev || !prev.last) return 0;
  if (prev.last === today || addDays(prev.last, 1) === today) return prev.count;
  return 0;
}

/** What we know about the collector, so quests reflect THEM, not a generic list. */
export interface QuestProfile {
  categories: string[]; // categories they collect (e.g. ["Pokémon", "Baseball"])
  collectorType: "any" | "money" | "talent";
  hasWishlist: boolean;
  inProgressSet: boolean; // a set between 1% and 95% complete
  binderSize: number;
}

// Deterministic pick so quests are stable across a week (no Math.random, which
// is unavailable here anyway) — vary by the week string + a salt.
function pick<T>(arr: T[], week: string, salt: number): T {
  let h = salt;
  for (let i = 0; i < week.length; i++) h = (h * 31 + week.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

/** Generate this week's quests, personalized to the collector's profile. */
export function makeQuests(week: string, now: QuestCounters, profile?: QuestProfile): QuestState {
  const p: QuestProfile = profile || { categories: [], collectorType: "any", hasWishlist: now.wishlist > 0, inProgressSet: now.bestSetPct > 0 && now.bestSetPct < 0.95, binderSize: now.cards };
  const cat = p.categories.length ? pick(p.categories, week, 7) : "";
  const quests: Quest[] = [];

  // 1) A scanning quest, flavored by category and collector type.
  if (cat) {
    quests.push({ id: "scan_cat", emoji: "📷", title: `Scan 3 ${cat} cards`, metric: "scans", target: now.scans + 3 });
  } else {
    quests.push({ id: "scan_5", emoji: "📷", title: "Identify 5 cards", metric: "scans", target: now.scans + 5 });
  }

  // 2) A collection-growth quest that scales with how big the binder already is.
  const addN = p.binderSize >= 50 ? 5 : 3;
  quests.push({ id: "binder_add", emoji: "📒", title: `Add ${addN} cards to your binder`, metric: "cards", target: now.cards + addN });

  // 3) Trade activity — money collectors get a slightly higher bar.
  const tradeN = p.collectorType === "money" ? 3 : 2;
  quests.push({ id: "trade_n", emoji: "🤝", title: `Evaluate ${tradeN} trades`, metric: "trades", target: now.trades + tradeN });

  // 4) A goal tied to what they're actually doing: finishing a set, building a
  //    wishlist, or (for talent collectors with neither) keeping up with news.
  if (p.inProgressSet) {
    quests.push({ id: "set_up_5", emoji: "🎴", title: "Raise your best set completion by 5%", metric: "bestSetPct", target: Math.min(1, now.bestSetPct + 0.05) });
  } else if (p.hasWishlist || p.collectorType === "money") {
    quests.push({ id: "wish_3", emoji: "♡", title: cat ? `Add 3 ${cat} cards to your wishlist` : "Add 3 cards to your wishlist", metric: "wishlist", target: now.wishlist + 3 });
  } else {
    quests.push({ id: "briefing_5b", emoji: "☀️", title: "Check the morning briefing on 4 days", metric: "briefingDays", target: 4 });
  }

  // 5) Always keep a briefing-streak quest (unless #4 already is one).
  if (!quests.some((q) => q.metric === "briefingDays")) {
    quests.push({ id: "briefing_5", emoji: "☀️", title: "Check the morning briefing on 5 days", metric: "briefingDays", target: 5 });
  }

  return { week, baseline: { ...now }, briefingDays: 0, quests };
}

export interface QuestProgress extends Quest {
  progress: number; // 0..1
  done: boolean;
  label: string; // "2/5"-style progress label
}

/** Live progress for each quest given the current counters. */
export function questProgress(state: QuestState, now: QuestCounters): QuestProgress[] {
  return state.quests.map((q) => {
    const base = q.metric === "briefingDays" ? 0 : state.baseline[q.metric];
    const cur = q.metric === "briefingDays" ? state.briefingDays : now[q.metric];
    const goal = q.target - base;
    const gained = Math.max(0, cur - base);
    const progress = goal <= 0 ? 1 : Math.min(1, gained / goal);
    const label =
      q.metric === "bestSetPct"
        ? `${Math.round(cur * 100)}%/${Math.round(q.target * 100)}%`
        : `${Math.min(gained, goal)}/${goal}`;
    return { ...q, progress, done: progress >= 1, label };
  });
}
