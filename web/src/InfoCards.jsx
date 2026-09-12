import { useState } from "react";
import { generateInfoCard } from "./api.js";

// suggestedPlaces comes from the server (PhotoPrism PlaceLabels + auto
// photo titles for this stop's included photos - see server/src/places.js)
// - it's just candidate names, nothing is generated until the user clicks
// one, so a wrong guess (an occasional person's name PhotoPrism detected
// as a photo's subject) costs nothing but an ignored chip.
export default function InfoCards({ storyId, stopId, suggestedPlaces, infoCards, onChange }) {
  const [manualName, setManualName] = useState("");
  const [busyPlace, setBusyPlace] = useState(null);
  const [error, setError] = useState(null);

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
      onChange([...infoCards, { id: crypto.randomUUID(), ...card }]);
      setManualName("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyPlace(null);
    }
  }

  function remove(id) {
    onChange(infoCards.filter((c) => c.id !== id));
  }

  return (
    <div className="info-cards">
      {infoCards.map((card) => (
        <div className="info-card" key={card.id}>
          <div className="info-card-header">
            <div>
              <h4>{card.placeName}</h4>
              {card.subtitle && <p className="info-card-subtitle">{card.subtitle}</p>}
            </div>
            <button className="link-btn" onClick={() => remove(card.id)}>
              Remove
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
        </div>
      ))}

      {availableSuggestions.length > 0 && (
        <div className="info-card-suggestions">
          <span className="route-embed-hint">Suggested from your photos:</span>
          {availableSuggestions.map((name) => (
            <button
              key={name}
              className="suggestion-chip"
              onClick={() => generate(name)}
              disabled={!!busyPlace}
            >
              {busyPlace === name ? `Researching ${name}…` : `+ ${name}`}
            </button>
          ))}
        </div>
      )}

      <div className="route-embed-add">
        <input
          placeholder="Or add any other place by name…"
          value={manualName}
          onChange={(e) => setManualName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && generate(manualName)}
        />
        <button
          className="ai-btn small"
          onClick={() => generate(manualName)}
          disabled={!manualName.trim() || !!busyPlace}
        >
          {busyPlace === manualName ? "Researching…" : "Add info card"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
