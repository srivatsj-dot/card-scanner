import { useT } from "../translator";
import Logo from "./Logo";

// Centered welcome modal shown on entry: log in / sign up, or continue as guest.
// Dismissable with the top-right ✕ or "Continue as guest".
export default function LoginModal({ onLogin, onGuest }: { onLogin: () => void; onGuest: () => void }) {
  const t = useT();
  return (
    <div className="backdrop" onClick={onGuest}>
      <div className="card login-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" aria-label={t("Close")} onClick={onGuest}>✕</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block" }}><Logo size={48} /></div>
          <h2 style={{ margin: "10px 0 4px" }}>{t("Welcome to Card-O-Rama")}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {t("Log in to save your binder, wishlist, and trades and sync them across devices — or keep looking around as a guest.")}
          </p>
          <button className="btn" style={{ width: "100%", marginTop: 10 }} onClick={onLogin}>
            👤 {t("Log in / Sign up")}
          </button>
          <button className="btn ghost" style={{ width: "100%", marginTop: 8 }} onClick={onGuest}>
            {t("Continue as guest")}
          </button>
        </div>
      </div>
    </div>
  );
}
