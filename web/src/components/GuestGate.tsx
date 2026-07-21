import { useT } from "../translator";

// Shown in place of a collection screen when browsing as a guest — instead of
// hiding the section entirely, invite sign-in with "Log in" as a blue link.
export default function GuestGate({ feature, onLogin }: { feature: string; onLogin: () => void }) {
  const t = useT();
  return (
    <div className="card guest-gate">
      <div style={{ fontSize: 40 }}>🔒</div>
      <h2 style={{ margin: "8px 0 6px" }}>
        <button className="link-inline" onClick={onLogin}>{t("Log in")}</button> {t("to use this feature")}
      </h2>
      <p className="muted" style={{ marginTop: 0 }}>{t(feature)}</p>
    </div>
  );
}
