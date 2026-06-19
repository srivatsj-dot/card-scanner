import { useEffect, useRef, useState } from "react";
import { login, register, hasAnyAccount, loginWithGoogle } from "../auth";
import { useT } from "../translator";
import Logo from "./Logo";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "register">(hasAnyAccount() ? "login" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const onAuthedRef = useRef(onAuthed);
  onAuthedRef.current = onAuthed;

  // Render Google's "Continue with Google" button when a client ID is configured.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    function init() {
      const gsi = (window as unknown as { google?: any }).google;
      if (!gsi?.accounts?.id || !googleBtnRef.current) return;
      gsi.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp: { credential?: string }) => {
          try {
            if (!resp.credential) throw new Error("Google sign-in was cancelled.");
            loginWithGoogle(resp.credential);
            onAuthedRef.current();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Google sign-in failed.");
          }
        },
      });
      gsi.accounts.id.renderButton(googleBtnRef.current, {
        theme: "filled_blue",
        size: "large",
        width: 320,
        text: "continue_with",
        shape: "pill",
      });
    }
    if ((window as unknown as { google?: any }).google?.accounts?.id) {
      init();
      return;
    }
    let script = document.getElementById("gis-script") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.id = "gis-script";
      document.body.appendChild(script);
    }
    script.addEventListener("load", init);
    return () => script?.removeEventListener("load", init);
  }, []);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") await register(username, password);
      else await login(username, password);
      onAuthed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-hero">
        <div className="auth-logo"><Logo size={72} /></div>
        <h1 className="auth-brand">Card-O-Rama</h1>
        <p className="auth-tagline">{t("Scan it. Price it. Trade smarter.")}</p>
      </div>
      <div className="card auth-card">
        <p className="muted" style={{ textAlign: "center", marginTop: 0 }}>
          {mode === "register"
            ? t("Create an account to keep your binder, wishlist, and settings.")
            : t("Welcome back — log in to your collection.")}
        </p>

        {GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleBtnRef} className="google-btn-host" />
            <div className="auth-divider"><span>{t("or")}</span></div>
          </>
        )}

        <div className="auth-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => { setMode("login"); setError(null); }}
          >
            {t("Log in")}
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => { setMode("register"); setError(null); }}
          >
            {t("Create account")}
          </button>
        </div>

        <label className="field">
          <span>{t("Username")}</span>
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("e.g. cardshark22")}
          />
        </label>
        <label className="field">
          <span>{t("Password")}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={mode === "register" ? t("Pick a password") : t("Your password")}
          />
        </label>

        {error && <div className="error-box" style={{ marginTop: 4 }}>{error}</div>}

        <button
          className="btn"
          style={{ marginTop: 14, width: "100%" }}
          onClick={submit}
          disabled={busy || !username.trim() || !password}
        >
          {busy ? <><span className="spinner" />{t("Please wait…")}</> : mode === "register" ? t("Create account") : t("Log in")}
        </button>

        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0, textAlign: "center" }}>
          {t("Accounts are stored only on this device. There's no password recovery, so don't lose it.")}
        </p>
      </div>
    </div>
  );
}
