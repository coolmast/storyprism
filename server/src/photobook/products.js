// Saal Digital photobook products, reverse-engineered from real projects
// exported by Saal Design Software 4.7 (see README "Saal project format").
//
// All geometry is in Saal's native unit, 0.1 mm. `spread` is one inner
// double page *including* bleed; the fold is at spread.w / 2. The cover is a
// single wrap-around sheet (back | spine | front) whose width grows by one
// unit (0.1 mm) per inner page - measured: square 74 pages -> 5854, 64 pages
// -> 5844. `coverBaseWidth` is that width at zero pages.
//
// The article/configurator IDs identify the product for Saal's shop. They are
// copied verbatim from projects the Saal software created itself: the square
// book from the user's ordered 2018 book (matt cover, glossy photo paper),
// the A4 ones from freshly created empty projects.
export const BOOK_PRODUCTS = {
  "saal-square-28": {
    label: "Saal Photobook 28 × 28 cm (square)",
    spread: { w: 5460, h: 2760 },
    coverBaseWidth: 5780,
    coverHeight: 2880,
    minPages: 26,
    defaultPages: 30,
    maxPages: 130,
    ids: {
      configuratorArticleID: "5c010f57-4eb6-4bb5-91cf-7576da966ae8",
      coverArticleID: "b2d7cc82-8cf8-45c9-9e10-35db20e70aee",
      innerArticleID: "8ef4ca83-bb34-4945-b882-debfe3580a93",
      childArticleID: "1ebc4760-a4bd-4294-9108-8e39d7f3ebe7",
      articleNumber: "30109122",
      articleCategoryID: null,
    },
  },
  "saal-a4-portrait": {
    label: "Saal Photobook A4 portrait",
    spread: { w: 4260, h: 2760 },
    coverBaseWidth: 4555,
    coverHeight: 2880,
    minPages: 26,
    defaultPages: 30,
    maxPages: 130,
    ids: {
      configuratorArticleID: "b5dee056-0504-46d1-9bb9-f5a14e3aee53",
      coverArticleID: "af902c9c-deea-4b88-bd91-d645b770518d",
      innerArticleID: "211bd01e-e085-4fe2-8e33-1af915f94519",
      childArticleID: "5eb84f4e-599a-4f1a-a801-3f2c944a9147",
      articleNumber: "30109116",
      articleCategoryID: "1b9d5f33-1776-4eb5-8a84-5a14784f155a",
    },
  },
  "saal-a4-landscape": {
    label: "Saal Photobook A4 landscape",
    spread: { w: 5660, h: 1940 },
    coverBaseWidth: 5954,
    coverHeight: 2060,
    minPages: 26,
    defaultPages: 30,
    maxPages: 130,
    ids: {
      configuratorArticleID: "7327a717-f93e-42f8-bea6-7c0178c3a926",
      coverArticleID: "fe40d445-38f7-4cd7-a516-f1715b9bac79",
      innerArticleID: "4444dcbb-efd4-4edc-83c1-dfd93539538a",
      childArticleID: "f681ca8b-ff45-42f3-80d2-b0a6d62281db",
      articleNumber: "30109119",
      articleCategoryID: "1b9d5f33-1776-4eb5-8a84-5a14784f155a",
    },
  },
};

export const DEFAULT_BOOK_PRODUCT = "saal-square-28";

// Shared Saal category/topic id - identical in every project inspected.
export const SAAL_CATEGORY_ID = "9ad91ddd-2087-841e-197e-f43744139f04";
export const SAAL_VERSION = "d4.7.378";

export function getBookProduct(id) {
  return BOOK_PRODUCTS[id] || BOOK_PRODUCTS[DEFAULT_BOOK_PRODUCT];
}

export function coverSize(product, numPages) {
  return { w: product.coverBaseWidth + numPages, h: product.coverHeight };
}

// Bleed on every outer edge (the thin red trim line in the Saal editor sits
// ~3 mm in); the cover additionally wraps ~6 mm around the board.
export const BLEED = 30;
export const COVER_WRAP = 60;
