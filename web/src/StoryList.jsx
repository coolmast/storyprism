export default function StoryList({ stories, onOpen, onDelete }) {
  if (stories.length === 0) {
    return <p className="hint">No stories yet — create one from an album under "New Story".</p>;
  }

  return (
    <ul className="story-list">
      {stories.map((s) => (
        <li key={s.id} className="story-card">
          <button className="story-card-main" onClick={() => onOpen(s.id)}>
            <h3>{s.title}</h3>
            <span>
              {s.albumTitle} · {s.stopCount} stops · updated{" "}
              {new Date(s.updatedAt).toLocaleDateString()}
            </span>
          </button>
          <button className="story-card-delete" onClick={() => onDelete(s.id)} title="Delete story">
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
