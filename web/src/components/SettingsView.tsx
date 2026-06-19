import { useRef } from "react";
import type { Settings } from "../types";
import { CATEGORIES, BLOCKABLE_CATEGORIES } from "../types";
import { LANGS } from "../i18n";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

export default function SettingsView({ settings, onChange, onExport, onImport }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const t = useT();
  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function toggleBlocked(cat: string) {
    const has = settings.blockedCategories.includes(cat);
    set(
      "blockedCategories",
      has ? settings.blockedCategories.filter((c) => c !== cat) : [...settings.blockedCategories, cat]
    );
  }

  return (
    <div className="card">
      <h2>{t("Settings & filters")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        These apply to every scan and trade. They're saved in your browser.
      </p>

      <div className="grid2">
        <label className="field">
          <span>Card category I mostly collect</span>
          <select
            value={settings.sport}
            onChange={(e) => set("sport", e.target.value === "Any" ? "" : e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c === "Any" ? "" : c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Currency</span>
          <select value={settings.currency} onChange={(e) => set("currency", e.target.value)}>
            {["USD", "EUR", "GBP", "CAD", "AUD", "INR", "JPY"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Language (app &amp; results)</span>
        <select value={settings.language} onChange={(e) => set("language", e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.name}>{l.native}</option>
          ))}
        </select>
      </label>

      <div className="grid2">
        <label className="field">
          <span>Min trade value (per card)</span>
          <input
            type="number"
            min={0}
            placeholder="e.g. 150 — blank for none"
            value={settings.minValue ?? ""}
            onChange={(e) => set("minValue", e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>Max trade value (per card)</span>
          <input
            type="number"
            min={0}
            placeholder="blank for none"
            value={settings.maxValue ?? ""}
            onChange={(e) => set("maxValue", e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>
      </div>

      <label className="toggle" style={{ marginTop: 6 }}>
        <input
          type="checkbox"
          checked={settings.liveData}
          onChange={(e) => set("liveData", e.target.checked)}
        />
        Use live web data for current prices &amp; player form
        <span className="muted" style={{ fontSize: 12 }}>
          &nbsp;— turn off if you keep hitting free-tier rate limits (faster, fewer calls)
        </span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.autoRefresh}
          onChange={(e) => set("autoRefresh", e.target.checked)}
        />
        Auto-refresh binder &amp; wishlist prices daily
        <span className="muted" style={{ fontSize: 12 }}>
          &nbsp;— turn off to save quota; you can still refresh manually
        </span>
      </label>

      <label className="field">
        <span>Trade style</span>
        <select
          value={settings.holdHorizon}
          onChange={(e) => set("holdHorizon", e.target.value as Settings["holdHorizon"])}
        >
          <option value="any">No preference</option>
          <option value="flip">Short-term flips (liquid, trending now)</option>
          <option value="long">Long-term holds (blue-chip, stable)</option>
        </select>
      </label>

      <h3 style={{ marginTop: 18 }}>Recommendation rules</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.sameKindOnly}
          onChange={(e) => set("sameKindOnly", e.target.checked)}
        />
        Only suggest cards of the <strong>same kind</strong> as the card (e.g. baseball → baseball)
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.gradedOnly}
          onChange={(e) => set("gradedOnly", e.target.checked)}
        />
        Only suggest graded / slabbed cards (PSA, BGS, SGC, CGC)
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.excludeMinorLeague}
          onChange={(e) => set("excludeMinorLeague", e.target.checked)}
        />
        Don't suggest minor-league players or unproven prospects
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.excludeRookies}
          onChange={(e) => set("excludeRookies", e.target.checked)}
        />
        Skip rookie cards — favor established veterans
      </label>

      <h3 style={{ marginTop: 18 }}>Block card types</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Never recommend cards from the categories you check.
      </p>
      <div className="chips">
        {BLOCKABLE_CATEGORIES.map((c) => {
          const active = settings.blockedCategories.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={`chip ${active ? "blocked" : ""}`}
              onClick={() => toggleBlocked(c)}
            >
              {active ? "🚫 " : ""}{c}
            </button>
          );
        })}
      </div>

      <label className="field" style={{ marginTop: 18 }}>
        <span>Custom instructions</span>
        <textarea
          value={settings.customInstructions}
          placeholder={
            "Anything else for the appraiser. Examples:\n" +
            "• Never recommend Panini or Donruss cards\n" +
            "• Only players on contending teams\n" +
            "• Prefer numbered parallels"
          }
          onChange={(e) => set("customInstructions", e.target.value)}
        />
      </label>

      <p className="muted" style={{ fontSize: 13 }}>
        Tip: block specific brands or set names here in plain English — e.g. “never recommend
        anything from Panini.”
      </p>

      <h3 style={{ marginTop: 18 }}>Backup &amp; restore</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Your binder, wishlist, and settings live in this browser. Export a backup file to move them
        to another device or keep them safe.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn secondary small" onClick={onExport}>⬇ Export backup</button>
        <button className="btn secondary small" onClick={() => importRef.current?.click()}>⬆ Import backup</button>
        <input
          ref={importRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
