import { useEffect, useState } from "react";
import { fetchThemeCandidates, fetchThemePlanPreview, createStory } from "./api.js";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";
import { Card, Chip } from "./ui/index.js";
import ItineraryMap from "./ItineraryMap.jsx";
import StopList from "./StopList.jsx";

// "Nach Themen" (yearbook) source: pick a date range, discover candidate
// sections from PhotoPrism's own Labels/Subjects plus a detected-trip
// cluster, let the user pick any mix of them (plus any number of
// hand-defined custom date sub-ranges - e.g. "3 days around a birthday in
// March"), and create a story with one section per chosen theme (trip ->
// content -> person -> custom order) followed by one ordinary chronological
// section for whatever no theme claimed.
function GroupChips({ label, items, selected, onToggle }) {
  if (items.length === 0) return null;
  return (
    <div className="theme-candidate-group">
      <span className="control-label">{label}</span>
      <div className="theme-chip-list" role="group" aria-label={label}>
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`theme-chip ${selected.has(c.id) ? "active" : ""}`}
            aria-pressed={selected.has(c.id)}
            onClick={() => onToggle(c.id)}
          >
            <span className="theme-chip-check" aria-hidden="true">
              {selected.has(c.id) ? "✓" : ""}
            </span>
            {c.title}
            <span className="theme-chip-count">{c.photoCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ThemeStoryPicker({ lang, onCreated }) {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [customThemes, setCustomThemes] = useState([]);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [previewStops, setPreviewStops] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  function chosenThemes() {
    const all = [...candidates.tripThemes, ...candidates.contentThemes, ...candidates.peopleThemes];
    return [...all.filter((c) => selected.has(c.id)), ...customThemes];
  }

  // Live preview (map + stop list, same as the other two sources already
  // show before creating a story) - re-fetched from the exact same
  // planThemeStops the backend uses to actually create the story, so it's
  // never a guess. Debounced slightly since toggling several chips in a
  // row would otherwise fire one request per click.
  useEffect(() => {
    if (!candidates) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const stops = await fetchThemePlanPreview(from, to, chosenThemes());
        if (!cancelled) setPreviewStops(stops);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, selected, customThemes]);

  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    try {
      const data = await fetchThemeCandidates(from, to);
      setCandidates(data);
      setSelected(new Set());
      setCustomThemes([]);
      setPreviewStops(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setDiscovering(false);
    }
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function addCustomTheme() {
    if (!customFrom || !customTo) return;
    setCustomThemes((prev) => [
      ...prev,
      {
        id: `custom-${uid()}`,
        type: "trip",
        title: customTitle.trim() || `${customFrom} – ${customTo}`,
        from: customFrom,
        to: customTo,
      },
    ]);
    setCustomFrom("");
    setCustomTo("");
    setCustomTitle("");
  }

  function removeCustomTheme(id) {
    setCustomThemes((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const story = await createStory({
        themePlan: { from, to, title, themes: chosenThemes() },
        contentLanguage: lang,
      });
      onCreated(story);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="theme-picker-flow">
      <Card className="theme-source-picker">
        <p className="route-embed-hint">{t("themeModeHint")}</p>
        <label className="date-range-field">
          {t("dateFromLabel")}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-range-field">
          {t("dateToLabel")}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <input
          className="date-range-title-input"
          placeholder={t("customTitlePlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="ai-btn" onClick={handleDiscover} disabled={!from || !to || discovering}>
          {discovering ? t("discoveringThemes") : t("discoverThemesBtn")}
        </button>
      </Card>

      {error && <p className="error">{error}</p>}

      {candidates && (
        <Card className="theme-candidates">
          <GroupChips
            label={t("themeGroupTrips")}
            items={candidates.tripThemes}
            selected={selected}
            onToggle={toggle}
          />
          <GroupChips
            label={t("themeGroupContent")}
            items={candidates.contentThemes}
            selected={selected}
            onToggle={toggle}
          />
          <GroupChips
            label={t("themeGroupPeople")}
            items={candidates.peopleThemes}
            selected={selected}
            onToggle={toggle}
          />

          <div className="theme-candidate-group">
            <span className="control-label">{t("themeGroupCustom")}</span>
            <p className="route-embed-hint">{t("themeCustomHint")}</p>
            {customThemes.length > 0 && (
              <div className="theme-chip-list">
                {customThemes.map((c) => (
                  <Chip key={c.id} onRemove={() => removeCustomTheme(c.id)}>
                    {c.title}
                  </Chip>
                ))}
              </div>
            )}
            <div className="theme-custom-form">
              <input
                type="date"
                aria-label={t("dateFromLabel")}
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <input
                type="date"
                aria-label={t("dateToLabel")}
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
              <input
                type="text"
                placeholder={t("customTitlePlaceholder")}
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
              />
              <button
                type="button"
                className="ai-btn small"
                onClick={addCustomTheme}
                disabled={!customFrom || !customTo}
              >
                {t("addCustomThemeBtn")}
              </button>
            </div>
          </div>

          <p className="theme-leftover-hint">{t("themeLeftoverHint")}</p>

          {previewStops && (
            <div className="theme-preview">
              <span className="control-label">{t("themePreviewLabel")}</span>
              {previewLoading && <p className="hint">{t("themePreviewUpdating")}</p>}
              <ItineraryMap stops={previewStops} />
              <StopList stops={previewStops} />
            </div>
          )}

          <button className="save-btn" onClick={handleCreate} disabled={creating}>
            {creating ? t("creating") : t("createThemeStoryBtn")}
          </button>
        </Card>
      )}
    </div>
  );
}
