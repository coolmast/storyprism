import { useState } from "react";
import { fetchThemeCandidates, createStory } from "./api.js";
import { useI18n } from "./i18n.jsx";
import { Card, EmptyState } from "./ui/index.js";

// "Nach Themen" (yearbook) source: pick a date range, discover candidate
// sections from PhotoPrism's own Labels/Subjects plus a detected-trip
// cluster, let the user pick any mix of them, and create a story with one
// section per chosen theme (in trip -> content -> person order) followed by
// one ordinary chronological section for whatever no theme claimed.
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
  const [discovering, setDiscovering] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function handleDiscover() {
    setDiscovering(true);
    setError(null);
    try {
      const data = await fetchThemeCandidates(from, to);
      setCandidates(data);
      setSelected(new Set());
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

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const all = [...candidates.tripThemes, ...candidates.contentThemes, ...candidates.peopleThemes];
      const themes = all.filter((c) => selected.has(c.id));
      const story = await createStory({
        themePlan: { from, to, title, themes },
        contentLanguage: lang,
      });
      onCreated(story);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  const totalCandidates = candidates
    ? candidates.tripThemes.length + candidates.contentThemes.length + candidates.peopleThemes.length
    : 0;

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

      {candidates && totalCandidates === 0 && (
        <EmptyState icon="🗂️" title={t("noThemesFound")} hint={t("noThemesFoundHint")} />
      )}

      {candidates && totalCandidates > 0 && (
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
          <p className="theme-leftover-hint">{t("themeLeftoverHint")}</p>
          <button className="save-btn" onClick={handleCreate} disabled={creating}>
            {creating ? t("creating") : t("createThemeStoryBtn")}
          </button>
        </Card>
      )}
    </div>
  );
}
