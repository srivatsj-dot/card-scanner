import type { Settings } from "../types";
import { CATEGORIES } from "../types";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export default function SettingsView({ settings, onChange }: Props) {
  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="card">
      <h2>Settings &amp; filters</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        These apply to every scan and trade check. They're saved in your browser.
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
        <span>Don't recommend trades worth less than (per card)</span>
        <input
          type="number"
          min={0}
          placeholder="e.g. 150 — leave blank for no minimum"
          value={settings.minValue ?? ""}
          onChange={(e) => set("minValue", e.target.value === "" ? null : Number(e.target.value))}
        />
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

      <label className="field" style={{ marginTop: 8 }}>
        <span>Custom instructions</span>
        <textarea
          value={settings.customInstructions}
          placeholder={
            "Anything else for the appraiser. Examples:\n" +
            "• Don't recommend Panini cards\n" +
            "• Block Topps Chrome\n" +
            "• Only suggest players on contending teams\n" +
            "• Focus on long-term holds, not flips"
          }
          onChange={(e) => set("customInstructions", e.target.value)}
        />
      </label>

      <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
        Tip: you can block brands or set names here in plain English — e.g. “never recommend
        anything from Panini or Donruss.”
      </p>
    </div>
  );
}
