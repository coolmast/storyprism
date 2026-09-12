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
    // Was sharing coastal's exact heading font (Playfair Display) and a
    // very similar warm-cream palette - the two themes read as near
    // identical in the picker. Moved to a Garamond pairing (a genuinely
    // different serif family, not just a different weight) and shifted the
    // accents from orange/teal toward mustard/faded-ink-green so the color
    // swatch reads distinctly too.
    label: "Vintage Postcard",
    swatch: ["#ede0c4", "#b5822a", "#4c6b52"],
    fontImport: "family=Cormorant+Garamond:wght@600;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400",
    headingFont: '"Cormorant Garamond", Georgia, serif',
    bodyFont: '"EB Garamond", Georgia, serif',
    ink: "#3a2f22",
    paper: "#ede0c4",
    accent: "#b5822a",
    accent2: "#4c6b52",
    sand: "#e0d2a8",
    line: "#c9b980",
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
  ocean: {
    label: "Ocean Blue",
    swatch: ["#eef5f7", "#1f6f8b", "#e3a857"],
    fontImport: "family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:wght@400;600",
    headingFont: '"Fraunces", Georgia, serif',
    bodyFont: '"Nunito Sans", "Helvetica Neue", sans-serif',
    ink: "#0f2b33",
    paper: "#eef5f7",
    accent: "#1f6f8b",
    accent2: "#e3a857",
    sand: "#d8ebef",
    line: "#bcd8de",
    headingCase: "none",
    headingTracking: "normal",
    heroScrim: "linear-gradient(to top, rgba(10,30,40,0.85), rgba(10,30,40,0.1) 60%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "",
  },
  midnight: {
    label: "Midnight",
    swatch: ["#0b0f1a", "#5b8fd6", "#c9d4e3"],
    fontImport: "family=Marcellus&family=Karla:wght@400;500",
    headingFont: '"Marcellus", Georgia, serif',
    bodyFont: '"Karla", "Helvetica Neue", sans-serif',
    ink: "#dbe4f0",
    paper: "#0b0f1a",
    accent: "#5b8fd6",
    accent2: "#c9d4e3",
    sand: "#151b2b",
    line: "#26304a",
    headingCase: "none",
    headingTracking: "0.02em",
    heroScrim: "linear-gradient(to top, rgba(0,0,5,0.92), rgba(0,0,5,0.15) 60%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "invert(1) hue-rotate(190deg) brightness(0.85) contrast(1.1)",
  },
  sunset: {
    label: "Sunset",
    swatch: ["#fdf1e7", "#e8604c", "#7c4a70"],
    fontImport: "family=Bodoni+Moda:opsz,wght@6..96,600;6..96,700&family=Mulish:wght@400;500",
    headingFont: '"Bodoni Moda", Georgia, serif',
    bodyFont: '"Mulish", "Helvetica Neue", sans-serif',
    ink: "#3a1f2b",
    paper: "#fdf1e7",
    accent: "#e8604c",
    accent2: "#7c4a70",
    sand: "#f7ddc9",
    line: "#eec7a8",
    headingCase: "none",
    headingTracking: "normal",
    heroScrim: "linear-gradient(to top, rgba(60,20,30,0.85), rgba(60,20,30,0.1) 60%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "sepia(0.4) saturate(1.4) hue-rotate(-10deg)",
  },
  sunrise: {
    label: "Sunrise",
    swatch: ["#fff8ec", "#f4a259", "#8fb996"],
    fontImport: "family=Cardo:wght@400;700&family=Lato:wght@400;700",
    headingFont: '"Cardo", Georgia, serif',
    bodyFont: '"Lato", "Helvetica Neue", sans-serif',
    ink: "#4a3b28",
    paper: "#fff8ec",
    accent: "#f4a259",
    accent2: "#8fb996",
    sand: "#fbe8cc",
    line: "#f0d9b5",
    headingCase: "none",
    headingTracking: "normal",
    heroScrim: "linear-gradient(to top, rgba(80,50,20,0.75), rgba(80,50,20,0.05) 55%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "sepia(0.2) saturate(1.2) brightness(1.05)",
  },
  adventure: {
    label: "Adventure",
    swatch: ["#f5f1e6", "#4a6741", "#8a6d3b"],
    fontImport: "family=Oswald:wght@500;600&family=Merriweather:wght@400;700",
    headingFont: '"Oswald", "Helvetica Neue", sans-serif',
    bodyFont: '"Merriweather", Georgia, serif',
    ink: "#2e2a1f",
    paper: "#f5f1e6",
    accent: "#4a6741",
    accent2: "#8a6d3b",
    sand: "#e8e0c8",
    line: "#d3c9a3",
    headingCase: "uppercase",
    headingTracking: "0.05em",
    heroScrim: "linear-gradient(to top, rgba(20,25,10,0.88), rgba(20,25,10,0.15) 58%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "sepia(0.15) saturate(1.1) hue-rotate(15deg)",
  },
  nordic: {
    label: "Nordic Mist",
    swatch: ["#f4f6f7", "#5c7a89", "#2f3e46"],
    fontImport: "family=Jost:wght@500;600&family=Work+Sans:wght@400;500",
    headingFont: '"Jost", "Helvetica Neue", sans-serif',
    bodyFont: '"Work Sans", "Helvetica Neue", sans-serif',
    ink: "#2f3e46",
    paper: "#f4f6f7",
    accent: "#5c7a89",
    accent2: "#2f3e46",
    sand: "#e3e9eb",
    line: "#cfd8db",
    headingCase: "none",
    headingTracking: "0.01em",
    heroScrim: "linear-gradient(to top, rgba(20,30,35,0.8), rgba(20,30,35,0.05) 55%)",
    mapTiles: OSM_STANDARD,
    mapFilter: "grayscale(0.6) saturate(0.9)",
  },
};

export const DEFAULT_THEME = "coastal";

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
