import { useEffect, useState } from "react";
import { saveStory, draftCaption, researchPlace, fetchThemes } from "./api.js";
import IncludedPhotoGrid from "./IncludedPhotoGrid.jsx";
import InterviewPanel from "./InterviewPanel.jsx";

function formatRange(start, end) {
  const opts = { day: "numeric", month: "short", year: "numeric" };
  const s = new Date(start).toLocaleDateString(undefined, opts);
  const e = new Date(end).toLocaleDateString(undefined, opts);
  return s === e ? s : `${s} – ${e}`;
}

export default function StoryEditor({ story, onBack, onSaved }) {
  const [draft, setDraft] = useState(story);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null); // id of photo/stop currently asking AI
  const [aiError, setAiError] = useState(null);
  const [themes, setThemes] = useState([]);

  useEffect(() => {
    setDraft(story);
    setDirty(false);
  }, [story]);

  useEffect(() => {
    fetchThemes().then(setThemes).catch(() => {});
  }, []);

  function markDirty(updater) {
    setDraft(updater);
    setDirty(true);
  }

  function updateStop(stopId, patch) {
    markDirty((d) => ({
      ...d,
      stops: d.stops.map((s) => (s.id === stopId ? { ...s, ...patch } : s)),
    }));
  }

  function updatePhoto(stopId, photoId, patch) {
    markDirty((d) => ({
      ...d,
      stops: d.stops.map((s) =>
        s.id !== stopId
          ? s
          : { ...s, photos: s.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)) }
      ),
    }));
  }

  function toggleFeatured(stopId, photoId) {
    markDirty((d) => ({
      ...d,
      stops: d.stops.map((s) =>
        s.id !== stopId
          ? s
          : {
              ...s,
              photos: s.photos.map((p) => ({
                ...p,
                featured: p.id === photoId ? !p.featured : false,
              })),
            }
      ),
    }));
  }

  function reorderPhotos(stopId, oldIndex, newIndex) {
    markDirty((d) => ({
      ...d,
      stops: d.stops.map((s) => {
        if (s.id !== stopId) return s;
        const included = s.photos.filter((p) => p.included);
        const excluded = s.photos.filter((p) => !p.included);
        const reordered = [...included];
        const [moved] = reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, moved);
        // Excluded photos don't have a visible order (they're a checkbox
        // list), so just keep them after the ones that matter.
        return { ...s, photos: [...reordered, ...excluded] };
      }),
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const saved = await saveStory(draft.id, draft);
      setDraft(saved);
      setDirty(false);
      onSaved?.(saved);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDraftCaption(stopId, photoId) {
    setBusy(photoId);
    setAiError(null);
    try {
      const { caption } = await draftCaption(draft.id, stopId, photoId);
      updatePhoto(stopId, photoId, { caption });
    } catch (e) {
      setAiError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function handleResearch(stopId) {
    setBusy(stopId);
    setAiError(null);
    try {
      const { research } = await researchPlace(draft.id, stopId);
      updateStop(stopId, { research });
    } catch (e) {
      setAiError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="story-editor">
      <div className="editor-toolbar">
        <button className="link-btn" onClick={onBack}>← My Stories</button>
        <div className="toolbar-actions">
          <a className="link-btn" href={`/story/${draft.id}`} target="_blank" rel="noreferrer">
            View story ↗
          </a>
          <a className="link-btn" href={`/story/${draft.id}/present`} target="_blank" rel="noreferrer">
            Present ↗
          </a>
          <a className="link-btn" href={`/api/stories/${draft.id}/export/pdf`}>
            Download PDF ↓
          </a>
          <a className="link-btn" href={`/api/stories/${draft.id}/export/deck-pdf`}>
            Download Slides ↓
          </a>
          <button className="save-btn" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {aiError && <p className="error">{aiError}</p>}

      <input
        className="story-title-input"
        value={draft.title}
        onChange={(e) => markDirty((d) => ({ ...d, title: e.target.value }))}
      />

      <div className="theme-picker">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-swatch ${draft.theme === t.id ? "active" : ""}`}
            title={t.label}
            onClick={() => markDirty((d) => ({ ...d, theme: t.id }))}
          >
            <span className="theme-swatch-colors">
              {t.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        className="story-intro"
        placeholder="Write an intro for this story…"
        value={draft.intro}
        onChange={(e) => markDirty((d) => ({ ...d, intro: e.target.value }))}
      />

      {draft.stops.map((stop) => (
        <section key={stop.id} className="stop-editor">
          <div className="stop-editor-header">
            <input
              className="stop-heading-input"
              value={stop.heading}
              onChange={(e) => updateStop(stop.id, { heading: e.target.value })}
            />
            <span className="stop-dates">{formatRange(stop.startedAt, stop.endedAt)}</span>
          </div>

          <textarea
            className="stop-narrative"
            placeholder="What happened here?"
            value={stop.narrative}
            onChange={(e) => updateStop(stop.id, { narrative: e.target.value })}
          />

          <input
            className="stop-pull-quote-input"
            placeholder="Pull quote (optional) — one striking line, rendered large"
            value={stop.pullQuote || ""}
            onChange={(e) => updateStop(stop.id, { pullQuote: e.target.value })}
          />

          <InterviewPanel
            storyId={draft.id}
            stopId={stop.id}
            onUseDraft={(result) =>
              updateStop(stop.id, {
                narrative: result.narrative,
                ...(result.pullQuote ? { pullQuote: result.pullQuote } : {}),
              })
            }
          />

          <div className="stop-research">
            <button
              className="ai-btn"
              onClick={() => handleResearch(stop.id)}
              disabled={busy === stop.id}
            >
              {busy === stop.id ? "Researching…" : "✨ Research this place"}
            </button>
            {stop.research && (
              <textarea
                className="stop-research-text"
                value={stop.research}
                onChange={(e) => updateStop(stop.id, { research: e.target.value })}
              />
            )}
          </div>

          <p className="photo-count-hint">
            {stop.photos.filter((p) => p.included).length} of {stop.photos.length} photos in the
            story — drag &#10021; to reorder, check more below to add them.
          </p>

          <IncludedPhotoGrid
            stopId={stop.id}
            photos={stop.photos.filter((p) => p.included)}
            onReorder={reorderPhotos}
            onUpdatePhoto={updatePhoto}
            onToggleFeatured={toggleFeatured}
            onDraftCaption={handleDraftCaption}
            busy={busy}
          />

          {stop.photos.some((p) => !p.included) && (
            <details className="more-photos">
              <summary>
                {stop.photos.filter((p) => !p.included).length} more photos from this stop
              </summary>
              <div className="thumb-grid">
                {stop.photos
                  .filter((p) => !p.included)
                  .map((photo) => (
                    <label className="thumb-toggle" key={photo.id}>
                      <input
                        type="checkbox"
                        checked={photo.included}
                        onChange={(e) => updatePhoto(stop.id, photo.id, { included: e.target.checked })}
                      />
                      {photo.thumbUrl && <img src={photo.thumbUrl} alt="" />}
                    </label>
                  ))}
              </div>
            </details>
          )}
        </section>
      ))}

      <textarea
        className="story-outro"
        placeholder="Write an outro for this story…"
        value={draft.outro}
        onChange={(e) => markDirty((d) => ({ ...d, outro: e.target.value }))}
      />
    </div>
  );
}
