// Runtime UI translation. Components wrap visible English strings with t(text);
// any string not yet translated for the current language is batched, sent to
// the server (Gemini) once, cached in localStorage, and re-rendered. English
// passes through untouched. This makes ALL wrapped text translate into any
// supported language without hand-written dictionaries.
import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
let currentLang = "English";
const cache: Record<string, Record<string, string>> = {};
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

const key = (lang: string) => `i18n-cache-${lang}`;

function loadCache(lang: string) {
  if (cache[lang]) return;
  try {
    cache[lang] = JSON.parse(localStorage.getItem(key(lang)) || "{}");
  } catch {
    cache[lang] = {};
  }
}
function saveCache(lang: string) {
  try {
    localStorage.setItem(key(lang), JSON.stringify(cache[lang]));
  } catch {
    /* quota — ignore */
  }
}
function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function setLanguage(lang: string) {
  if (lang === currentLang) return;
  currentLang = lang;
  if (lang !== "English") loadCache(lang);
  pending = new Set();
  notify();
}

export function translate(text: string): string {
  if (!text || currentLang === "English") return text;
  loadCache(currentLang);
  const hit = cache[currentLang][text];
  if (hit !== undefined) return hit;
  if (!pending.has(text)) {
    pending.add(text);
    scheduleFlush();
  }
  return text; // English placeholder until the translation arrives
}

function scheduleFlush() {
  if (flushTimer != null) return;
  flushTimer = setTimeout(flush, 450);
}

async function flush() {
  flushTimer = null;
  if (inFlight) {
    scheduleFlush();
    return;
  }
  const lang = currentLang;
  if (lang === "English") {
    pending.clear();
    return;
  }
  const texts = [...pending].filter((t) => cache[lang][t] === undefined).slice(0, 120);
  if (texts.length === 0) {
    pending.clear();
    return;
  }
  inFlight = true;
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, language: lang }),
    });
    if (res.ok) {
      const data = await res.json();
      const tr = (data.translations || {}) as Record<string, string>;
      for (const k of texts) if (typeof tr[k] === "string") cache[lang][k] = tr[k];
      saveCache(lang);
    }
  } catch {
    /* offline / error — keep English */
  } finally {
    inFlight = false;
    for (const t of texts) pending.delete(t);
    notify();
    if (pending.size > 0) scheduleFlush();
  }
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Hook: returns the translate function and re-renders when translations load. */
export function useT() {
  useSyncExternalStore(subscribe, () => version, () => version);
  return translate;
}
