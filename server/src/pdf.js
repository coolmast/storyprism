import { chromium } from "playwright-core";

export async function renderStoryPdf(url) {
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
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
  } finally {
    await browser.close();
  }
}
