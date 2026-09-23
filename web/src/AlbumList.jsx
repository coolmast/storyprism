import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n.jsx";

// PhotoPrism only fills in Year/Month/Day for its own auto-generated
// "moment" albums (a year+country grouping) - manually-curated albums
// never carry it, even though almost all of this user's album titles are
// "<Place> <Year>" (see the real album list: "Australien 2019", "Barcelona
// 2018", "Blåvand 2021", ...). Falling back to a year found in the title
// covers that overwhelming majority; anything left over (no PhotoPrism
// year, no year-shaped substring - "AlexHochzeit", "Colorline", ...) goes
// in its own "no year" bucket at the end instead of vanishing.
const YEAR_IN_TITLE = /\b(19|20)\d{2}\b/;

function albumYear(album) {
  if (album.year) return album.year;
  const match = album.title.match(YEAR_IN_TITLE);
  return match ? Number(match[0]) : null;
}

function groupByYear(albums) {
  const byYear = new Map();
  for (const album of albums) {
    const key = albumYear(album) ?? "unknown";
    if (!byYear.has(key)) byYear.set(key, []);
    byYear.get(key).push(album);
  }
  const years = [...byYear.keys()].filter((k) => k !== "unknown").sort((a, b) => b - a);
  if (byYear.has("unknown")) years.push("unknown");
  return years.map((year) => ({
    year,
    albums: byYear
      .get(year)
      .slice()
      .sort((a, b) => (a.month || 99) - (b.month || 99) || a.title.localeCompare(b.title)),
  }));
}

// selectedUids: a Set of album UIDs - more than one may be selected at
// once, merged into a single itinerary (see App.jsx's handling).
export default function AlbumList({ albums, selectedUids, onToggle }) {
  const { t } = useI18n();
  const groups = useMemo(() => groupByYear(albums), [albums]);
  const [openYears, setOpenYears] = useState(() => new Set());
  const initialized = useRef(false);

  // Most recent year open by default (roughly chronological, newest
  // first, so a fresh visit shows this year/last year without the full
  // multi-decade list at once) - runs once, when the album list first
  // arrives, not on every re-render.
  useEffect(() => {
    if (initialized.current || groups.length === 0) return;
    initialized.current = true;
    const initial = new Set([groups[0].year]);
    const selectedGroup = groups.find((g) => g.albums.some((a) => selectedUids.has(a.uid)));
    if (selectedGroup) initial.add(selectedGroup.year);
    setOpenYears(initial);
    // Only ever runs once, when the album list first arrives - deliberately
    // not re-running when the selection changes afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  function toggleYear(year, open) {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (open) next.add(year);
      else next.delete(year);
      return next;
    });
  }

  return (
    <div className="album-year-groups">
      {groups.map((group) => (
        <details
          key={group.year}
          className="album-year-group"
          open={openYears.has(group.year)}
          onToggle={(e) => toggleYear(group.year, e.target.open)}
        >
          <summary className="album-year-header">
            <span>{group.year === "unknown" ? t("albumsNoYear") : group.year}</span>
            <span className="album-year-count">{group.albums.length}</span>
          </summary>
          <ul className="album-list">
            {group.albums.map((a) => {
              const selected = selectedUids.has(a.uid);
              return (
                <li key={a.uid}>
                  <button
                    className={selected ? "active" : ""}
                    aria-pressed={selected}
                    onClick={() => onToggle(a.uid)}
                  >
                    <span className="album-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                    <span className="album-title">{a.title}</span>
                    {/* PhotoPrism doesn't precompute a photo count for "moment"
                        albums (they're a saved search filter, not a static
                        list, so PhotoCount always comes back 0) - showing "0"
                        there would read as "this album is empty", which is
                        misleading. */}
                    {a.type !== "moment" && <span className="album-count">{a.photoCount}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </div>
  );
}
