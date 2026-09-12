import { useEffect, useState } from "react";
import {
  fetchAlbums,
  fetchItinerary,
  fetchItineraryByDate,
  fetchStories,
  fetchStory,
  createStory,
  deleteStory,
} from "./api.js";
import AlbumList from "./AlbumList.jsx";
import ItineraryMap from "./ItineraryMap.jsx";
import StopList from "./StopList.jsx";
import StoryList from "./StoryList.jsx";
import StoryEditor from "./StoryEditor.jsx";
import { useI18n, UI_LANGUAGES } from "./i18n.jsx";
import "./App.css";

const LANG_FLAG = { en: "🇬🇧", de: "🇩🇪", da: "🇩🇰" };

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState("new"); // "new" | "stories" | "editor"
  const [source, setSource] = useState("album"); // "album" | "dateRange"

  const [albums, setAlbums] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [rangeTitle, setRangeTitle] = useState("");
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);

  useEffect(() => {
    fetchAlbums().then(setAlbums).catch((e) => setError(e.message));
  }, []);

  // The app is a single-page app with no URL routing beyond this - "tab"
  // was pure in-memory React state, so the address bar always stayed at
  // "/" no matter what you were doing. On mobile that's a real bug, not
  // just a cosmetic one: opening "View story" (a new tab with a map and
  // 50+ photos) is exactly the kind of thing that gets a backgrounded tab
  // evicted from memory under pressure, and when Android reloads it later
  // from its last URL, "/" always resets to the start screen - there was
  // no history entry anywhere that pointed back at "the editor for story
  // X". Same story for the actual back button/gesture. Fixing this means
  // reflecting the current story in the URL and restoring from it on
  // load/back, not just switching an in-memory tab.
  async function applyRoute() {
    const match = window.location.pathname.match(/^\/edit\/([^/]+)$/);
    if (match) {
      try {
        const story = await fetchStory(match[1]);
        setActiveStory(story);
        setTab("editor");
        return;
      } catch {
        // Story was deleted or the id is stale - fall through to a sane
        // default instead of showing a dead editor.
      }
    }
    setTab(window.location.pathname === "/library" ? "stories" : "new");
  }

  useEffect(() => {
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => window.removeEventListener("popstate", applyRoute);
  }, []);

  function goTo(newTab, story = null) {
    setTab(newTab);
    if (story) setActiveStory(story);
    const path = newTab === "editor" && story ? `/edit/${story.id}` : newTab === "stories" ? "/library" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }

  useEffect(() => {
    if (source === "album") {
      if (!selectedUid) {
        setStops([]);
        return;
      }
      setLoading(true);
      setError(null);
      fetchItinerary(selectedUid)
        .then(setStops)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      if (!dateFrom || !dateTo) {
        setStops([]);
        return;
      }
      setLoading(true);
      setError(null);
      fetchItineraryByDate(dateFrom, dateTo)
        .then(setStops)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [source, selectedUid, dateFrom, dateTo]);

  function refreshStories() {
    fetchStories().then(setStories).catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (tab === "stories") refreshStories();
  }, [tab]);

  async function handleCreateStory() {
    setCreating(true);
    setError(null);
    try {
      const payload =
        source === "album"
          ? { albumUid: selectedUid, contentLanguage: lang }
          : { dateFrom, dateTo, title: rangeTitle, contentLanguage: lang };
      const story = await createStory(payload);
      goTo("editor", story);
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function openStory(id) {
    const story = await fetchStory(id);
    goTo("editor", story);
  }

  async function removeStory(id) {
    if (!confirm(t("deleteStoryConfirm"))) return;
    await deleteStory(id);
    refreshStories();
  }

  const selectedAlbum = albums.find((a) => a.uid === selectedUid);

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t("appTitle")}</h1>
        <span>{t("appTagline")}</span>
        <nav className="tabs">
          <button className={tab === "new" ? "active" : ""} onClick={() => goTo("new")}>
            {t("tabNewStory")}
          </button>
          <button className={tab === "stories" ? "active" : ""} onClick={() => goTo("stories")}>
            {t("tabMyStories")}
          </button>
        </nav>
        <div className="lang-switcher" title={t("uiLanguageLabel")}>
          {UI_LANGUAGES.map((code) => (
            <button
              key={code}
              className={lang === code ? "active" : ""}
              onClick={() => setLang(code)}
            >
              {LANG_FLAG[code]} {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {tab === "new" && (
        <div className="app-body">
          <aside className="sidebar">
            <div className="source-toggle">
              <button className={source === "album" ? "active" : ""} onClick={() => setSource("album")}>
                {t("sourceAlbum")}
              </button>
              <button
                className={source === "dateRange" ? "active" : ""}
                onClick={() => setSource("dateRange")}
              >
                {t("sourceDateRange")}
              </button>
            </div>
            {error && <p className="error">{error}</p>}
            {source === "album" && (
              <AlbumList albums={albums} selectedUid={selectedUid} onSelect={setSelectedUid} />
            )}
            {source === "dateRange" && (
              <div className="date-range-picker">
                <p className="route-embed-hint">{t("dateRangeHint")}</p>
                <label className="date-range-field">
                  {t("dateFromLabel")}
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </label>
                <label className="date-range-field">
                  {t("dateToLabel")}
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </label>
                <input
                  className="date-range-title-input"
                  placeholder={t("customTitlePlaceholder")}
                  value={rangeTitle}
                  onChange={(e) => setRangeTitle(e.target.value)}
                />
              </div>
            )}
          </aside>
          <main className="content">
            {source === "album" && !selectedUid && <p className="hint">{t("pickAlbumHint")}</p>}
            {source === "dateRange" && !(dateFrom && dateTo) && (
              <p className="hint">{t("pickDateRangeHint")}</p>
            )}
            {((source === "album" && selectedUid) || (source === "dateRange" && dateFrom && dateTo)) && (
              <>
                <div className="content-header">
                  <h2>
                    {source === "album" ? selectedAlbum?.title : rangeTitle || `${dateFrom} – ${dateTo}`}
                  </h2>
                  <button className="save-btn" onClick={handleCreateStory} disabled={creating}>
                    {creating
                      ? t("creating")
                      : source === "album"
                      ? t("createStoryBtn")
                      : t("createStoryFromRangeBtn")}
                  </button>
                </div>
                {loading && <p>{t("loadingItinerary")}</p>}
                {!loading && (
                  <>
                    <ItineraryMap stops={stops} />
                    <StopList stops={stops} />
                  </>
                )}
              </>
            )}
          </main>
        </div>
      )}

      {tab === "stories" && (
        <div className="app-body single">
          <main className="content">
            <h2>{t("myStoriesTitle")}</h2>
            {error && <p className="error">{error}</p>}
            <StoryList stories={stories} onOpen={openStory} onDelete={removeStory} />
          </main>
        </div>
      )}

      {tab === "editor" && activeStory && (
        <div className="app-body single">
          <main className="content">
            <StoryEditor
              story={activeStory}
              onBack={() => goTo("stories")}
              onSaved={(s) => setActiveStory(s)}
            />
          </main>
        </div>
      )}
    </div>
  );
}
