import { useI18n } from "./i18n.jsx";

function AlbumGroup({ label, albums, selectedUid, onSelect }) {
  if (albums.length === 0) return null;
  return (
    <>
      <span className="album-group-label">{label}</span>
      <ul className="album-list">
        {albums.map((a) => (
          <li key={a.uid}>
            <button
              className={a.uid === selectedUid ? "active" : ""}
              onClick={() => onSelect(a.uid)}
            >
              <span className="album-title">{a.title}</span>
              {/* PhotoPrism doesn't precompute a photo count for "moment"
                  albums (they're a saved search filter, not a static list,
                  so PhotoCount always comes back 0) - showing "0" there
                  would read as "this album is empty", which is misleading. */}
              {a.type !== "moment" && <span className="album-count">{a.photoCount}</span>}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function AlbumList({ albums, selectedUid, onSelect }) {
  const { t } = useI18n();
  const manual = albums.filter((a) => a.type !== "moment");
  const moments = albums.filter((a) => a.type === "moment");

  return (
    <div>
      <AlbumGroup label={t("albumsManual")} albums={manual} selectedUid={selectedUid} onSelect={onSelect} />
      <AlbumGroup label={t("albumsMoments")} albums={moments} selectedUid={selectedUid} onSelect={onSelect} />
    </div>
  );
}
