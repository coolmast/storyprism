import { useState } from "react";
import { createStory } from "./api.js";
import { useI18n } from "./i18n.jsx";
import { Card } from "./ui/index.js";

// "Nach Themen" (yearbook) source: this only sets the book's overall time
// horizon. The story starts completely empty - no sections yet - and every
// section (a trip, a person, a label, a hand-typed PhotoPrism query, or
// "everything else, by month") gets cherry-picked afterward in the editor's
// "Add section" panel (ThemeSectionPanel.jsx), which reuses this same date
// range to scope its suggestions. This replaced picking every theme upfront
// here: seeing the book in progress before adding the next section works
// better than committing to a whole plan before seeing any of it.
export default function ThemeStoryPicker({ lang, onCreated }) {
  const { t } = useI18n();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const story = await createStory({
        themePlan: { from, to },
        title,
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
        {error && <p className="error">{error}</p>}
        <button className="save-btn" onClick={handleCreate} disabled={!from || !to || creating}>
          {creating ? t("creating") : t("createThemeStoryBtn")}
        </button>
      </Card>
    </div>
  );
}
