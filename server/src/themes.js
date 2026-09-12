// CARTO's basemaps.cartocdn.com raster tiles (previously used for the
// Voyager/Positron/Dark basemaps below) now require an API key we don't
// have - unauthenticated requests still return 200 PNGs, but with an
// "API KEY REQUIRED" watermark baked into the image, which is why maps on
// every theme but "vintage" (the only one that was already on plain OSM)
// rendered as a big empty-looking, watermarked box. Standard OpenStreetMap
// tiles are the one raster source that's reliably free with no key, so
// every theme now uses those; the different-per-theme "mood" is instead
// applied as a CSS filter on Leaflet's tile pane (see mapFilter, used in
// render.js) - grayscale for a Positron-like light look, invert+hue-rotate
// for a Dark-Matter-like look (a standard trick for faking a dark basemap
// from light OSM tiles), sepia for a vintage-postcard tint.
const OSM_STANDARD = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap contributors",
};

// Each theme is a self-contained visual identity: palette + font pairing +
// a couple of mood knobs (heading case/tracking, hero darkness) + a map
// basemap that fits the mood. Adding a theme means adding an entry here -
// render.js/deck.js only ever read from this.
export const THEMES = {
  coastal: {
    label: "Coastal",
    swatch: ["#faf6f0", "#c8703d", "#2f6f6a"],
    fontImport:
      "family=Playfair+Display:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600",
    headingFont: '"Playfair Display", Georgia, serif',
    bodyFont: '"Source Serif 4", Georgia, serif',
    ink: "#2b2420",
    paper: "#faf6f0",
    accent: "#c8703d",
    accent2: "#2f6f6a",
    sand: "#e8dcc8",
    line: "#d8cbb5",
    headingCase: "none",
    headingTracking: "normal",
    heroScrim: "linear-gradient(to top, rgba(20,15,10,0.85), rgba(20,15,10,0.1) 60%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "",
  },
  monochrome: {
    label: "Monochrome Editorial",
    swatch: ["#ffffff", "#111111", "#6b6b6b"],
    fontImport: "family=Archivo+Black&family=Inter:wght@400;500;600",
    headingFont: '"Archivo Black", "Helvetica Neue", sans-serif',
    bodyFont: '"Inter", "Helvetica Neue", sans-serif',
    ink: "#111111",
    paper: "#ffffff",
    accent: "#111111",
    accent2: "#6b6b6b",
    sand: "#f0f0f0",
    line: "#dcdcdc",
    headingCase: "uppercase",
    headingTracking: "0.02em",
    heroScrim: "linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.15) 55%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "grayscale(1) contrast(0.95) brightness(1.05)",
  },
  vintage: {
    label: "Vintage Postcard",
    swatch: ["#f2e8d5", "#9c3b2e", "#33475b"],
    fontImport: "family=Playfair+Display:wght@700&family=EB+Garamond:ital,wght@0,400;0,600;1,400",
    headingFont: '"Playfair Display", Georgia, serif',
    bodyFont: '"EB Garamond", Georgia, serif',
    ink: "#3a2f22",
    paper: "#f2e8d5",
    accent: "#9c3b2e",
    accent2: "#33475b",
    sand: "#e5d4ad",
    line: "#cdb98a",
    headingCase: "none",
    headingTracking: "0.03em",
    heroScrim: "linear-gradient(to top, rgba(40,25,10,0.88), rgba(40,25,10,0.2) 55%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "sepia(0.35) saturate(1.3) brightness(1.02)",
  },
  bold: {
    label: "Bold Modern",
    swatch: ["#15161a", "#ff5a3c", "#f4f4f4"],
    fontImport: "family=Bebas+Neue&family=Space+Grotesk:wght@400;500;600",
    headingFont: '"Bebas Neue", "Space Grotesk", sans-serif',
    bodyFont: '"Space Grotesk", "Helvetica Neue", sans-serif',
    ink: "#f4f4f4",
    paper: "#15161a",
    accent: "#ff5a3c",
    accent2: "#f4f4f4",
    sand: "#22232a",
    line: "#33343c",
    headingCase: "uppercase",
    headingTracking: "0.04em",
    heroScrim: "linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0.1) 60%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "invert(1) hue-rotate(180deg) brightness(0.9) contrast(1.1)",
  },
};

export const DEFAULT_THEME = "coastal";

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
