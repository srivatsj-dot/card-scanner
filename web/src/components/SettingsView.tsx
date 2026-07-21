import { useState } from "react";
import type { Settings } from "../types";
import { CATEGORIES, BLOCKABLE_CATEGORIES, REGIONS } from "../types";
import { LANGS } from "../i18n";
import { useT } from "../translator";
import { notifySignup } from "../api";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onDeleteAccount: () => void;
  onRename?: (name: string) => Promise<void>;
  email?: string;
  displayName?: string;
}

export default function SettingsView({ settings, onChange, onDeleteAccount, onRename, email, displayName }: Props) {
  const t = useT();
  const [nameInput, setNameInput] = useState(displayName || "");
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingName, setSavingName] = useState(false);

  async function saveName() {
    if (!onRename || !nameInput.trim() || nameInput.trim() === displayName) return;
    setSavingName(true);
    setNameMsg(null);
    try {
      await onRename(nameInput.trim());
      setNameMsg({ ok: true, text: t("Username updated.") });
    } catch (e) {
      setNameMsg({ ok: false, text: e instanceof Error ? e.message : t("Couldn't update username.") });
    } finally {
      setSavingName(false);
    }
  }
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  async function sendTestEmail() {
    if (!email) return;
    setSending(true);
    setEmailMsg(null);
    const r = await notifySignup(email, displayName || "there");
    setSending(false);
    if (r.ok) setEmailMsg({ ok: true, text: t("Sent! Check your inbox.") });
    else if (r.reason === "email-not-configured")
      setEmailMsg({ ok: false, text: t("Email isn't available right now. Please try again later.") });
    else setEmailMsg({ ok: false, text: t("Couldn't send the email. Please try again.") });
  }
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

      {onRename && (
        <label className="field">
          <span>{t("Username")}{email ? ` (${email})` : ""}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text" value={nameInput} maxLength={40}
              autoCapitalize="none" autoCorrect="off"
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
              placeholder={t("Your username")}
              style={{ flex: 1 }}
            />
            <button
              className="btn secondary"
              onClick={saveName}
              disabled={savingName || !nameInput.trim() || nameInput.trim() === displayName}
            >
              {savingName ? t("Saving…") : t("Save")}
            </button>
          </div>
          {nameMsg && (
            <span className="muted" style={{ fontSize: 12, color: nameMsg.ok ? "var(--good, #3ad29f)" : "var(--bad, #ff6b6b)" }}>
              {nameMsg.text}
            </span>
          )}
        </label>
      )}

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
            placeholder={t("Optional")}
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
          &nbsp;— {t("turn off for faster results using offline knowledge")}
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
          &nbsp;— {t("turn off to refresh prices only when you choose")}
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

      <h3 style={{ marginTop: 18 }}>🛒 {t("Trade")}</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={!!settings.emailOffers}
          onChange={(e) => set("emailOffers", e.target.checked)}
        />
        {t("Email me when a trade offer arrives or is answered")}
        <span className="muted" style={{ fontSize: 12 }}>
          &nbsp;— {t("needs an email on your account")}
        </span>
      </label>

      <label className="field" style={{ marginTop: 8 }}>
        <span>{t("Who can send me trade requests")}</span>
        <select
          value={settings.tradeRequestsFrom || "anyone"}
          onChange={(e) => set("tradeRequestsFrom", e.target.value as Settings["tradeRequestsFrom"])}
        >
          <option value="anyone">{t("Anyone")}</option>
          <option value="friends">{t("Friends only")}</option>
          <option value="list">{t("Only specific usernames")}</option>
        </select>
      </label>
      {settings.tradeRequestsFrom === "list" && (
        <label className="field">
          <span>{t("Allowed usernames (comma-separated)")}</span>
          <input
            type="text"
            value={(settings.tradeAllowList || []).join(", ")}
            placeholder="alice, bob, charlie"
            onChange={(e) => set("tradeAllowList", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          />
        </label>
      )}

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
          placeholder={t("Anything else for the appraiser — brands or sets to avoid, players or teams to favor, parallels to prefer.")}
          onChange={(e) => set("customInstructions", e.target.value)}
        />
      </label>

      <p className="muted" style={{ fontSize: 13 }}>
        {t("Tip: write your preferences in plain English, like which brands or sets to avoid.")}
      </p>

      {email && (
        <>
          <h3 style={{ marginTop: 22 }}>{t("Email")}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t("Send a test welcome email to")} <strong>{email}</strong> {t("to check email delivery is working.")}
          </p>
          <button className="btn secondary small" onClick={sendTestEmail} disabled={sending}>
            {sending ? <><span className="spinner" />{t("Sending…")}</> : `✉ ${t("Send test email")}`}
          </button>
          {emailMsg && (
            <p style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }} className={emailMsg.ok ? "" : "warn"}>
              {emailMsg.ok ? "✓ " : "⚠ "}{emailMsg.text}
            </p>
          )}
        </>
      )}

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

      <p className="muted" style={{ fontSize: 12, marginTop: 22, marginBottom: 0 }}>
        <a href="/faq.html" target="_blank" rel="noopener" style={{ color: "var(--muted)" }}>{t("FAQ")}</a>
        {" · "}
        <a href="/privacy.html" target="_blank" rel="noopener" style={{ color: "var(--muted)" }}>{t("Privacy Policy")}</a>
      </p>
    </div>
  );
}
