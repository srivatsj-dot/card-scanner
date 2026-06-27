import { useEffect, useRef, useState } from "react";
import { login, register, hasAnyAccount, loginWithGoogle, accountByEmail, resetPassword, maskEmail } from "../auth";
import { notifySignup, sendResetCode } from "../api";
import { cloudEnabled, cloudForgot, cloudReset } from "../cloud";
import { trackSignup } from "../analytics";
import { useT } from "../translator";
import Logo from "./Logo";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "register" | "reset">(hasAnyAccount() ? "login" : "register");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Password reset (device-local: looks up the account here, server only emails
  // the code). Two steps: enter username → enter emailed code + new password.
  const [resetStep, setResetStep] = useState<"id" | "code">("id");
  const [resetKey, setResetKey] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCodeInput, setResetCodeInput] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const codeRef = useRef<{ code: string; exp: number } | null>(null);

  function openReset() {
    setMode("reset"); setResetStep("id"); setError(null); setInfo(null);
    setPassword(""); setResetCodeInput(""); setResetEmail(""); codeRef.current = null;
  }

  async function startReset() {
    if (busy) return;
    setError(null); setInfo(null);
    // Cloud accounts: the server handles lookup + emailing the code.
    if (await cloudEnabled()) {
      setBusy(true);
      try {
        await cloudForgot(resetEmail.trim());
        setResetStep("code");
        setInfo(`${t("If that email has an account, we sent it a 6-digit code.")}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send the code.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const acct = accountByEmail(resetEmail);
    if (!acct) { setError(t("No account on this device uses that email.")); return; }
    if (acct.isGoogle) { setError(t("This account uses Google sign-in — use Continue with Google to get back in.")); return; }
    setBusy(true);
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String(buf[0] % 1000000).padStart(6, "0");
    codeRef.current = { code, exp: Date.now() + 15 * 60 * 1000 };
    const r = await sendResetCode(acct.email, acct.display, code);
    setBusy(false);
    if (!r.ok) {
      codeRef.current = null;
      setError(r.reason === "email-not-configured"
        ? t("Email isn't set up on the server, so reset codes can't be sent.")
        : r.error || t("Couldn't send the code."));
      return;
    }
    setResetKey(acct.key);
    setResetStep("code");
    setInfo(`${t("We emailed a 6-digit code to")} ${maskEmail(acct.email)}.`);
  }

  async function finishReset() {
    if (busy) return;
    setError(null);
    // Cloud accounts: the server verifies the code and resets the password.
    if (await cloudEnabled()) {
      setBusy(true);
      try {
        await cloudReset(resetEmail.trim(), resetCodeInput.trim(), password);
        setMode("login");
        setResetStep("id");
        setInfo(t("Password reset — sign in with your new password."));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reset.");
      } finally {
        setBusy(false);
      }
      return;
    }
    const rec = codeRef.current;
    if (!rec || Date.now() > rec.exp) { setError(t("The code expired — start over.")); return; }
    if (resetCodeInput.trim() !== rec.code) { setError(t("That code doesn't match. Check the email.")); return; }
    setBusy(true);
    try {
      await resetPassword(resetKey, password);
      codeRef.current = null;
      onAuthed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reset.");
    } finally {
      setBusy(false);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenClientRef = useRef<any>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const onAuthedRef = useRef(onAuthed);
  onAuthedRef.current = onAuthed;

  // Set up Google's OAuth account-picker flow behind our OWN generic "Continue
  // with Google" button — so it never shows a personalized "Continue as <name>".
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    function init() {
      const gsi = (window as unknown as { google?: any }).google;
      if (!gsi?.accounts?.oauth2) return;
      tokenClientRef.current = gsi.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        callback: async (resp: { access_token?: string; error?: string }) => {
          if (resp.error || !resp.access_token) {
            if (resp.error && resp.error !== "access_denied") setError("Google sign-in failed. Try again.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            const r = await loginWithGoogle(resp.access_token);
            if (r.created) {
              trackSignup(); // ad conversion: a real account was created
              notifySignup(r.email, r.display);
            }
            onAuthedRef.current();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Google sign-in failed.");
          } finally {
            setBusy(false);
          }
        },
      });
      setGoogleReady(true);
    }
    if ((window as unknown as { google?: any }).google?.accounts?.oauth2) {
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

  // Always show the account chooser (never auto-continue as the signed-in user).
  function startGoogle() {
    if (busy) return;
    if (!tokenClientRef.current) { setError("Google sign-in is still loading — try again in a second."); return; }
    setError(null);
    tokenClientRef.current.requestAccessToken({ prompt: "select_account" });
  }

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        await register(username, password, email);
        trackSignup(); // ad conversion: a real account was created
        notifySignup(email, username);
      } else {
        await login(username, password);
      }
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
          <h2 className="auth-heading">{mode === "register" ? t("Create your account") : mode === "reset" ? t("Reset password") : t("Welcome back")}</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {mode === "register"
              ? t("Create an account to keep your binder, wishlist, and settings.")
              : mode === "reset"
              ? t("We'll email a one-time code to the address on your account.")
              : t("Log in to your collection.")}
          </p>

        {mode === "reset" && (
          <>
            {resetStep === "id" ? (
              <>
                <label className="field">
                  <span>{t("Email")}</span>
                  <input
                    type="email" autoCapitalize="none" autoCorrect="off" autoComplete="off"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") startReset(); }}
                    placeholder={t("Your email address")}
                  />
                </label>
                {error && <div className="error-box" style={{ marginTop: 4 }}>{error}</div>}
                <button className="btn" style={{ marginTop: 14, width: "100%" }} onClick={startReset} disabled={busy || !resetEmail.trim()}>
                  {busy ? <><span className="spinner" />{t("Sending…")}</> : t("Email me a code")}
                </button>
              </>
            ) : (
              <>
                {info && <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{info}</p>}
                <label className="field">
                  <span>{t("Reset code")}</span>
                  <input
                    type="text" inputMode="numeric" autoComplete="one-time-code"
                    value={resetCodeInput}
                    onChange={(e) => setResetCodeInput(e.target.value)}
                    placeholder={t("6-digit code")}
                  />
                </label>
                <label className="field">
                  <span>{t("New password")}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") finishReset(); }}
                    placeholder={t("Pick a new password")}
                  />
                </label>
                {error && <div className="error-box" style={{ marginTop: 4 }}>{error}</div>}
                <button className="btn" style={{ marginTop: 14, width: "100%" }} onClick={finishReset} disabled={busy || !resetCodeInput.trim() || !password}>
                  {busy ? <><span className="spinner" />{t("Please wait…")}</> : t("Set new password")}
                </button>
                <button className="link-btn" style={{ marginTop: 10 }} onClick={startReset} disabled={busy}>
                  {t("Resend code")}
                </button>
              </>
            )}
            <button className="link-btn" style={{ marginTop: 10 }} onClick={() => { setMode("login"); setError(null); setInfo(null); }}>
              ← {t("Back to log in")}
            </button>
          </>
        )}

        {mode !== "reset" && (<>

        {(
          <>
            <button
              className="btn-google"
              disabled={busy || (!!GOOGLE_CLIENT_ID && !googleReady)}
              onClick={
                GOOGLE_CLIENT_ID
                  ? startGoogle
                  : () => setError(t("Google sign-in isn't available right now. Please use a username and password below."))
              }
            >
              <GoogleG />
              {t("Continue with Google")}
            </button>
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
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("Your username")}
          />
        </label>
        {mode === "register" && (
          <label className="field">
            <span>{t("Email")}</span>
            <input
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={t("Your email address")}
            />
          </label>
        )}
        <label className="field">
          <span>{t("Password")}</span>
          <input
            type="password"
            autoComplete="new-password"
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
          disabled={busy || !username.trim() || !password || (mode === "register" && !email.trim())}
        >
          {busy ? <><span className="spinner" />{t("Please wait…")}</> : mode === "register" ? t("Create account") : t("Log in")}
        </button>

        {mode === "login" && (
          <button className="link-btn" style={{ marginTop: 12 }} onClick={openReset}>
            {t("Forgot password?")}
          </button>
        )}

        <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
          {t("Accounts are stored on this device. A forgotten password can be reset with a code emailed to the address on your account.")}
        </p>
        </>)}
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
