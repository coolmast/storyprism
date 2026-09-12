import { useEffect, useState } from "react";
import { fetchAlbums, fetchItinerary } from "./api.js";
import AlbumList from "./AlbumList.jsx";
import ItineraryMap from "./ItineraryMap.jsx";
import StopList from "./StopList.jsx";
import "./App.css";

export default function App() {
  const [albums, setAlbums] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [stops, setStops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchAlbums()
      .then(setAlbums)
      .catch((e) => setError(e.message));
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

  const selectedAlbum = albums.find((a) => a.uid === selectedUid);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Story Builder</h1>
        <span>Turn a PhotoPrism album into a travel story</span>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          {error && !selectedUid && <p className="error">{error}</p>}
          <AlbumList albums={albums} selectedUid={selectedUid} onSelect={setSelectedUid} />
        </aside>

        <main className="content">
          {!selectedUid && <p className="hint">Pick an album to build its itinerary.</p>}
          {selectedUid && (
            <>
              <h2>{selectedAlbum?.title}</h2>
              {loading && <p>Loading itinerary…</p>}
              {error && selectedUid && <p className="error">{error}</p>}
              {!loading && !error && (
                <>
                  <ItineraryMap stops={stops} />
                  <StopList stops={stops} />
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
