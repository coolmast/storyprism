import { useState } from "react";
import { detectProvider } from "./embeds.js";
import { useI18n } from "./i18n.jsx";
import { uid } from "./uid.js";

export default function RouteEmbeds({ embeds, onChange }) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  function add() {
    const trimmed = url.trim();
    if (!trimmed) return;
    onChange([
      ...embeds,
      { id: uid(), provider: detectProvider(trimmed), url: trimmed, title: title.trim() },
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
              <button className="link-btn danger" onClick={() => remove(e.id)}>
                {t("removeBtn")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="route-embed-add">
        <input
          placeholder={t("pasteRouteLink")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          placeholder={t("titleOptional")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="ai-btn small" onClick={add} disabled={!url.trim()}>
          {t("addRoute")}
        </button>
      </div>
      <p className="route-embed-hint">{t("routeEmbedHint")}</p>
    </div>
  );
}
