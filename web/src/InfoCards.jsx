import { useState } from "react";
import { generateInfoCard, fetchMatchingPhotos } from "./api.js";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";

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
        { id: uid(), placement: "top", heroPhotoHash: null, heroPhotoUrl: null, ...card },
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

  function updateFact(cardId, index, patch) {
    onChange(
      infoCards.map((c) =>
        c.id === cardId ? { ...c, facts: c.facts.map((f, i) => (i === index ? { ...f, ...patch } : f)) } : c
      )
    );
  }

  function addFact(cardId) {
    onChange(
      infoCards.map((c) =>
        c.id === cardId ? { ...c, facts: [...(c.facts || []), { label: "", value: "" }] } : c
      )
    );
  }

  function removeFact(cardId, index) {
    onChange(
      infoCards.map((c) => (c.id === cardId ? { ...c, facts: c.facts.filter((_, i) => i !== index) } : c))
    );
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
            <div className="info-card-header-fields">
              <div className="info-card-name-row">
                <input
                  className="info-card-name-input"
                  value={card.placeName}
                  onChange={(e) => {
                    updateCard(card.id, { placeName: e.target.value });
                    setHeroCandidates((prev) => {
                      if (!(card.id in prev)) return prev;
                      const next = { ...prev };
                      delete next[card.id];
                      return next;
                    });
                  }}
                />
                {card.websiteUrl && (
                  <a
                    className="info-card-link"
                    href={card.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={t("visitWebsite")}
                    aria-label={t("visitWebsite")}
                  >
                    ↗
                  </a>
                )}
              </div>
              <input
                className="info-card-subtitle-input"
                placeholder={t("subtitlePlaceholder")}
                value={card.subtitle || ""}
                onChange={(e) => updateCard(card.id, { subtitle: e.target.value })}
              />
            </div>
            <button className="link-btn danger" onClick={() => remove(card.id)}>
              {t("removeBtn")}
            </button>
          </div>

          <textarea
            className="info-card-summary-input"
            placeholder={t("summaryPlaceholder")}
            value={card.summary || ""}
            onChange={(e) => updateCard(card.id, { summary: e.target.value })}
          />

          <div className="info-card-website-row">
            <span className="control-label">{t("websiteUrlLabel")}</span>
            <input
              type="url"
              className="info-card-website-input"
              placeholder={t("websiteUrlPlaceholder")}
              value={card.websiteUrl || ""}
              onChange={(e) => updateCard(card.id, { websiteUrl: e.target.value })}
            />
          </div>

          <dl className="info-card-facts editable">
            {(card.facts || []).map((f, i) => (
              <div key={i} className="info-card-fact-row">
                <input
                  className="info-card-fact-label"
                  placeholder={t("factLabelPlaceholder")}
                  value={f.label}
                  onChange={(e) => updateFact(card.id, i, { label: e.target.value })}
                />
                <input
                  className="info-card-fact-value"
                  placeholder={t("factValuePlaceholder")}
                  value={f.value}
                  onChange={(e) => updateFact(card.id, i, { value: e.target.value })}
                />
                <button
                  type="button"
                  className="link-btn danger small"
                  title={t("removeBtn")}
                  onClick={() => removeFact(card.id, i)}
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="link-btn add-fact-btn" onClick={() => addFact(card.id)}>
              + {t("addFact")}
            </button>
          </dl>

          <div className="info-card-controls">
            <label className="info-card-placement">
              <span className="control-label">{t("placementLabel")}</span>
              <select
                value={card.placement || "top"}
                onChange={(e) => updateCard(card.id, { placement: e.target.value })}
              >
                <option value="top">{t("placementTop")}</option>
                <option value="middle">{t("placementMiddle")}</option>
                <option value="end">{t("placementEnd")}</option>
              </select>
            </label>

            <button
              type="button"
              className={`hero-picker-toggle ${heroPickerFor === card.id ? "open" : ""}`}
              onClick={() => toggleHeroPicker(card)}
            >
              {card.heroPhotoUrl ? (
                <img className="hero-picker-toggle-thumb" src={card.heroPhotoUrl} alt="" />
              ) : (
                <span className="hero-picker-toggle-placeholder" aria-hidden="true">🖼</span>
              )}
              <span>{card.heroPhotoUrl ? t("changeHeroPhoto") : t("addHeroPhoto")}</span>
            </button>
          </div>

          {heroPickerFor === card.id && (
            <div className="hero-picker">
              {heroLoading && <p className="hint">{t("researching")}</p>}
              {!heroLoading && (heroCandidates[card.id] || []).length === 0 && (
                <p className="hint">{t("noMatchingPhotos")}</p>
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
