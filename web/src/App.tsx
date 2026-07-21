import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ScanResult, Settings, SavedCard, WishItem, Theme, LaterItem } from "./types";
import { defaultSettings } from "./types";
import { searchCard, scanCard } from "./api";
import { searchCardCached } from "./cache";
import { ensureDigest } from "./digest";
import { describeCard, DAY_MS, makeThumbnail } from "./utils";
import { langByName, detectLanguageName } from "./i18n";
import { useT, setLanguage } from "./translator";
import { computeStats, earnedIds, ACHIEVEMENTS } from "./achievements";
import ScanView from "./components/ScanView";
import SearchView from "./components/SearchView";
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
import { currentUser, displayNameOf, emailOf, logout, deleteAccount, setDisplayName } from "./auth";
import { cloudActive, schedulePush, cloudPull, cloudUserKey, marketOffers } from "./cloud";

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
  const [chatOpen, setChatOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // New accounts get a 3-question setup (language, style, cards) once.
  const ONBOARD_KEY = `card-scanner-onboard:${ns}`;
  const [needsOnboarding, setNeedsOnboarding] = useState(
    () => !isGuest && (() => { try { return localStorage.getItem(ONBOARD_KEY) === "1"; } catch { return false; } })()
  );
  function finishOnboarding(patch: Partial<Settings>) {
    setSettings((s) => ({ ...s, ...patch }));
    if (patch.language) setLanguage(patch.language);
    try { localStorage.removeItem(ONBOARD_KEY); } catch { /* ignore */ }
    setNeedsOnboarding(false);
  }
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

  // Live counters the quests measure against (briefingDays lives in questState).
  const questCounters: QuestCounters = {
    scans, trades, cards: saved.length, wishlist: wishlist.length,
    briefingDays: questState?.briefingDays || 0, bestSetPct,
  };

  // Keep quests on the current week — regenerate from this week's baseline when
  // the week rolls over (or on first run).
  useEffect(() => {
    const week = weekOf(dayISO());
    if (!questState || questState.week !== week) {
      // Personalize from the collector's categories, style, wishlist, and sets.
      const owned = Array.from(new Set(saved.map((s) => (s.result.sport || "").trim()).filter(Boolean)));
      const cats = owned.length ? owned : (settings.sport ? [settings.sport] : settings.digestSports || []);
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
    marketOffers()
      .then((o) => {
        if (cancelled) return;
        setIncomingPending(o.incoming.filter((x) => x.status === "pending").length);
        let seen: string[] = [];
        try { seen = JSON.parse(localStorage.getItem(SEEN_RESP_KEY) || "[]"); } catch { /* ignore */ }
        const seenSet = new Set(seen);
        setAnsweredOut(
          o.outgoing
            .filter((x) => (x.status === "accepted" || x.status === "declined") && !seenSet.has(x.id))
            .map((x) => ({ id: x.id, who: x.toDisplay, status: x.status }))
        );
      })
      .catch(() => {});
    return () => { cancelled = true; };
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
  // Wishlist cards, for the digest's "from your wishlist" section.
  const digestWishlist = useMemo(
    () => Array.from(new Set(wishlist.map((w) => (w.result ? describeCard(w.result) : w.text)).filter(Boolean))),
    [wishlist]
  );
  const [refreshing, setRefreshing] = useState(false);
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
    const ids = earnedIds(computeStats(saved, wishlist, scans, trades, settings.language, bestSetPct, streak?.best || 0));
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
      earnedRef.current = new Set(ids);
      localStorage.setItem(EARNED_KEY, JSON.stringify(ids));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, wishlist, scans, trades, settings.language, bestSetPct, streak]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);
  useEffect(() => {
    // Right-to-left layout for Arabic etc.
    document.documentElement.dir = langByName(settings.language).rtl ? "rtl" : "ltr";
    setLanguage(settings.language);
  }, [settings.language]);

  function saveCard(result: ScanResult, frontDataUrl: string | undefined) {
    if (!requireAuth()) return;
    const now = Date.now();
    setSaved((prev) => [
      {
        id: uid(),
        savedAt: now,
        thumbnail: frontDataUrl || "",
        result,
        lastRefreshedAt: now,
        previousMid: null,
        history: [{ t: now, mid: result.estimatedValue.mid }],
      },
      ...prev,
    ]);
    toast(`${t("Saved to binder")}: ${result.player || t("card")}`);
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
  const REFRESH_CONCURRENCY = 4;

  async function refreshAll(force: boolean) {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const stale = (t?: number) => force || !t || Date.now() - t > DAY_MS;
    const movers: string[] = [];

    async function refreshCard(card: SavedCard) {
      const fresh = await searchCard(describeCard(card.result), aiSettings);
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
      const worker = async () => {
        while (idx < work.length && !stop) {
          const job = work[idx++];
          try {
            await job();
          } catch (e) {
            if (isRateLimit(e)) stop = true; // back off; catch up next load/manual
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
          {navBtn("bulk", t("Bulk"))}
          <div className="side-group">{t("Trade")}</div>
          {navBtn("trade", t("Trade"))}
          {navBtn("tradeup", <>📈 {t("Trade-Up")}</>)}
          {navBtn("market", <>🛒 {t("Marketplace")}{incomingPending > 0 ? ` 🔴 ${incomingPending}` : ""}</>)}
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
                  <span className="user-avatar">{userName.slice(0, 1).toUpperCase()}</span>
                  <span className="user-name">{userName}</span>
                </span>
                <button className="btn ghost small" onClick={onLogout}>{t("Log out")}</button>
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
        <HomeView
          saved={saved}
          wishlist={wishlist}
          scans={scans}
          currency={settings.currency}
          onGo={(v) => setView(v)}
          streak={liveStreak(streak, dayISO())}
          quests={questState ? questProgress(questState, questCounters) : []}
        />
      )}
      {view === "today" && (
        <>
          {answeredOut.length > 0 && (
            <div className="card offer-alert" onClick={() => { setView("market"); ackResponses(); }}>
              {answeredOut.map((r) => (
                <div key={r.id}>
                  {r.status === "accepted" ? "🤝" : "✕"} {r.who}{" "}
                  {r.status === "accepted"
                    ? t("accepted your trade — the cards have been swapped!")
                    : t("declined your trade.")}
                </div>
              ))}
              <span className="link-inline">{t("Open the Marketplace")}</span>
              <button
                className="btn ghost small"
                style={{ marginLeft: 8 }}
                onClick={(e) => { e.stopPropagation(); ackResponses(); }}
              >
                {t("Dismiss")}
              </button>
            </div>
          )}
          <DigestView settings={aiSettings} players={digestPlayers} wishlist={digestWishlist} cacheKey={DIGEST_KEY} />
        </>
      )}
      {view === "scan" && (
        <ScanView settings={aiSettings} result={scan} onResult={(r) => { setScan(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} onWishResult={(r) => addWishResults([r])} />
      )}
      {view === "search" && (
        <SearchView settings={aiSettings} result={search} onResult={(r) => { setSearch(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} onWishResult={(r) => addWishResults([r])} />
      )}
      {view === "bulk" && <BulkView settings={aiSettings} onSave={saveCard} onWish={addWishResults} />}
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
        <MarketView
          saved={saved}
          settings={aiSettings}
          cloudOn={cloudActive()}
          isGuest={isGuest}
          onRequireLogin={onRequestLogin}
        />
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
          onConditionCheck={checkCondition}
          onSetPhoto={setCardPhoto}
          onToggleFlag={toggleFlag}
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
        <AwardsView saved={saved} wishlist={wishlist} scans={scans} trades={trades} lang={settings.language} bestSetPct={bestSetPct} streakDays={streak?.best || 0} />
      ))}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          onChange={setSettings}
          onDeleteAccount={() => { if (!requireAuth()) return; onDeleteAccount(); }}
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
        <ChatDrawer settings={aiSettings} cardContext={lastResult} onClose={() => setChatOpen(false)} />
      )}

      {needsOnboarding && <Onboarding settings={settings} onDone={finishOnboarding} />}

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
  const [user, setUser] = useState<string | null>(null);
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

  // Don't auto-resume a saved session: everyone starts as a guest (main
  // screens open, saving prompts login) and signs in deliberately.
  useEffect(() => {
    logout();
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
