import { useI18n } from "./i18n.jsx";

export default function StoryList({ stories, onOpen, onDelete }) {
  const { t, locale } = useI18n();
  if (stories.length === 0) {
    return <p className="hint">{t("noStoriesYet")}</p>;
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
