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

/** Generate this week's quests from the collection at week start. */
export function makeQuests(week: string, now: QuestCounters): QuestState {
  const quests: Quest[] = [
    { id: "scan_5", emoji: "📷", title: "Identify 5 cards", metric: "scans", target: now.scans + 5 },
    { id: "binder_3", emoji: "📒", title: "Add 3 cards to your binder", metric: "cards", target: now.cards + 3 },
    { id: "trade_2", emoji: "🤝", title: "Evaluate 2 trades", metric: "trades", target: now.trades + 2 },
    { id: "briefing_5", emoji: "☀️", title: "Check the morning briefing on 5 days", metric: "briefingDays", target: 5 },
  ];
  // Personal set quest when a set is genuinely in progress; otherwise wishlist.
  if (now.bestSetPct > 0 && now.bestSetPct < 0.95) {
    quests.push({
      id: "set_up_5",
      emoji: "🎴",
      title: "Raise your best set completion by 5%",
      metric: "bestSetPct",
      target: Math.min(1, now.bestSetPct + 0.05),
    });
  } else {
    quests.push({ id: "wish_3", emoji: "♡", title: "Add 3 cards to your wishlist", metric: "wishlist", target: now.wishlist + 3 });
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
