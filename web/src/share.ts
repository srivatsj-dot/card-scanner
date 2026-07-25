// Render a shareable image of a card — the photo, who it is, what it's worth,
// and its grade — so a good pull can be posted to Instagram/Discord/a group chat.
// Everything is drawn on a canvas so there's no server round-trip.

import type { SavedCard, ScanResult } from "./types";
import { money } from "./utils";

const W = 1080, H = 1350; // 4:5 — the tallest aspect most social feeds show uncropped

/** Load an image for canvas use. Returns null if it can't be drawn (CORS/404). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    // Remote photos need CORS permission or the canvas becomes "tainted" and
    // can't be exported. Data URLs (your own photo) are always fine.
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw text, shrinking the font until it fits the given width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, start: number, weight = "800") {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    if (ctx.measureText(text).width <= maxW || size <= 22) break;
    size -= 2;
  } while (true);
  ctx.fillText(text, x, y);
  return size;
}

export interface ShareOpts {
  card: SavedCard | { result: ScanResult; thumbnail?: string; grade?: SavedCard["grade"] };
  username?: string;
  hideValue?: boolean; // some people don't want to post prices
}

/** Build the share image and return it as a PNG blob. */
export async function renderShareCard({ card, username, hideValue }: ShareOpts): Promise<Blob | null> {
  const r = card.result;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Background: deep gradient so the card pops on any feed.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#141a2e");
  bg.addColorStop(1, "#0a0d18");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // The card photo, centred in a rounded frame.
  const img = await loadImage((card as SavedCard).thumbnail || r.imageUrl || "");
  const frameW = 660, frameH = 924;
  const fx = (W - frameW) / 2, fy = 150;
  ctx.save();
  roundRect(ctx, fx, fy, frameW, frameH, 24);
  ctx.fillStyle = "#1b2136";
  ctx.fill();
  ctx.clip();
  if (img) {
    // cover-fit inside the frame
    const scale = Math.max(frameW / img.width, frameH / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, fx + (frameW - dw) / 2, fy + (frameH - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#8a93ab";
    ctx.textAlign = "center";
    ctx.font = "700 180px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("🃏", W / 2, fy + frameH / 2 + 60);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 2;
  roundRect(ctx, fx, fy, frameW, frameH, 24);
  ctx.stroke();

  // Grade badge, top-right of the frame.
  const g = (card as SavedCard).grade;
  if (g) {
    const label = `${g.company} ${g.grade}`.trim();
    ctx.font = "800 34px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    const bw = tw + 44, bh = 60;
    const bx = fx + frameW - bw - 20, by = fy + 20;
    ctx.fillStyle = "rgba(10,12,20,0.86)";
    roundRect(ctx, bx, by, bw, bh, 30); ctx.fill();
    ctx.strokeStyle = "#ffd76a"; ctx.lineWidth = 2;
    roundRect(ctx, bx, by, bw, bh, 30); ctx.stroke();
    ctx.fillStyle = "#ffd76a";
    ctx.textAlign = "center";
    ctx.fillText(label, bx + bw / 2, by + 41);
  }

  // Header
  ctx.textAlign = "center";
  ctx.fillStyle = "#8a93ab";
  ctx.font = "700 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(username ? `${username}'s pull` : "Card-O-Rama", W / 2, 74);

  // Player + set line
  ctx.fillStyle = "#ffffff";
  fitText(ctx, r.player || "Unknown card", W / 2, 1160, W - 120, 62);
  const sub = [r.year, r.manufacturer, r.setName, r.parallel].filter(Boolean).join(" · ");
  if (sub) {
    ctx.fillStyle = "#a7b0c6";
    fitText(ctx, sub, W / 2, 1208, W - 140, 32, "600");
  }

  // Value
  if (!hideValue && r.estimatedValue?.mid) {
    ctx.fillStyle = "#3ad29f";
    fitText(ctx, money(r.estimatedValue.mid, r.estimatedValue.currency || "USD"), W / 2, 1278, W - 200, 56);
  }

  // Footer wordmark
  ctx.fillStyle = "#6b7590";
  ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("Card-O-Rama", W / 2, H - 34);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png", 0.95));
}

/**
 * Share the card: uses the native share sheet on phones (so it can go straight
 * to Instagram/WhatsApp), and falls back to downloading the PNG on desktop.
 * Returns how it was handled, so the UI can say the right thing.
 */
export async function shareCard(opts: ShareOpts): Promise<"shared" | "downloaded" | "failed"> {
  const blob = await renderShareCard(opts);
  if (!blob) return "failed";
  const name = `${(opts.card.result.player || "card").replace(/\W+/g, "-").toLowerCase()}.png`;
  const file = new File([blob], name, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: opts.card.result.player || "My card" });
      return "shared";
    } catch {
      return "failed"; // user cancelled the sheet
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
