import { useCallback, useEffect, useState } from "react";
import { saveStory, draftCaption, researchPlace, fetchThemes, fetchLanguages, fetchPdfLayouts } from "./api.js";
import IncludedPhotoGrid from "./IncludedPhotoGrid.jsx";
import PdfLivePreview from "./PdfLivePreview.jsx";
import InterviewPanel from "./InterviewPanel.jsx";
import RouteEmbeds from "./RouteEmbeds.jsx";
import NotesImportPanel from "./NotesImportPanel.jsx";
import InfoCards from "./InfoCards.jsx";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";

const THEME_LABEL_KEY = {
  coastal: "themeCoastal",
  monochrome: "themeMonochrome",
  vintage: "themeVintage",
  bold: "themeBold",
  ocean: "themeOcean",
  midnight: "themeMidnight",
  sunset: "themeSunset",
  sunrise: "themeSunrise",
  adventure: "themeAdventure",
  nordic: "themeNordic",
};

function formatRange(start, end, locale) {
  const opts = { day: "numeric", month: "short", year: "numeric" };
  const s = new Date(start).toLocaleDateString(locale, opts);
  const e = new Date(end).toLocaleDateString(locale, opts);
  return s === e ? s : `${s} – ${e}`;
}

export default function StoryEditor({ story, onBack, onSaved }) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState(story);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null); // id of photo/stop currently asking AI
  const [aiError, setAiError] = useState(null);
  const [themes, setThemes] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [pdfLayouts, setPdfLayouts] = useState({ templates: [], packs: [], paperSizes: [] });
  const [collapsedStops, setCollapsedStops] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  async function handleCopyShareLink() {
    // No ?preview=1 here on purpose: that flag only exists to show the
    // shuffle-layout button for the creator's own fine-tuning - the link
    // you'd actually send to family should be the plain, static page.
    const url = `${window.location.origin}/story/${draft.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt(t("copyShareLink"), url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function toggleStopCollapsed(stopId) {
    setCollapsedStops((prev) => {
      const next = new Set(prev);
      if (next.has(stopId)) next.delete(stopId);
      else next.add(stopId);
      return next;
    });
  }

  function setAllStopsCollapsed(collapse) {
    setCollapsedStops(collapse ? new Set(draft.stops.map((s) => s.id)) : new Set());
  }

  useEffect(() => {
    setDraft(story);
    setDirty(false);
  }, [story]);

  useEffect(() => {
    fetchThemes().then(setThemes).catch(() => {});
    fetchLanguages().then(setLanguages).catch(() => {});
    fetchPdfLayouts().then(setPdfLayouts).catch(() => {});
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

  // A blank stop the user inserts by hand, for a moment the automatic
  // time/distance clustering didn't split out on its own - a rest stop,
  // a detour, a chapter break with no photos at all. Inherits the
  // neighboring stop's dates/location as a reasonable default rather than
  // leaving them blank; the user can rename/rewrite everything anyway, and
  // an empty stop with nothing added to it is hidden from the final page.
  function addSection(afterStopId) {
    markDirty((d) => {
      const idx = d.stops.findIndex((s) => s.id === afterStopId);
      const neighbor = d.stops[idx];
      const newStop = {
        id: uid(),
        heading: t("newSectionHeading"),
        narrative: "",
        pullQuote: "",
        research: "",
        startedAt: neighbor?.endedAt ?? neighbor?.startedAt ?? null,
        endedAt: neighbor?.endedAt ?? null,
        lat: neighbor?.lat ?? null,
        lng: neighbor?.lng ?? null,
        placeLabel: null,
        photos: [],
        embeds: [],
        infoCards: [],
        suggestedPlaces: [],
      };
      const stops = [...d.stops];
      stops.splice(idx + 1, 0, newStop);
      return { ...d, stops };
    });
  }

  // Splits a stop's included photos into two stops at the clicked photo
  // (that photo and everything after it moves to a new stop right after
  // this one). Excluded photos stay with the original stop - they aren't
  // part of the visible ordering being split, and moving them too would be
  // guessing at an order the user never actually set. Can't recompute a
  // precise date range or map position for the new stop from photo data
  // alone (per-photo timestamps/GPS aren't kept once a story exists, only
  // the stop-level ones are), so the split half just inherits the
  // original stop's - an approximation, but a harmless one the user can
  // freely edit afterward.
  function splitStopAtPhoto(stopId, photoId) {
    markDirty((d) => {
      const idx = d.stops.findIndex((s) => s.id === stopId);
      const stop = d.stops[idx];
      const included = stop.photos.filter((p) => p.included);
      const excluded = stop.photos.filter((p) => !p.included);
      const splitAt = included.findIndex((p) => p.id === photoId);
      if (splitAt <= 0) return d;

      const keepIncluded = included.slice(0, splitAt);
      const movedIncluded = included.slice(splitAt);
      const newStop = {
        id: uid(),
        heading: `${stop.heading} (2)`,
        narrative: "",
        pullQuote: "",
        research: "",
        startedAt: stop.startedAt,
        endedAt: stop.endedAt,
        lat: stop.lat,
        lng: stop.lng,
        placeLabel: stop.placeLabel,
        photos: movedIncluded,
        embeds: [],
        infoCards: [],
        suggestedPlaces: [],
      };
      const stops = [...d.stops];
      stops[idx] = { ...stop, photos: [...keepIncluded, ...excluded] };
      stops.splice(idx + 1, 0, newStop);
      return { ...d, stops };
    });
  }

  function removeSection(stopId) {
    if (!confirm(t("removeSectionConfirm"))) return;
    markDirty((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== stopId) }));
  }

  // Stable identity so the preview's message listener isn't re-bound on
  // every render; `updateStop` only touches state setters.
  const handlePdfOverride = useCallback((stopId, templateId) => {
    updateStop(stopId, { pdfTemplateOverride: templateId || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBookOverride = useCallback((stopId, layoutId) => {
    updateStop(stopId, { bookLayoutOverride: layoutId || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className={`story-editor ${showPdfPreview ? "with-pdf-preview" : ""}`}>
      {showPdfPreview && (
        <PdfLivePreview
          draft={draft}
          pdfLayouts={pdfLayouts}
          onChange={(patch) => markDirty((d) => ({ ...d, ...patch }))}
          onOverride={handlePdfOverride}
          onBookOverride={handleBookOverride}
          onClose={() => setShowPdfPreview(false)}
        />
      )}
      <div className="editor-toolbar">
        <button className="link-btn" onClick={onBack}>{t("backToStories")}</button>
        <div className="toolbar-actions">
          <a
            className="toolbar-btn"
            href={`/story/${draft.id}?preview=1`}
            target="_blank"
            rel="noreferrer"
            title={t("viewStory")}
          >
            <span aria-hidden="true">👁️</span>
            <span className="toolbar-btn-label">{t("viewStory")}</span>
          </a>
          <button className="toolbar-btn" onClick={handleCopyShareLink} title={t("copyShareLink")}>
            <span aria-hidden="true">{copied ? "✓" : "🔗"}</span>
            <span className="toolbar-btn-label">{copied ? t("linkCopied") : t("copyShareLink")}</span>
          </button>
          <a
            className="toolbar-btn"
            href={`/story/${draft.id}/present`}
            target="_blank"
            rel="noreferrer"
            title={t("present")}
          >
            <span aria-hidden="true">🎬</span>
            <span className="toolbar-btn-label">{t("present")}</span>
          </a>
          <button
            className={`toolbar-btn ${showPdfPreview ? "active" : ""}`}
            onClick={() => setShowPdfPreview((v) => !v)}
            title={t("previewPdfLayout")}
          >
            <span aria-hidden="true">🔍</span>
            <span className="toolbar-btn-label">{t("previewPdfLayout")}</span>
          </button>
          <a className="toolbar-btn" href={`/api/stories/${draft.id}/export/pdf`} title={t("downloadPdf")}>
            <span aria-hidden="true">📄</span>
            <span className="toolbar-btn-label">{t("downloadPdf")}</span>
          </a>
          <a
            className="toolbar-btn"
            href={`/api/stories/${draft.id}/export/deck-pdf`}
            title={t("downloadSlides")}
          >
            <span aria-hidden="true">🖼️</span>
            <span className="toolbar-btn-label">{t("downloadSlides")}</span>
          </a>
          <button className="save-btn" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? t("saving") : dirty ? t("saveChanges") : t("saved")}
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
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-swatch ${draft.theme === theme.id ? "active" : ""}`}
            title={THEME_LABEL_KEY[theme.id] ? t(THEME_LABEL_KEY[theme.id]) : theme.label}
            onClick={() => markDirty((d) => ({ ...d, theme: theme.id }))}
          >
            <span className="theme-swatch-colors">
              {theme.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            {THEME_LABEL_KEY[theme.id] ? t(THEME_LABEL_KEY[theme.id]) : theme.label}
          </button>
        ))}
      </div>

      <div className="lang-picker">
        <span className="lang-picker-label">{t("contentLanguageLabel")}</span>
        {languages.map((l) => (
          <button
            key={l.code}
            className={`lang-picker-btn ${draft.contentLanguage === l.code ? "active" : ""}`}
            onClick={() => markDirty((d) => ({ ...d, contentLanguage: l.code }))}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="lang-picker">
        <span className="lang-picker-label">{t("pdfLayoutPackLabel")}</span>
        {pdfLayouts.packs.map((p) => (
          <button
            key={p.id}
            className={`lang-picker-btn ${(draft.pdfLayoutPack || "photobook") === p.id ? "active" : ""}`}
            onClick={() => markDirty((d) => ({ ...d, pdfLayoutPack: p.id }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="lang-picker">
        <span className="lang-picker-label">{t("pdfPaperSizeLabel")}</span>
        {pdfLayouts.paperSizes.map((p) => (
          <button
            key={p.id}
            className={`lang-picker-btn ${(draft.pdfPaperSize || "a4-portrait") === p.id ? "active" : ""}`}
            onClick={() => markDirty((d) => ({ ...d, pdfPaperSize: p.id }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <textarea
        className="story-intro"
        placeholder={t("introPlaceholder")}
        value={draft.intro}
        onChange={(e) => markDirty((d) => ({ ...d, intro: e.target.value }))}
      />

      <NotesImportPanel
        storyId={draft.id}
        stops={draft.stops}
        onApplySuggestion={(stopId, patch) => updateStop(stopId, patch)}
      />

      <div className="stops-toolbar">
        <button className="link-btn" onClick={() => setAllStopsCollapsed(false)}>
          {t("expandAll")}
        </button>
        <button className="link-btn" onClick={() => setAllStopsCollapsed(true)}>
          {t("collapseAll")}
        </button>
      </div>

      {draft.stops.map((stop, i) => {
        const isCollapsed = collapsedStops.has(stop.id);
        const includedPhotos = stop.photos.filter((p) => p.included);
        const summaryThumb = includedPhotos.find((p) => p.thumbUrl) || stop.photos.find((p) => p.thumbUrl);

        return (
          <section key={stop.id} className={`stop-editor ${isCollapsed ? "collapsed" : ""}`}>
            <div className="stop-summary-row">
              <button
                type="button"
                className="stop-collapse-toggle"
                onClick={() => toggleStopCollapsed(stop.id)}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? t("expandStop") : t("collapseStop")}
              >
                <span className="stop-marker">{i + 1}</span>
                <span className={`stop-chevron ${isCollapsed ? "" : "open"}`}>▾</span>
              </button>

              {isCollapsed ? (
                <button type="button" className="stop-summary-info" onClick={() => toggleStopCollapsed(stop.id)}>
                  {summaryThumb?.thumbUrl && (
                    <img className="stop-summary-thumb" src={summaryThumb.thumbUrl} alt="" />
                  )}
                  <span className="stop-summary-heading">{stop.heading}</span>
                  <span className="stop-dates">{formatRange(stop.startedAt, stop.endedAt, locale)}</span>
                  <span className="stop-summary-meta">{t("photosCount", includedPhotos.length)}</span>
                </button>
              ) : (
                <div className="stop-editor-header">
                  <input
                    className="stop-heading-input"
                    value={stop.heading}
                    onChange={(e) => updateStop(stop.id, { heading: e.target.value })}
                  />
                  <span className="stop-dates">{formatRange(stop.startedAt, stop.endedAt, locale)}</span>
                  {draft.stops.length > 1 && (
                    <button
                      type="button"
                      className="link-btn danger small"
                      onClick={() => removeSection(stop.id)}
                    >
                      {t("removeSection")}
                    </button>
                  )}
                </div>
              )}
            </div>

            {!isCollapsed && (
              <>
                <div className="stop-section">
                  <span className="section-label">{t("narrativeLabel")}</span>
                  <textarea
                    className="stop-narrative"
                    placeholder={t("narrativePlaceholder")}
                    value={stop.narrative}
                    onChange={(e) => updateStop(stop.id, { narrative: e.target.value })}
                  />

                  <input
                    className="stop-pull-quote-input"
                    placeholder={t("pullQuotePlaceholder")}
                    value={stop.pullQuote || ""}
                    onChange={(e) => updateStop(stop.id, { pullQuote: e.target.value })}
                  />
                </div>

                <div className="stop-section stop-enrich">
                  <span className="section-label">{t("enrichLabel")}</span>

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
                      {busy === stop.id ? t("researching") : t("researchThisPlace")}
                    </button>
                    {stop.research && (
                      <textarea
                        className="stop-research-text"
                        value={stop.research}
                        onChange={(e) => updateStop(stop.id, { research: e.target.value })}
                      />
                    )}
                  </div>

                  <InfoCards
                    storyId={draft.id}
                    stopId={stop.id}
                    suggestedPlaces={stop.suggestedPlaces || []}
                    infoCards={stop.infoCards || []}
                    onChange={(infoCards) => updateStop(stop.id, { infoCards })}
                  />

                  <RouteEmbeds
                    embeds={stop.embeds || []}
                    onChange={(embeds) => updateStop(stop.id, { embeds })}
                  />
                </div>

                <div className="stop-section">
                  <span className="section-label">{t("photosLabel")}</span>
                  <p className="photo-count-hint">
                    {t("photoCountHint", includedPhotos.length, stop.photos.length)}
                  </p>

                  <label className="pdf-override-picker">
                    <span className="control-label">{t("pdfLayoutOverrideLabel")}</span>
                    <select
                      value={stop.pdfTemplateOverride || ""}
                      onChange={(e) => updateStop(stop.id, { pdfTemplateOverride: e.target.value || null })}
                    >
                      <option value="">{t("pdfLayoutAutomatic")}</option>
                      {pdfLayouts.templates
                        .filter((tpl) => tpl.selectable)
                        .map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.label}
                          </option>
                        ))}
                    </select>
                  </label>

                  <IncludedPhotoGrid
                    stopId={stop.id}
                    photos={includedPhotos}
                    onReorder={reorderPhotos}
                    onUpdatePhoto={updatePhoto}
                    onToggleFeatured={toggleFeatured}
                    onDraftCaption={handleDraftCaption}
                    onSplitHere={(photoId) => splitStopAtPhoto(stop.id, photoId)}
                    busy={busy}
                  />

                  {stop.photos.some((p) => !p.included) && (
                    <details className="more-photos">
                      <summary>
                        {t("morePhotosSummary", stop.photos.filter((p) => !p.included).length)}
                      </summary>
                      <div className="thumb-grid">
                        {stop.photos
                          .filter((p) => !p.included)
                          .map((photo) => (
                            <label className="thumb-toggle" key={photo.id}>
                              <input
                                type="checkbox"
                                checked={photo.included}
                                onChange={(e) =>
                                  updatePhoto(stop.id, photo.id, { included: e.target.checked })
                                }
                              />
                              {photo.thumbUrl && <img src={photo.thumbUrl} alt="" />}
                            </label>
                          ))}
                      </div>
                    </details>
                  )}
                </div>

                <button type="button" className="link-btn add-section-btn" onClick={() => addSection(stop.id)}>
                  {t("addSectionAfter")}
                </button>
              </>
            )}
          </section>
        );
      })}

      <textarea
        className="story-outro"
        placeholder={t("outroPlaceholder")}
        value={draft.outro}
        onChange={(e) => markDirty((d) => ({ ...d, outro: e.target.value }))}
      />
    </div>
  );
}
