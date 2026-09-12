import { chromium } from "playwright-core";
import { getStrings } from "./i18n.js";

export async function renderStoryPdf(url, language) {
  const strings = getStrings(language);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
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
    // Let map tiles + Leaflet's fitBounds settle before printing.
    await page.waitForTimeout(800);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0", bottom: "0.5in", left: "0", right: "0" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `
        <div style="width:100%; font-size:9px; text-align:center; color:#999; font-family:Georgia,serif;">
          ${strings.pageOf} <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
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
