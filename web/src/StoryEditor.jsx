import { useCallback, useEffect, useRef, useState } from "react";
import Sortable from "sortablejs";
import {
  saveStory,
  draftCaption,
  researchPlace,
  fetchThemes,
  fetchLanguages,
  fetchPdfLayouts,
  checkStoryUpdates,
} from "./api.js";
import IncludedPhotoGrid from "./IncludedPhotoGrid.jsx";
import PdfLivePreview from "./PdfLivePreview.jsx";
import InterviewPanel from "./InterviewPanel.jsx";
import RouteEmbeds from "./RouteEmbeds.jsx";
import NotesImportPanel from "./NotesImportPanel.jsx";
import InfoCards from "./InfoCards.jsx";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";
import { Modal, SegmentedControl, useToast } from "./ui/index.js";

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

export default function StoryEditor({ story, onSaved }) {
  const { t, locale } = useI18n();
  const showToast = useToast();
  const [draft, setDraft] = useState(story);
  const [saving, setSaving] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null); // id of photo/stop currently asking AI
  const [aiError, setAiError] = useState(null);
  const [themes, setThemes] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [pdfLayouts, setPdfLayouts] = useState({ templates: [], packs: [], paperSizes: [] });
  const [collapsedStops, setCollapsedStops] = useState(() => new Set());
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [pendingRemoveStopId, setPendingRemoveStopId] = useState(null);
  const stopsListRef = useRef(null);

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
    showToast(t("linkCopied"), { tone: "ok" });
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

  // The rare fix this exists for: a photo's EXIF timestamp is off, so
  // automatic clustering put it in the wrong stop entirely - dragging it
  // into the right one is the whole fix, no manual timestamp editing needed
  // anywhere. Clears `featured`: that flag made it the *old* stop's hero,
  // which has nothing to do with the stop it's joining (and could silently
  // unseat that stop's own hero photo if left set).
  function movePhoto(photoId, fromStopId, toStopId, newIndex) {
    markDirty((d) => {
      const fromIdx = d.stops.findIndex((s) => s.id === fromStopId);
      const toIdx = d.stops.findIndex((s) => s.id === toStopId);
      if (fromIdx === -1 || toIdx === -1) return d;
      const fromStop = d.stops[fromIdx];
      const photo = fromStop.photos.find((p) => p.id === photoId);
      if (!photo) return d;

      const stops = [...d.stops];
      stops[fromIdx] = { ...fromStop, photos: fromStop.photos.filter((p) => p.id !== photoId) };

      const toStop = d.stops[toIdx];
      const toIncluded = toStop.photos.filter((p) => p.included);
      const toExcluded = toStop.photos.filter((p) => !p.included);
      toIncluded.splice(newIndex, 0, { ...photo, included: true, featured: false });
      stops[toIdx] = { ...toStop, photos: [...toIncluded, ...toExcluded] };

      return { ...d, stops };
    });
  }

  function reorderStops(oldIndex, newIndex) {
    markDirty((d) => {
      const stops = [...d.stops];
      const [moved] = stops.splice(oldIndex, 1);
      stops.splice(newIndex, 0, moved);
      return { ...d, stops };
    });
  }

  // Sortable manages the stop <section> elements as plain DOM children (not
  // through React state during a drag), so it has to be re-created whenever
  // the number of stops changes - otherwise it keeps dragging stale nodes
  // after a section is added/removed/split.
  useEffect(() => {
    if (!stopsListRef.current) return;
    const sortable = Sortable.create(stopsListRef.current, {
      animation: 150,
      handle: ".stop-drag-handle",
      forceFallback: true,
      onEnd: (evt) => {
        if (evt.oldIndex !== evt.newIndex) {
          reorderStops(evt.oldIndex, evt.newIndex);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.stops.length]);

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

  function requestRemoveSection(stopId) {
    setPendingRemoveStopId(stopId);
  }

  function confirmRemoveSection() {
    const stopId = pendingRemoveStopId;
    markDirty((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== stopId) }));
    setPendingRemoveStopId(null);
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

  const handleBookSpreadCounts = useCallback((stopId, counts) => {
    updateStop(stopId, { bookSpreadCounts: counts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Remove / re-add a text part of the printed book (from the preview).
  const handleBookToggle = useCallback(({ target, stopId, cardIndex, hidden }) => {
    if (target === "intro") markDirty((d) => ({ ...d, bookHideIntro: hidden }));
    else if (target === "outro") markDirty((d) => ({ ...d, bookHideOutro: hidden }));
    else if (target === "chapter") updateStop(stopId, { bookHideText: hidden });
    else if (target === "info")
      markDirty((d) => ({
        ...d,
        stops: d.stops.map((s) =>
          s.id !== stopId
            ? s
            : { ...s, infoCards: (s.infoCards || []).map((c, i) => (i === cardIndex ? { ...c, bookHidden: hidden } : c)) }
        ),
      }));
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

  // Re-runs the search that created this story and merges in anything new
  // (see storyUpdate.js) - writes straight to the database, so it's blocked
  // while there are unsaved local edits rather than risking silently
  // discarding them when the fresh story replaces `draft`.
  async function handleCheckUpdates() {
    setCheckingUpdates(true);
    setAiError(null);
    try {
      const { summary, story: updated } = await checkStoryUpdates(draft.id);
      setDraft(updated);
      onSaved?.(updated);
      showToast(
        summary.newPhotoCount === 0
          ? t("noNewPhotosFound")
          : t("newPhotosFound", summary.newPhotoCount, summary.newStopCount),
        { tone: "ok" }
      );
    } catch (e) {
      setAiError(e.message);
    } finally {
      setCheckingUpdates(false);
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
          onBookSpreadCounts={handleBookSpreadCounts}
          onBookToggle={handleBookToggle}
          onClose={() => setShowPdfPreview(false)}
        />
      )}
      <div className="editor-toolbar">
        <div className="toolbar-actions">
          <button
            className={`toolbar-btn ${showPdfPreview ? "active" : ""}`}
            onClick={() => setShowPdfPreview((v) => !v)}
            title={t("previewPdfLayout")}
          >
            <span aria-hidden="true">🔍</span>
            <span className="toolbar-btn-label">{t("previewPdfLayout")}</span>
          </button>
          <button className="toolbar-btn" onClick={() => setShowExportMenu(true)} title={t("shareExport")}>
            <span aria-hidden="true">⤴</span>
            <span className="toolbar-btn-label">{t("shareExport")}</span>
          </button>
          <button className="save-btn" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? t("saving") : dirty ? t("saveChanges") : t("saved")}
          </button>
        </div>
      </div>

      {aiError && <p className="error">{aiError}</p>}

      <div className="story-title-row">
        <input
          className="story-title-input"
          value={draft.title}
          onChange={(e) => markDirty((d) => ({ ...d, title: e.target.value }))}
        />
        <button type="button" className="settings-btn" onClick={() => setShowSettings(true)}>
          <span aria-hidden="true">⚙</span> {t("storySettings")}
        </button>
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

      <div className="stops-list" ref={stopsListRef}>
      {draft.stops.map((stop, i) => {
        const isCollapsed = collapsedStops.has(stop.id);
        const includedPhotos = stop.photos.filter((p) => p.included);
        const summaryThumb = includedPhotos.find((p) => p.thumbUrl) || stop.photos.find((p) => p.thumbUrl);

        return (
          <section key={stop.id} className={`stop-editor ${isCollapsed ? "collapsed" : ""}`}>
            <div className="stop-summary-row">
              {draft.stops.length > 1 && (
                <span className="stop-drag-handle" title={t("dragHandleTitle")} aria-hidden="true">
                  &#10021;
                </span>
              )}
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
                      onClick={() => requestRemoveSection(stop.id)}
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
                    onMove={movePhoto}
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
      </div>

      <textarea
        className="story-outro"
        placeholder={t("outroPlaceholder")}
        value={draft.outro}
        onChange={(e) => markDirty((d) => ({ ...d, outro: e.target.value }))}
      />

      <Modal
        open={pendingRemoveStopId != null}
        onClose={() => setPendingRemoveStopId(null)}
        title={t("removeSection")}
        footer={
          <>
            <button type="button" className="link-btn" onClick={() => setPendingRemoveStopId(null)}>
              {t("cancel")}
            </button>
            <button type="button" className="ui-danger-btn" onClick={confirmRemoveSection}>
              {t("removeSection")}
            </button>
          </>
        }
      >
        <p>{t("removeSectionConfirm")}</p>
      </Modal>

      <Modal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title={t("storySettings")}
        footer={
          <button type="button" className="save-btn" onClick={() => setShowSettings(false)}>
            {t("done")}
          </button>
        }
      >
        {draft.sourceType && (
          <div className="settings-section">
            <span className="control-label">{t("checkUpdatesLabel")}</span>
            <p className="route-embed-hint">{t("checkUpdatesHint")}</p>
            <button
              type="button"
              className="ai-btn"
              onClick={handleCheckUpdates}
              disabled={checkingUpdates || dirty}
              title={dirty ? t("checkUpdatesDirtyHint") : undefined}
            >
              {checkingUpdates ? t("checkingUpdates") : t("checkUpdatesBtn")}
            </button>
            {dirty && <p className="route-embed-hint">{t("checkUpdatesDirtyHint")}</p>}
          </div>
        )}

        <div className="settings-section">
          <span className="control-label">{t("themeLabel")}</span>
          <div className="theme-picker">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-swatch ${draft.theme === theme.id ? "active" : ""}`}
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
        </div>

        <div className="settings-section">
          <span className="control-label">{t("contentLanguageLabel")}</span>
          <SegmentedControl
            ariaLabel={t("contentLanguageLabel")}
            value={draft.contentLanguage}
            onChange={(v) => markDirty((d) => ({ ...d, contentLanguage: v }))}
            options={languages.map((l) => ({ value: l.code, label: l.label }))}
          />
        </div>

        <div className="settings-section">
          <span className="control-label">{t("pdfLayoutPackLabel")}</span>
          <SegmentedControl
            ariaLabel={t("pdfLayoutPackLabel")}
            value={draft.pdfLayoutPack || "photobook"}
            onChange={(v) => markDirty((d) => ({ ...d, pdfLayoutPack: v }))}
            options={pdfLayouts.packs.map((p) => ({ value: p.id, label: p.label }))}
          />
        </div>

        <div className="settings-section">
          <label className="control-label" htmlFor="pdf-paper-size-select">
            {t("pdfPaperSizeLabel")}
          </label>
          <select
            id="pdf-paper-size-select"
            className="settings-select"
            value={draft.pdfPaperSize || "a4-portrait"}
            onChange={(e) => markDirty((d) => ({ ...d, pdfPaperSize: e.target.value }))}
          >
            {pdfLayouts.paperSizes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </Modal>

      <Modal open={showExportMenu} onClose={() => setShowExportMenu(false)} title={t("shareExport")}>
        <div className="export-menu">
          <a
            className="export-menu-item"
            href={`/story/${draft.id}?preview=1`}
            target="_blank"
            rel="noreferrer"
          >
            <span className="export-menu-icon" aria-hidden="true">👁️</span>
            {t("viewStory")}
          </a>
          <button
            type="button"
            className="export-menu-item"
            onClick={() => {
              handleCopyShareLink();
              setShowExportMenu(false);
            }}
          >
            <span className="export-menu-icon" aria-hidden="true">🔗</span>
            {t("copyShareLink")}
          </button>
          <a className="export-menu-item" href={`/story/${draft.id}/present`} target="_blank" rel="noreferrer">
            <span className="export-menu-icon" aria-hidden="true">🎬</span>
            {t("present")}
          </a>
          <a className="export-menu-item" href={`/api/stories/${draft.id}/export/pdf`}>
            <span className="export-menu-icon" aria-hidden="true">📄</span>
            {t("downloadPdf")}
          </a>
          <a className="export-menu-item" href={`/api/stories/${draft.id}/export/deck-pdf`}>
            <span className="export-menu-icon" aria-hidden="true">🖼️</span>
            {t("downloadSlides")}
          </a>
        </div>
      </Modal>
    </div>
  );
}
