import { useState } from "react";
import { interviewTurn, draftFromInterview } from "./api.js";

// Conversation lives only in this component's state - it's a within-session
// ghostwriter chat, not persisted to the story. Re-opening the panel after
// collapsing it keeps going where it left off; reloading the page starts
// fresh. That matches how the other AI actions here work (one-shot, not
// stored) while still giving real back-and-forth iteration during a sitting.
export default function InterviewPanel({ storyId, stopId, onUseDraft }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(null);

  async function open_() {
    setOpen(true);
    if (messages.length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const { reply } = await interviewTurn(storyId, stopId, []);
      setMessages([{ role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const { reply } = await interviewTurn(storyId, stopId, next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestDraft() {
    setBusy(true);
    setError(null);
    try {
      const result = await draftFromInterview(storyId, stopId, messages);
      setDraft(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function acceptDraft() {
    onUseDraft(draft);
    setDraft(null);
    setMessages((m) => [
      ...m,
      { role: "assistant", content: "Used that rewrite - keep going if you want to refine it further." },
    ]);
  }

  if (!open) {
    return (
      <button className="ai-btn" onClick={open_}>
        💬 Interview me about this stop
      </button>
    );
  }

  return (
    <div className="interview-panel">
      <div className="interview-header">
        <span>💬 Ghostwriter interview</span>
        <button className="link-btn" onClick={() => setOpen(false)}>
          Collapse
        </button>
      </div>

      <div className="interview-messages">
        {messages.map((m, i) => (
          <div key={i} className={`interview-bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="interview-bubble assistant busy">…</div>}
      </div>

      {error && <p className="error">{error}</p>}

      {draft && (
        <div className="interview-draft">
          <h4>Proposed rewrite</h4>
          <p>{draft.narrative}</p>
          {draft.pullQuote && (
            <p className="interview-draft-quote">Pull quote: “{draft.pullQuote}”</p>
          )}
          <div className="interview-draft-actions">
            <button className="save-btn" onClick={acceptDraft}>
              Use this
            </button>
            <button className="link-btn" onClick={() => setDraft(null)}>
              Keep chatting instead
            </button>
          </div>
        </div>
      )}

      {!draft && (
        <>
          <div className="interview-input-row">
            <textarea
              placeholder="Type your answer…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={busy}
            />
            <button className="save-btn" onClick={send} disabled={busy || !input.trim()}>
              Send
            </button>
          </div>
          <button
            className="ai-btn"
            onClick={requestDraft}
            disabled={busy || messages.length === 0}
          >
            ✍️ Draft rewrite from this conversation
          </button>
        </>
      )}
    </div>
  );
}
