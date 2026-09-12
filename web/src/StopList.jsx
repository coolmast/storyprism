function formatRange(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const opts = { day: "numeric", month: "short" };
  return s.toDateString() === e.toDateString()
    ? s.toLocaleDateString(undefined, opts)
    : `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

export default function StopList({ stops }) {
  return (
    <ol className="stop-list">
      {stops.map((s) => (
        <li key={s.index}>
          <div className="stop-marker">{s.index + 1}</div>
          <div className="stop-body">
            <div className="stop-thumbs">
              {s.photos.slice(0, 4).map((p) =>
                p.thumbUrl ? <img key={p.uid} src={p.thumbUrl} alt="" /> : null
              )}
            </div>
            <div className="stop-meta">
              <h3>{s.placeCity || s.placeLabel || "Unknown place"}</h3>
              <span>{formatRange(s.startedAt, s.endedAt)} · {s.photoCount} photos</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
