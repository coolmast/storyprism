import { useEffect, useState } from "react";
import { fetchThemeCandidates, addThemeSection } from "./api.js";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";

// One click on a suggested chip - or one submit of the custom-range/query
// form - immediately adds that section to the story via
// POST /stories/:id/theme-sections (storyUpdate.js's addThemeToStory) and
// hands the freshly reconciled story back up. Nothing here builds a plan
// client-side; every candidate is exactly what /api/theme-candidates
// already suggests, scoped to the story's own from/to.
function GroupChips({ label, items, onAdd, addingId }) {
  if (items.length === 0) return null;
  return (
    <div className="theme-candidate-group">
      <span className="control-label">{label}</span>
      <div className="theme-chip-list" role="group" aria-label={label}>
        {items.map((c) => (
          <button
            key={c.id}
            type="button"
            className="theme-chip"
            onClick={() => onAdd(c)}
            disabled={!!addingId}
          >
            {addingId === c.id ? "…" : c.title}
            <span className="theme-chip-count">{c.photoCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ThemeSectionPanel({ storyId, from, to, existingThemeIds, disabled, onAdded }) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addingId, setAddingId] = useState(null);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [query, setQuery] = useState("");
  const [queryTitle, setQueryTitle] = useState("");

  useEffect(() => {
    if (!from || !to) return;
    let cancelled = false;
    setLoading(true);
    fetchThemeCandidates(from, to)
      .then((data) => {
        if (!cancelled) setCandidates(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  async function addTheme(theme) {
    setAddingId(theme.id);
    setError(null);
    try {
      const result = await addThemeSection(storyId, theme);
      onAdded(result);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setAddingId(null);
    }
  }

  async function addCustomRange() {
    if (!customFrom || !customTo) return;
    const ok = await addTheme({
      id: `custom-${uid()}`,
      type: "trip",
      title: customTitle.trim() || `${customFrom} – ${customTo}`,
      from: customFrom,
      to: customTo,
    });
    if (!ok) return;
    setCustomFrom("");
    setCustomTo("");
    setCustomTitle("");
  }

  async function addQuery() {
    if (!query.trim()) return;
    const ok = await addTheme({
      id: `query-${uid()}`,
      type: "query",
      query: query.trim(),
      title: queryTitle.trim() || query.trim(),
    });
    if (!ok) return;
    setQuery("");
    setQueryTitle("");
  }

  function addLeftover() {
    addTheme({ id: "leftover", type: "leftover" });
  }

  const visible = candidates && {
    tripThemes: candidates.tripThemes.filter((c) => !existingThemeIds.has(c.id)),
    contentThemes: candidates.contentThemes.filter((c) => !existingThemeIds.has(c.id)),
    peopleThemes: candidates.peopleThemes.filter((c) => !existingThemeIds.has(c.id)),
  };
  const busy = !!addingId;

  return (
    <div className="theme-section-panel">
      <p className="route-embed-hint">{t("addSectionHint")}</p>
      {disabled && <p className="route-embed-hint">{t("checkUpdatesDirtyHint")}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="hint">{t("discoveringThemes")}</p>}

      <fieldset disabled={disabled} className="theme-section-fieldset">
        {visible && (
          <>
            <GroupChips label={t("themeGroupTrips")} items={visible.tripThemes} onAdd={addTheme} addingId={addingId} />
            <GroupChips label={t("themeGroupContent")} items={visible.contentThemes} onAdd={addTheme} addingId={addingId} />
            <GroupChips label={t("themeGroupPeople")} items={visible.peopleThemes} onAdd={addTheme} addingId={addingId} />
          </>
        )}

        <div className="theme-candidate-group">
          <span className="control-label">{t("themeGroupCustom")}</span>
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
            <button type="button" className="ai-btn small" onClick={addCustomRange} disabled={busy || !customFrom || !customTo}>
              {t("addCustomThemeBtn")}
            </button>
          </div>
        </div>

        <div className="theme-candidate-group">
          <span className="control-label">{t("themeGroupQuery")}</span>
          <p className="route-embed-hint">{t("themeQueryHint")}</p>
          <div className="theme-custom-form theme-query-form">
            <input
              type="text"
              placeholder={t("themeQueryPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <input
              type="text"
              placeholder={t("customTitlePlaceholder")}
              value={queryTitle}
              onChange={(e) => setQueryTitle(e.target.value)}
            />
            <button type="button" className="ai-btn small" onClick={addQuery} disabled={busy || !query.trim()}>
              {t("addQueryThemeBtn")}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="ai-btn"
          onClick={addLeftover}
          disabled={busy || existingThemeIds.has("leftover")}
        >
          {existingThemeIds.has("leftover") ? t("leftoverAlreadyAdded") : t("addLeftoverBtn")}
        </button>
      </fieldset>
    </div>
  );
}
