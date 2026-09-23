import { chromium } from "playwright-core";
import { buildPdfHtml } from "./pdfDocument.js";

// Builds the whole document from the story's own content and templates
// (see pdfDocument.js/pdfPlanner.js/pdfTemplates.js) and hands it to
// Chromium directly via setContent - no more navigating to the live
// /story/:id page and relying on a @media print override of its on-screen
// CSS. `preferCSSPageSize: true` is what makes Chromium actually honor the
// document's own `@page { size: ...; margin: 0; }` rule (set per the
// story's chosen paper size) instead of forcing a fixed A4 with margins -
// that, plus every page being a deterministic CSS Grid rather than
// reflowed content, is what makes the output the same every time.
//
// No page-number footer here (the old pipeline had one): a zero-margin
// @page is required for the templates' full-bleed photo pages to actually
// reach the edge, and Chromium's header/footer templates render inside
// whatever margin the page declares - there's no room left for one without
// either giving every template a permanent margin (defeating full-bleed)
// or overlaying text on top of photos. Worth revisiting with a per-template
// opt-in if this is missed in practice.
export async function renderStoryPdf(story, { pack, paperSize } = {}) {
  const html = buildPdfHtml(story, { pack, paperSize });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }))
      )
    );
    return await page.pdf({ printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}

// reveal.js has print-pdf support built in (its CSS reflows each slide into
// its own page when the URL carries ?print-pdf) - we just need to drive a
// browser at that mode and print at the same pixel size the deck itself
// uses (see Reveal.initialize's width/height in deck.js).
export async function renderDeckPdf(url) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}?print-pdf`, { waitUntil: "networkidle" });
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images)
          .filter((img) => !img.complete)
          .map((img) => new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          }))
      )
    );
    await page.waitForTimeout(1000);
    return await page.pdf({
      width: "1280px",
      height: "800px",
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
    });
  } finally {
    await browser.close();
  }
}
