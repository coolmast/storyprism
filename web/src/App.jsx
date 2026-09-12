import { useEffect, useState } from "react";
import { fetchAlbums, fetchItinerary, fetchStories, fetchStory, createStory, deleteStory } from "./api.js";
import AlbumList from "./AlbumList.jsx";
import ItineraryMap from "./ItineraryMap.jsx";
import StopList from "./StopList.jsx";
import StoryList from "./StoryList.jsx";
import StoryEditor from "./StoryEditor.jsx";
import "./App.css";

export default function App() {
  const [tab, setTab] = useState("new"); // "new" | "stories" | "editor"

  const [albums, setAlbums] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);

  useEffect(() => {
    fetchAlbums().then(setAlbums).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!selectedUid) return;
    setLoading(true);
    setError(null);
    fetchItinerary(selectedUid)
      .then(setStops)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedUid]);

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
      const story = await createStory(selectedUid);
      setActiveStory(story);
      setTab("editor");
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function openStory(id) {
    const story = await fetchStory(id);
    setActiveStory(story);
    setTab("editor");
  }

  async function removeStory(id) {
    if (!confirm("Delete this story? This can't be undone.")) return;
    await deleteStory(id);
    refreshStories();
  }

  const selectedAlbum = albums.find((a) => a.uid === selectedUid);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Story Builder</h1>
        <span>Turn a PhotoPrism album into a travel story</span>
        <nav className="tabs">
          <button className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>
            New Story
          </button>
          <button className={tab === "stories" ? "active" : ""} onClick={() => setTab("stories")}>
            My Stories
          </button>
        </nav>
      </header>

      {tab === "new" && (
        <div className="app-body">
          <aside className="sidebar">
            {error && <p className="error">{error}</p>}
            <AlbumList albums={albums} selectedUid={selectedUid} onSelect={setSelectedUid} />
          </aside>
          <main className="content">
            {!selectedUid && <p className="hint">Pick an album to build its itinerary.</p>}
            {selectedUid && (
              <>
                <div className="content-header">
                  <h2>{selectedAlbum?.title}</h2>
                  <button className="save-btn" onClick={handleCreateStory} disabled={creating}>
                    {creating ? "Creating…" : "Create story from this album"}
                  </button>
                </div>
                {loading && <p>Loading itinerary…</p>}
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
            <h2>My Stories</h2>
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
              onBack={() => setTab("stories")}
              onSaved={(s) => setActiveStory(s)}
            />
          </main>
        </div>
      )}
    </div>
  );
}
