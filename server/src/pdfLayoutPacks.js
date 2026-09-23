// A pack is just "which photo-bearing templates are in rotation" for the
// automatic planner (see pdfPlanner.js) - not a fixed sequence, since stops
// have wildly different photo counts. The planner cycles through a pack's
// list without repeating the same template twice in a row, skipping any
// whose capacity doesn't fit what's left.
export const PDF_LAYOUT_PACKS = {
  classic: {
    label: "Classic",
    templates: ["grid-4", "duo-caption", "grid-6", "photo-strip", "single-full-bleed"],
  },
  airy: {
    label: "Airy",
    templates: ["single-full-bleed", "duo-caption"],
  },
  dense: {
    label: "Dense",
    templates: ["grid-6", "grid-4", "photo-strip"],
  },
};

export const DEFAULT_LAYOUT_PACK = "classic";

export function getLayoutPack(id) {
  return PDF_LAYOUT_PACKS[id] || PDF_LAYOUT_PACKS[DEFAULT_LAYOUT_PACK];
}
