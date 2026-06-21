import { useEffect, useRef } from "react";
import { adsenseClient } from "../analytics";

// A single Google AdSense unit. Renders nothing unless a publisher id
// (VITE_ADSENSE_CLIENT) and a slot id are configured, so the app is ad-free in
// dev and until AdSense is approved. Pass a slot id from your AdSense account;
// defaults to VITE_ADSENSE_SLOT.
const DEFAULT_SLOT = import.meta.env.VITE_ADSENSE_SLOT as string | undefined;

declare global {
  interface Window { adsbygoogle: unknown[] }
}

export default function AdSlot({ slot, format = "auto", className }: { slot?: string; format?: string; className?: string }) {
  const slotId = slot || DEFAULT_SLOT;
  const pushed = useRef(false);

  useEffect(() => {
    if (!adsenseClient || !slotId || pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* AdSense not loaded / blocked — leave the space empty */
    }
  }, [slotId]);

  if (!adsenseClient || !slotId) return null;

  return (
    <div className={`ad-slot ${className || ""}`}>
      <span className="ad-label">Ad</span>
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={adsenseClient}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
