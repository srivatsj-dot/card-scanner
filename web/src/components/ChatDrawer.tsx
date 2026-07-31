import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ScanResult, Settings } from "../types";
import { streamChat, askAssistant, type AssistantAction } from "../api";
import { useT } from "../translator";

interface Props {
  settings: Settings;
  cardContext: ScanResult | null;
  onClose: () => void;
  /** A snapshot of the collector's own data, so the assistant can answer about it. */
  context?: unknown;
  /** Carry out an action the assistant asked for; returns what happened. */
  onAction?: (a: AssistantAction) => string | null;
}

export default function ChatDrawer({ settings, cardContext, onClose, context, onAction }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    // The assistant path knows the collector's own data and can act on the app.
    // It's the right answer for "add X to my wishlist" or "what's my binder
    // worth" — anything else falls through to the streaming appraiser below.
    if (onAction) {
      try {
        const { reply, actions } = await askAssistant(history, settings, context);
        const done = (actions || []).map((a) => onAction(a)).filter(Boolean) as string[];
        const body = [reply, ...done.map((d) => `✅ ${d}`)].filter(Boolean).join("\n");
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: body || t("Done.") };
          return next;
        });
        setBusy(false);
        return;
      } catch {
        // Assistant unavailable — fall back to the normal streaming chat.
      }
    }

    try {
      await streamChat(history, settings, cardContext ?? undefined, (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + delta,
          };
          return next;
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content === "") return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="drawer">
        <header>
          <div>
            <strong>{t("Ask Card-O-Rama")}</strong>
            {cardContext?.player && (
              <div className="muted" style={{ fontSize: 12 }}>{t("About:")} {cardContext.player}</div>
            )}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="msgs" ref={msgsRef}>
          {messages.length === 0 && (
            <div className="muted" style={{ fontSize: 14 }}>
              {t("Ask anything, or tell me what to do — “add a Luka Dončić rookie to my wishlist”, “what was my collection worth last month?”, “star my Ohtani”, “refresh my prices”, “is this a good long-term hold?”")}
              {cardContext?.player ? " " + t("I have your scanned card as context.") : ""}
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          ))}
          {error && <div className="error-box">{error}</div>}
        </div>

        <div className="composer">
          <input
            type="text"
            value={input}
            placeholder={t("Ask a question, or tell me to do something…")}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            disabled={busy}
          />
          <button className="btn" onClick={send} disabled={busy || !input.trim()}>
            {t("Send")}
          </button>
        </div>
      </aside>
    </>
  );
}
