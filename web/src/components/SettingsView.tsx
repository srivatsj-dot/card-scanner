import type { Settings } from "../types";
import { CATEGORIES, BLOCKABLE_CATEGORIES, REGIONS } from "../types";
import { LANGS } from "../i18n";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onDeleteAccount: () => void;
}

export default function SettingsView({ settings, onChange, onDeleteAccount }: Props) {
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

  function toggleDigestSport(cat: string) {
    const has = settings.digestSports.includes(cat);
    set(
      "digestSports",
      has ? settings.digestSports.filter((c) => c !== cat) : [...settings.digestSports, cat]
    );
  }

  return (
    <div className="card">
      <h2>{t("Settings & filters")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("These apply to every scan and trade. They're saved in your browser.")}
      </p>

      <div className="grid2">
        <label className="field">
          <span>{t("Card category I mostly collect")}</span>
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
          <span>{t("Currency")}</span>
          <select value={settings.currency} onChange={(e) => set("currency", e.target.value)}>
            {["USD", "EUR", "GBP", "CAD", "AUD", "INR", "JPY"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span>{t("Market / location (for regional pricing)")}</span>
        <select value={settings.region} onChange={(e) => set("region", e.target.value)}>
          <option value="">{t("Global / auto")}</option>
          {REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{t("Language (app & results)")}</span>
        <select value={settings.language} onChange={(e) => set("language", e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.name}>{l.native}</option>
          ))}
        </select>
      </label>

      <div className="grid2">
        <label className="field">
          <span>{t("Min trade value (per card)")}</span>
          <input
            type="number"
            min={0}
            placeholder={t("e.g. 150 — blank for none")}
            value={settings.minValue ?? ""}
            onChange={(e) => set("minValue", e.target.value === "" ? null : Number(e.target.value))}
          />
        </label>
        <label className="field">
          <span>{t("Max trade value (per card)")}</span>
          <input
            type="number"
            min={0}
            placeholder={t("blank for none")}
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
        {t("Use live web data for current prices & player form")}
        <span className="muted" style={{ fontSize: 12 }}>
          &nbsp;— {t("turn off if you keep hitting free-tier rate limits (faster, fewer calls)")}
        </span>
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.autoRefresh}
          onChange={(e) => set("autoRefresh", e.target.checked)}
        />
        {t("Auto-refresh binder & wishlist prices daily")}
        <span className="muted" style={{ fontSize: 12 }}>
          &nbsp;— {t("turn off to save quota; you can still refresh manually")}
        </span>
      </label>

      <h3 style={{ marginTop: 18 }}>☀️ {t("Morning update")}</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.morningUpdate}
          onChange={(e) => set("morningUpdate", e.target.checked)}
        />
        {t("Show a daily market update on the Today tab")}
      </label>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Include these categories in the update:")}
      </p>
      <div className="chips">
        {BLOCKABLE_CATEGORIES.map((c) => {
          const on = settings.digestSports.includes(c);
          return (
            <button
              key={c}
              type="button"
              className={`chip ${on ? "" : "off"}`}
              onClick={() => toggleDigestSport(c)}
            >
              {on ? "✓ " : ""}{c}
            </button>
          );
        })}
      </div>

      <label className="field">
        <span>{t("What kind of collector are you?")}</span>
        <select
          value={settings.collectorType}
          onChange={(e) => set("collectorType", e.target.value as Settings["collectorType"])}
        >
          <option value="any">{t("No preference")}</option>
          <option value="money">{t("Money collector — chase value & resale")}</option>
          <option value="talent">{t("Talent collector — chase the best players")}</option>
        </select>
      </label>

      <label className="toggle" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={settings.sameKindOnly}
          onChange={(e) => set("sameKindOnly", e.target.checked)}
        />
        {t("Only suggest cards of the same kind as the card (e.g. baseball → baseball)")}
      </label>

      <h3 style={{ marginTop: 18 }}>{t("Block card types")}</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Never recommend cards from the categories you check.")}
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
        <span>{t("Custom instructions")}</span>
        <textarea
          value={settings.customInstructions}
          placeholder={
            t("Anything else for the appraiser. Examples:") + "\n" +
            t("• Never recommend Panini or Donruss cards") + "\n" +
            t("• Only players on contending teams") + "\n" +
            t("• Prefer numbered parallels")
          }
          onChange={(e) => set("customInstructions", e.target.value)}
        />
      </label>

      <p className="muted" style={{ fontSize: 13 }}>
        {t("Tip: block specific brands or set names here in plain English — e.g. “never recommend anything from Panini.”")}
      </p>

      <h3 style={{ marginTop: 22 }}>{t("Account")}</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("Deleting your account removes it and its binder, wishlist, and settings from this device. This can't be undone.")}
      </p>
      <button
        className="btn danger small"
        onClick={() => {
          if (confirm(t("Delete this account and all its data? This can't be undone."))) onDeleteAccount();
        }}
      >
        {t("Delete account")}
      </button>
    </div>
  );
}
