// A pack is a distinct "look" for the printed book, same idea (and same 4
// ids) as the web PDF export's packs (see pdfLayoutPacks.js) - just applied
// to this pipeline's own template set (spreadLayouts.js's SPREAD_LAYOUTS,
// shared by the Saal and CEWE writers) instead of pdfTemplates.js's. The two
// pipelines plan fundamentally different canvases - a lay-flat/glued spread
// with a fold vs. a single printed page - so a pack here is a weight table
// over spread templates, not the PDF pack's per-page template list. Reusing
// the existing, already content-aware templates (rather than porting the
// PDF ones) means no writer changes: saalSvg.js/ceweExport.js only ever read
// a spread's plain element list, never which template produced it.
//
// A per-stop `bookLayoutOverride` (pinning one template) still wins over
// whichever pack is selected - see bookPlanner.js.
export const BOOK_LAYOUT_PACKS = {
  photobook: {
    label: "Photobook",
    templates: {
      "backdrop-cards": 1.15,
      "hero-page": 1,
      "page-backdrops": 0.95,
      "page-mosaics": 0.95,
      panorama: 0.9,
      "white-scatter": 0.8,
    },
  },
  classic: {
    label: "Classic",
    templates: {
      "hero-page": 1.1,
      "page-backdrops": 1.05,
      "page-mosaics": 0.7,
      panorama: 0.6,
      "backdrop-cards": 0.5,
      "white-scatter": 0.2,
    },
  },
  airy: {
    label: "Gallery (airy)",
    templates: {
      "white-scatter": 1.15,
      panorama: 1,
      "page-backdrops": 0.7,
      "hero-page": 0.6,
      "backdrop-cards": 0.4,
      "page-mosaics": 0.25,
    },
  },
  dense: {
    label: "Mosaic (dense)",
    templates: {
      "page-mosaics": 1.2,
      "backdrop-cards": 0.9,
      "page-backdrops": 0.8,
      "hero-page": 0.5,
      panorama: 0.4,
      "white-scatter": 0.2,
    },
  },
};

export const DEFAULT_BOOK_LAYOUT_PACK = "photobook";

export function getBookLayoutPack(id) {
  return BOOK_LAYOUT_PACKS[id] || BOOK_LAYOUT_PACKS[DEFAULT_BOOK_LAYOUT_PACK];
}
