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

import type { ScanResult } from "./types";

/** Build a short text description of a saved card for the trade tool. */
export function describeCard(r: ScanResult): string {
  const parts = [r.year, r.manufacturer, r.setName, r.player, r.parallel].filter(Boolean);
  let s = parts.join(" ");
  if (r.specialEdition) s += ` (${r.specialEdition})`;
  if (r.serialNumber) s += ` /${r.serialNumber.replace(/^.*\//, "")}`;
  else if (r.cardNumber) s += ` #${r.cardNumber}`;
  return s.trim() || r.player || "Saved card";
}
