import { readFileSync } from "node:fs";

// Saal Digital photobook products, reverse-engineered from real projects
// written by Saal Design Software 4.7 (see README "Saal project format").
//
// All geometry is in Saal's native unit, 0.1 mm. `spread` is one inner
// double page *including* bleed; the fold is at spread.w / 2. The cover is a
// single wrap-around sheet (back | spine | front).
//
// Page counts are NOT free: every page count of a book is its own article in
// Saal's catalog (`childArticleID`), and the importer rejects a project whose
// child article doesn't match its page count ("Projekt konnte nicht
// importiert werden"). The full table (26-160 pages, step 2, per product) is
// in saalPageArticles.json, derived from Saal's local catalog cache. The
// spine - and so the cover width - grows in steps of 1 mm per 6 pages;
// `coverAnchors` are widths Saal itself wrote, other counts are stepped from
// the nearest anchor.
//
// The remaining article/configurator IDs identify the product and are the
// same for every page count: the square book from the user's ordered 2018
// book (matt cover, glossy photo paper), the A4 ones from fresh projects.
export const BOOK_PRODUCTS = {
  "saal-square-28": {
    label: "Saal Photobook 28 × 28 cm (square)",
    spread: { w: 5460, h: 2760 },
    coverHeight: 2880,
    // Cover widths Saal wrote at these page counts (the spine grows 1 mm
    // per 6-page bracket, see coverSize()).
    coverAnchors: { 64: 5844, 68: 5844, 70: 5854, 72: 5854, 74: 5854, 76: 5864 },
    ids: {
      configuratorArticleID: "5c010f57-4eb6-4bb5-91cf-7576da966ae8",
      coverArticleID: "b2d7cc82-8cf8-45c9-9e10-35db20e70aee",
      innerArticleID: "8ef4ca83-bb34-4945-b882-debfe3580a93",
      articleNumber: "30109122",
      articleCategoryID: null,
    },
  },
  "saal-a4-portrait": {
    label: "Saal Photobook A4 portrait",
    spread: { w: 4260, h: 2760 },
    coverHeight: 2880,
    coverAnchors: { 30: 4585 },
    ids: {
      configuratorArticleID: "b5dee056-0504-46d1-9bb9-f5a14e3aee53",
      coverArticleID: "af902c9c-deea-4b88-bd91-d645b770518d",
      innerArticleID: "211bd01e-e085-4fe2-8e33-1af915f94519",
      articleNumber: "30109116",
      articleCategoryID: "1b9d5f33-1776-4eb5-8a84-5a14784f155a",
    },
  },
  "saal-a4-landscape": {
    label: "Saal Photobook A4 landscape",
    spread: { w: 5660, h: 1940 },
    coverHeight: 2060,
    coverAnchors: { 30: 5984 },
    ids: {
      configuratorArticleID: "7327a717-f93e-42f8-bea6-7c0178c3a926",
      coverArticleID: "fe40d445-38f7-4cd7-a516-f1715b9bac79",
      innerArticleID: "4444dcbb-efd4-4edc-83c1-dfd93539538a",
      articleNumber: "30109119",
      articleCategoryID: "1b9d5f33-1776-4eb5-8a84-5a14784f155a",
    },
  },
};

// CEWE FOTOWELT photobooks (Hardcover Matt, standard digital print) - the
// counterparts of the three Saal formats above. Geometry is from CEWE's own
// article catalog (products-<n>.xml in the app's data folder, `composition`
// per article, mm there / 0.1 mm here); verified against projects the real
// software wrote (see README "CEWE project format"). Unlike Saal these are
// glued, not lay-flat: page 1 is a single right page, the last one a single
// left page, and the pages in between form the spreads - `singlePages`.
//
// Spine: base width + one `block` per 16 pages beyond the minimum (CEWE's
// "4 packages of 4 pages"); matches the cover width CEWE itself wrote at
// 26/46/86/202 pages exactly.
const ceweBook = ({ label, page, cover, coverBleed, ids }) => ({
  vendor: "cewe",
  label,
  // Planner canvas: both pages plus the 3 mm bleed on every edge, fold at w/2.
  spread: { w: 2 * page.w + 60, h: page.h + 60 },
  page,
  cover,
  coverBleed,
  spine: { base: 75, block: 12.49, pagesPerBlock: 16 },
  pages: { min: 26, max: 202, step: 4 },
  singlePages: 2,
  bleed: 30,
  ids,
});

