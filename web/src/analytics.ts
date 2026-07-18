// Google tag (gtag.js) for measuring ad performance — which Search/YouTube ads
// produce real sign-ups. Entirely optional and OFF unless VITE_GTAG_ID is set,
// so dev and un-configured builds load nothing and track nothing.
//
//   VITE_GTAG_ID        GA4 ("G-XXXX") or Google Ads ("AW-XXXX") tag id
//   VITE_ADS_CONVERSION optional Google Ads sign-up conversion, "AW-XXXX/label"

// Config resolves from the build-time Vite env first, then falls back to the
// runtime config the server injects into index.html as window.__APP_CONFIG.
// The runtime fallback means these ids can be set via the host dashboard alone
// (no rebuild), which is what makes analytics reliably turn on in production.
interface AppConfig {
  gtagId?: string;
  adsConversion?: string;
  adsenseClient?: string;
  adsenseSlot?: string;
}
const runtimeConfig: AppConfig =
  (typeof window !== "undefined" && (window as unknown as { __APP_CONFIG?: AppConfig }).__APP_CONFIG) || {};
const pick = (buildVal: string | undefined, runtimeVal: string | undefined): string | undefined =>
  (buildVal && buildVal.trim()) || (runtimeVal && runtimeVal.trim()) || undefined;

const GTAG_ID = pick(import.meta.env.VITE_GTAG_ID as string | undefined, runtimeConfig.gtagId);
const ADS_CONVERSION = pick(import.meta.env.VITE_ADS_CONVERSION as string | undefined, runtimeConfig.adsConversion);

// Google AdSense publisher id ("ca-pub-XXXXXXXX"). When set, ad units render;
// when blank, no ad script loads and AdSlot renders nothing.
export const adsenseClient = pick(
  import.meta.env.VITE_ADSENSE_CLIENT as string | undefined,
  runtimeConfig.adsenseClient,
);

// Default AdSense slot id, same build-time-then-runtime resolution.
export const adsenseSlot = pick(
  import.meta.env.VITE_ADSENSE_SLOT as string | undefined,
  runtimeConfig.adsenseSlot,
);

/** Load the AdSense library once (no-op unless a publisher id is configured). */
export function initAds(): void {
  if (!adsenseClient || typeof document === "undefined") return;
  if (document.querySelector("script[data-adsense]")) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`;
  s.crossOrigin = "anonymous";
  s.setAttribute("data-adsense", "1");
  document.head.appendChild(s);
}

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

let inited = false;

export function initAnalytics(): void {
  if (inited || !GTAG_ID || typeof document === "undefined") return;
  inited = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GTAG_ID)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  // Canonical gtag shim — pushes the raw arguments object, which gtag expects.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GTAG_ID);
}

/** Fire a sign-up conversion (GA4 event + optional Google Ads conversion). */
export function trackSignup(): void {
  if (!GTAG_ID || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "sign_up", { method: "password" });
  if (ADS_CONVERSION) window.gtag("event", "conversion", { send_to: ADS_CONVERSION });
}

/** Generic event passthrough for any future tracking. */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!GTAG_ID || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params || {});
}
