// Smoke test for the editor app's UI shell/component-kit interactivity
// (brief item 8: "write a smoke test script for meaningful interactivity
// rather than only eyeballing it"). Exercises real user flows - nav
// switching, the theme toggle + its persistence, the album year-group
// accordion, and the Settings/Export/Delete-confirmation modals - at both
// the desktop and mobile breakpoints, and asserts no console errors and no
// horizontal overflow throughout.
//
// Selectors are structural (classes/positions), not text, since the UI's
// default language follows the browser/OS locale rather than always
// being English.
//
// Requires the backend (`npm run dev` in server/, default :3001) and the
// Vite dev server (`npm run dev` in web/) both already running. Creates
// one disposable story from the smallest real album for the editor
// checks, and deletes it again when done (even on failure).
//
// Usage: node scripts/ui-smoke-test.mjs
// Env overrides: SMOKE_FRONTEND_URL, SMOKE_BACKEND_URL

import { chromium } from "playwright-core";

const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.SMOKE_BACKEND_URL || "http://localhost:3001";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function isOpenModalVisible(page) {
  return (await page.locator(".ui-modal[open]").count()) > 0;
}

async function runChecksAtBreakpoint(browser, story, width, tag) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  const nav = width < 860 ? ".app-tabbar button" : ".app-nav button";

  await page.goto(FRONTEND_URL, { waitUntil: "networkidle" });

  // --- Nav switching ---
  await page.locator(nav).nth(1).click();
  await page.waitForTimeout(200);
  check(`[${tag}] nav switches to the library`, (await page.locator(".story-list, .ui-empty-state").count()) > 0);

  // --- Theme toggle + persistence, then reset to system ---
  await page.locator(".ui-segmented button").nth(2).click(); // System/Light/Dark -> Dark
  await page.waitForTimeout(150);
  let themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
  check(`[${tag}] theme toggle sets dark mode`, themeAttr === "dark");
  await page.reload({ waitUntil: "networkidle" });
  themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
  check(`[${tag}] theme choice survives a reload`, themeAttr === "dark");
  await page.locator(".ui-segmented button").nth(0).click(); // back to System, for later screens/runs
  await page.waitForTimeout(150);

  // --- Album year-group accordion (New Story screen) ---
  await page.locator(nav).nth(0).click();
  await page.waitForTimeout(300);
  const yearGroups = page.locator(".album-year-group");
  const yearGroupCount = await yearGroups.count();
  check(`[${tag}] album list renders year groups`, yearGroupCount > 0);
  if (yearGroupCount > 1) {
    const secondGroupOpen = await yearGroups.nth(1).evaluate((el) => el.open);
    check(`[${tag}] only the newest year is expanded by default`, secondGroupOpen === false);
  }

  // --- Multi-select album picker: two albums merge into one itinerary ---
  const albumButtons = yearGroups.first().locator(".album-list button");
  const albumButtonCount = await albumButtons.count();
  if (albumButtonCount >= 2) {
    await albumButtons.nth(0).click();
    await page.waitForTimeout(400);
    await albumButtons.nth(1).click();
    await page.waitForTimeout(600);
    const bothSelected =
      (await albumButtons.nth(0).evaluate((el) => el.classList.contains("active"))) &&
      (await albumButtons.nth(1).evaluate((el) => el.classList.contains("active")));
    check(`[${tag}] selecting a second album keeps the first selected`, bothSelected);
    const heading = await page.locator(".content-header h2").innerText();
    check(`[${tag}] combined title joins both album names`, heading.includes("+"), heading);
    await albumButtons.nth(1).click(); // deselect, so later screens start clean
    await albumButtons.nth(0).click();
    await page.waitForTimeout(200);
  }

  // --- "Nach Themen" (yearbook) source: discover + select + create ---
  await page.locator(".source-toggle button").nth(2).click();
  await page.waitForTimeout(200);
  const themeDateInputs = page.locator('.theme-source-picker input[type="date"]');
  // A full calendar year, not the entire library history: theme discovery's
  // trip-cluster detection now correctly paginates through every photo in
  // range (see getPhotosByDateRange) instead of silently stopping at an
  // old fixed 3000-photo cap, so a range spanning this library's full
  // multi-year history means genuinely paging through 100k+ photos here -
  // correct, but far slower than a smoke test should be. One year is still
  // wide enough to exercise real multi-theme discovery.
  await themeDateInputs.nth(0).fill("2026-01-01");
  await themeDateInputs.nth(1).fill("2026-12-31");
  await page.locator(".theme-source-picker .ai-btn").click();
  // Discovery is network-bound (probes dozens of label/subject candidates
  // against PhotoPrism) - poll for the candidates Card instead of a fixed
  // sleep, which was flaky under load.
  await page.locator(".theme-candidates").waitFor({ state: "visible", timeout: 15000 });
  const themeChips = page.locator(".theme-chip");
  const themeChipCount = await themeChips.count();
  check(`[${tag}] theme discovery returns candidates`, themeChipCount > 0);
  await page.locator(".theme-preview .stop-list li").first().waitFor({ state: "visible", timeout: 10000 });
  const stopCountBefore = await page.locator(".theme-preview .stop-list li").count();
  check(`[${tag}] live preview shows the chronological plan before selecting anything`, stopCountBefore > 0);
  if (themeChipCount > 0) {
    // The chip's title sits as a plain text node between its check-mark and
    // photo-count <span> children - read that node directly rather than
    // innerText, which would concatenate all three with no separator.
    const firstChipTitle = await themeChips.first().evaluate((el) => {
      const textNode = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      return textNode ? textNode.textContent.trim() : null;
    });
    await themeChips.nth(0).click();
    await page.waitForTimeout(150);
    check(`[${tag}] selecting a theme chip marks it active`, await themeChips.nth(0).evaluate((el) => el.classList.contains("active")));
    // Over a huge (multi-year) range, splitting one small theme off the
    // leftover doesn't reliably change its own cluster *count* (buildItinerary
    // groups by time gaps, and removing one day's photos rarely creates or
    // removes a gap boundary elsewhere) - so check for the concrete, actually-
    // claimed behavior instead: the selected theme's own title appears as a
    // section. A full year's worth of photos now genuinely gets refetched
    // and replanned on each selection (no more silent truncation), so this
    // can take a couple of seconds - poll for the heading instead of a fixed
    // debounce sleep, which flaked once the refetch got slower for the
    // right reason (fixing the truncation bug in getPhotosByDateRange).
    let headingsAfter = [];
    let sawSection = false;
    try {
      await page
        .locator(".theme-preview .stop-list h3", { hasText: firstChipTitle })
        .first()
        .waitFor({ state: "visible", timeout: 10000 });
      sawSection = true;
    } catch {
      headingsAfter = await page.locator(".theme-preview .stop-list h3").allInnerTexts();
    }
    check(
      `[${tag}] live preview gets a section for the selected theme`,
      sawSection,
      sawSection ? firstChipTitle : `${firstChipTitle} - got [${headingsAfter.join(", ")}]`
    );
  }

  // Custom date sub-range (e.g. "a few days around a birthday") - not a
  // discovered candidate, hand-entered, removable, still folds into the plan.
  const customDateInputs = page.locator('.theme-custom-form input[type="date"]');
  await customDateInputs.nth(0).fill("2026-03-10");
  await customDateInputs.nth(1).fill("2026-03-13");
  await page.locator('.theme-custom-form input[type="text"]').fill("Smoke test birthday");
  await page.locator(".theme-custom-form .ai-btn").click();
  await page.waitForTimeout(150);
  check(`[${tag}] adding a custom section shows it as a removable chip`, (await page.locator(".theme-candidate-group .ui-chip").count()) === 1);

  await page.locator(".theme-candidates .save-btn").click();
  await page.waitForTimeout(2500);
  const themeStoryTitle = await page.locator(".story-title-input").inputValue().catch(() => null);
  check(`[${tag}] creating a yearbook story opens its editor`, !!themeStoryTitle);
  const themeStoryId = new URL(page.url()).pathname.split("/").pop();

  // --- Section (stop) drag-reordering - this story is guaranteed several
  // sections (a theme + a custom section + a chronological tail), unlike
  // the small disposable album story used below.
  await page.getByText("Alle einklappen").click();
  await page.waitForTimeout(200);
  const dragHandles = page.locator(".stop-drag-handle");
  const dragHandleCount = await dragHandles.count();
  if (dragHandleCount >= 2) {
    const headingsBeforeDrag = await page.locator(".stop-summary-heading").allInnerTexts();
    const firstBox = await dragHandles.nth(0).boundingBox();
    const secondBox = await dragHandles.nth(1).boundingBox();
    await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height + 10, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const headingsAfterDrag = await page.locator(".stop-summary-heading").allInnerTexts();
    check(
      `[${tag}] dragging a section's handle reorders the sections`,
      headingsAfterDrag[0] === headingsBeforeDrag[1] && headingsAfterDrag.length === headingsBeforeDrag.length
    );
  }

  await jsonFetch(`${BACKEND_URL}/api/stories/${themeStoryId}`, { method: "DELETE" });

  // --- Open the disposable test story's editor ---
  await page.locator(nav).nth(1).click();
  await page.waitForTimeout(200);
  await page.locator(".story-card-main", { hasText: story.title }).click();
  await page.waitForTimeout(600);
  const titleValue = await page.locator(".story-title-input").inputValue();
  check(`[${tag}] editor opens with the right story loaded`, titleValue === story.title);

  // --- Settings modal ---
  await page.locator(".settings-btn").click();
  await page.waitForTimeout(150);
  check(`[${tag}] settings modal opens`, await isOpenModalVisible(page));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check(`[${tag}] settings modal closes on Escape`, !(await isOpenModalVisible(page)));

  // --- Export modal + toast (copy share link is the 2nd menu item) ---
  await page.locator(".editor-toolbar .toolbar-btn").nth(1).click();
  await page.waitForTimeout(150);
  check(`[${tag}] share/export modal opens`, await isOpenModalVisible(page));
  await page.locator(".export-menu-item").nth(1).click();
  await page.waitForTimeout(200);
  check(`[${tag}] export modal closes after picking an action`, !(await isOpenModalVisible(page)));
  check(`[${tag}] copying the share link shows a toast`, await page.locator(".ui-toast").isVisible().catch(() => false));

  // --- Remove-section confirmation modal (cancel, never confirm) ---
  const removeSectionBtn = page.locator(".link-btn.danger.small").first();
  if (await removeSectionBtn.count()) {
    await removeSectionBtn.click();
    await page.waitForTimeout(150);
    check(`[${tag}] remove-section modal opens`, await isOpenModalVisible(page));
    await page.locator(".ui-modal[open] .ui-modal-footer button").nth(0).click();
    await page.waitForTimeout(150);
    check(`[${tag}] remove-section modal closes on cancel`, !(await isOpenModalVisible(page)));
  }

  // --- Delete-story confirmation modal (cancel, never confirm) ---
  await page.locator(nav).nth(1).click();
  await page.waitForTimeout(200);
  await page.locator(".story-card-delete").first().click();
  await page.waitForTimeout(150);
  check(`[${tag}] delete-story modal opens`, await isOpenModalVisible(page));
  await page.locator(".ui-modal[open] .ui-modal-footer button").nth(0).click();
  await page.waitForTimeout(150);
  check(`[${tag}] delete-story modal closes on cancel`, !(await isOpenModalVisible(page)));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`[${tag}] no horizontal overflow`, !overflow);
  check(`[${tag}] no browser console errors`, consoleErrors.length === 0, consoleErrors.join("; "));

  await context.close();
}

async function main() {
  const albums = await jsonFetch(`${BACKEND_URL}/api/albums`);
  const album = albums
    .filter((a) => a.type !== "moment" && a.photoCount > 0)
    .sort((a, b) => a.photoCount - b.photoCount)[0];
  if (!album) throw new Error("No usable album found to build a disposable test story from.");

  const story = await jsonFetch(`${BACKEND_URL}/api/stories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumUids: [album.uid], contentLanguage: "en" }),
  });
  console.log(`Created disposable test story "${story.title}" (${story.id}) from album "${album.title}" (${album.photoCount} photos)\n`);

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await runChecksAtBreakpoint(browser, story, 1280, "desktop");
    await runChecksAtBreakpoint(browser, story, 390, "mobile");
  } finally {
    await browser.close();
    await jsonFetch(`${BACKEND_URL}/api/stories/${story.id}`, { method: "DELETE" });
    console.log(`\nDeleted disposable test story ${story.id}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
