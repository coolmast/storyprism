export default function AlbumList({ albums, selectedUid, onSelect }) {
  return (
    <ul className="album-list">
      {albums.map((a) => (
        <li key={a.uid}>
          <button
            className={a.uid === selectedUid ? "active" : ""}
            onClick={() => onSelect(a.uid)}
          >
            <span className="album-title">{a.title}</span>
            <span className="album-count">{a.photoCount}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
