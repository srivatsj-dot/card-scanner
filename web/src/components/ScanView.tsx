import { useEffect, useRef, useState } from "react";
import type { ScanResult, Settings } from "../types";
import { scanCard } from "../api";
import ResultCard from "./ResultCard";

interface Props {
  settings: Settings;
  result: ScanResult | null;
  onResult: (r: ScanResult | null) => void;
}

export default function ScanView({ settings, result, onResult }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  // Clean up the camera if the component unmounts.
  useEffect(() => () => stopCamera(), []);

  async function startCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser doesn't support camera access. Use file upload instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, // prefer the rear camera on phones
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setDataUrl(null);
      onResult(null);
      // Attach after render so the <video> element exists.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (e) {
      setError(
        "Couldn't open the camera. Check that you allowed camera permission (and that the page is on https or localhost)."
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setDataUrl(canvas.toDataURL("image/jpeg", 0.92));
    onResult(null);
    stopCamera();
  }

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setDataUrl(reader.result as string);
      onResult(null);
    };
    reader.readAsDataURL(file);
  }

  async function runScan() {
    if (!dataUrl) return;
    setLoading(true);
    setError(null);
    try {
      const r = await scanCard(dataUrl, settings);
      onResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    stopCamera();
    setDataUrl(null);
    onResult(null);
    setError(null);
  }

  return (
    <div>
      <div className="card">
        <h2>Scan a card</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Use your camera or upload a photo of the front of any card — Pokémon, baseball, soccer,
          cricket, basketball, football, or hockey.
        </p>

        {/* Live camera */}
        {cameraOn && (
          <div>
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: "100%",
                maxWidth: 480,
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "#000",
                display: "block",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn" onClick={capturePhoto}>📷 Capture</button>
              <button className="btn ghost" onClick={stopCamera}>Cancel</button>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Line the card up to fill the frame, then capture.
            </p>
          </div>
        )}

        {/* Empty state: choose camera or file */}
        {!cameraOn && !dataUrl && (
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            <div className="big">Scan a card</div>
            <div className="muted" style={{ marginBottom: 16 }}>
              Use your camera, or drop / choose an image (JPG, PNG, WEBP)
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button className="btn" onClick={startCamera}>📸 Use camera</button>
              <button className="btn secondary" onClick={() => fileRef.current?.click()}>
                Upload file
              </button>
            </div>
          </div>
        )}

        {/* Captured / uploaded preview */}
        {!cameraOn && dataUrl && (
          <div className="preview">
            <img src={dataUrl} alt="card preview" />
            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={runScan} disabled={loading}>
                  {loading ? <><span className="spinner" />Analyzing…</> : "Analyze card"}
                </button>
                <button className="btn secondary" onClick={startCamera} disabled={loading}>
                  📸 Retake
                </button>
                <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                  Upload file
                </button>
                <button className="btn ghost" onClick={reset} disabled={loading}>
                  Clear
                </button>
              </div>
              {loading && (
                <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                  Identifying the card, checking special editions, and pulling trade ideas…
                </p>
              )}
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {result && <div style={{ marginTop: 16 }}><ResultCard result={result} /></div>}
    </div>
  );
}
