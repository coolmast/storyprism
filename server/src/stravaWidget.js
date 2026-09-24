import { chromium } from "playwright-core";

// A printable snapshot of a Strava activity embed, for the photobook (see
// bookPlanner.js's routeMapPhoto). Strava's current embed mechanism is a
// placeholder <div> + widget <script> that only does anything in a real
// browser (see embeds.js) - there's no static-image endpoint like Komoot's,
// so getting pixels out of it means actually rendering the widget headlessly
// and screenshotting it, the same Playwright/Chromium toolchain already
// used for the PDF export (pdf.js).
//
// The widget replaces the placeholder div outright (not a child iframe
// nested inside it) once it loads, and there's no "finished loading" event
// to wait on - the div's own <iframe> then has to fetch and render its own
// content (photos, stats) asynchronously. A fixed settle time after the
// iframe appears is the least-bad option here.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

async function captureWidget({ activityId, token, style }) {
  const html = `<!doctype html><html><head><style>body{margin:0;background:#ffffff}</style></head><body>
<div class="strava-embed-placeholder" data-embed-type="activity" data-embed-id="${activityId}" data-style="${style}" data-from-embed="false" data-token="${token}"></div>
<script src="https://strava-embeds.com/embed.js"></script>
</body></html>`;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.waitForSelector("iframe", { timeout: 15000 });
    await page.waitForTimeout(5000);
    const iframe = await page.$("iframe");
    if (!iframe) throw new Error("Strava's widget script didn't create an embed frame");
    return await iframe.screenshot({ type: "jpeg", quality: 88 });
  } finally {
    await browser.close();
  }
}

export async function stravaWidgetImage(info) {
  const key = `${info.activityId}:${info.token}:${info.style}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.buffer;
  const buffer = await captureWidget(info);
  cache.set(key, { buffer, at: Date.now() });
  return buffer;
}
