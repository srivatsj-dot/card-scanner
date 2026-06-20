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

export function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: n >= 100 ? 0 : 2,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n)}`;
  }
}

import type { ScanResult, BulkCard } from "./types";

/** Promote a lean bulk-scan card into a full ScanResult for the binder.
 * Missing fields get neutral defaults; a later price refresh fills in the rest. */
export function bulkCardToResult(c: BulkCard): ScanResult {
  return {
    identified: c.identified,
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

/** Build a short text description of a saved card for the trade tool. */
export function describeCard(r: ScanResult): string {
  const parts = [r.year, r.manufacturer, r.setName, r.player, r.parallel].filter(Boolean);
  let s = parts.join(" ");
  if (r.specialEdition) s += ` (${r.specialEdition})`;
  if (r.serialNumber) s += ` /${r.serialNumber.replace(/^.*\//, "")}`;
  else if (r.cardNumber) s += ` #${r.cardNumber}`;
  return s.trim() || r.player || "Saved card";
}
