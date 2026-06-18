import { useEffect, useRef, useState } from "react";

interface Props {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Full-screen live camera with a capture shutter. Reused by the scan view and
 * the trade card rows. The stream is attached inside a mount effect (after the
 * <video> element exists) so the preview isn't black.
 */
export default function CameraModal({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't access the camera. Use file upload instead.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" }, // rear camera on phones
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
          video.onloadedmetadata = () => {
            video.play().then(() => setReady(true)).catch(() => setReady(true));
          };
        }
      } catch {
        setError(
          "Couldn't open the camera. Allow camera permission, and make sure the page is on http://localhost or https."
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
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
          <>
            <video ref={videoRef} autoPlay playsInline muted className="cam-video" />
            {!ready && <div className="muted" style={{ padding: 8 }}>Starting camera…</div>}
          </>
        )}
        <div className="cam-actions">
          {!error && (
            <button className="btn" onClick={capture} disabled={!ready}>
              📷 Capture
            </button>
          )}
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
