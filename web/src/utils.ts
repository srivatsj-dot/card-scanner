/** Downscale a data-URL image to a small JPEG thumbnail for storage. */
export function makeThumbnail(dataUrl: string, max = 280): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const DAY_MS = 24 * 60 * 60 * 1000;

// --- Currency -------------------------------------------------------------
// Prices are stored in whatever currency the market quoted (usually USD from
// eBay). The collector picks the currency they want to SEE, so we convert at
// display time — switching currency in Settings updates every figure in the app
// instantly, with no refresh and no re-pricing.
// Built-in fallback rates, used only until live ones arrive (or if they can't be
// fetched). `loadFxRates()` replaces these with real daily rates from the server.
const FALLBACK_USD_PER: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, INR: 0.012, JPY: 0.0067,
};
let USD_PER: Record<string, number> = { ...FALLBACK_USD_PER };
let displayCurrency = "";

/**
 * Pull today's real exchange rates from the server (cached there for 12h) and use
 * them for every conversion from then on. Returns true if live rates were applied,
 * so the app can re-render the prices it's already showing.
 */
export async function loadFxRates(): Promise<boolean> {
  try {
    const res = await fetch("/api/fx");
    if (!res.ok) return false;
    const { rates } = (await res.json()) as { rates?: Record<string, number> | null };
    if (!rates || !Number.isFinite(rates.EUR)) return false;
    USD_PER = { ...FALLBACK_USD_PER, ...rates }; // keep fallbacks for any missing code
    return true;
  } catch { return false; }
}
/** Set the currency every price is shown in (called when the setting changes). */
export function setDisplayCurrency(code: string) {
  displayCurrency = (code || "").toUpperCase();
}
/** Convert between two currency codes; unknown codes pass through unchanged. */
export function convertMoney(n: number, from: string, to: string): number {
  const f = USD_PER[(from || "USD").toUpperCase()];
  const t = USD_PER[(to || "USD").toUpperCase()];
  if (!f || !t || f === t) return n;
  return (n * f) / t;
}

export function money(n: number, currency: string) {
  const from = (currency || "USD").toUpperCase();
  // Show it in the collector's chosen currency, converting if we know both.
  const to = displayCurrency && USD_PER[displayCurrency] && USD_PER[from] ? displayCurrency : from;
  const amount = to === from ? n : convertMoney(n, from, to);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: to,
      maximumFractionDigits: amount >= 100 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${to} ${Math.round(amount)}`;
  }
}

import type { ScanResult, BulkCard } from "./types";

/** Promote a lean bulk-scan card into a full ScanResult for the binder.
 * Missing fields get neutral defaults; a later price refresh fills in the rest. */
export function bulkCardToResult(c: BulkCard): ScanResult {
  return {
    identified: c.identified,
    imageUrl: c.imageUrl,
    player: c.player,
    sport: c.sport,
    team: c.team,
    year: c.year,
    manufacturer: c.manufacturer,
    setName: c.setName,
    cardNumber: c.cardNumber,
    parallel: c.parallel,
    specialEdition: c.specialEdition,
    serialNumber: c.serialNumber,
    estimatedCondition: c.conditionGrade,
    conditionReport: {
      grade: c.conditionGrade || "Not assessed",
      flaws: [],
      summary: c.conditionGrade ? "" : "Condition not assessed in bulk scan.",
    },
    estimatedValue: c.estimatedValue,
    rating: { score: 0, label: "Quick scan", summary: c.note },
    hiddenInsights: [],
    playerOutlook: { trend: "unknown", summary: "" },
    recommendedTrades: [],
    similarValueTargets: [],
    generalAssessment: c.note,
    warnings: [],
  };
}

/**
 * Are these the same physical card (so saving one is a duplicate)? Compares the
 * identity fields that distinguish a printing — player, year, set, number and
 * parallel — ignoring case/punctuation. A missing field on either side doesn't
 * block a match, so a slightly thinner scan of the same card still counts.
 */
export function sameCard(a: ScanResult, b: ScanResult): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const player = norm(a.player), other = norm(b.player);
  if (!player || player !== other) return false; // different subject → different card
  const fields: (keyof ScanResult)[] = ["year", "setName", "cardNumber", "parallel"];
  return fields.every((f) => {
    const x = norm(a[f]), y = norm(b[f]);
    return !x || !y || x === y; // only a genuine mismatch rules it out
  });
}

/** Build a short text description of a saved card for the trade tool. */
export function describeCard(r: ScanResult): string {
  const parts = [r.year, r.manufacturer, r.setName, r.player, r.parallel].filter(Boolean);
  let s = parts.join(" ");
  if (r.specialEdition) s += ` (${r.specialEdition})`;
  if (r.serialNumber) s += ` /${r.serialNumber.replace(/^.*\//, "")}`;
  else if (r.cardNumber) s += ` #${r.cardNumber}`;
  return s.trim() || r.player || "Saved card";
}
