import { useEffect, useRef, useState } from "react";
import { useT } from "../translator";

interface Props {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
  // Bulk photos hold several cards, so they skip the single-card guide/crop and
  // capture the whole frame (keeping autofocus, high-res, and the blur review).
  fullFrame?: boolean;
}

// Trading-card aspect ratio (2.5" × 3.5" = 5:7) for the alignment guide.
const CARD_RATIO = 5 / 7;
// Below this Laplacian-variance score a shot is likely too blurry to read.
const BLUR_THRESHOLD = 55;

/**
 * Live camera with a card alignment guide, crop-to-guide capture, continuous
 * autofocus, and a review step that warns on blur before the shot is used.
 *
 * Key UX fixes: you don't have to perfectly fill the frame — line the card up
 * inside the on-screen guide and we crop tightly to it, so the saved image is
 * filled with card. The preview uses object-fit: contain (never hidden-crops)
 * so the guide maps exactly to what gets captured.
 */
export default function CameraModal({ onCapture, onClose, fullFrame = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [portrait, setPortrait] = useState(true);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [preview, setPreview] = useState<string | null>(null);
  const [blurry, setBlurry] = useState(false);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("This browser can't access the camera. Use Upload instead."));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing }, // rear ("environment") or front ("user")
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            aspectRatio: portrait ? 3 / 4 : 4 / 3, // a hint; desktops may ignore
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        // Ask for continuous autofocus where the device supports it — the single
        // biggest win against blurry close-ups of cards.
        try {
          const track = stream.getVideoTracks()[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const caps: any = track.getCapabilities?.();
          if (caps?.focusMode?.includes("continuous")) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] });
          }
        } catch {
          /* focus control not supported — fine */
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          const tryPlay = () => {
            video.play().then(() => !cancelled && setReady(true)).catch(() => {});
          };
          video.onloadedmetadata = tryPlay;
          video.oncanplay = tryPlay;
          tryPlay();
        }
      } catch (err) {
        if (cancelled) return;
        const name = (err as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(
            t("Camera permission is blocked for this site. In Safari: top menu → Safari → Settings for localhost… → set Camera to Allow, then reload. Or just use Upload.")
          );
        } else if (name === "NotFoundError") {
          setError(t("No camera was found on this device. Use Upload instead."));
        } else {
          setError(t("Couldn't open the camera. Make sure no other app is using it, or use Upload."));
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [portrait, facing]);

  // Tap the preview to nudge a single autofocus pass (best-effort).
  async function refocus() {
    videoRef.current?.play().then(() => setReady(true)).catch(() => {});
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const caps: any = track?.getCapabilities?.();
      if (track && caps?.focusMode?.includes("single-shot")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await track.applyConstraints({ advanced: [{ focusMode: "single-shot" } as any] });
      }
    } catch {
      /* ignore */
    }
  }

  // Map the on-screen guide rectangle to source pixels (accounting for the
  // object-fit: contain letterboxing) and crop the captured frame to it.
  function capture() {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !video.videoWidth) return;

    const nW = video.videoWidth, nH = video.videoHeight;
    let sx = 0, sy = 0, sw = nW, sh = nH;
    if (guide) {
      const vr = video.getBoundingClientRect();
      const gr = guide.getBoundingClientRect();
      // object-fit: cover — the video fills the box and overflows; use max scale.
      const scale = Math.max(vr.width / nW, vr.height / nH);
      const contentLeft = vr.left + (vr.width - nW * scale) / 2;
      const contentTop = vr.top + (vr.height - nH * scale) / 2;
      sx = Math.max(0, (gr.left - contentLeft) / scale);
      sy = Math.max(0, (gr.top - contentTop) / scale);
      sw = Math.min(nW - sx, gr.width / scale);
      sh = Math.min(nH - sy, gr.height / scale);
      if (sw < 8 || sh < 8) { sx = 0; sy = 0; sw = nW; sh = nH; }
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    setBlurry(sharpness(ctx, canvas.width, canvas.height) < BLUR_THRESHOLD);
    setPreview(canvas.toDataURL("image/jpeg", 0.92));
  }

  function usePhoto() {
    if (preview) { onCapture(preview); onClose(); }
  }

  return (
    <div className="cam-overlay" onClick={onClose}>
      <div className="cam-box" onClick={(e) => e.stopPropagation()}>
        {error ? (
          <div className="error-box">{error}</div>
        ) : preview ? (
          // Review step: confirm the shot is sharp before using it.
          <div className={`cam-stage ${portrait ? "portrait" : "landscape"}`}>
            <img src={preview} alt={t("Captured card")} className="cam-video" style={{ objectFit: "contain" }} />
            {blurry && <div className="cam-blur-warn">⚠ {t("Looks blurry — retake for a sharper read")}</div>}
          </div>
        ) : (
          <div
            className={`cam-stage ${portrait ? "portrait" : "landscape"}`}
            onClick={refocus}
          >
            <video ref={videoRef} autoPlay playsInline muted className="cam-video" />
            {!fullFrame && <div ref={guideRef} className="cam-guide" aria-hidden />}
            {!ready && <div className="cam-hint muted">{t("Starting camera… (tap if it stays black)")}</div>}
          </div>
        )}

        <div className="cam-actions">
          {!error && !preview && (
            <>
              <button className="btn" onClick={capture} disabled={!ready}>📷 {t("Capture")}</button>
              <button
                className="btn secondary"
                onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
                title={t("Switch between front and back camera")}
              >
                🔄 {facing === "environment" ? t("Front camera") : t("Back camera")}
              </button>
              <button
                className="btn secondary"
                onClick={() => setPortrait((p) => !p)}
                title={t("Switch frame orientation")}
              >
                {portrait ? t("Landscape frame") : t("Portrait frame")}
              </button>
            </>
          )}
          {!error && preview && (
            <>
              <button className="btn" onClick={usePhoto}>✓ {t("Use photo")}</button>
              <button className="btn secondary" onClick={() => { setPreview(null); setBlurry(false); }}>↺ {t("Retake")}</button>
            </>
          )}
          <button className="btn ghost" onClick={onClose}>{t("Cancel")}</button>
        </div>
        {!error && !preview && (
          <p className="muted" style={{ fontSize: 12, margin: "8px 2px 0", textAlign: "center" }}>
            {fullFrame
              ? t("Fit all the cards in the frame, well-lit and in focus. Hold steady; tap to refocus.")
              : t("Line the card up inside the frame — it doesn't have to fill the whole screen. Hold steady; we crop to the box. Tap to refocus.")}
          </p>
        )}
      </div>
    </div>
  );
}

// Variance of the Laplacian on a downscaled grayscale copy — a standard, cheap
// sharpness proxy. Higher = sharper; low values mean the shot is out of focus.
function sharpness(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const tw = 256, th = Math.max(1, Math.round((h / w) * 256));
  const c = document.createElement("canvas");
  c.width = tw; c.height = th;
  const cx = c.getContext("2d");
  if (!cx) return Infinity; // can't measure → don't warn
  cx.drawImage(ctx.canvas, 0, 0, tw, th);
  const d = cx.getImageData(0, 0, tw, th).data;
  const gray = new Float32Array(tw * th);
  for (let i = 0; i < tw * th; i++) {
    gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  }
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < th - 1; y++) {
    for (let x = 1; x < tw - 1; x++) {
      const i = y * tw + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - tw] - gray[i + tw];
      sum += lap; sum2 += lap * lap; n++;
    }
  }
  if (n === 0) return Infinity;
  const mean = sum / n;
  return sum2 / n - mean * mean;
}
