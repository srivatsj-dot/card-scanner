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
      <div className="auth-side">
        <div className="auth-logo"><Logo size={64} /></div>
        <h1 className="auth-brand">Card-O-Rama</h1>
        <p className="auth-tagline">{t("Scan it. Price it. Trade smarter.")}</p>
        <ul className="auth-points">
          <li>{t("Instant AI value, stats & condition on any card")}</li>
          <li>{t("Track your binder, wishlist & trades")}</li>
          <li>{t("Earn achievements as your collection grows")}</li>
        </ul>
      </div>
      <div className="auth-main">
        <div className="auth-card">
          <h2 className="auth-heading">{mode === "register" ? t("Create your account") : t("Welcome back")}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {mode === "register"
              ? t("Create an account to keep your binder, wishlist, and settings.")
              : t("Log in to your collection.")}
          </p>

        {GOOGLE_CLIENT_ID ? (
          <div ref={googleBtnRef} className="google-btn-host" />
        ) : (
          <button
            className="btn-google"
            onClick={() =>
              setError(
                t("Google sign-in isn't set up yet — add a VITE_GOOGLE_CLIENT_ID to your .env to turn it on. For now, use a username and password below.")
              )
            }
          >
            <GoogleG />
            {t("Continue with Google")}
          </button>
        )}
        <div className="auth-divider"><span>{t("or")}</span></div>

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

        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          {t("Accounts are stored only on this device. There's no password recovery, so don't lose it.")}
        </p>
        </div>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
