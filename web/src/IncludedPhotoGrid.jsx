import { useEffect, useRef } from "react";
import Sortable from "sortablejs";

// Drag handle keeps the checkbox/textarea/buttons inside each card
// clickable - Sortable only starts a drag from ".drag-handle".
export default function IncludedPhotoGrid({
  stopId,
  photos,
  onReorder,
  onUpdatePhoto,
  onToggleFeatured,
  onDraftCaption,
  busy,
}) {
  const gridRef = useRef(null);

  useEffect(() => {
    if (!gridRef.current) return;
    const sortable = Sortable.create(gridRef.current, {
      animation: 150,
      handle: ".drag-handle",
      forceFallback: true,
      onEnd: (evt) => {
        if (evt.oldIndex !== evt.newIndex) {
          onReorder(stopId, evt.oldIndex, evt.newIndex);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopId]);

  return (
    <div className="photo-grid" ref={gridRef}>
      {photos.map((photo) => (
        <div className={`photo-card ${photo.featured ? "featured" : ""}`} key={photo.id}>
          <span className="drag-handle" title="Drag to reorder">
            &#10021;
          </span>
          {photo.thumbUrl && <img src={photo.thumbUrl} alt="" />}
          <div className="photo-card-row">
            <label className="photo-include">
              <input
                type="checkbox"
                checked={photo.included}
                onChange={(e) => onUpdatePhoto(stopId, photo.id, { included: e.target.checked })}
              />
              include
            </label>
            <button
              className="feature-btn"
              title={photo.featured ? "Featured photo for this stop" : "Make this the featured photo"}
              onClick={() => onToggleFeatured(stopId, photo.id)}
            >
              {photo.featured ? "★ Featured" : "☆ Feature"}
            </button>
          </div>
          <textarea
            placeholder="Caption…"
            value={photo.caption}
            onChange={(e) => onUpdatePhoto(stopId, photo.id, { caption: e.target.value })}
          />
          <button
            className="ai-btn small"
            onClick={() => onDraftCaption(stopId, photo.id)}
            disabled={busy === photo.id}
          >
            {busy === photo.id ? "…" : "✨ Draft caption"}
          </button>
        </div>
      ))}
    </div>
  );
}
