import { useState } from "react";
import type { Settings } from "../types";
import { BLOCKABLE_CATEGORIES } from "../types";
import { LANGS } from "../i18n";
import { useT } from "../translator";
import Logo from "./Logo";

// Quick 3-question setup shown right after an account is created: language,
// trading style, and which cards you collect. All also live in Settings — this
// just gets new users a personalized experience from the first screen.
export default function Onboarding({ settings, onDone }: { settings: Settings; onDone: (patch: Partial<Settings>) => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [language, setLanguage] = useState(settings.language || "English");
  const [collectorType, setCollectorType] = useState<Settings["collectorType"]>(settings.collectorType || "any");
  const [cards, setCards] = useState<string[]>(
    settings.digestSports?.length ? settings.digestSports : [...BLOCKABLE_CATEGORIES]
  );

  const toggleCard = (c: string) =>
    setCards((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  function finish() {
    onDone({
      language,
      collectorType,
      digestSports: cards.length ? cards : [...BLOCKABLE_CATEGORIES],
      // If they picked exactly one category, make it their primary.
      sport: cards.length === 1 ? cards[0] : settings.sport,
    });
  }

  const steps = [
    {
      title: t("What language should we use?"),
      body: (
        <select className="onb-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGS.map((l) => (
            <option key={l.code} value={l.name}>{l.native}</option>
          ))}
        </select>
      ),
    },
    {
      title: t("What's your trading style?"),
      body: (
        <div className="onb-options">
          {[
            { v: "any", emoji: "🎯", label: t("No preference"), desc: t("A balanced mix.") },
            { v: "money", emoji: "💰", label: t("Money collector"), desc: t("Chase value, resale, and price appreciation.") },
            { v: "talent", emoji: "⭐", label: t("Talent collector"), desc: t("Chase the best players and rising stars.") },
          ].map((o) => (
            <button
              key={o.v}
              className={`onb-choice ${collectorType === o.v ? "sel" : ""}`}
              onClick={() => setCollectorType(o.v as Settings["collectorType"])}
            >
              <span className="onb-choice-emoji">{o.emoji}</span>
              <span><strong>{o.label}</strong><br /><span className="muted" style={{ fontSize: 13 }}>{o.desc}</span></span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: t("What do you like to collect?"),
      body: (
        <div className="chips" style={{ justifyContent: "center" }}>
          {BLOCKABLE_CATEGORIES.map((c) => {
            const on = cards.includes(c);
            return (
              <button key={c} type="button" className={`chip ${on ? "" : "off"}`} onClick={() => toggleCard(c)}>
                {on ? "✓ " : ""}{c}
              </button>
            );
          })}
        </div>
      ),
    },
  ];

  const last = step === steps.length - 1;

  return (
    <div className="backdrop">
      <div className="card onboarding" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block" }}><Logo size={40} /></div>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{t("Step")} {step + 1} / {steps.length}</p>
          <h2 style={{ margin: "6px 0 16px" }}>{steps[step].title}</h2>
        </div>
        {steps[step].body}
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep((s) => s - 1)}>← {t("Back")}</button>
          )}
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={() => (last ? finish() : setStep((s) => s + 1))}
          >
            {last ? t("Start collecting") : t("Next")}
          </button>
        </div>
        <button className="link-btn" style={{ marginTop: 10, width: "100%" }} onClick={finish}>
          {t("Skip — I'll set this up later")}
        </button>
      </div>
    </div>
  );
}
