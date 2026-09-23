// Applied via `@page { size: ${css}; }` in the generated PDF document, and
// Chromium is told to honor it with `preferCSSPageSize: true` in pdf.js -
// that combination is what actually gives deterministic, exact-dimension
// pages, unlike the old approach of just printing a live webpage at a fixed
// Playwright `format`.
export const PDF_PAPER_SIZES = {
  "a4-portrait": { label: "A4 Portrait", css: "210mm 297mm" },
  "a4-landscape": { label: "A4 Landscape", css: "297mm 210mm" },
  "letter-portrait": { label: "US Letter", css: "215.9mm 279.4mm" },
  square: { label: "Square", css: "210mm 210mm" },
};

export const DEFAULT_PAPER_SIZE = "a4-portrait";

export function getPaperSize(id) {
  return PDF_PAPER_SIZES[id] || PDF_PAPER_SIZES[DEFAULT_PAPER_SIZE];
}
