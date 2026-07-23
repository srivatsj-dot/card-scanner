// Google reverse-image search via Cloud Vision "Web Detection". Sends a card
// photo to Google and gets back the web's best guess of what it is, plus related
// entities — used as a strong hint for identification. Optional: needs a Google
// Cloud Vision API key (GOOGLE_VISION_API_KEY). Best-effort; null on any miss.
//
// NOTE: this is a Google CLOUD key (Vision API enabled, billing on — there's a
// free tier ~1,000 images/month), NOT the AI Studio GEMINI_API_KEY.

const VISION_KEY = process.env.GOOGLE_VISION_API_KEY || "";
export const hasVision = Boolean(VISION_KEY);

export interface WebGuess {
  bestGuess?: string;
  entities: string[];
}

export async function webDetect(imageBase64: string, ms = 7000): Promise<WebGuess | null> {
  if (!hasVision || !imageBase64) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        requests: [{ image: { content: imageBase64 }, features: [{ type: "WEB_DETECTION", maxResults: 10 }] }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responses?: { webDetection?: {
        bestGuessLabels?: { label?: string }[];
        webEntities?: { description?: string; score?: number }[];
      } }[];
    };
    const wd = data?.responses?.[0]?.webDetection;
    if (!wd) return null;
    const bestGuess = wd.bestGuessLabels?.find((b) => b.label)?.label;
    const entities = (wd.webEntities || [])
      .filter((e) => e.description && (e.score ?? 0) > 0.3)
      .map((e) => e.description as string)
      .slice(0, 8);
    return bestGuess || entities.length ? { bestGuess, entities } : null;
  } catch {
    return null;
  }
}
