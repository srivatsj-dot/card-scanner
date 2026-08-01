import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScanResult, Settings, SavedCard, WishItem, Theme, LaterItem } from "./types";
import { defaultSettings } from "./types";
import { searchCard, scanCard, gradePrice, quickPrice } from "./api";
import { searchCardCached } from "./cache";
import { ensureDigest } from "./digest";
import { describeCard, DAY_MS, makeThumbnail, money, sameCard, setDisplayCurrency, loadFxRates, convertMoney } from "./utils";
import { langByName, detectLanguageName } from "./i18n";
import { useT, setLanguage } from "./translator";
import { computeStats, earnedIds, ACHIEVEMENTS } from "./achievements";
import ScanView from "./components/ScanView";
import SearchView from "./components/SearchView";
import ErrorBoundary from "./components/ErrorBoundary";
import BulkView from "./components/BulkView";
import TradeView from "./components/TradeView";
import SettingsView from "./components/SettingsView";
import BinderView from "./components/BinderView";
import WishlistView from "./components/WishlistView";
import SetsView from "./components/SetsView";
import AwardsView from "./components/AwardsView";
import AdSlot from "./components/AdSlot";
import ChatDrawer from "./components/ChatDrawer";
import AuthScreen from "./components/AuthScreen";
import OfferView from "./components/OfferView";
import LoginModal from "./components/LoginModal";
import Onboarding from "./components/Onboarding";
import GuestGate from "./components/GuestGate";
import MarketView from "./components/MarketView";
import { bumpStreak, dayISO, liveStreak, makeQuests, questProgress, weekOf } from "./quests";
import type { Streak, QuestState, QuestCounters } from "./quests";
import Logo from "./components/Logo";
import TradeUpView from "./components/TradeUpView";
import LaterView from "./components/LaterView";
import DigestView from "./components/DigestView";
import HomeView from "./components/HomeView";
import PortfolioChart from "./components/PortfolioChart";
import Confetti from "./components/Confetti";
import { currentUser, displayNameOf, emailOf, logout, deleteAccount, setDisplayName, createdAtOf } from "./auth";
import { cloudActive, schedulePush, cloudPull, cloudUserKey, marketOffers, cloudSignOutAll } from "./cloud";

type View = "home" | "today" | "scan" | "search" | "bulk" | "trade" | "tradeup" | "market" | "later" | "binder" | "wishlist" | "sets" | "awards" | "settings";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

// Phone vs desktop — bulk scan is a phone-only feature (a phone camera is far
// better for snapping a tray of cards). Coarse pointer OR a mobile UA + narrow.
const isMobile = () =>
  (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) ||
  (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches && window.innerWidth < 900);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const isRateLimit = (e: unknown) =>
  (e as { status?: number })?.status === 429 ||
  String(e instanceof Error ? e.message : e).toLowerCase().includes("rate limit");

