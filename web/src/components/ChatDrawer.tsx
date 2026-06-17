import { useEffect, useRef, useState } from "react";
import type { ChatMessage, ScanResult, Settings } from "../types";
import { streamChat } from "../api";

interface Props {
  settings: Settings;
  cardContext: ScanResult | null;
  onClose: () => void;
}

export default function ChatDrawer({ settings, cardContext, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    // Add an empty assistant bubble we stream into.
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

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
      // Drop the empty/partial assistant bubble on error.
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
            <strong>Ask the appraiser</strong>
            {cardContext?.player && (
              <div className="muted" style={{ fontSize: 12 }}>About: {cardContext.player}</div>
            )}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="msgs" ref={msgsRef}>
          {messages.length === 0 && (
            <div className="muted" style={{ fontSize: 14 }}>
              Ask anything — “Is this a good long-term hold?”, “What grade could it get?”, “Who
              else should I target?”
              {cardContext?.player ? " I have your scanned card as context." : ""}
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
            placeholder="Type a question…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            disabled={busy}
          />
          <button className="btn" onClick={send} disabled={busy || !input.trim()}>
            Send
          </button>
        </div>
      </aside>
    </>
  );
}
