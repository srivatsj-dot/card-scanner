import { useState } from "react";
import { login, register, hasAnyAccount } from "../auth";
import { useT } from "../translator";

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"login" | "register">(hasAnyAccount() ? "login" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="card auth-card">
        <div className="brand" style={{ justifyContent: "center", marginBottom: 6 }}>
          <h1>Card<span className="dot">·</span>Scanner</h1>
        </div>
        <p className="muted" style={{ textAlign: "center", marginTop: 0 }}>
          {mode === "register"
            ? t("Create an account to keep your binder, wishlist, and settings.")
            : t("Welcome back — log in to your collection.")}
        </p>

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