function MainApp({ user, onRequestLogin, onLogout, onDeleteAccount }: { user: string | null; onRequestLogin: () => void; onLogout: () => void; onDeleteAccount: () => void }) {
  // Guest mode: user === null. All screens work (scan, search, briefing,
  // trades) but anything that SAVES to a collection is gated behind
  // requireAuth(), which opens the login screen instead.
  const isGuest = user == null;
  const ns = user ?? "guest";
  const userName = user ? displayNameOf(user) : "Guest";
  // All persisted state is namespaced per account, so each user has their own
  // binder, wishlist, settings, and progress in the same browser.
  const SETTINGS_KEY = `card-scanner-settings:${ns}`;
  const BINDER_KEY = `card-scanner-binder:${ns}`;
  const WISHLIST_KEY = `card-scanner-wishlist:${ns}`;
  const THEME_KEY = `card-scanner-theme:${ns}`;
  const SCANS_KEY = `card-scanner-scans:${ns}`;
  const TRADES_KEY = `card-scanner-trades:${ns}`;
  const EARNED_KEY = `card-scanner-earned:${ns}`;
  const AUTO_REFRESH_KEY = `card-scanner-last-auto-refresh:${ns}`;
  const DIGEST_KEY = `card-scanner-digest:${ns}`;
  const WANTED_KEY = `card-scanner-wanted:${ns}`;
  const SET_PCT_KEY = `card-scanner-best-set-pct:${ns}`;
  const STREAK_KEY = `card-scanner-streak:${ns}`;
  const QUESTS_KEY = `card-scanner-quests:${ns}`;
  const QUEST_MASTER_KEY = `card-scanner-quest-master:${ns}`;
  const TRADE_COUNTERS_KEY = `card-scanner-trade-counters:${ns}`;
  // A recorded log of what the binder was worth over time. This has to be kept
  // as it HAPPENS: rebuilding history from the cards you currently hold silently
  // erases the past (sell a card and the peak it created vanishes, as if you'd
  // never owned it). Values are stored in USD so switching currency can't distort
  // the shape of the line.
  const VALUE_LOG_KEY = `card-scanner-value-log:${ns}`;

  const [view, setView] = useState<View>("home");
  const [settings, setSettings] = useState<Settings>(() => {
    const stored = loadJSON<Partial<Settings> | null>(SETTINGS_KEY, null);
    // First run: default the language to the browser's language.
    return stored
      ? { ...defaultSettings, ...stored }
      : { ...defaultSettings, language: detectLanguageName() };
  });
  const t = useT();
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [search, setSearch] = useState<ScanResult | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [saved, setSaved] = useState<SavedCard[]>(() => loadJSON<SavedCard[]>(BINDER_KEY, []));
  const [wishlist, setWishlist] = useState<WishItem[]>(() => loadJSON<WishItem[]>(WISHLIST_KEY, []));
  const [later, setLater] = useState<LaterItem[]>(() => loadJSON<LaterItem[]>(WANTED_KEY, []));
  const [theme, setTheme] = useState<Theme>(() => loadJSON<Theme>(THEME_KEY, "dark"));
  const [scans, setScans] = useState<number>(() => loadJSON<number>(SCANS_KEY, 0));
  const [trades, setTrades] = useState<number>(() => loadJSON<number>(TRADES_KEY, 0));
  // Best set-completion % ever reached (from the Sets view's checks), for the
  // completion achievements. Persisted so badges stick across sessions.
  const [bestSetPct, setBestSetPct] = useState<number>(() => loadJSON<number>(SET_PCT_KEY, 0));
  // Daily briefing streak + this week's quests.
  const [streak, setStreak] = useState<Streak | null>(() => loadJSON<Streak | null>(STREAK_KEY, null));
  const [questState, setQuestState] = useState<QuestState | null>(() => loadJSON<QuestState | null>(QUESTS_KEY, null));
  const [questMaster, setQuestMaster] = useState<boolean>(() => loadJSON<boolean>(QUEST_MASTER_KEY, false));
  type TradeCounters = { made: number; accepted: number; rejected: number; cards: number };
  const [tradeCounters, setTradeCounters] = useState<TradeCounters>(() => loadJSON<TradeCounters>(TRADE_COUNTERS_KEY, { made: 0, accepted: 0, rejected: 0, cards: 0 }));
  function recordTrade(evt: { type: "made" | "accepted" | "rejected"; cards?: number }) {
    setTradeCounters((prev) => {
      const next = { ...prev };
      if (evt.type === "made") next.made += 1;
      else if (evt.type === "rejected") next.rejected += 1;
      else if (evt.type === "accepted") { next.accepted += 1; next.cards += evt.cards || 0; }
      localStorage.setItem(TRADE_COUNTERS_KEY, JSON.stringify(next));
      return next;
    });
  }
  const [valueLog, setValueLog] = useState<{ t: number; v: number }[]>(() => loadJSON<{ t: number; v: number }[]>(VALUE_LOG_KEY, []));
  // Record the binder's total whenever it changes, at most one point an hour
  // (later changes in the same hour overwrite it, so the log stays compact).
  useEffect(() => {
    if (isGuest) return;
    const usd = saved.reduce((n, c) => n + convertMoney(c.result.estimatedValue?.mid || 0, c.result.estimatedValue?.currency, "USD"), 0);
    setValueLog((prev) => {
      const now = Date.now();
      const last = prev[prev.length - 1];
      if (last && Math.abs(last.v - usd) < 0.005) return prev; // nothing moved
      const HOUR = 60 * 60 * 1000;
      const next = last && now - last.t < HOUR ? [...prev.slice(0, -1), { t: now, v: usd }] : [...prev, { t: now, v: usd }];
      const trimmed = next.slice(-2000);
      try { localStorage.setItem(VALUE_LOG_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }
      return trimmed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, isGuest]);

  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // New accounts get a 3-question setup (language, style, cards) once.
  const ONBOARD_KEY = `card-scanner-onboard:${ns}`;
  // Ask the setup questions ONCE per account. `settings.onboarded` rides along in
  // the synced blob, so logging back in (here or on another device) never
  // re-asks — even if the device-local "just signed up" flag is still lying around.
  const [needsOnboarding, setNeedsOnboarding] = useState(
    () => !isGuest && !settings.onboarded &&
      // An account that already has a collection has obviously been set up before
      // (e.g. signing in on a new device) — don't put it through setup again.
      saved.length === 0 && wishlist.length === 0 &&
      (() => { try { return localStorage.getItem(ONBOARD_KEY) === "1"; } catch { return false; } })()
  );
  function finishOnboarding(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch, onboarded: true }));
    if (patch.language) setLanguage(patch.language);
    try { localStorage.removeItem(ONBOARD_KEY); } catch { /* ignore */ }
    setNeedsOnboarding(false);
  }
  // If a synced pull says this account already onboarded, close the questions.
  useEffect(() => {
    if (settings.onboarded && needsOnboarding) {
      setNeedsOnboarding(false);
      try { localStorage.removeItem(ONBOARD_KEY); } catch { /* ignore */ }
    }
  }, [settings.onboarded, needsOnboarding]);
  const [, setNameTick] = useState(0); // bump to re-render after a username change
  const earnedRef = useRef<Set<string>>(
    new Set(
      loadJSON<string[] | null>(EARNED_KEY, null) ??
        earnedIds(
          computeStats(
            loadJSON<SavedCard[]>(BINDER_KEY, []),
            loadJSON<WishItem[]>(WISHLIST_KEY, []),
            loadJSON<number>(SCANS_KEY, 0),
            loadJSON<number>(TRADES_KEY, 0),
            settings.language,
            loadJSON<number>(SET_PCT_KEY, 0)
          )
        )
    )
  );
  // Reactive mirror of the ever-earned set, so the Awards view re-renders and
  // badges stay unlocked forever (even after clearing the binder).
  const [unlockedIds, setUnlockedIds] = useState<string[]>(() => [...earnedRef.current]);

  // Live counters the quests measure against (briefingDays lives in questState).
  const questCounters: QuestCounters = {
    scans, trades, cards: saved.length, wishlist: wishlist.length,
    briefingDays: questState?.briefingDays || 0, bestSetPct,
    binderValue: saved.reduce((s, c) => s + (c.result.estimatedValue?.mid || 0), 0),
    marketTrades: tradeCounters.accepted,
    distinctSets: new Set(saved.map((s) => (s.result.setName || "").trim().toLowerCase()).filter(Boolean)).size,
    maxCardValue: saved.reduce((m, c) => Math.max(m, c.result.estimatedValue?.mid || 0), 0),
  };

  // Keep quests on the current week — regenerate from this week's baseline when
  // the week rolls over (or on first run).
  useEffect(() => {
    const week = weekOf(dayISO());
    if (!questState || questState.week !== week) {
      // Personalize from what they ACTUALLY collect: cards in the binder first,
      // then their preferred category. Do NOT fall back to the all-sports digest
      // list — that wrongly assumed Pokémon for people who don't collect it.
      const owned = Array.from(new Set(saved.map((s) => (s.result.sport || "").trim()).filter(Boolean)));
      const cats = owned.length ? owned : (settings.sport ? [settings.sport] : []);
      const fresh = makeQuests(week, questCounters, {
        categories: cats.slice(0, 5),
        collectorType: settings.collectorType,
        hasWishlist: wishlist.length > 0,
        inProgressSet: bestSetPct > 0 && bestSetPct < 0.95,
        binderSize: saved.length,
      });
      setQuestState(fresh);
      localStorage.setItem(QUESTS_KEY, JSON.stringify(fresh));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questState?.week]);

  // Trade-offer notifications, split by direction:
  //  • INCOMING pending offers → a badge in the trades section (Marketplace nav).
  //  • Responses to YOUR sent offers (accepted/declined) → the morning briefing,
  //    shown once until acknowledged.
  const SEEN_RESP_KEY = `card-scanner-seen-offer-responses:${ns}`;
  const [incomingPending, setIncomingPending] = useState(0);
  const [answeredOut, setAnsweredOut] = useState<{ id: string; who: string; status: string }[]>([]);
  useEffect(() => {
    if (isGuest || !cloudActive()) return;
    let cancelled = false;
    // Only announce a response that happened recently — never replay old history.
    const RECENT_MS = 14 * DAY_MS;
    const fetchOffers = () => marketOffers()
      .then((o) => {
        if (cancelled) return;
        setIncomingPending(o.incoming.filter((x) => x.status === "pending").length);
        const answered = o.outgoing.filter(
          (x) => x.status === "accepted" || x.status === "declined" || x.status === "countered"
        );
        // The "already announced" list lives on this device. If it's MISSING (a
        // fresh login, a new device, cleared storage), seed it with everything
        // that's already been answered instead of popping them all up again —
        // that's what caused "X declined your trade" on every single login.
        let seen: string[] | null = null;
        try {
          const raw = localStorage.getItem(SEEN_RESP_KEY);
          if (raw) seen = JSON.parse(raw) as string[];
        } catch { /* treat as missing */ }
        if (seen === null) {
          try { localStorage.setItem(SEEN_RESP_KEY, JSON.stringify(answered.map((x) => x.id))); } catch { /* ignore */ }
          setAnsweredOut([]);
          return;
        }
        const seenSet = new Set(seen);
        const now = Date.now();
        setAnsweredOut(
          answered
            .filter((x) => !seenSet.has(x.id))
            .filter((x) => !x.respondedAt || now - x.respondedAt < RECENT_MS)
            .map((x) => ({ id: x.id, who: x.toDisplay, status: x.status }))
        );
      })
      .catch(() => {});
    fetchOffers();
    const iv = setInterval(fetchOffers, 45000); // poll so responses pop while idle
    return () => { cancelled = true; clearInterval(iv); };
  }, [view, isGuest]);
  function ackResponses() {
    setAnsweredOut((cur) => {
      try {
        const prev: string[] = JSON.parse(localStorage.getItem(SEEN_RESP_KEY) || "[]");
        localStorage.setItem(SEEN_RESP_KEY, JSON.stringify([...new Set([...prev, ...cur.map((x) => x.id)])]));
      } catch { /* ignore */ }
      return [];
    });
  }

  // Award "Quest Master" the first time every quest in a week is completed.
  useEffect(() => {
    if (questMaster || !questState) return;
    const prog = questProgress(questState, questCounters);
    if (prog.length && prog.every((q) => q.done)) {
      setQuestMaster(true);
      localStorage.setItem(QUEST_MASTER_KEY, JSON.stringify(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questState, scans, trades, saved.length, wishlist.length, bestSetPct]);

  // Opening the morning briefing advances the daily streak (once per day) and
  // counts toward this week's briefing quest.
  useEffect(() => {
    if (view !== "today") return;
    const today = dayISO();
    const next = bumpStreak(streak, today);
    if (next === streak) return; // already counted today
    setStreak(next);
    localStorage.setItem(STREAK_KEY, JSON.stringify(next));
    setQuestState((qs) => {
      if (!qs) return qs;
      const upd = { ...qs, briefingDays: qs.briefingDays + 1 };
      localStorage.setItem(QUESTS_KEY, JSON.stringify(upd));
      return upd;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Saving anything to a collection needs an account: guests get sent to the
  // login screen instead. Returns whether the caller may proceed.
  function requireAuth(): boolean {
    if (isGuest) {
      onRequestLogin();
      return false;
    }
    return true;
  }

  // Record a set-completion % from the Sets view; keep the best ever seen.
  function reportSetPct(pct: number) {
    setBestSetPct((prev) => {
      const next = Math.max(prev, pct || 0);
      if (next !== prev) localStorage.setItem(SET_PCT_KEY, JSON.stringify(next));
      return next;
    });
  }

  // Settings the AI sees, augmented with the current wishlist (for wishlist-aware
  // trade/recommendation logic). Not persisted into the saved settings.
  const aiSettings = useMemo(
    () => ({
      ...settings,
      wishlist: wishlist.map((w) => (w.result ? describeCard(w.result) : w.text)).filter(Boolean),
    }),
    [settings, wishlist]
  );
  // Players in the binder, for the morning digest to prioritize.
  const digestPlayers = useMemo(
    () =>
      Array.from(
        new Set(
          saved
            .filter((s) => s.result.player)
            .map((s) => `${s.result.player}${s.result.sport ? ` (${s.result.sport})` : ""}`)
        )
      ),
    [saved]
  );
  // The digest categories the collector actually owns — so their briefing covers
  // only what they collect (a no-Pokémon binder never yields an all-Pokémon feed).
  const collectedCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const s of saved) {
      const sp = (s.result.sport || "").toLowerCase();
      if (sp.includes("pok")) cats.add("Pokémon");
      else if (sp.includes("base")) cats.add("Baseball");
      else if (sp.includes("basket")) cats.add("Basketball");
      else if (sp.includes("hockey")) cats.add("Hockey");
      else if (sp.includes("cricket")) cats.add("Cricket");
      else if (sp.includes("soccer") || sp.includes("futbol") || sp.includes("fútbol")) cats.add("Soccer");
      else if (sp.includes("football") || sp.includes("nfl")) cats.add("Football");
    }
    return Array.from(cats);
  }, [saved]);
  // Wishlist cards, for the digest's "from your wishlist" section.
  const digestWishlist = useMemo(
    () => Array.from(new Set(wishlist.map((w) => (w.result ? describeCard(w.result) : w.text)).filter(Boolean))),
    [wishlist]
  );
  const [refreshing, setRefreshing] = useState(false);
  // "3 / 25" progress while refreshing, so a big binder never looks frozen.
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);
  const [, setCurrencyTick] = useState(0); // bumped when the display currency changes
  // Confetti + banner when a special card is saved.
  const [celebrate, setCelebrate] = useState<{ title: string; sub: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [unlocks, setUnlocks] = useState<{ id: number; emoji: string; title: string; desc: string }[]>([]);
  const refreshingRef = useRef(false);

  function toast(msg: string) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }

  function showUnlock(emoji: string, title: string, desc: string) {
    const id = Date.now() + Math.random();
    setUnlocks((u) => [...u, { id, emoji, title, desc }]);
    setTimeout(() => setUnlocks((u) => u.filter((x) => x.id !== id)), 4800);
  }

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(BINDER_KEY, JSON.stringify(saved)); }, [saved]);
  useEffect(() => { localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist)); }, [wishlist]);
  useEffect(() => { localStorage.setItem(WANTED_KEY, JSON.stringify(later)); }, [later]);
  useEffect(() => { localStorage.setItem(SCANS_KEY, JSON.stringify(scans)); }, [scans]);
  useEffect(() => { localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); }, [trades]);
  // Cross-device sync: when signed into a cloud account, push the collection to
  // the server (debounced) whenever any synced state changes.
  useEffect(() => {
    if (user && cloudActive()) schedulePush(user);
  }, [settings, saved, wishlist, later, scans, trades, theme, user]);
  // Unlock-achievement toasts.
  useEffect(() => {
    const ids = earnedIds(computeStats(saved, wishlist, scans, trades, settings.language, bestSetPct, streak?.best || 0, questMaster, tradeCounters));
    const newly = ids.filter((id) => !earnedRef.current.has(id));
    if (newly.length) {
      // Don't fire a wall of banners on the very first computation (e.g. importing
      // an existing collection) — only celebrate genuinely new unlocks.
      if (earnedRef.current.size > 0 || newly.length <= 3) {
        newly.forEach((id) => {
          const a = ACHIEVEMENTS.find((x) => x.id === id);
          if (a) showUnlock(a.emoji, a.title, a.desc);
        });
      }
      // UNION, never replace — an earned badge is kept forever, so clearing the
      // binder or dropping below a threshold can't take it away.
      const union = [...new Set([...earnedRef.current, ...ids])];
      earnedRef.current = new Set(union);
      setUnlockedIds(union);
      localStorage.setItem(EARNED_KEY, JSON.stringify(union));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, wishlist, scans, trades, settings.language, bestSetPct, streak, questMaster, tradeCounters]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);
  useEffect(() => {
    // Right-to-left layout for Arabic etc.
    document.documentElement.dir = langByName(settings.language).rtl ? "rtl" : "ltr";
    setLanguage(settings.language);
  }, [settings.language]);
  // Every price is displayed in the chosen currency, converted on the fly — so
  // switching currency updates the whole app at once instead of waiting for a
  // re-price. Set before paint so the first render is already correct.
  useLayoutEffect(() => {
    setDisplayCurrency(settings.currency);
    setCurrencyTick((n) => n + 1); // re-render everything showing a price
  }, [settings.currency]);
  // Swap the built-in approximate rates for today's real ones, once per load.
  useEffect(() => {
    loadFxRates().then((ok) => { if (ok) setCurrencyTick((n) => n + 1); });
  }, []);

  function saveCard(result: ScanResult, frontDataUrl: string | undefined, quiet = false) {
    if (!requireAuth()) return;
    // Duplicate warning: you very likely already own this exact card. Ask before
    // adding a second copy on a single save; on a bulk save just say so after.
    const copies = saved.filter((c) => sameCard(c.result, result)).length;
    if (copies > 0 && !quiet) {
      const ok = confirm(
        `${t("You already have this card in your binder")}${copies > 1 ? ` (${copies} ${t("copies")})` : ""}.\n\n${result.player || t("Card")}\n\n${t("Add another copy?")}`
      );
      if (!ok) return;
    }
    const now = Date.now();
    setSaved((prev) => [
      {
        id: uid(),
        savedAt: now,
        // Prefer a real web photo of the card (fills the frame) over the captured/
        // uploaded shot; fall back to the user's photo when we have no web image.
        thumbnail: result.imageUrl || frontDataUrl || "",
        result,
        lastRefreshedAt: now,
        previousMid: null,
        history: [{ t: now, mid: result.estimatedValue.mid }],
      },
      ...prev,
    ]);
    toast(copies > 0
      ? `⚠️ ${t("Duplicate")} — ${result.player || t("card")} (${copies + 1} ${t("copies")})`
      : `${t("Saved to binder")}: ${result.player || t("card")}`);
    // A genuinely special pull deserves a moment — confetti + a banner naming it.
    const why = rarityReason(result);
    if (why) setCelebrate({ title: result.player || t("A big one!"), sub: why });
  }

  /**
   * Is this card worth celebrating? Either it's valuable (≥ $250 equivalent) or
   * it's the kind of card collectors chase — a one-of-one, serial numbered, an
   * autograph or relic, or genuine vintage. Returns why, for the banner.
   */
  function rarityReason(r: ScanResult): string | null {
    const v = r.estimatedValue;
    const usd = v ? convertMoney(v.mid || 0, v.currency || "USD", "USD") : 0;
    const blob = `${r.specialEdition || ""} ${r.parallel || ""}`.toLowerCase();
    if (/\b1\s*\/\s*1\b|one[- ]of[- ]one/.test(blob)) return t("A one-of-one. There isn't another.");
    if (usd >= 1000) return t("Worth four figures — a serious card.");
    if (r.serialNumber) return `${t("Serial numbered")} /${r.serialNumber.replace(/^.*\//, "")}.`;
    if (/auto|signed|signature/.test(blob)) return t("An autograph!");
    if (/relic|patch|jersey|memorabilia/.test(blob)) return t("A piece of memorabilia in the card.");
    if (usd >= 250) return t("One of the most valuable cards in your binder.");
    const yr = parseInt((r.year || "").replace(/\D/g, "").slice(0, 4), 10);
    if (Number.isFinite(yr) && yr > 1900 && yr < 1970) return t("Genuine vintage.");
    return null;
  }

  // Re-scan a saved card's photo to log its condition over time and flag new damage.
  async function checkCondition(id: string, dataUrl: string) {
    const card = saved.find((c) => c.id === id);
    if (!card) return;
    try {
      const res = await scanCard([dataUrl], { ...aiSettings, liveData: false });
      const cr = res.conditionReport;
      const grade = cr?.grade || res.estimatedCondition || "Unknown";
      const flaws = cr?.flaws || [];
      const prev = card.conditionLog?.[card.conditionLog.length - 1];
      const newFlaws = prev ? flaws.filter((f) => !prev.flaws.includes(f)) : [];
      setSaved((p) =>
        p.map((c) =>
          c.id === id ? { ...c, conditionLog: [...(c.conditionLog || []), { t: Date.now(), grade, flaws }] } : c
        )
      );
      if (newFlaws.length) toast(`⚠ ${newFlaws.length} ${t("new flaw(s) spotted")}: ${newFlaws[0]}`);
      else toast(`${t("Condition logged")}: ${grade}`);
    } catch (e) {
      toast(isRateLimit(e) ? t("Too busy right now — try again in a minute") : t("Condition check failed"));
    }
  }

  // Toggle a card flag: favorite (protect from trade suggestions) or notNeeded
  // (surface as trade bait). Mutually exclusive — a card can't be both.
  function toggleFlag(id: string, flag: "favorite" | "notNeeded") {
    setSaved((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const on = !c[flag];
        return { ...c, favorite: false, notNeeded: false, [flag]: on };
      })
    );
  }

  // Swap two cards' positions in the binder (click-to-rearrange in the grid /
  // page views). Order is preserved in `saved`, so it persists across syncs.
  function reorderCards(aId: string, bId: string) {
    setSaved((prev) => {
      const arr = prev.slice();
      const i = arr.findIndex((c) => c.id === aId);
      const j = arr.findIndex((c) => c.id === bId);
      if (i < 0 || j < 0 || i === j) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  // Attach (or replace) a photo on a saved binder card.
  async function setCardPhoto(id: string, dataUrl: string) {
    const thumb = await makeThumbnail(dataUrl);
    setSaved((prev) => prev.map((c) => (c.id === id ? { ...c, thumbnail: thumb } : c)));
  }

  // Edit a wishlist card's description and re-look up its data.
  async function editWish(id: string, newText: string) {
    const text = newText.trim();
    if (!text) return;
    setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, text, result: undefined, previousMid: null } : w)));
    try {
      const r = await searchCardCached(text, aiSettings);
      setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
    } catch {
      /* leave text-only; user can retry via refresh */
    }
  }

  // Data portability: download everything we hold for this account as JSON, so
  // your collection is never locked inside the app.
  function exportMyData() {
    const dump = {
      exportedAt: new Date().toISOString(),
      account: isGuest ? "guest" : userName,
      settings, binder: saved, wishlist, later,
      stats: { scans, trades, bestSetPct, streak, questMaster, tradeCounters },
      achievements: unlockedIds,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-o-rama-${(isGuest ? "guest" : userName).replace(/\W+/g, "-")}-${dayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("Your data has been downloaded."));
  }

  // Record a professional grade you had done (PSA 10, BGS 9.5, …). A slabbed card
  // trades in a different market, so we re-price it against graded comps of that
  // grade and remember the raw value to show what grading added.
  async function setCardGrade(id: string, company: string, grade: string, certNumber?: string) {
    const card = saved.find((c) => c.id === id);
    if (!card) return;
    if (!company) { // clear the grade
      setSaved((prev) => prev.map((c) => (c.id === id ? { ...c, grade: undefined } : c)));
      return;
    }
    const rawMid = card.grade?.rawMid ?? card.result.estimatedValue?.mid ?? null;
    setSaved((prev) => prev.map((c) => (c.id === id
      ? { ...c, grade: { company, grade, gradedAt: Date.now(), certNumber, rawMid } }
      : c)));
    try {
      const r = await gradePrice(card.result, company, grade, aiSettings);
      if (!r.graded) return; // no graded comps — keep the raw value
      const g = r.graded;
      setSaved((prev) => prev.map((c) => (c.id === id ? {
        ...c,
        previousMid: c.result.estimatedValue?.mid ?? null,
        result: { ...c.result, estimatedValue: { low: g.low, mid: g.mid, high: g.high, currency: g.currency, note: g.note } },
        grade: { company, grade, gradedAt: Date.now(), certNumber, rawMid: r.raw?.mid ?? rawMid },
        lastRefreshedAt: Date.now(),
        history: [...(c.history || []), { t: Date.now(), mid: g.mid }],
      } : c)));
      toast(`${t("Graded")} ${company} ${grade} — ${money(g.mid, g.currency)}`);
    } catch { /* keep the grade; value stays as-is */ }
  }

  // Correct a saved binder card that was identified wrong: re-look it up from the
  // fixed description and replace its data (and its web photo) in place.
  async function editSavedCard(id: string, newText: string) {
    const text = newText.trim();
    if (!text) return;
    try {
      const r = await searchCardCached(text, aiSettings);
      setSaved((prev) => prev.map((c) => (c.id === id ? {
        ...c,
        result: r,
        thumbnail: r.imageUrl || c.thumbnail,
        previousMid: c.result.estimatedValue?.mid ?? null,
        lastRefreshedAt: Date.now(),
      } : c)));
    } catch { /* leave the card as-is on failure */ }
  }


  // --- In-app assistant ------------------------------------------------------
  // A compact snapshot of the collector's own data, so the assistant can answer
  // specifically ("what's my binder worth?", "what was it worth in August?")
  // instead of guessing. Kept small: identity + value per card, no images.
  function assistantContext() {
    const cur = settings.currency || "USD";
    const inCur = (n: number, from?: string) => Math.round(convertMoney(n || 0, from || "USD", cur) * 100) / 100;
    // A monthly value timeline plus the last 14 days, built from card histories.
    const stamps: number[] = [];
    const now = Date.now();
    for (let d = 13; d >= 0; d--) stamps.push(now - d * DAY_MS);
    for (let m = 1; m <= 24; m++) stamps.push(now - m * 30 * DAY_MS);
    const timeline = [...new Set(stamps)].sort((a, b) => a - b).map((at) => {
      let total = 0;
      for (const c of saved) {
        if ((c.savedAt || 0) > at) continue;
        const pts = (c.history || []).filter((h) => h.t <= at);
        const v = pts.length ? pts[pts.length - 1].mid : c.result.estimatedValue?.mid || 0;
        total += convertMoney(Number(v) || 0, c.result.estimatedValue?.currency, cur);
      }
      return { date: new Date(at).toISOString().slice(0, 10), value: Math.round(total) };
    });
    return {
      account: {
        name: userName,
        createdAt: user ? new Date(createdAtOf(user) || Date.now()).toISOString().slice(0, 10) : null,
        currency: cur,
      },
      totals: {
        cards: saved.length,
        binderValue: inCur(saved.reduce((n, c) => n + convertMoney(c.result.estimatedValue?.mid || 0, c.result.estimatedValue?.currency, cur), 0)),
        wishlistCards: wishlist.length,
        scans, tradesChecked: trades,
        achievementsEarned: unlockedIds.length,
        briefingStreak: liveStreak(streak, dayISO()),
      },
      binder: saved.slice(0, 250).map((c) => ({
        player: c.result.player, year: c.result.year, set: c.result.setName,
        parallel: c.result.parallel, number: c.result.cardNumber,
        value: inCur(c.result.estimatedValue?.mid || 0, c.result.estimatedValue?.currency),
        grade: c.grade ? `${c.grade.company} ${c.grade.grade}` : null,
        favorite: !!c.favorite,
        addedOn: new Date(c.savedAt).toISOString().slice(0, 10),
      })),
      wishlist: wishlist.slice(0, 100).map((w) => ({
        text: w.text,
        value: inCur(w.result?.estimatedValue?.mid || 0, w.result?.estimatedValue?.currency),
      })),
      valueTimeline: timeline,
    };
  }

  /** Find the binder card the assistant is referring to, by loose description. */
  function findCard(query: string): SavedCard | undefined {
    const q = (query || "").toLowerCase().trim();
    if (!q) return undefined;
    const words = q.split(/\s+/).filter((w) => w.length > 2);
    const score = (c: SavedCard) => {
      const hay = describeCard(c.result).toLowerCase();
      return words.filter((w) => hay.includes(w)).length;
    };
    return saved.filter((c) => score(c) > 0).sort((a, b) => score(b) - score(a))[0];
  }

  /** Carry out one assistant action. Returns a line describing what happened. */
  function runAssistantAction(a: { type: string; text?: string | null; query?: string | null; view?: string | null; company?: string | null; grade?: string | null; on?: boolean | null }): string | null {
    switch (a.type) {
      case "wishlist_add": {
        const text = (a.text || a.query || "").trim();
        if (!text) return null;
        addWish(text);
        return `${t("Added to your wishlist")}: ${text}`;
      }
      case "binder_add": {
        const text = (a.text || a.query || "").trim();
        if (!text) return null;
        // Look it up, then save it — same path as a manual search + save.
        searchCardCached(text, aiSettings)
          .then((r) => saveCard(r, undefined, true))
          .catch(() => toast(t("Couldn't look that card up.")));
        return `${t("Looking that up and adding it to your binder")}: ${text}`;
      }
      case "later_add": {
        const text = (a.text || a.query || "").trim();
        if (!text) return null;
        saveLater({ target: text, give: [] });
        return `${t("Saved for later")}: ${text}`;
      }
      case "later_remove": {
        const q = (a.query || a.text || "").toLowerCase().trim();
        const hit = later.find((l) => q && l.target.toLowerCase().includes(q));
        if (!hit) return t("Couldn't find that in your For later list.");
        removeLater(hit.id);
        return t("Removed it from For later.");
      }
      case "wishlist_to_binder": {
        const q = (a.query || a.text || "").toLowerCase().trim();
        const hit = wishlist.find((w) => q && w.text.toLowerCase().includes(q));
        if (!hit) return t("Couldn't find that card on your wishlist.");
        if (hit.result) saveCard(hit.result, undefined, true);
        setWishlist((prev) => prev.filter((w) => w.id !== hit.id));
        return `${t("Moved to your binder")}: ${hit.text}`;
      }
      case "unfavorite_all": {
        setSaved((prev) => prev.map((c) => (c.favorite ? { ...c, favorite: false } : c)));
        return t("Cleared every star.");
      }
      case "sort_binder":
      case "binder_layout": {
        const v = String(a.text || a.view || "").toLowerCase();
        if (a.type === "binder_layout" && ["list", "grid", "pages"].includes(v)) {
          setSettings((s2) => ({ ...s2, binderMode: v as Settings["binderMode"] }));
          setView("binder");
          return `${t("Binder layout set to")} ${v}`;
        }
        return null;
      }
      case "theme": {
        const v = String(a.text || "").toLowerCase();
        if (v !== "dark" && v !== "light") return null;
        setTheme(v as Theme);
        return `${t("Switched to")} ${v} ${t("mode")}`;
      }
      case "wishlist_remove": {
        const q = (a.query || a.text || "").toLowerCase().trim();
        const hit = wishlist.find((w) => q && w.text.toLowerCase().includes(q));
        if (!hit) return t("Couldn't find that card on your wishlist.");
        setWishlist((prev) => prev.filter((w) => w.id !== hit.id));
        return `${t("Removed from your wishlist")}: ${hit.text}`;
      }
      case "binder_remove": {
        const hit = findCard(a.query || a.text || "");
        if (!hit) return t("Couldn't find that card in your binder.");
        setSaved((prev) => prev.filter((c) => c.id !== hit.id));
        return `${t("Removed from your binder")}: ${describeCard(hit.result)}`;
      }
      case "favorite": {
        const hit = findCard(a.query || a.text || "");
        if (!hit) return t("Couldn't find that card in your binder.");
        const want = a.on !== false;
        if (!!hit.favorite !== want) toggleFlag(hit.id, "favorite");
        return `${want ? t("Starred") : t("Unstarred")}: ${describeCard(hit.result)}`;
      }
      case "grade": {
        const hit = findCard(a.query || a.text || "");
        if (!hit) return t("Couldn't find that card in your binder.");
        if (!a.grade) return t("Tell me the grade it received.");
        setCardGrade(hit.id, a.company || "PSA", String(a.grade));
        return `${t("Recorded")} ${a.company || "PSA"} ${a.grade} ${t("on")} ${describeCard(hit.result)}`;
      }
      case "navigate": {
        const v = String(a.view || a.text || "").toLowerCase();
        const ok: View[] = ["home", "today", "scan", "search", "bulk", "trade", "tradeup", "market", "later", "binder", "wishlist", "sets", "awards", "settings"];
        if (!ok.includes(v as View)) return null;
        setView(v as View);
        setChatOpen(false);
        return `${t("Opened")} ${v}`;
      }
      case "refresh_prices":
        refreshAll(true);
        return t("Refreshing your prices now.");
      case "set_currency": {
        const code = String(a.text || a.query || "").toUpperCase().slice(0, 3);
        if (!/^[A-Z]{3}$/.test(code)) return null;
        setSettings((s2) => ({ ...s2, currency: code }));
        return `${t("Currency switched to")} ${code}`;
      }
      default:
        return null;
    }
  }

  // --- "For later" list (saved trades / cards to acquire) ------------------
  function saveLater(item: Omit<LaterItem, "id" | "savedAt">) {
    if (!requireAuth()) return;
    setLater((prev) => [{ id: uid(), savedAt: Date.now(), ...item }, ...prev]);
    toast(t("Saved to For later"));
  }
  function removeLater(id: string) {
    setLater((prev) => prev.filter((w) => w.id !== id));
  }
  // Settle a trade against the binder: look up the card received and add it,
  // then remove the card(s) given away (best-effort token match). Shared by the
  // "Do trade" button (when you own what you're giving) and the "For later"
  // lander. Returns true on success. Counts as a completed trade.
  async function settleTrade(target: string, give: string[]): Promise<boolean> {
    if (!requireAuth()) return false;
    let r: ScanResult;
    try {
      r = await searchCardCached(target, aiSettings);
    } catch (e) {
      toast(isRateLimit(e) ? t("Too busy right now — try again in a minute") : t("Couldn't look that up — try again"));
      return false;
    }
    setSaved((prev) => {
      const list = prev.slice();
      for (const g of give) {
        const tokens = g.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 2);
        let bestIdx = -1, bestScore = 0;
        list.forEach((c, i) => {
          const desc = describeCard(c.result).toLowerCase();
          const score = tokens.filter((tk) => desc.includes(tk)).length;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        });
        if (bestIdx >= 0 && bestScore >= 2) list.splice(bestIdx, 1);
      }
      return list;
    });
    saveCard(r, undefined);
    setTrades((n) => n + 1);
    return true;
  }

  // "Do trade" from the trade tool: you own what you're giving, so log it now —
  // add what you receive, drop what you gave, and jump to the binder.
  async function doTrade(target: string, give: string[]) {
    const ok = await settleTrade(target, give);
    if (ok) setView("binder");
  }

  // Land a saved item: add the card you got to the binder and remove the
  // originals you traded away (best-effort match).
  async function laterToBinder(item: LaterItem) {
    if (!confirm(`${t("Add to your binder?")} "${item.target}" ${t("will be added, and the cards you traded away removed.")}`)) return;
    const give = item.give && item.give.length ? item.give : item.steps?.[0]?.giveUp || [];
    const ok = await settleTrade(item.target, give);
    if (ok) {
      removeLater(item.id);
      setView("binder");
    }
  }

  function wishToBinder(item: WishItem) {
    if (!requireAuth()) return;
    if (!item.result) return;
    saveCard(item.result, undefined);
    setWishlist((prev) => prev.filter((w) => w.id !== item.id));
    setView("binder");
  }

  async function addWish(text: string) {
    if (!requireAuth()) return;
    const id = uid();
    setWishlist((prev) => [{ id, addedAt: Date.now(), text }, ...prev]);
    setAdding(true);
    try {
      const r = await searchCardCached(text, aiSettings);
      setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
    } catch {
      /* leave as text-only; user can retry via refresh */
    } finally {
      setAdding(false);
    }
  }

  // Add several text descriptions to the wishlist at once (e.g. all of a card's
  // recommended trade targets). Items appear instantly; prices fill in parallel.
  async function addWishMany(texts: string[]) {
    if (!requireAuth()) return;
    const clean = texts.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const items = clean.map((text) => ({ id: uid(), addedAt: Date.now(), text }));
    setWishlist((prev) => [...items, ...prev]);
    toast(`${clean.length} ${t("added to wishlist")}`);
    await Promise.all(items.map(async (item) => {
      try {
        const r = await searchCardCached(item.text, aiSettings);
        setWishlist((prev) => prev.map((w) => (w.id === item.id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
      } catch {
        /* leave text-only; daily refresh will price it */
      }
    }));
  }

  // Add cards we already have full results for (e.g. bulk-detected cards) — no
  // lookup needed since the value is already known.
  function addWishResults(results: ScanResult[]) {
    if (!requireAuth()) return;
    if (results.length === 0) return;
    const items = results.map((result) => ({
      id: uid(),
      addedAt: Date.now(),
      text: describeCard(result),
      result,
      lastRefreshedAt: Date.now(),
    }));
    setWishlist((prev) => [...items, ...prev]);
    toast(`${results.length} ${t("added to wishlist")}`);
  }

  // Refresh saved + wishlist prices. force=true ignores the 24h freshness check
  // and refreshes everything. Runs several at once (no artificial gaps) so a
  // refresh is quick; auto runs cap the count so they don't burn quota.
  const AUTO_CAP = 5; // at most a few per auto run; the rest catch up later
  // Refresh is now mostly cheap live-price lookups rather than AI calls, so more
  // can run at once without tripping rate limits.
  const REFRESH_CONCURRENCY = 8;

  async function refreshAll(force: boolean) {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const stale = (t?: number) => force || !t || Date.now() - t > DAY_MS;
    const movers: string[] = [];

    async function refreshCard(card: SavedCard) {
      // Fast path: the card is already identified, so just re-price it from live
      // market data. Only fall back to a full AI lookup when there's no live
      // price to be had — that's what used to make this take minutes.
      let fresh = card.result;
      const quick = await quickPrice(card.result, aiSettings).catch(() => ({ estimatedValue: null }));
      if (quick.estimatedValue) fresh = { ...card.result, estimatedValue: quick.estimatedValue };
      else fresh = await searchCard(describeCard(card.result), aiSettings);
      const prevMid = card.result.estimatedValue.mid;
      const newMid = fresh.estimatedValue.mid;
      const at = Date.now();
      const changeFrac = prevMid > 0 ? Math.abs(newMid - prevMid) / prevMid : 1;
      if (changeFrac < 0.1) {
        // The model's estimate wobbles run-to-run; a small change is noise, not a
        // real market move. Keep the value steady, just stamp the time.
        setSaved((prev) => prev.map((c) => (c.id === card.id ? { ...c, lastRefreshedAt: at } : c)));
      } else {
        if (changeFrac >= 0.15) movers.push(`${card.result.player || "A card"} ${newMid >= prevMid ? "▲" : "▼"}`);
        setSaved((prev) =>
          prev.map((c) =>
            c.id === card.id
              ? {
                ...c,
                previousMid: c.result.estimatedValue.mid,
                result: fresh,
                lastRefreshedAt: at,
                history: [...(c.history || [{ t: c.savedAt, mid: c.result.estimatedValue.mid }]), { t: at, mid: newMid }].slice(-60),
              }
              : c
          )
        );
      }
    }

    async function refreshWish(w: WishItem) {
      const fresh = await searchCard(w.result ? describeCard(w.result) : w.text, aiSettings);
      const prevMid = w.result?.estimatedValue.mid ?? 0;
      const changeFrac = prevMid > 0 ? Math.abs(fresh.estimatedValue.mid - prevMid) / prevMid : 1;
      if (w.result && changeFrac < 0.1) {
        setWishlist((prev) => prev.map((x) => (x.id === w.id ? { ...x, lastRefreshedAt: Date.now() } : x)));
      } else {
        setWishlist((prev) =>
          prev.map((x) =>
            x.id === w.id
              ? { ...x, previousMid: x.result ? x.result.estimatedValue.mid : null, result: fresh, lastRefreshedAt: Date.now() }
              : x
          )
        );
      }
    }

    const jobs: (() => Promise<void>)[] = [
      ...saved.filter((c) => stale(c.lastRefreshedAt)).map((c) => () => refreshCard(c)),
      ...wishlist.filter((w) => stale(w.lastRefreshedAt)).map((w) => () => refreshWish(w)),
    ];
    const work = force ? jobs : jobs.slice(0, AUTO_CAP);

    try {
      let idx = 0;
      let stop = false;
      let done = 0;
      if (force && work.length) setRefreshProgress({ done: 0, total: work.length });
      const worker = async () => {
        while (idx < work.length && !stop) {
          const job = work[idx++];
          try {
            await job();
          } catch (e) {
            if (isRateLimit(e)) stop = true; // back off; catch up next load/manual
          } finally {
            done++;
            if (force) setRefreshProgress({ done, total: work.length });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, work.length) }, worker));
      if (movers.length > 0) {
        toast(`📈 ${movers.length} card${movers.length > 1 ? "s" : ""} moved 15%+: ${movers.slice(0, 3).join(", ")}`);
      }
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }

  // Auto price-refresh: at most once an hour per device, only if enabled, and
  // only for items older than 24h. Stamp the time first so reloads don't re-burst.
  useEffect(() => {
    if (settings.autoRefresh === false) return;
    const last = Number(localStorage.getItem(AUTO_REFRESH_KEY) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return;
    localStorage.setItem(AUTO_REFRESH_KEY, String(Date.now()));
    refreshAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-generate the morning briefing for EVERY day from launch through today,
  // in the background on app load, so they're all there and ready (today first,
  // then back-fill the rest). Generation is de-duplicated with the Today view
  // and cached immutably, so missing days are made once. Runs once per load.
  const digestPrefetched = useRef(false);
  useEffect(() => {
    if (digestPrefetched.current) return;
    if (settings.morningUpdate === false) return;
    digestPrefetched.current = true;
    const LAUNCH = "2026-06-19";
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const today = fmt(new Date());
    // Build the list today → launch (newest first), then generate sequentially
    // so a back-fill doesn't fire a burst of calls at once.
    const days: string[] = [];
    for (let d = new Date(); fmt(d) >= LAUNCH; d.setDate(d.getDate() - 1)) days.push(fmt(d));
    (async () => {
      for (const day of days) {
        if (day < LAUNCH || day > today) continue;
        try {
          await ensureDigest(DIGEST_KEY, day, settings.digestSports, digestPlayers, digestWishlist, aiSettings);
        } catch { /* keep going; missing days retry next load */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the app stays open across midnight, generate the new day's briefing in the
  // background right at 12:00 AM so it's waiting when you next look.
  useEffect(() => {
    if (settings.morningUpdate === false) return;
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 30);
    const ms = nextMidnight.getTime() - now.getTime();
    const id = setTimeout(() => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      ensureDigest(DIGEST_KEY, today, settings.digestSports, digestPlayers, digestWishlist, aiSettings);
    }, ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.morningUpdate, settings.digestSports, digestPlayers, digestWishlist]);

  const navBtn = (v: View, label: ReactNode) => (
    <button className={view === v ? "active" : ""} onClick={() => { setView(v); setSidebarOpen(false); }}>{label}</button>
  );

  return (
    <div className={`shell ${sidebarOpen ? "nav-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo size={30} />
          <h1>Card-O-Rama</h1>
        </div>
        <nav className="side-nav">
          {navBtn("home", <>🏠 {t("Home")}</>)}
          {navBtn("today", <>☀️ {t("Today")}</>)}
          <div className="side-group">{t("Identify")}</div>
          {navBtn("scan", t("Scan"))}
          {navBtn("search", t("Search"))}
          {isMobile() && navBtn("bulk", t("Bulk"))}
          <div className="side-group">{t("Trade")}</div>
          {navBtn("trade", t("Check trade"))}
          {navBtn("tradeup", <>📈 {t("Trade-Up")}</>)}
          {navBtn("market", <>🛒 {t("Trade")}{incomingPending > 0 ? ` 🔴 ${incomingPending}` : ""}</>)}
          {navBtn("later", <>🔖 {t("For later")}</>)}
          <div className="side-group">{t("Collection")}</div>
          {navBtn("binder", <>{t("Binder")}{saved.length > 0 ? ` (${saved.length})` : ""}</>)}
          {navBtn("wishlist", <>{t("Wishlist")}{wishlist.length > 0 ? ` (${wishlist.length})` : ""}</>)}
          {navBtn("sets", <>🗂️ {t("Sets")}</>)}
          {navBtn("awards", <>🏆 {t("Awards")}</>)}
          <div className="side-group">{t("More")}</div>
          {navBtn("settings", t("Settings"))}
        </nav>
        <div className="sidebar-foot">
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="user-menu">
            {isGuest ? (
              <button className="btn small" onClick={onRequestLogin} style={{ width: "100%" }}>
                👤 {t("Log in / Sign up")}
              </button>
            ) : (
              <>
                <span className="user-chip" title={userName}>
                  <span className="user-avatar">
                    {/^(data:|https?:)/.test(settings.avatar || "")
                      ? <img src={settings.avatar} alt="" />
                      : settings.avatar
                        ? settings.avatar
                        : userName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="user-name">{userName}</span>
                </span>
                <button className="btn ghost small" onClick={() => { setView("home"); onLogout(); }}>{t("Log out")}</button>
              </>
            )}
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

      <div className="content">
        <div className="mobile-bar">
          <button className="hamburger" onClick={() => setSidebarOpen(true)} aria-label="Menu">☰</button>
          <div className="brand"><Logo size={26} /><h1>Card-O-Rama</h1></div>
        </div>

      {view === "home" && (
        <>
          {/* Value-over-time sits above the fold once you actually own cards. */}
          {!isGuest && saved.length > 0 && <PortfolioChart saved={saved} currency={settings.currency} since={user ? createdAtOf(user) : null} log={valueLog} />}
          <HomeView
            saved={saved}
            wishlist={wishlist}
            scans={scans}
            currency={settings.currency}
            onGo={(v) => setView(v)}
            streak={liveStreak(streak, dayISO())}
            quests={questState ? questProgress(questState, questCounters) : []}
            isGuest={isGuest}
            onLogin={onRequestLogin}
          />
        </>
      )}
      {view === "today" && (
        <DigestView settings={aiSettings} players={digestPlayers} wishlist={digestWishlist} cacheKey={DIGEST_KEY} collected={collectedCategories} />
      )}
      {view === "scan" && (
        <ErrorBoundary>
          <ScanView settings={aiSettings} result={scan} onResult={(r) => { setScan(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} onWishResult={(r) => addWishResults([r])} />
        </ErrorBoundary>
      )}
      {view === "search" && (
        <ErrorBoundary>
          <SearchView settings={aiSettings} result={search} onResult={(r) => { setSearch(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} onWishResult={(r) => addWishResults([r])} />
        </ErrorBoundary>
      )}
      {view === "bulk" && (isMobile() ? (
        <BulkView settings={aiSettings} onSave={(r, d) => saveCard(r, d, true)} onWish={addWishResults} />
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "36px 22px" }}>
          <div style={{ fontSize: 40 }}>📱</div>
          <h2 style={{ margin: "8px 0 6px" }}>{t("Bulk scan is a phone feature")}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t("Snapping a tray of cards works far better with your phone's camera. Open Card-O-Rama on your phone to bulk scan — or use single Scan here.")}
          </p>
          <button className="btn" style={{ marginTop: 6 }} onClick={() => setView("scan")}>📷 {t("Go to Scan")}</button>
        </div>
      ))}
      {view === "trade" && (
        <TradeView
          settings={aiSettings}
          saved={saved}
          wishlist={wishlist}
          onTrade={() => setTrades((n) => n + 1)}
          onWishAll={addWishMany}
          onSaveLater={saveLater}
          onDoTrade={doTrade}
          senderName={userName}
          onRequireLogin={isGuest ? onRequestLogin : undefined}
          offersKey={`card-scanner-sent-offers:${ns}`}
        />
      )}
      {view === "tradeup" && (isGuest ? (
        <GuestGate feature="Plan a path of fair trades from cards you own toward a grail card." onLogin={onRequestLogin} />
      ) : (
        <TradeUpView
          settings={aiSettings}
          saved={saved}
          onSaveLater={(target, result) => saveLater({ target, give: result.steps[0]?.giveUp || [], steps: result.steps })}
        />
      ))}
      {view === "market" && (
        <ErrorBoundary>
          <MarketView
            saved={saved}
            settings={aiSettings}
            cloudOn={cloudActive()}
            isGuest={isGuest}
            onRequireLogin={onRequestLogin}
            onTradeEvent={recordTrade}
            myWishlist={digestWishlist}
          />
        </ErrorBoundary>
      )}
      {view === "later" && (isGuest ? (
        <GuestGate feature="Save trades and cards to come back to later." onLogin={onRequestLogin} />
      ) : (
        <LaterView later={later} onRemove={removeLater} onAddToBinder={laterToBinder} />
      ))}
      {view === "binder" && (isGuest ? (
        <GuestGate feature="Keep a binder of your cards that re-prices itself and tracks value over time." onLogin={onRequestLogin} />
      ) : (
        <BinderView
          saved={saved}
          onRemove={(id) => setSaved((prev) => prev.filter((c) => c.id !== id))}
          onClear={() => { if (confirm(t("Remove all saved cards from your binder?"))) setSaved([]); }}
          onRefresh={() => refreshAll(true)}
          refreshing={refreshing}
          progress={refreshProgress}
          onConditionCheck={checkCondition}
          onSetPhoto={setCardPhoto}
          onToggleFlag={toggleFlag}
          onReorder={reorderCards}
          onEdit={editSavedCard}
          onGrade={setCardGrade}
          shareName={isGuest ? undefined : userName}
          mode={settings.binderMode || "list"}
          onModeChange={(m) => setSettings((s) => ({ ...s, binderMode: m }))}
        />
      ))}
      {view === "wishlist" && (isGuest ? (
        <GuestGate feature="Build a wishlist of cards you want, priced and tracked for you." onLogin={onRequestLogin} />
      ) : (
        <WishlistView
          wishlist={wishlist}
          onAdd={addWish}
          onRemove={(id) => setWishlist((prev) => prev.filter((w) => w.id !== id))}
          onAddToBinder={wishToBinder}
          onEdit={editWish}
          onRefresh={() => refreshAll(true)}
          refreshing={refreshing}
          adding={adding}
        />
      ))}
      {view === "sets" && (isGuest ? (
        <GuestGate feature="Track set completion across your binder and earn badges." onLogin={onRequestLogin} />
      ) : (
        <SetsView saved={saved} settings={aiSettings} onWish={addWishMany} onSetPct={reportSetPct} />
      ))}
      {view === "awards" && (isGuest ? (
        <GuestGate feature="Earn achievements as your collection grows." onLogin={onRequestLogin} />
      ) : (
        <AwardsView saved={saved} wishlist={wishlist} scans={scans} trades={trades} lang={settings.language} bestSetPct={bestSetPct} streakDays={streak?.best || 0} questMaster={questMaster} tradeCounters={tradeCounters} unlocked={unlockedIds} />
      ))}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onChange={setSettings}
          onDeleteAccount={() => { if (!requireAuth()) return; onDeleteAccount(); }}
          onExportData={exportMyData}
          onSignOutAll={async () => {
            if (!requireAuth()) return;
            try { await cloudSignOutAll(); } catch { /* fall through to a local logout */ }
            onLogout();
          }}
          onRename={async (name) => { if (!user) { onRequestLogin(); return; } await setDisplayName(user, name); setNameTick((n) => n + 1); }}
          email={(user && emailOf(user)) || undefined}
          displayName={userName}
        />
      )}
      {/* AdSense policy: ads may only appear alongside real publisher content —
          never on functional screens (settings, awards), empty states, or
          screens still loading. Gate the ad to content-rich views only. */}
      {(view === "today" ||
        (view === "scan" && !!scan) ||
        (view === "search" && !!search) ||
        (view === "binder" && saved.length >= 3) ||
        (view === "sets" && saved.length >= 3)) && <AdSlot className="ad-bottom" />}
      </div>

      <button className="chat-fab" onClick={() => setChatOpen(true)}>💬 {t("Ask a question")}</button>

      {chatOpen && (
        <ChatDrawer
          settings={aiSettings}
          cardContext={lastResult}
          onClose={() => setChatOpen(false)}
          context={assistantContext()}
          onAction={runAssistantAction}
        />
      )}

      {needsOnboarding && <Onboarding settings={settings} onDone={finishOnboarding} />}

      {answeredOut.length > 0 && (
        <div className="backdrop" onClick={ackResponses}>
          <div className="card login-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <button className="modal-x" aria-label={t("Close")} onClick={ackResponses}>✕</button>
            <div style={{ fontSize: 44 }}>{answeredOut.some((r) => r.status === "accepted") ? "🤝" : answeredOut.some((r) => r.status === "countered") ? "🔄" : "✕"}</div>
            <h2 style={{ margin: "8px 0 6px" }}>{t("Trade update")}</h2>
            {answeredOut.map((r) => (
              <p key={r.id} style={{ margin: "4px 0" }}>
                <strong>{r.who}</strong>{" "}
                {r.status === "accepted"
                  ? t("accepted your trade — the cards have been swapped into your binder!")
                  : r.status === "countered"
                    ? t("sent a counter-offer — open Trades to see their new offer.")
                    : t("declined your trade.")}
              </p>
            ))}
            <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={() => { setView("market"); ackResponses(); }}>
              {t("Go to Trades")}
            </button>
          </div>
        </div>
      )}

      {celebrate && (
        <>
          <Confetti onDone={() => setCelebrate(null)} />
          <div className="rare-banner">
            <div className="rare-title">🎉 {celebrate.title}</div>
            <div className="rare-sub">{celebrate.sub}</div>
          </div>
        </>
      )}

      <div className="toasts">
        {toasts.map((t) => <div className="toast" key={t.id}>{t.msg}</div>)}
      </div>

      <div className="unlock-stack">
        {unlocks.map((u) => (
          <div className="unlock-banner" key={u.id}>
            <div className="unlock-emoji">{u.emoji}</div>
            <div className="unlock-text">
              <div className="unlock-label">🏆 {t("Achievement unlocked")}</div>
              <div className="unlock-title">{t(u.title)}</div>
              <div className="unlock-desc">{t(u.desc)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A trade-offer link (/offer/<id>) renders the public offer page — before any
// auth gate, because the recipient may not have an account. The path is fixed
// for the life of the page load, so this is computed once at module level.
const OFFER_PATH_ID = /^\/offer\/([A-Za-z0-9_-]{6,})$/.exec(window.location.pathname)?.[1] || null;

export default function App() {
  // Resume the saved session on load so a reload / reopen on the same device
  // stays signed in (no forced re-login).
  const [user, setUser] = useState<string | null>(() => currentUser());
  const [showAuth, setShowAuth] = useState(false);
  // Entry welcome modal: shown once per browser session for guests.
  const [showLoginModal, setShowLoginModal] = useState(() => {
    try { return sessionStorage.getItem("card-scanner-welcomed") !== "1"; } catch { return true; }
  });
  const dismissWelcome = () => {
    setShowLoginModal(false);
    try { sessionStorage.setItem("card-scanner-welcomed", "1"); } catch { /* ignore */ }
  };
  // Bumped whenever a cloud pull/merge changes localStorage, to remount MainApp
  // so it re-reads the freshly-synced collection from storage.
  const [syncTick, setSyncTick] = useState(0);

  // Keep the saved session (resumed above) — a reload shouldn't log you out.
  useEffect(() => {
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  // Cross-device sync: pull the latest server copy on sign-in, whenever the tab
  // regains focus, and when a background merge announces fresh data. Remounts
  // MainApp (via syncTick) only when something actually changed. No-op for
  // device-local accounts.
  useEffect(() => {
    if (!user || !cloudActive()) return;
    let cancelled = false;
    const sync = async () => {
      const changed = await cloudPull(cloudUserKey());
      if (changed && !cancelled) setSyncTick((n) => n + 1);
    };
    const onVisible = () => { if (!document.hidden) void sync(); };
    const onMerged = () => { if (!cancelled) setSyncTick((n) => n + 1); };
    void sync();
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("cloud-synced", onMerged);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("cloud-synced", onMerged);
    };
  }, [user]);

  if (OFFER_PATH_ID) {
    return <OfferView id={OFFER_PATH_ID} />;
  }

  // Guest mode: the main screens are open without an account — scanning,
  // searching, the briefing, trades. The auth screen appears only when the
  // visitor tries to SAVE something (binder, wishlist, for-later …) or taps
  // "Log in". Public screens also give crawlers real content to index.
  if (showAuth && !user) {
    return (
      <AuthScreen
        onAuthed={() => { setUser(currentUser()); setShowAuth(false); }}
        onBack={() => setShowAuth(false)}
      />
    );
  }

  // key fully remounts MainApp on account switch OR after a sync changed
  // storage, so all per-user state re-initializes from namespaced storage.
  return (
    <>
      <MainApp
        key={`${user ?? "guest"}#${syncTick}`}
        user={user}
        onRequestLogin={() => { dismissWelcome(); setShowAuth(true); }}
        onLogout={() => {
          logout();
          setUser(null);
          setShowAuth(true); // land on the login screen after logging out
        }}
        onDeleteAccount={() => {
          if (user) deleteAccount(user);
          setUser(null);
        }}
      />
      {showLoginModal && !user && (
        <LoginModal
          onLogin={() => { dismissWelcome(); setShowAuth(true); }}
          onGuest={dismissWelcome}
        />
      )}
    </>
  );
}