Object.assign(BOOK_PRODUCTS, {
  "cewe-a4-portrait": ceweBook({
    label: "CEWE Fotobuch Groß Hardcover (A4 portrait)",
    page: { w: 2050, h: 2700 },
    cover: { w: 2100, h: 2750 },
    coverBleed: 100,
    ids: { artId: 9141, productName: "ALB15", articleName: "CEWE FOTOBUCH Groß Hardcover Matt" },
  }),
  "cewe-a4-landscape": ceweBook({
    label: "CEWE Fotobuch Groß Panorama Hardcover (A4 landscape)",
    page: { w: 2700, h: 2050 },
    cover: { w: 2750, h: 2100 },
    coverBleed: 100,
    ids: { artId: 9759, productName: "ALB35", articleName: "CEWE FOTOBUCH Groß Panorama Hardcover Matt" },
  }),
  "cewe-square-xl": ceweBook({
    label: "CEWE Fotobuch XL Hardcover (29 × 29 cm square)",
    page: { w: 2900, h: 2900 },
    cover: { w: 2960, h: 2960 },
    coverBleed: 100,
    ids: { artId: 9264, productName: "ALB32", articleName: "CEWE FOTOBUCH XL Hardcover Matt" },
  }),
});

export const DEFAULT_BOOK_PRODUCT = "saal-square-28";

export const vendorOf = (product) => product.vendor || "saal";

export function ceweSpineWidth(product, numPages) {
  const { base, block, pagesPerBlock } = product.spine;
  return base + Math.floor((numPages - product.pages.min) / pagesPerBlock) * block;
}

// CEWE's own cover box ("bundlesize"): back + spine + front, trimmed.
export function ceweCoverBox(product, numPages) {
  return { w: 2 * product.cover.w + ceweSpineWidth(product, numPages), h: product.cover.h };
}

// Shared Saal category/topic id - identical in every project inspected.
export const SAAL_CATEGORY_ID = "9ad91ddd-2087-841e-197e-f43744139f04";
export const SAAL_VERSION = "d4.7.378";

export function getBookProduct(id) {
  return BOOK_PRODUCTS[id] || BOOK_PRODUCTS[DEFAULT_BOOK_PRODUCT];
}

const PAGE_ARTICLES = JSON.parse(
  readFileSync(new URL("./saalPageArticles.json", import.meta.url), "utf8")
);

function productId(product) {
  return Object.keys(BOOK_PRODUCTS).find((id) => BOOK_PRODUCTS[id] === product);
}

export function knownPageCounts(product) {
  if (product.pages) {
    const { min, max, step } = product.pages;
    return Array.from({ length: (max - min) / step + 1 }, (_, i) => min + i * step);
  }
  return Object.keys(PAGE_ARTICLES[productId(product)] || {})
    .map(Number)
    .sort((a, b) => a - b);
}

// The page count a book with `neededPages` of content is exported at: the
// smallest known count that fits (the rest becomes blank pages), or the
// largest known one if the content needs more (flagged as overflow).
// `neededPages` counts spread pages only; products with single first/last
// pages (CEWE) need those on top.
export function resolvePageCount(product, neededPages) {
  const counts = knownPageCounts(product);
  const needed = neededPages + (product.singlePages || 0);
  const fit = counts.find((c) => c >= needed);
  return { pages: fit ?? counts.at(-1), overflow: fit === undefined };
}

export function childArticleIdFor(product, numPages) {
  return PAGE_ARTICLES[productId(product)]?.[String(numPages)] || null;
}

// Spine brackets: square books measured 64-68 -> one width, 70-74 -> +1 mm,
// 76 -> +2 mm, i.e. brackets of 6 pages starting at 4 (mod 6).
const bracket = (pages) => Math.floor((pages - 4) / 6);

export function coverSize(product, numPages) {
  if (vendorOf(product) === "cewe") {
    const box = ceweCoverBox(product, numPages);
    return { w: box.w + 2 * product.coverBleed, h: box.h + 2 * product.coverBleed };
  }
  const anchors = Object.entries(product.coverAnchors).map(([p, w]) => [Number(p), w]);
  if (product.coverAnchors[numPages]) return { w: product.coverAnchors[numPages], h: product.coverHeight };
  const [refPages, refWidth] = anchors.reduce((best, a) =>
    Math.abs(a[0] - numPages) < Math.abs(best[0] - numPages) ? a : best
  );
  return { w: refWidth + 10 * (bracket(numPages) - bracket(refPages)), h: product.coverHeight };
}

// Bleed on every outer edge (the thin red trim line in the Saal editor sits
// ~3 mm in); the cover additionally wraps ~6 mm around the board.
export const BLEED = 30;
export const COVER_WRAP = 60;
