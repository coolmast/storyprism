import { useI18n } from "./i18n.jsx";

function formatRange(start, end, locale) {
  const s = new Date(start);
  const e = new Date(end);
  const opts = { day: "numeric", month: "short" };
  return s.toDateString() === e.toDateString()
    ? s.toLocaleDateString(locale, opts)
    : `${s.toLocaleDateString(locale, opts)} – ${e.toLocaleDateString(locale, opts)}`;
}

export default function StopList({ stops }) {
  const { t, locale } = useI18n();
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
              <h3>{s.placeCity || s.placeLabel || t("unknownPlace")}</h3>
              <span>
                {formatRange(s.startedAt, s.endedAt, locale)} · {t("photosCount", s.photoCount)}
              </span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
