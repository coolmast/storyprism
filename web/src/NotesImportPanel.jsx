import { useState } from "react";
import { importNotes } from "./api.js";
import { useI18n } from "./i18n.jsx";

// Story-level, not per-stop: the whole point is the AI figures out which
// stop each part of the notes belongs to, so it needs to see all of them
// at once. Suggestions are applied one at a time (or all at once) so the
// user can reject ones that got matched to the wrong stop.
export default function NotesImportPanel({ storyId, stops, onApplySuggestion }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("text"); // "text" | "url"
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [applied, setApplied] = useState({});

  function headingFor(stopId) {
    return stops.find((s) => s.id === stopId)?.heading || t("thatStop");
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setSuggestions(null);
    try {
      const { suggestions } = await importNotes(
        storyId,
        mode === "url" ? { url: url.trim() } : { text: text.trim() }
      );
      if (suggestions.length === 0) {
        setError(t("noSuggestionsFound"));
      }
      setSuggestions(suggestions);
      setApplied({});
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function apply(s) {
    onApplySuggestion(s.stopId, {
      narrative: s.narrative,
      ...(s.pullQuote ? { pullQuote: s.pullQuote } : {}),
    });
    setApplied((a) => ({ ...a, [s.stopId]: true }));
  }

  function applyAll() {
    suggestions.forEach((s) => !applied[s.stopId] && apply(s));
  }

  if (!open) {
    return (
      <button className="ai-btn" onClick={() => setOpen(true)}>
        {t("importNotesBtn")}
      </button>
    );
  }

  return (
    <div className="notes-import">
      <div className="interview-header">
        <span>{t("importNotesHeader")}</span>
        <button className="link-btn" onClick={() => setOpen(false)}>
          {t("collapse")}
        </button>
      </div>

      <p className="route-embed-hint">{t("importNotesHint")}</p>

      <div className="notes-import-tabs">
        <button className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>
          {t("pasteTextTab")}
        </button>
        <button className={mode === "url" ? "active" : ""} onClick={() => setMode("url")}>
          {t("linkToArticleTab")}
        </button>
      </div>

      {mode === "text" ? (
        <textarea
          className="notes-import-text"
          placeholder={t("notesPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <input
          className="notes-import-url"
          placeholder={t("urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}

      <button
        className="save-btn"
        onClick={submit}
        disabled={busy || (mode === "text" ? !text.trim() : !url.trim())}
      >
        {busy ? t("readingAndOrganizing") : t("organizeIntoStory")}
      </button>

      {error && <p className="error">{error}</p>}

      {suggestions && suggestions.length > 0 && (
        <div className="notes-suggestions">
          <div className="notes-suggestions-header">
            <span>{t("suggestionsFound", suggestions.length)}</span>
            <button className="link-btn" onClick={applyAll}>
              {t("useAll")}
            </button>
          </div>
          {suggestions.map((s) => (
            <div key={s.stopId} className="interview-draft">
              <h4>{t("forStop", headingFor(s.stopId))}</h4>
              <p>{s.narrative}</p>
              {s.pullQuote && <p className="interview-draft-quote">{t("pullQuoteLabel", s.pullQuote)}</p>}
              <div className="interview-draft-actions">
                <button className="save-btn" onClick={() => apply(s)} disabled={applied[s.stopId]}>
                  {applied[s.stopId] ? t("used") : t("useThis")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
