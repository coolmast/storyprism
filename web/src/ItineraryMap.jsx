import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const stopIcon = (n) =>
  L.divIcon({
    className: "stop-icon",
    html: `<span>${n}</span>`,
    iconSize: [28, 28],
  });

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      map.fitBounds(points, { padding: [40, 40] });
    }
  }, [points, map]);
  return null;
}

export default function ItineraryMap({ stops }) {
  const located = stops.filter((s) => s.lat != null);
  const points = located.map((s) => [s.lat, s.lng]);

  if (located.length === 0) {
    return <div className="map-empty">No geotagged photos in this album yet.</div>;
  }

  return (
    <MapContainer center={points[0]} zoom={8} className="itinerary-map">
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={points} pathOptions={{ color: "#c8703d", weight: 3, dashArray: "6 8" }} />
      {located.map((s) => (
        <Marker key={s.index} position={[s.lat, s.lng]} icon={stopIcon(s.index + 1)}>
          <Popup>
            <strong>{s.placeCity || s.placeLabel || "Unknown place"}</strong>
            <br />
            {new Date(s.startedAt).toLocaleDateString()}
            <br />
            {s.photoCount} photos
            {s.photos[0]?.thumbUrl && (
              <div>
                <img src={s.photos[0].thumbUrl} alt="" width={160} />
              </div>
            )}
          </Popup>
        </Marker>
      ))}
      <FitBounds points={points} />
    </MapContainer>
  );
}
