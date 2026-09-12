import { useState } from "react";
import { generateInfoCard, fetchMatchingPhotos } from "./api.js";
import { useI18n } from "./i18n.jsx";

// suggestedPlaces comes from the server (PhotoPrism PlaceLabels + auto
// photo titles for this stop's included photos - see server/src/places.js)
// - it's just candidate names, nothing is generated until the user clicks
// one, so a wrong guess (an occasional person's name PhotoPrism detected
// as a photo's subject) costs nothing but an ignored chip.
export default function InfoCards({ storyId, stopId, suggestedPlaces, infoCards, onChange }) {
  const { t } = useI18n();
  const [manualName, setManualName] = useState("");
  const [busyPlace, setBusyPlace] = useState(null);
  const [error, setError] = useState(null);
  const [heroPickerFor, setHeroPickerFor] = useState(null);
  const [heroCandidates, setHeroCandidates] = useState({});
  const [heroLoading, setHeroLoading] = useState(false);

  const existingNames = new Set(infoCards.map((c) => c.placeName.toLowerCase()));
  const availableSuggestions = suggestedPlaces.filter(
    (p) => !existingNames.has(p.toLowerCase())
  );

  async function generate(placeName) {
    if (!placeName.trim() || busyPlace) return;
    setBusyPlace(placeName);
    setError(null);
    try {
      const card = await generateInfoCard(storyId, stopId, placeName.trim());
      onChange([
        ...infoCards,
        { id: crypto.randomUUID(), placement: "top", heroPhotoHash: null, heroPhotoUrl: null, ...card },
      ]);
      setManualName("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyPlace(null);
    }
  }

  function remove(id) {
    onChange(infoCards.filter((c) => c.id !== id));
    if (heroPickerFor === id) setHeroPickerFor(null);
  }

  function updateCard(id, patch) {
    onChange(infoCards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function toggleHeroPicker(card) {
    if (heroPickerFor === card.id) {
      setHeroPickerFor(null);
      return;
    }
    setHeroPickerFor(card.id);
    if (!heroCandidates[card.id]) {
      setHeroLoading(true);
      try {
        const photos = await fetchMatchingPhotos(storyId, stopId, card.placeName);
        setHeroCandidates((prev) => ({ ...prev, [card.id]: photos }));
      } catch (e) {
        setError(e.message);
      } finally {
        setHeroLoading(false);
      }
    }
  }

  return (
    <div className="info-cards">
      {infoCards.map((card) => (
        <div className="info-card" key={card.id}>
          {card.heroPhotoUrl && <img className="info-card-hero-preview" src={card.heroPhotoUrl} alt="" />}
          <div className="info-card-header">
            <div>
              <h4>{card.placeName}</h4>
              {card.subtitle && <p className="info-card-subtitle">{card.subtitle}</p>}
            </div>
            <button className="link-btn" onClick={() => remove(card.id)}>
              {t("removeBtn")}
            </button>
          </div>
          {card.summary && <p className="info-card-summary">{card.summary}</p>}
          {card.facts?.length > 0 && (
            <dl className="info-card-facts">
              {card.facts.map((f, i) => (
                <div key={i}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="info-card-controls">
            <label className="info-card-placement">
              {t("placementLabel")}
              <select
                value={card.placement || "top"}
                onChange={(e) => updateCard(card.id, { placement: e.target.value })}
              >
                <option value="top">{t("placementTop")}</option>
                <option value="middle">{t("placementMiddle")}</option>
                <option value="end">{t("placementEnd")}</option>
              </select>
            </label>

            <button className="link-btn" onClick={() => toggleHeroPicker(card)}>
              {t("heroPhotoLabel")}: {card.heroPhotoUrl ? "✓" : t("heroPhotoNone")} — {t("chooseHeroBtn")}
            </button>
          </div>

          {heroPickerFor === card.id && (
            <div className="hero-picker">
              {heroLoading && <p>{t("researching")}</p>}
              {!heroLoading && (heroCandidates[card.id] || []).length === 0 && (
                <p className="hint">{t("heroPhotoNone")}</p>
              )}
              <div className="hero-picker-grid">
                {card.heroPhotoHash && (
                  <button
                    className="hero-picker-thumb clear"
                    title={t("heroPhotoNone")}
                    onClick={() => updateCard(card.id, { heroPhotoHash: null, heroPhotoUrl: null })}
                  >
                    ✕
                  </button>
                )}
                {(heroCandidates[card.id] || []).map((p) => (
                  <button
                    key={p.hash}
                    className={`hero-picker-thumb ${card.heroPhotoHash === p.hash ? "selected" : ""}`}
                    onClick={() => {
                      updateCard(card.id, { heroPhotoHash: p.hash, heroPhotoUrl: p.thumbUrl });
                      setHeroPickerFor(null);
                    }}
                  >
                    <img src={p.thumbUrl} alt="" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {availableSuggestions.length > 0 && (
        <div className="info-card-suggestions">
          <span className="route-embed-hint">{t("suggestedFromPhotos")}</span>
          {availableSuggestions.map((name) => (
            <button
              key={name}
              className="suggestion-chip"
              onClick={() => generate(name)}
              disabled={!!busyPlace}
            >
              {busyPlace === name ? t("researchingPlace", name) : `+ ${name}`}
            </button>
          ))}
        </div>
      )}

      <div className="route-embed-add">
        <input
          placeholder={t("addPlaceByName")}
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate(manualName)}
        />
        <button
          className="ai-btn small"
          onClick={() => generate(manualName)}
          disabled={!manualName.trim() || !!busyPlace}
        >
          {busyPlace === manualName ? t("researching") : t("addInfoCard")}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
