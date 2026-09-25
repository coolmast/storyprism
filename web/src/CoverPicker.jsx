import { useState } from "react";
import { useI18n } from "./i18n.jsx";

// Manual overrides for the photobook cover's photos - it's one continuous
// wraparound canvas (back cover / spine / front cover) built from photos
// across every stop, not just one, so unlike the chapter-backdrop picker
// (StoryEditor.jsx) this needs to gather candidates from the whole story
// and group them by stop so a long trip's picker stays readable.
function groupedPhotos(stops) {
  return stops
    .map((stop) => ({ heading: stop.heading, photos: stop.photos.filter((p) => p.included && p.thumbUrl) }))
    .filter((g) => g.photos.length);
}

function findPhoto(stops, hash) {
  if (!hash) return null;
  for (const stop of stops) {
    const p = stop.photos.find((ph) => ph.hash === hash);
    if (p) return p;
  }
  return null;
}

function RolePicker({ roleKey, value, groups, stops, autoLabel, changeLabel, open, onToggle, onSelect, onClear }) {
  const photo = findPhoto(stops, value);
  return (
    <div className="cover-picker-role">
      <button type="button" className={`hero-picker-toggle ${open ? "open" : ""}`} onClick={onToggle}>
        {photo ? (
          <img className="hero-picker-toggle-thumb" src={photo.thumbUrl} alt="" />
        ) : (
          <span className="hero-picker-toggle-placeholder" aria-hidden="true">🖼</span>
        )}
        <span>{photo ? changeLabel : autoLabel}</span>
      </button>
      {open && (
        <div className="hero-picker">
          {value && (
            <button type="button" className="hero-picker-thumb clear cover-picker-clear" title={autoLabel} onClick={onClear}>
              ✕ {autoLabel}
            </button>
          )}
          <div className="cover-picker-groups">
            {groups.map((g) => (
              <div className="cover-picker-group" key={g.heading}>
                <div className="cover-picker-group-label">{g.heading}</div>
                <div className="hero-picker-grid">
                  {g.photos.map((p) => (
                    <button
                      key={p.id}
                      className={`hero-picker-thumb ${value === p.hash ? "selected" : ""}`}
                      onClick={() => onSelect(p.hash)}
                    >
                      <img src={p.thumbUrl} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CoverPicker({ stops, backdropHash, cardHashes, onChange }) {
  const { t } = useI18n();
  const [openRole, setOpenRole] = useState(null);
  const groups = groupedPhotos(stops);
  const cards = cardHashes || [];
  const toggle = (role) => setOpenRole(openRole === role ? null : role);

  return (
    <div className="cover-picker">
      <span className="section-label">{t("coverPhotosLabel")}</span>
      <div className="cover-picker-roles">
        <RolePicker
          roleKey="backdrop"
          value={backdropHash || null}
          groups={groups}
          stops={stops}
          autoLabel={t("coverBackdropAuto")}
          changeLabel={t("changeCoverBackdrop")}
          open={openRole === "backdrop"}
          onToggle={() => toggle("backdrop")}
          onSelect={(hash) => {
            onChange({ bookCoverBackdropHash: hash });
            setOpenRole(null);
          }}
          onClear={() => onChange({ bookCoverBackdropHash: null })}
        />
        {[0, 1].map((i) => (
          <RolePicker
            key={i}
            roleKey={`card${i}`}
            value={cards[i] || null}
            groups={groups}
            stops={stops}
            autoLabel={t(i === 0 ? "coverCard1Auto" : "coverCard2Auto")}
            changeLabel={t(i === 0 ? "changeCoverCard1" : "changeCoverCard2")}
            open={openRole === `card${i}`}
            onToggle={() => toggle(`card${i}`)}
            onSelect={(hash) => {
              const next = [cards[0] || null, cards[1] || null];
              next[i] = hash;
              onChange({ bookCoverCards: next });
              setOpenRole(null);
            }}
            onClear={() => {
              const next = [cards[0] || null, cards[1] || null];
              next[i] = null;
              onChange({ bookCoverCards: next });
            }}
          />
        ))}
      </div>
    </div>
  );
}
