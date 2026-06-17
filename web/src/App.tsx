import { useEffect, useState } from "react";
import type { ScanResult, Settings } from "./types";
import { defaultSettings } from "./types";
import ScanView from "./components/ScanView";
import TradeView from "./components/TradeView";
import SettingsView from "./components/SettingsView";
import ChatDrawer from "./components/ChatDrawer";

type View = "scan" | "trade" | "settings";

const STORAGE_KEY = "card-scanner-settings";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultSettings;
}

export default function App() {
  const [view, setView] = useState<View>("scan");
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <h1>Card<span className="dot">·</span>Scanner</h1>
          <span className="tag">AI appraiser</span>
        </div>
        <nav className="nav">
          <button className={view === "scan" ? "active" : ""} onClick={() => setView("scan")}>
            Scan
          </button>
          <button className={view === "trade" ? "active" : ""} onClick={() => setView("trade")}>
            Trade check
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
      </div>

      {view === "scan" && <ScanView settings={settings} result={scan} onResult={setScan} />}
      {view === "trade" && <TradeView settings={settings} />}
      {view === "settings" && <SettingsView settings={settings} onChange={setSettings} />}

      <button className="chat-fab" onClick={() => setChatOpen(true)}>
        💬 Ask a question
      </button>

      {chatOpen && (
        <ChatDrawer settings={settings} cardContext={scan} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}
