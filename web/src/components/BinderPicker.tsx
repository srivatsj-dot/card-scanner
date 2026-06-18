import type { SavedCard } from "../types";

interface Props {
  saved: SavedCard[];
  onPick: (card: SavedCard) => void;
  onClose: () => void;
}

/** Modal to pick a card from the saved binder (used by the trade tool). */
export default function BinderPicker({ saved, onPick, onClose }: Props) {
  return (
    <div className="cam-overlay" onClick={onClose}>
      <div className="cam-box" onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 96vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>Pick from your binder</strong>
          <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        {saved.length === 0 ? (
          <p className="muted">Your binder is empty. Save a scan first.</p>
        ) : (
          <div style={{ maxHeight: "60vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {saved.map((s) => (
              <button key={s.id} className="picker-row" onClick={() => onPick(s)}>
                {s.thumbnail ? (
                  <img className="thumb" src={s.thumbnail} alt={s.result.player || "card"} />
                ) : (
                  <div className="thumb placeholder">★</div>
                )}
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div style={{ fontWeight: 700 }}>{s.result.player || "Unknown card"}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[s.result.year, s.result.manufacturer, s.result.setName].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
