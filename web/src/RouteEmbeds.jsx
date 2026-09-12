import { useState } from "react";
import { detectProvider } from "./embeds.js";

export default function RouteEmbeds({ embeds, onChange }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  function add() {
    const trimmed = url.trim();
    if (!trimmed) return;
    onChange([
      ...embeds,
      { id: crypto.randomUUID(), provider: detectProvider(trimmed), url: trimmed, title: title.trim() },
    ]);
    setUrl("");
    setTitle("");
  }

  function remove(id) {
    onChange(embeds.filter((e) => e.id !== id));
  }

  return (
    <div className="route-embeds">
      {embeds.length > 0 && (
        <ul className="route-embed-list">
          {embeds.map((e) => (
            <li key={e.id}>
              <span className="route-embed-provider">{e.provider}</span>
              <a href={e.url} target="_blank" rel="noreferrer">
                {e.title || e.url}
              </a>
              <button className="link-btn" onClick={() => remove(e.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="route-embed-add">
        <input
          placeholder="Paste a Strava/Komoot/Garmin route link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="ai-btn small" onClick={add} disabled={!url.trim()}>
          Add route
        </button>
      </div>
      <p className="route-embed-hint">
        Use the service's "Embed" share link for an interactive map on the page; any other link just
        shows as a button out to the route.
      </p>
    </div>
  );
}
