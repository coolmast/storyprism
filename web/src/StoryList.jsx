import { useI18n } from "./i18n.jsx";
import { EmptyState } from "./ui/index.js";

export default function StoryList({ stories, onOpen, onDelete, onCreateNew }) {
  const { t, locale } = useI18n();
  if (stories.length === 0) {
    return (
      <EmptyState
        icon="📚"
        title={t("noStoriesYet")}
        hint={t("noStoriesHint")}
        action={
          onCreateNew ? (
            <button type="button" className="save-btn" onClick={onCreateNew}>
              {t("tabNewStory")}
            </button>
          ) : null
        }
      />
    );
  }

  return (
    <ul className="story-list">
      {stories.map((s) => (
        <li key={s.id} className="story-card">
          <button className="story-card-main" onClick={() => onOpen(s.id)}>
            <h3>{s.title}</h3>
            <span>
              {t("storyCardMeta", s.albumTitle, s.stopCount, new Date(s.updatedAt).toLocaleDateString(locale))}
            </span>
          </button>
          <button className="story-card-delete" onClick={() => onDelete(s.id)} title={t("deleteStoryTitle")}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
