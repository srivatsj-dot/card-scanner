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
  binderValue: number; // total binder value (in the user's currency)
  marketTrades: number; // completed trades with other collectors
  distinctSets: number; // number of different sets owned
  maxCardValue: number; // value of the most valuable card owned
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

// A stable-per-week seed derived from the week key (no Math.random — unavailable
// here and would break determinism). Different weeks → different seed → different
// quests, but the SAME week always regenerates identically.
function weekSeed(week: string): number {
  let h = 2166136261;
  for (let i = 0; i < week.length; i++) h = Math.imul(h ^ week.charCodeAt(i), 16777619) >>> 0;
  return h;
}
// Pull a pseudo-random small int from the seed at a given "slot".
const roll = (seed: number, slot: number, mod: number) => ((Math.imul(seed ^ (slot * 0x9e3779b1), 2654435761) >>> 0) % mod);
const choose = <T>(arr: T[], seed: number, slot: number): T => arr[roll(seed, slot, arr.length)];

/** Generate this week's quests — personalized AND rotated so each week differs. */
export function makeQuests(week: string, now: QuestCounters, profile?: QuestProfile): QuestState {
  const p: QuestProfile = profile || { categories: [], collectorType: "any", hasWishlist: now.wishlist > 0, inProgressSet: now.bestSetPct > 0 && now.bestSetPct < 0.95, binderSize: now.cards };
  const seed = weekSeed(week);
  const cat = p.categories.length ? choose(p.categories, seed, 1) : "";

  // Two CORE quests every week, but with week-varied counts so they never feel
  // identical.
  const scanN = choose([3, 5, 8], seed, 2);
  const addN = choose(p.binderSize >= 50 ? [5, 8, 10] : [2, 3, 4], seed, 3);
  const quests: Quest[] = [
    cat
      ? { id: "scan", emoji: "📷", title: `Scan ${scanN} ${cat} cards`, metric: "scans", target: now.scans + scanN }
      : { id: "scan", emoji: "📷", title: `Identify ${scanN} cards`, metric: "scans", target: now.scans + scanN },
    { id: "binder", emoji: "📒", title: `Add ${addN} cards to your binder`, metric: "cards", target: now.cards + addN },
  ];

  // A rotating POOL — pick 3 different ones each week so the set keeps changing.
  const tradeN = p.collectorType === "money" ? choose([2, 3, 4], seed, 4) : choose([1, 2, 3], seed, 4);
  const briefN = choose([3, 4, 5], seed, 5);
  const wishN = choose([2, 3], seed, 6);
  const valBump = choose([25, 50, 100, 250], seed, 7); // grow binder value by this much
  const bigPull = choose([25, 50, 100], seed, 11); // "beat your best" threshold step
  // A varied pool of quests with punchy, collector-flavored copy. 3 are picked
  // and rotated each week so it never feels like the same checklist.
  const pool: Quest[] = [
    { id: "trade", emoji: "⚖️", title: `Run ${tradeN} trades through Check trade`, metric: "trades", target: now.trades + tradeN },
    { id: "briefing", emoji: "🗞️", title: `Read the morning briefing on ${briefN} days`, metric: "briefingDays", target: briefN },
    { id: "wish", emoji: "🎯", title: cat ? `Add ${wishN} ${cat} cards to your chase list` : `Add ${wishN} cards to your wishlist`, metric: "wishlist", target: now.wishlist + wishN },
    { id: "value_up", emoji: "📈", title: `Level up: grow your binder value by ${valBump}`, metric: "binderValue", target: Math.round(now.binderValue + valBump) },
    { id: "market_trade", emoji: "🤝", title: "Pull off a trade with another collector", metric: "marketTrades", target: now.marketTrades + 1 },
    { id: "new_set", emoji: "🗂️", title: cat ? `Start a new ${cat} set — add a card from a set you don't own` : "Break into a new set you don't own yet", metric: "distinctSets", target: now.distinctSets + 1 },
    { id: "big_pull", emoji: "💎", title: `Hit a new personal best — land a card worth ${Math.max(bigPull, Math.ceil((now.maxCardValue + 1) / 25) * 25)}+`, metric: "maxCardValue", target: Math.max(bigPull, Math.ceil((now.maxCardValue + 1) / 25) * 25) },
  ];
  if (p.inProgressSet) {
    pool.push({ id: "set_up", emoji: "🎴", title: "Raise your best set completion by 5%", metric: "bestSetPct", target: Math.min(1, now.bestSetPct + 0.05) });
  }
  // Deterministically rotate the pool order by week, then take 3.
  const ordered = pool
    .map((q, i) => ({ q, k: roll(seed, 20 + i, 997) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.q);
  const chosen = ordered.slice(0, 3);
  // Always guarantee a briefing quest so streak-building stays encouraged.
  if (!chosen.some((q) => q.metric === "briefingDays")) {
    chosen[chosen.length - 1] = pool.find((q) => q.metric === "briefingDays")!;
  }
  quests.push(...chosen);

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
        : q.metric === "binderValue"
        ? `+${Math.round(Math.min(gained, goal))}/${Math.round(goal)}`
        : q.metric === "maxCardValue"
        ? `${Math.round(cur)}/${Math.round(q.target)}`
        : `${Math.min(gained, goal)}/${goal}`;
    return { ...q, progress, done: progress >= 1, label };
  });
}
