import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import { useI18n } from "./i18n.jsx";

// Drag handle keeps the checkbox/textarea/buttons inside each card
// clickable - Sortable only starts a drag from ".drag-handle".
export default function IncludedPhotoGrid({
  stopId,
  photos,
  onReorder,
  onMove,
  onUpdatePhoto,
  onToggleFeatured,
  onDraftCaption,
  onSplitHere,
  busy,
}) {
  const { t } = useI18n();
  const gridRef = useRef(null);

  useEffect(() => {
    if (!gridRef.current) return;
    // Shared group name across every stop's grid, so a photo can be dragged
    // out of one section and dropped straight into another - the rare fix
    // for a photo whose EXIF timestamp put it in the wrong stop to begin
    // with. Same handle as a same-stop reorder; sortablejs tells the two
    // apart itself via evt.from/evt.to.
    const sortable = Sortable.create(gridRef.current, {
      animation: 150,
      handle: ".drag-handle",
      forceFallback: true,
      group: "included-photos",
      onEnd: (evt) => {
        const fromStopId = evt.from.dataset.stopId;
        const toStopId = evt.to.dataset.stopId;
        if (fromStopId !== toStopId) {
          // sortablejs physically relocated evt.item into the other grid's
          // DOM subtree - React still thinks it owns that node under the
          // *old* parent, and its next reconcile (triggered by the state
          // update below) crashes trying to remove a child that's no
          // longer there ("Failed to execute 'removeChild'..."). Put the
          // node back where React last rendered it before handing the
          // actual move to React via state, the standard fix for
          // sortablejs across more than one React-owned list.
          evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex] || null);
          onMove(evt.item.dataset.photoId, fromStopId, toStopId, evt.newIndex);
        } else if (evt.oldIndex !== evt.newIndex) {
          onReorder(stopId, evt.oldIndex, evt.newIndex);
        }
      },
    });
    return () => sortable.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopId]);

  return (
    <div className="photo-grid" ref={gridRef} data-stop-id={stopId}>
      {photos.map((photo, i) => (
        <div className={`photo-card ${photo.featured ? "featured" : ""}`} key={photo.id} data-photo-id={photo.id}>
          <span className="drag-handle" title={t("dragHandleTitle")}>
            &#10021;
          </span>
          {onSplitHere && i > 0 && (
            <button
              type="button"
              className="split-here-btn"
              title={t("splitSectionHere")}
              onClick={() => onSplitHere(photo.id)}
            >
              ✂
            </button>
          )}
          {photo.thumbUrl && <img src={photo.thumbUrl} alt="" />}
          <div className="photo-card-row">
            <label className="photo-include">
              <input
                type="checkbox"
                checked={photo.included}
                onChange={(e) => onUpdatePhoto(stopId, photo.id, { included: e.target.checked })}
              />
              {t("include")}
            </label>
            <button
              className="feature-btn"
              title={photo.featured ? t("featuredTitle") : t("makeFeaturedTitle")}
              onClick={() => onToggleFeatured(stopId, photo.id)}
            >
              {photo.featured ? t("featuredBtn") : t("featureBtn")}
            </button>
          </div>
          <textarea
            placeholder={t("captionPlaceholder")}
            value={photo.caption}
            onChange={(e) => onUpdatePhoto(stopId, photo.id, { caption: e.target.value })}
          />
          <button
            className="ai-btn small"
            onClick={() => onDraftCaption(stopId, photo.id)}
            disabled={busy === photo.id}
          >
            {busy === photo.id ? "…" : t("draftCaptionBtn")}
          </button>
        </div>
      ))}
    </div>
  );
}
