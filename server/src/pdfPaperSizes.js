// Applied via `@page { size: ${css}; }` in the generated PDF document, and
// Chromium is told to honor it with `preferCSSPageSize: true` in pdf.js -
// that combination is what actually gives deterministic, exact-dimension
// pages, unlike the old approach of just printing a live webpage at a fixed
// Playwright `format`.
//
// `widthMm` / `heightMm` also size each `.pdf-page` box and give the layout
// engine the page aspect ratio it arranges photos for.
function size(label, widthMm, heightMm) {
  return { label, widthMm, heightMm, css: `${widthMm}mm ${heightMm}mm` };
}

export const PDF_PAPER_SIZES = {
  "a4-portrait": size("A4 Portrait", 210, 297),
  "a4-landscape": size("A4 Landscape", 297, 210),
  "letter-portrait": size("US Letter", 215.9, 279.4),
  square: size("Square 21 cm", 210, 210),
  "square-large": size("Square 30 cm (photobook)", 300, 300),
};

export const DEFAULT_PAPER_SIZE = "a4-portrait";

export function getPaperSize(id) {
  return PDF_PAPER_SIZES[id] || PDF_PAPER_SIZES[DEFAULT_PAPER_SIZE];
}
