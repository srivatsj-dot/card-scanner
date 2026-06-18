import { useEffect, useState } from "react";
import type { ScanResult, Settings, SavedCard, Theme } from "./types";
import { defaultSettings } from "./types";
import ScanView from "./components/ScanView";
import TradeView from "./components/TradeView";
import SettingsView from "./components/SettingsView";
import BinderView from "./components/BinderView";
import ChatDrawer from "./components/ChatDrawer";

type View = "scan" | "trade" | "binder" | "settings";

const SETTINGS_KEY = "card-scanner-settings";
const BINDER_KEY = "card-scanner-binder";
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

export default function App() {
  const [view, setView] = useState<View>("scan");
  const [settings, setSettings] = useState<Settings>(() => ({
    ...defaultSettings,
    ...loadJSON<Partial<Settings>>(SETTINGS_KEY, {}),
  }));
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [saved, setSaved] = useState<SavedCard[]>(() => loadJSON<SavedCard[]>(BINDER_KEY, []));
  const [theme, setTheme] = useState<Theme>(() => (loadJSON<Theme>(THEME_KEY, "dark")));
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(BINDER_KEY, JSON.stringify(saved));
  }, [saved]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);

  function saveCard(result: ScanResult, frontDataUrl: string | undefined) {
    const card: SavedCard = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: Date.now(),
      thumbnail: frontDataUrl || "",
      result,
    };
    setSaved((prev) => [card, ...prev]);
  }

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
            <button className={view === "trade" ? "active" : ""} onClick={() => setView("trade")}>Trade</button>
            <button className={view === "binder" ? "active" : ""} onClick={() => setView("binder")}>
              Binder{saved.length > 0 ? ` (${saved.length})` : ""}
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
        <ScanView settings={settings} result={scan} onResult={setScan} onSave={saveCard} />
      )}
      {view === "trade" && <TradeView settings={settings} />}
      {view === "binder" && (
        <BinderView
          saved={saved}
          onRemove={(id) => setSaved((prev) => prev.filter((c) => c.id !== id))}
          onClear={() => {
            if (confirm("Remove all saved cards from your binder?")) setSaved([]);
          }}
        />
      )}
      {view === "settings" && <SettingsView settings={settings} onChange={setSettings} />}

      <button className="chat-fab" onClick={() => setChatOpen(true)}>💬 Ask a question</button>

      {chatOpen && (
        <ChatDrawer settings={settings} cardContext={scan} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}
