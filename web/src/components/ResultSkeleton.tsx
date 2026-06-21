import { useT } from "../translator";

// A placeholder that mirrors ResultCard's layout while a lookup is in flight, so
// the page fills in immediately instead of showing a bare spinner. If we already
// know what the user typed (search), we echo it as the title so the identity is
// on screen the instant they hit enter.
export default function ResultSkeleton({ title }: { title?: string }) {
  const t = useT();
  const bar = (w: string, h = 14) => (
    <span className="sk-bar" style={{ width: w, height: h }} aria-hidden />
  );
  return (
    <div className="result-skeleton" aria-busy="true" aria-label={t("Looking up the card…")}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title ? <h2 style={{ marginBottom: 8 }}>{title}</h2> : bar("55%", 22)}
            <div style={{ marginTop: 10 }}>{bar("40%")}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              {bar("64px", 22)}
              {bar("52px", 22)}
              {bar("48px", 22)}
            </div>
          </div>
          <div className="sk-ring" aria-hidden />
        </div>
      </div>
      <div className="grid2">
        <div className="card">
          {bar("45%", 16)}
          <div style={{ marginTop: 14 }}>{bar("60%", 28)}</div>
          <div style={{ marginTop: 12 }}>{bar("90%")}</div>
          <div style={{ marginTop: 8 }}>{bar("80%")}</div>
        </div>
        <div className="card">
          {bar("50%", 16)}
          <div style={{ marginTop: 14 }}>{bar("70px", 22)}</div>
          <div style={{ marginTop: 12 }}>{bar("95%")}</div>
          <div style={{ marginTop: 8 }}>{bar("85%")}</div>
        </div>
      </div>
      <div className="card">
        {bar("35%", 16)}
        <div style={{ marginTop: 12 }}>{bar("100%")}</div>
        <div style={{ marginTop: 8 }}>{bar("92%")}</div>
        <div style={{ marginTop: 8 }}>{bar("78%")}</div>
      </div>
      <p className="muted sk-note">{t("Pulling live prices and player form…")}</p>
    </div>
  );
}
