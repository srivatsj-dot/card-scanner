import { useEffect, useRef, useState } from "react";
import type { ScanResult, Settings, SavedCard, WishItem, Theme } from "./types";
import { defaultSettings } from "./types";
import { searchCard } from "./api";
import { describeCard, sleep, DAY_MS } from "./utils";
import ScanView from "./components/ScanView";
import SearchView from "./components/SearchView";
import TradeView from "./components/TradeView";
import SettingsView from "./components/SettingsView";
import BinderView from "./components/BinderView";
import WishlistView from "./components/WishlistView";
import ChatDrawer from "./components/ChatDrawer";

type View = "scan" | "search" | "trade" | "binder" | "wishlist" | "settings";

const SETTINGS_KEY = "card-scanner-settings";
const BINDER_KEY = "card-scanner-binder";
const WISHLIST_KEY = "card-scanner-wishlist";
const THEME_KEY = "card-scanner-theme";

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

export default function App() {
  const [view, setView] = useState<View>("scan");
  const [settings, setSettings] = useState<Settings>(() => ({
    ...defaultSettings,
    ...loadJSON<Partial<Settings>>(SETTINGS_KEY, {}),
  }));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [search, setSearch] = useState<ScanResult | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [saved, setSaved] = useState<SavedCard[]>(() => loadJSON<SavedCard[]>(BINDER_KEY, []));
  const [wishlist, setWishlist] = useState<WishItem[]>(() => loadJSON<WishItem[]>(WISHLIST_KEY, []));
  const [theme, setTheme] = useState<Theme>(() => loadJSON<Theme>(THEME_KEY, "dark"));
  const [chatOpen, setChatOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const refreshingRef = useRef(false);

  useEffect(() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);
  useEffect(() => { localStorage.setItem(BINDER_KEY, JSON.stringify(saved)); }, [saved]);
  useEffect(() => { localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist)); }, [wishlist]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);

  function saveCard(result: ScanResult, frontDataUrl: string | undefined) {
    setSaved((prev) => [
      { id: uid(), savedAt: Date.now(), thumbnail: frontDataUrl || "", result, lastRefreshedAt: Date.now(), previousMid: null },
      ...prev,
    ]);
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
      const r = await searchCard(text, settings);
      setWishlist((prev) => prev.map((w) => (w.id === id ? { ...w, result: r, lastRefreshedAt: Date.now() } : w)));
    } catch {
      /* leave as text-only; user can retry via refresh */
    } finally {
      setAdding(false);
    }
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
    try {
      for (const card of saved) {
        if (budget <= 0) break;
        if (!stale(card.lastRefreshedAt)) continue;
        budget--;
        try {
          if (!first) await sleep(REFRESH_GAP_MS);
          first = false;
          const fresh = await searchCard(describeCard(card.result), settings);
          setSaved((prev) =>
            prev.map((c) =>
              c.id === card.id
                ? { ...c, previousMid: c.result.estimatedValue.mid, result: fresh, lastRefreshedAt: Date.now() }
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
          const fresh = await searchCard(w.result ? describeCard(w.result) : w.text, settings);
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
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  // Auto price-refresh: at most once an hour per device, only if enabled, and
  // only for items older than 24h. Stamp the time first so reloads don't re-burst.
  useEffect(() => {
    if (settings.autoRefresh === false) return;
    const KEY = "card-scanner-last-auto-refresh";
    const last = Number(localStorage.getItem(KEY) || 0);
    if (Date.now() - last < 60 * 60 * 1000) return;
    localStorage.setItem(KEY, String(Date.now()));
    refreshAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <h1>Card<span className="dot">·</span>Scanner</h1>
          <span className="tag">AI appraiser</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <nav className="nav">
            <button className={view === "scan" ? "active" : ""} onClick={() => setView("scan")}>Scan</button>
            <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>Search</button>
            <button className={view === "trade" ? "active" : ""} onClick={() => setView("trade")}>Trade</button>
            <button className={view === "binder" ? "active" : ""} onClick={() => setView("binder")}>
              Binder{saved.length > 0 ? ` (${saved.length})` : ""}
            </button>
            <button className={view === "wishlist" ? "active" : ""} onClick={() => setView("wishlist")}>
              Wishlist{wishlist.length > 0 ? ` (${wishlist.length})` : ""}
            </button>
            <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
          </nav>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {view === "scan" && (
        <ScanView settings={settings} result={scan} onResult={(r) => { setScan(r); if (r) setLastResult(r); }} onSave={saveCard} />
      )}
      {view === "search" && (
        <SearchView settings={settings} result={search} onResult={(r) => { setSearch(r); if (r) setLastResult(r); }} onSave={saveCard} />
      )}
      {view === "trade" && <TradeView settings={settings} saved={saved} />}
      {view === "binder" && (
        <BinderView
          saved={saved}
          onRemove={(id) => setSaved((prev) => prev.filter((c) => c.id !== id))}
          onClear={() => { if (confirm("Remove all saved cards from your binder?")) setSaved([]); }}
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
      {view === "settings" && <SettingsView settings={settings} onChange={setSettings} />}

      <button className="chat-fab" onClick={() => setChatOpen(true)}>💬 Ask a question</button>

      {chatOpen && (
        <ChatDrawer settings={settings} cardContext={lastResult} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}
