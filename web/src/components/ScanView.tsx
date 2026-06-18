import { useRef, useState } from "react";
import type { ScanResult, Settings } from "../types";
import { scanCard } from "../api";
import { makeThumbnail } from "../utils";
import ResultCard from "./ResultCard";
import CameraModal from "./CameraModal";

interface Props {
  settings: Settings;
  result: ScanResult | null;
  onResult: (r: ScanResult | null) => void;
  onSave: (result: ScanResult, frontDataUrl: string | undefined) => void;
}

const MAX_IMAGES = 4;

export default function ScanView({ settings, result, onResult, onSave }: Props) {
  const [images, setImages] = useState<string[]>([]); // data URLs
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addImage(dataUrl: string) {
    setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, dataUrl]));
    onResult(null);
    setSaved(false);
  }

  function handleFiles(files: FileList) {
    setError(null);
    Array.from(files)
      .slice(0, MAX_IMAGES - images.length)
      .forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = () => addImage(reader.result as string);
        reader.readAsDataURL(file);
      });
  }

  async function runScan() {
    if (images.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await scanCard(images, settings);
      onResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!result) return;
    const thumb = images[0] ? await makeThumbnail(images[0]) : undefined;
    onSave(result, thumb);
    setSaved(true);
  }

  const labels = ["Front", "Back", "Angle", "Extra"];

  return (
    <div>
      <div className="card">
        <h2>Scan a card</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Add up to {MAX_IMAGES} photos of the <strong>same</strong> card — front, back, and an
          angled shot help read serial numbers and spot refractors/parallels. Works for Pokémon,
          baseball, soccer, cricket, basketball, football, and hockey.
        </p>

        {images.length > 0 && (
          <div className="img-strip">
            {images.map((src, i) => (
              <div className="img-slot" key={i}>
                <img src={src} alt={labels[i] || `photo ${i + 1}`} />
                <span className="img-label">{labels[i] || `Photo ${i + 1}`}</span>
                <button
                  className="img-remove"
                  onClick={() => {
                    setImages(images.filter((_, j) => j !== i));
                    onResult(null);
                    setSaved(false);
                  }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={images.length === 0 ? "dropzone" : ""}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          style={images.length === 0 ? {} : { marginTop: 4 }}
        >
          {images.length === 0 && (
            <>
              <div className="big">Scan a card</div>
              <div className="muted" style={{ marginBottom: 16 }}>
                Use your camera, or drop / choose images (JPG, PNG, WEBP)
              </div>
            </>
          )}
          {images.length < MAX_IMAGES && (
            <div style={{ display: "flex", gap: 8, justifyContent: images.length === 0 ? "center" : "flex-start", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => setShowCamera(true)} disabled={loading}>
                📸 {images.length === 0 ? "Use camera" : "Add photo"}
              </button>
              <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                Upload file{images.length === 0 ? "" : "(s)"}
              </button>
            </div>
          )}
        </div>

        {images.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button className="btn" onClick={runScan} disabled={loading}>
              {loading ? <><span className="spinner" />Analyzing…</> : `Analyze card${images.length > 1 ? ` (${images.length} photos)` : ""}`}
            </button>
            <button
              className="btn ghost"
              onClick={() => { setImages([]); onResult(null); setError(null); setSaved(false); }}
              disabled={loading}
            >
              Clear
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {error && <div className="error-box" style={{ marginTop: 14 }}>{error}</div>}
      </div>

      {result && (
        <div style={{ marginTop: 16 }}>
          {result.identified && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: 14 }}>Keep this in your collection?</span>
              <button className="btn" onClick={save} disabled={saved}>
                {saved ? "✓ Saved to binder" : "★ Save to binder"}
              </button>
            </div>
          )}
          <ResultCard result={result} />
        </div>
      )}

      {showCamera && (
        <CameraModal onCapture={(d) => addImage(d)} onClose={() => setShowCamera(false)} />
      )}
    </div>
  );
}
