import { useRef, useState } from "react";
import type { ScanResult, Settings } from "../types";
import { scanCard } from "../api";
import ResultCard from "./ResultCard";
import CameraModal from "./CameraModal";

interface Props {
  settings: Settings;
  result: ScanResult | null;
  onResult: (r: ScanResult | null) => void;
}

export default function ScanView({ settings, result, onResult }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <div>
      <div className="card">
        <h2>Scan a card</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Use your camera or upload a photo of the front of any card — Pokémon, baseball, soccer,
          cricket, basketball, football, or hockey.
        </p>

        {!dataUrl && (
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
              <button className="btn" onClick={() => setShowCamera(true)}>📸 Use camera</button>
              <button className="btn secondary" onClick={() => fileRef.current?.click()}>
                Upload file
              </button>
            </div>
          </div>
        )}

        {dataUrl && (
          <div className="preview">
            <img src={dataUrl} alt="card preview" />
            <div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={runScan} disabled={loading}>
                  {loading ? <><span className="spinner" />Analyzing…</> : "Analyze card"}
                </button>
                <button className="btn secondary" onClick={() => setShowCamera(true)} disabled={loading}>
                  📸 Retake
                </button>
                <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                  Upload file
                </button>
                <button
                  className="btn ghost"
                  onClick={() => { setDataUrl(null); onResult(null); setError(null); }}
                  disabled={loading}
                >
                  Clear
                </button>
              </div>
              {loading && (
                <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
                  Researching the card, current value, and trade ideas…
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

      {showCamera && (
        <CameraModal
          onCapture={(d) => { setDataUrl(d); onResult(null); }}
          onClose={() => setShowCamera(false)}
        />
      )}
    </div>
  );
}
