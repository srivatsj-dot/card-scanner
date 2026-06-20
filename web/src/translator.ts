// Runtime UI translation. Components wrap visible English strings with t(text);
// untranslated strings are batched, sent to the server (Gemini) once, cached in
// localStorage, and re-rendered. English passes through untouched.
//
// Reliability: small batches (long strings used to overflow the model's output
// limit and truncate the JSON), failed/partial batches are retried instead of
// dropped, and switching language pre-warms every string the app has ever shown
// so the whole UI flips over — not just what's currently on screen.
import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;
let currentLang = "English";
const cache: Record<string, Record<string, string>> = {};
let pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const inProgress = new Set<string>(); // texts currently being fetched
let active = 0; // in-flight requests
const attempts = new Map<string, number>(); // `${lang}\n${text}` -> tries
const BATCH = 25;
const MAX_CONCURRENT = 4; // translate several batches at once for a fast flip

// Every English string the app has shown, so a new language can translate it all.
const known = new Set<string>();
const KNOWN_KEY = "i18n-known";
try { (JSON.parse(localStorage.getItem(KNOWN_KEY) || "[]") as string[]).forEach((s) => known.add(s)); } catch { /* ignore */ }
function rememberKnown(text: string) {
  if (text && !known.has(text)) {
    known.add(text);
    try { localStorage.setItem(KNOWN_KEY, JSON.stringify([...known])); } catch { /* quota */ }
  }
}

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
  pending = new Set();
  inProgress.clear();
  if (lang !== "English") {
    loadCache(lang);
    // Pre-warm: queue every string we've ever shown that isn't translated yet,
    // so the whole app flips, not just the current screen.
    for (const text of known) if (cache[lang][text] === undefined) pending.add(text);
    if (pending.size) scheduleFlush(0);
  }
  notify();
}

export function translate(text: string): string {
  rememberKnown(text);
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

function scheduleFlush(delay = 250) {
  if (flushTimer != null) return;
  flushTimer = setTimeout(pump, delay);
}

// Fill the request pool: dispatch as many batches as concurrency allows.
function pump() {
  flushTimer = null;
  const lang = currentLang;
  if (lang === "English") {
    pending.clear();
    inProgress.clear();
    return;
  }
  while (active < MAX_CONCURRENT) {
    const batch = [...pending]
      .filter((t) => cache[lang][t] === undefined && !inProgress.has(t))
      .slice(0, BATCH);
    if (batch.length === 0) break;
    batch.forEach((t) => inProgress.add(t));
    active++;
    void runBatch(lang, batch);
  }
}

async function runBatch(lang: string, batch: string[]) {
  let ok = false;
  try {
    const res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: batch, language: lang }),
    });
    if (res.ok) {
      const data = await res.json();
      const tr = (data.translations || {}) as Record<string, string>;
      for (const k of batch) if (typeof tr[k] === "string" && tr[k]) cache[lang][k] = tr[k];
      saveCache(lang);
      ok = true;
    }
  } catch {
    /* offline / error — retried below */
  } finally {
    active--;
    // Keep anything that didn't translate so it retries (up to 4 attempts),
    // rather than dropping it and leaving the UI half-translated.
    for (const t of batch) {
      inProgress.delete(t);
      const ak = `${lang}\n${t}`;
      const tries = (attempts.get(ak) || 0) + 1;
      if (cache[lang][t] !== undefined || tries >= 4) {
        pending.delete(t);
        attempts.delete(ak);
      } else {
        attempts.set(ak, tries);
      }
    }
    notify();
    if (pending.size > 0) {
      if (ok) pump();
      else scheduleFlush(1500);
    }
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
