import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanResult, Settings, SavedCard, WishItem, Theme } from "./types";
import { defaultSettings } from "./types";
import { searchCard } from "./api";
import { describeCard, sleep, DAY_MS } from "./utils";
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
import AwardsView from "./components/AwardsView";
import ChatDrawer from "./components/ChatDrawer";
import AuthScreen from "./components/AuthScreen";
import Logo from "./components/Logo";
import { currentUser, displayNameOf, logout } from "./auth";

type View = "scan" | "search" | "bulk" | "trade" | "binder" | "wishlist" | "awards" | "settings";

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
  String(e instanceof Error ? e.message : e).toLowerCase().includes("rate limit");

function MainApp({ user, onLogout }: { user: string; onLogout: () => void }) {
  // All persisted state is namespaced per account, so each user has their own
  // binder, wishlist, settings, and progress in the same browser.
  const SETTINGS_KEY = `card-scanner-settings:${user}`;
  const BINDER_KEY = `card-scanner-binder:${user}`;
  const WISHLIST_KEY = `card-scanner-wishlist:${user}`;
  const THEME_KEY = `card-scanner-theme:${user}`;
  const SCANS_KEY = `card-scanner-scans:${user}`;
  const TRADES_KEY = `card-scanner-trades:${user}`;
  const EARNED_KEY = `card-scanner-earned:${user}`;
  const AUTO_REFRESH_KEY = `card-scanner-last-auto-refresh:${user}`;

  const [view, setView] = useState<View>("scan");
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
  const [theme, setTheme] = useState<Theme>(() => loadJSON<Theme>(THEME_KEY, "dark"));
  const [scans, setScans] = useState<number>(() => loadJSON<number>(SCANS_KEY, 0));
  const [trades, setTrades] = useState<number>(() => loadJSON<number>(TRADES_KEY, 0));
  const [chatOpen, setChatOpen] = useState(false);
  const earnedRef = useRef<Set<string>>(
    new Set(
      loadJSON<string[] | null>(EARNED_KEY, null) ??
        earnedIds(
          computeStats(
            loadJSON<SavedCard[]>(BINDER_KEY, []),
            loadJSON<WishItem[]>(WISHLIST_KEY, []),
            loadJSON<number>(SCANS_KEY, 0),
            loadJSON<number>(TRADES_KEY, 0),
            settings.language
          )
        )
    )
  );

  // Settings the AI sees, augmented with the current wishlist (for wishlist-aware
  // trade/recommendation logic). Not persisted into the saved settings.
  const aiSettings = useMemo(
    () => ({
      ...settings,
      wishlist: wishlist.map((w) => (w.result ? describeCard(w.result) : w.text)).filter(Boolean),
    }),
    [settings, wishlist]
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

  function exportData() {
    const data = { version: 1, exportedAt: Date.now(), settings, saved, wishlist };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-scanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(t("Backup downloaded"));
  }

  function importData(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result as string);
        if (d.settings) setSettings({ ...defaultSettings, ...d.settings });
        if (Array.isArray(d.saved)) setSaved(d.saved);
        if (Array.isArray(d.wishlist)) setWishlist(d.wishlist);
        toast(t("Data imported"));
      } catch {
        toast(t("Couldn't read that backup file"));
      }
    };
    reader.readAsText(file);
  }

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(BINDER_KEY, JSON.stringify(saved)); }, [saved]);
  useEffect(() => { localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist)); }, [wishlist]);
  useEffect(() => { localStorage.setItem(SCANS_KEY, JSON.stringify(scans)); }, [scans]);
  useEffect(() => { localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); }, [trades]);
  // Unlock-achievement toasts.
  useEffect(() => {
    const ids = earnedIds(computeStats(saved, wishlist, scans, trades, settings.language));
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
  }, [saved, wishlist, scans, trades, settings.language]);
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

  function wishToBinder(item: WishItem) {
    if (!item.result) return;
    saveCard(item.result, undefined);
    setWishlist((prev) => prev.filter((w) => w.id !== item.id));
    setView("binder");
  }

  async function addWish(text: string) {
    const id = uid();
    setWishlist((prev) => [{ id, addedAt: Date.now(), text }, ...prev]);
    setAdding(true);
    try {
      const r = await searchCard(text, aiSettings);
      setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
    } catch {
      /* leave as text-only; user can retry via refresh */
    } finally {
      setAdding(false);
    }
  }

  // Add several text descriptions to the wishlist at once (e.g. all of a card's
  // recommended trade targets). Items appear instantly; prices fill in gently so
  // we don't burst the rate limit.
  async function addWishMany(texts: string[]) {
    const clean = texts.map((s) => s.trim()).filter(Boolean);
    if (clean.length === 0) return;
    const items = clean.map((text) => ({ id: uid(), addedAt: Date.now(), text }));
    setWishlist((prev) => [...items, ...prev]);
    toast(`${clean.length} ${t("added to wishlist")}`);
    for (const item of items) {
      try {
        const r = await searchCard(item.text, aiSettings);
        setWishlist((prev) => prev.map((w) => (w.id === item.id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
        await sleep(800);
      } catch {
        /* leave text-only; daily refresh will price it */
      }
    }
  }

  // Add cards we already have full results for (e.g. bulk-detected cards) — no
  // lookup needed since the value is already known.
  function addWishResults(results: ScanResult[]) {
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
  // and refreshes everything. Auto runs are gentle: capped count, spaced out, so
  // they don't burn the free-tier quota that foreground scans need.
  const REFRESH_GAP_MS = 6000; // ~10/min — under the flash free-tier limit
  const AUTO_CAP = 5; // at most a few per auto run; the rest catch up later

  async function refreshAll(force: boolean) {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const stale = (t?: number) => force || !t || Date.now() - t > DAY_MS;
    let budget = force ? Infinity : AUTO_CAP;
    let first = true;
    const movers: string[] = [];
    try {
      for (const card of saved) {
        if (budget <= 0) break;
        if (!stale(card.lastRefreshedAt)) continue;
        budget--;
        try {
          if (!first) await sleep(REFRESH_GAP_MS);
          first = false;
          const fresh = await searchCard(describeCard(card.result), aiSettings);
          const prevMid = card.result.estimatedValue.mid;
          const newMid = fresh.estimatedValue.mid;
          if (prevMid > 0 && Math.abs(newMid - prevMid) / prevMid >= 0.15) {
            movers.push(`${card.result.player || "A card"} ${newMid >= prevMid ? "▲" : "▼"}`);
          }
          const at = Date.now();
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
        } catch (e) {
          if (isRateLimit(e)) return; // back off; catch up next load/manual
        }
      }
      for (const w of wishlist) {
        if (budget <= 0) break;
        if (!stale(w.lastRefreshedAt)) continue;
        budget--;
        try {
          if (!first) await sleep(REFRESH_GAP_MS);
          first = false;
          const fresh = await searchCard(w.result ? describeCard(w.result) : w.text, aiSettings);
          setWishlist((prev) =>
            prev.map((x) =>
              x.id === w.id
                ? { ...x, previousMid: x.result ? x.result.estimatedValue.mid : null, result: fresh, lastRefreshedAt: Date.now() }
                : x
            )
          );
        } catch (e) {
          if (isRateLimit(e)) return;
        }
      }
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

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <Logo size={34} />
          <h1>Card-O-Rama</h1>
        </div>
        <div className="topbar-right">
          <nav className="nav">
            <button className={view === "scan" ? "active" : ""} onClick={() => setView("scan")}>{t("Scan")}</button>
            <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>{t("Search")}</button>
            <button className={view === "bulk" ? "active" : ""} onClick={() => setView("bulk")}>{t("Bulk")}</button>
            <button className={view === "trade" ? "active" : ""} onClick={() => setView("trade")}>{t("Trade")}</button>
            <button className={view === "binder" ? "active" : ""} onClick={() => setView("binder")}>
              {t("Binder")}{saved.length > 0 ? ` (${saved.length})` : ""}
            </button>
            <button className={view === "wishlist" ? "active" : ""} onClick={() => setView("wishlist")}>
              {t("Wishlist")}{wishlist.length > 0 ? ` (${wishlist.length})` : ""}
            </button>
            <button className={view === "awards" ? "active" : ""} onClick={() => setView("awards")}>🏆 {t("Awards")}</button>
            <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>{t("Settings")}</button>
          </nav>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <div className="user-menu">
            <span className="user-chip" title={displayNameOf(user)}>
              <span className="user-avatar">{displayNameOf(user).slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{displayNameOf(user)}</span>
            </span>
            <button className="btn ghost small" onClick={onLogout}>{t("Log out")}</button>
          </div>
        </div>
      </div>

      {view === "scan" && (
        <ScanView settings={aiSettings} result={scan} onResult={(r) => { setScan(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} />
      )}
      {view === "search" && (
        <SearchView settings={aiSettings} result={search} onResult={(r) => { setSearch(r); if (r) { setLastResult(r); if (r.identified) setScans((n) => n + 1); } }} onSave={saveCard} onWishAll={addWishMany} />
      )}
      {view === "bulk" && <BulkView settings={aiSettings} onSave={saveCard} onWish={addWishResults} />}
      {view === "trade" && <TradeView settings={aiSettings} saved={saved} onTrade={() => setTrades((n) => n + 1)} onWishAll={addWishMany} />}
      {view === "binder" && (
        <BinderView
          saved={saved}
          onRemove={(id) => setSaved((prev) => prev.filter((c) => c.id !== id))}
          onClear={() => { if (confirm(t("Remove all saved cards from your binder?"))) setSaved([]); }}
          onRefresh={() => refreshAll(true)}
          refreshing={refreshing}
        />
      )}
      {view === "wishlist" && (
        <WishlistView
          wishlist={wishlist}
          onAdd={addWish}
          onRemove={(id) => setWishlist((prev) => prev.filter((w) => w.id !== id))}
          onAddToBinder={wishToBinder}
          onRefresh={() => refreshAll(true)}
          refreshing={refreshing}
          adding={adding}
        />
      )}
      {view === "awards" && <AwardsView saved={saved} wishlist={wishlist} scans={scans} trades={trades} lang={settings.language} />}
      {view === "settings" && (
        <SettingsView settings={settings} onChange={setSettings} onExport={exportData} onImport={importData} />
      )}

      <button className="chat-fab" onClick={() => setChatOpen(true)}>💬 {t("Ask a question")}</button>

      {chatOpen && (
        <ChatDrawer settings={aiSettings} cardContext={lastResult} onClose={() => setChatOpen(false)} />
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

export default function App() {
  const [user, setUser] = useState<string | null>(() => currentUser());

  // Keep a theme on the documentElement even before sign-in (for the auth screen).
  useEffect(() => {
    if (!document.documentElement.dataset.theme) {
      document.documentElement.dataset.theme = "dark";
    }
  }, []);

  if (!user) {
    return <AuthScreen onAuthed={() => setUser(currentUser())} />;
  }

  // key={user} fully remounts MainApp on account switch so all per-user state
  // re-initializes from that account's namespaced storage.
  return (
    <MainApp
      key={user}
      user={user}
      onLogout={() => {
        logout();
        setUser(null);
      }}
    />
  );
}
