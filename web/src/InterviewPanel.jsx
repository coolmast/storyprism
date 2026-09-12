import { useState } from "react";
import { interviewTurn, draftFromInterview } from "./api.js";
import { useI18n } from "./i18n.jsx";

// Conversation lives only in this component's state - it's a within-session
// ghostwriter chat, not persisted to the story. Re-opening the panel after
// collapsing it keeps going where it left off; reloading the page starts
// fresh. That matches how the other AI actions here work (one-shot, not
// stored) while still giving real back-and-forth iteration during a sitting.
export default function InterviewPanel({ storyId, stopId, onUseDraft }) {
  const { t } = useI18n();
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
      { role: "assistant", content: t("usedRewriteMsg") },
    ]);
  }

  if (!open) {
    return (
      <button className="ai-btn" onClick={open_}>
        {t("interviewMeBtn")}
      </button>
    );
  }

  return (
    <div className="interview-panel">
      <div className="interview-header">
        <span>{t("ghostwriterInterview")}</span>
        <button className="link-btn" onClick={() => setOpen(false)}>
          {t("collapse")}
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
          <h4>{t("proposedRewrite")}</h4>
          <p>{draft.narrative}</p>
          {draft.pullQuote && (
            <p className="interview-draft-quote">{t("pullQuoteLabel", draft.pullQuote)}</p>
          )}
          <div className="interview-draft-actions">
            <button className="save-btn" onClick={acceptDraft}>
              {t("useThis")}
            </button>
            <button className="link-btn" onClick={() => setDraft(null)}>
              {t("keepChattingInstead")}
            </button>
          </div>
        </div>
      )}

      {!draft && (
        <>
          <div className="interview-input-row">
            <textarea
              placeholder={t("typeYourAnswer")}
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
              {t("send")}
            </button>
          </div>
          <button
            className="ai-btn"
            onClick={requestDraft}
            disabled={busy || messages.length === 0}
          >
            {t("draftRewriteBtn")}
          </button>
        </>
      )}
    </div>
  );
}
