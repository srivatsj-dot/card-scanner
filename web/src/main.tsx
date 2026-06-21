import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAnalytics, initAds } from "./analytics";
import "./styles.css";

// Load the Google tag for ad measurement (no-op unless VITE_GTAG_ID is set)
// and the AdSense library (no-op unless VITE_ADSENSE_CLIENT is set).
initAnalytics();
initAds();

// Note: no React.StrictMode — its dev-only double-mounting tears down and
// restarts the camera stream, which can leave the preview black.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Service worker: only in production builds. In dev it would cache Vite's
// modules and serve a stale (often blank) app after code changes — so in dev we
// actively remove any previously-installed worker and clear its caches.
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}
