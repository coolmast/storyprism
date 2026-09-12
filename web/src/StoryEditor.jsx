import { useEffect, useState } from "react";
import { saveStory, draftCaption, researchPlace } from "./api.js";

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

  useEffect(() => {
    setDraft(story);
    setDirty(false);
  }, [story]);

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
        <button className="save-btn" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>

      {aiError && <p className="error">{aiError}</p>}

      <input
        className="story-title-input"
        value={draft.title}
        onChange={(e) => markDirty((d) => ({ ...d, title: e.target.value }))}
      />

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
            story — check more below to add them.
          </p>

          <div className="photo-grid">
            {stop.photos
              .filter((p) => p.included)
              .map((photo) => (
                <div className="photo-card" key={photo.id}>
                  {photo.thumbUrl && <img src={photo.thumbUrl} alt="" />}
                  <label className="photo-include">
                    <input
                      type="checkbox"
                      checked={photo.included}
                      onChange={(e) => updatePhoto(stop.id, photo.id, { included: e.target.checked })}
                    />
                    include
                  </label>
                  <textarea
                    placeholder="Caption…"
                    value={photo.caption}
                    onChange={(e) => updatePhoto(stop.id, photo.id, { caption: e.target.value })}
                  />
                  <button
                    className="ai-btn small"
                    onClick={() => handleDraftCaption(stop.id, photo.id)}
                    disabled={busy === photo.id}
                  >
                    {busy === photo.id ? "…" : "✨ Draft caption"}
                  </button>
                </div>
              ))}
          </div>

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
