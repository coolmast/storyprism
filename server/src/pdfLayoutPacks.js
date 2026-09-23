// A pack is a complete look for the printed book: which photo templates the
// automatic planner may use (with a weight - how much this pack "likes"
// each one), how stops open, what the cover looks like and which font the
// titles use. The planner (pdfPlanner.js) scores every template/photo-count
// combination against the actual photo shapes, so a pack describes taste,
// not a fixed sequence.
//
// Ids `classic`, `airy` and `dense` are kept from v2 because stories store
// them; their looks have been redesigned to be clearly different.
export const PDF_LAYOUT_PACKS = {
  photobook: {
    label: "Photobook",
    titleStyle: "handwritten",
    cover: "cover-collage",
    opening: "hero-overlay",
    chapterBackdrop: true,
    templates: {
      "backdrop-cards": 1.15,
      "blur-mosaic": 1,
      scatter: 0.8,
      "single-full-bleed": 0.7,
    },
  },
  classic: {
    label: "Classic",
    titleStyle: "theme",
    cover: "hero-pullquote",
    opening: "hero-pullquote",
    chapterBackdrop: false,
    templates: {
      "grid-4": 1,
      "duo-caption": 0.95,
      "photo-strip": 0.9,
      "single-full-bleed": 0.7,
    },
  },
  airy: {
    label: "Gallery (airy)",
    titleStyle: "theme",
    cover: "hero-pullquote",
    opening: "hero-pullquote",
    chapterBackdrop: false,
    templates: {
      scatter: 1.1,
      "single-full-bleed": 0.95,
      "duo-caption": 0.8,
    },
  },
  dense: {
    label: "Mosaic (dense)",
    titleStyle: "theme",
    cover: "cover-collage",
    opening: "hero-overlay",
    chapterBackdrop: true,
    templates: {
      "grid-6": 1.1,
      "blur-mosaic": 1,
    },
  },
};

export const DEFAULT_LAYOUT_PACK = "photobook";

export function getLayoutPack(id) {
  return PDF_LAYOUT_PACKS[id] || PDF_LAYOUT_PACKS[DEFAULT_LAYOUT_PACK];
}

export const TITLE_FONTS = {
  handwritten: { family: "'Indie Flower', cursive", import: "family=Indie+Flower" },
};
