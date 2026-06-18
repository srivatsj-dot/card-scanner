import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Live camera with a capture shutter. Reused by the scan view and trade rows.
 * The stream is attached in a mount effect (after the <video> exists) and
 * play() is retried on multiple events so the preview isn't black. The preview
 * uses object-fit: contain (never crops) and a Portrait/Landscape toggle so
 * vertical cards fit.
 */
export default function CameraModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [portrait, setPortrait] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't access the camera. Use Upload instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment", // rear camera on phones
            aspectRatio: portrait ? 3 / 4 : 4 / 3, // a hint; desktops may ignore
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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
            "Camera permission is blocked for this site. In Safari: top menu → Safari → Settings for localhost… → set Camera to Allow, then reload. Or just use Upload."
          );
        } else if (name === "NotFoundError") {
          setError("No camera was found on this device. Use Upload instead.");
        } else {
          setError("Couldn't open the camera. Make sure no other app is using it, or use Upload.");
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [portrait]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // Capture the full native frame (no crop), regardless of preview size.
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.92));
    onClose();
  }

  return (
    <div className="cam-overlay" onClick={onClose}>
      <div className="cam-box" onClick={(e) => e.stopPropagation()}>
        {error ? (
          <div className="error-box">{error}</div>
        ) : (
          <div
            className={`cam-stage ${portrait ? "portrait" : "landscape"}`}
            onClick={() => videoRef.current?.play().then(() => setReady(true)).catch(() => {})}
          >
            <video ref={videoRef} autoPlay playsInline muted className="cam-video" />
            {!ready && <div className="cam-hint muted">Starting camera… (tap if it stays black)</div>}
          </div>
        )}

        <div className="cam-actions">
          {!error && (
            <>
              <button className="btn" onClick={capture} disabled={!ready}>📷 Capture</button>
              <button
                className="btn secondary"
                onClick={() => setPortrait((p) => !p)}
                title="Switch frame orientation"
              >
                {portrait ? "Landscape frame" : "Portrait frame"}
              </button>
            </>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
        {!error && (
          <p className="muted" style={{ fontSize: 12, margin: "8px 2px 0", textAlign: "center" }}>
            Fill the frame with the card. Use the orientation button for vertical cards.
          </p>
        )}
      </div>
    </div>
  );
}
