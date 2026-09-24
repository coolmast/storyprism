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

// A stop's heading renders as plain text (.stop-summary-heading) only while
// collapsed - expanded (the default for a freshly added stop), it's the
// value of an editable .stop-heading-input instead. Covers both so a check
// doesn't care which state the stop happens to be in.
async function currentStopHeadings(page) {
  const collapsed = await page.locator(".stop-summary-heading").allInnerTexts();
  const expanded = await page.locator(".stop-heading-input").evaluateAll((els) => els.map((el) => el.value));
  return [...collapsed, ...expanded];
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

  // --- "Nach Themen" (yearbook) source: just a date range up front, story
  // starts empty, sections are cherry-picked one at a time afterward in the
  // editor's own Add Section panel (see ThemeSectionPanel.jsx) - replaced
  // the old "discover everything, select some, create the whole plan at
  // once" flow.
  await page.locator(".source-toggle button").nth(2).click();
  await page.waitForTimeout(200);
  const themeDateInputs = page.locator('.theme-source-picker input[type="date"]');
  // A full calendar year, not the entire library history: theme discovery's
  // trip-cluster detection paginates through every photo in range (see
  // getPhotosByDateRange), so a range spanning this library's full
  // multi-year history would mean genuinely paging through 100k+ photos
  // here - correct, but far slower than a smoke test should be. One year is
  // still wide enough to exercise real multi-theme discovery.
  await themeDateInputs.nth(0).fill("2026-01-01");
  await themeDateInputs.nth(1).fill("2026-12-31");
  await page.locator(".theme-source-picker .save-btn").click();
  await page.waitForTimeout(1200);
  const themeStoryTitle = await page.locator(".story-title-input").inputValue().catch(() => null);
  check(`[${tag}] creating a yearbook story opens its editor`, !!themeStoryTitle);
  const themeStoryId = new URL(page.url()).pathname.split("/").pop();
  check(`[${tag}] a freshly created yearbook story starts with no sections`, (await page.locator(".stop-editor").count()) === 0);

  // --- Add Section panel: one click on a suggested theme chip, one
  // hand-typed date sub-range, and "add remaining photos" - each reconciled
  // into the story immediately (writes straight to the database, no
  // separate "create" step to confirm first).
  await page.locator(".settings-btn").click();
  await page.locator(".theme-section-panel").waitFor({ state: "visible", timeout: 5000 });
  // Discovery is network-bound (probes dozens of label/subject candidates
  // against PhotoPrism) - poll for the chips instead of a fixed sleep,
  // which was flaky under load.
  await page.waitForFunction(() => document.querySelectorAll(".theme-chip").length > 0, { timeout: 15000 });
  const themeChips = page.locator(".theme-chip");
  const themeChipCount = await themeChips.count();
  check(`[${tag}] Add Section panel shows suggested theme chips`, themeChipCount > 0);
  if (themeChipCount > 0) {
    // The chip's title sits as a plain text node between its check-mark and
    // photo-count <span> children - read that node directly rather than
    // innerText, which would concatenate all three with no separator.
    const firstChipTitle = await themeChips.first().evaluate((el) => {
      const textNode = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      return textNode ? textNode.textContent.trim() : null;
    });
    await themeChips.nth(0).click();
    let sawSection = false;
    let headingsNow = [];
    for (let i = 0; i < 20 && !sawSection; i++) {
      headingsNow = await currentStopHeadings(page);
      sawSection = headingsNow.some((h) => h === firstChipTitle);
      if (!sawSection) await page.waitForTimeout(1000);
    }
    check(
      `[${tag}] clicking a theme chip adds it as a section right away`,
      sawSection,
      sawSection ? firstChipTitle : `${firstChipTitle} - got [${headingsNow.join(", ")}]`
    );
  }

  // Custom date sub-range (e.g. "a few days around a birthday") - not a
  // discovered candidate, hand-typed, added the same way as a chip.
  const customDateInputs = page.locator('.theme-custom-form:not(.theme-query-form) input[type="date"]');
  await customDateInputs.nth(0).fill("2026-03-10");
  await customDateInputs.nth(1).fill("2026-03-13");
  await page.locator('.theme-custom-form:not(.theme-query-form) input[type="text"]').fill("Smoke test birthday");
  await page.getByRole("button", { name: "Abschnitt hinzufügen", exact: true }).click();
  let sawCustomSection = false;
  let headingsNow2 = [];
  for (let i = 0; i < 15 && !sawCustomSection; i++) {
    headingsNow2 = await currentStopHeadings(page);
    sawCustomSection = headingsNow2.some((h) => h === "Smoke test birthday");
    if (!sawCustomSection) await page.waitForTimeout(1000);
  }
  check(
    `[${tag}] adding a custom date sub-range adds it as a section`,
    sawCustomSection,
    sawCustomSection ? "" : `got [${headingsNow2.join(", ")}]`
  );

  // "Add remaining photos" - the explicit catch-all for a cherry-picked
  // book, replacing the old always-on chronological tail.
  const stopCountBeforeLeftover = await page.locator(".stop-editor").count();
  await page.getByRole("button", { name: "Restliche Fotos hinzufügen (nach Monat)", exact: true }).click();
  let stopCountAfterLeftover = stopCountBeforeLeftover;
  for (let i = 0; i < 15 && stopCountAfterLeftover <= stopCountBeforeLeftover; i++) {
    await page.waitForTimeout(1000);
    stopCountAfterLeftover = await page.locator(".stop-editor").count();
  }
  check(`[${tag}] "add remaining photos" appends the monthly catch-all sections`, stopCountAfterLeftover > stopCountBeforeLeftover);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // --- Cross-section photo drag: dragging a photo card into a *different*
  // stop's grid moves it there (the rare-EXIF-timestamp fix). Real regression
  // coverage for a real bug found only through actual browser testing: since
  // sortablejs physically relocates the DOM node into the other grid's own
  // React-rendered subtree, React's next reconcile crashed trying to remove
  // a child that was no longer there unless that raw DOM move is reverted
  // in onEnd first - a mistake a within-one-list drag (reordering, or moving
  // sections) can't surface at all, since it never touches more than one
  // React-owned parent. Stops start expanded, before "Alle einklappen"
  // below collapses them - a collapsed stop renders no photo grid at all.
  const photoGrids = page.locator(".photo-grid");
  const gridCount = await photoGrids.count();
  let sourceGridIndex = -1;
  for (let i = 0; i < gridCount; i++) {
    if ((await photoGrids.nth(i).locator(".photo-card").count()) > 0) {
      sourceGridIndex = i;
      break;
    }
  }
  if (sourceGridIndex !== -1 && gridCount >= 2) {
    const targetGridIndex = sourceGridIndex === 0 ? 1 : 0;
    const sourceCard = photoGrids.nth(sourceGridIndex).locator(".photo-card").first();
    const movedPhotoId = await sourceCard.getAttribute("data-photo-id");
    const targetLocator = photoGrids.nth(targetGridIndex);

    // The source card can easily be off-screen (above the viewport, e.g.
    // right after the page navigated here) or sitting right under a sticky
    // header at y=0 - either way, boundingBox() still reports its (wrong
    // for clicking) position, so the drag silently never starts. Scroll it
    // to the middle of the viewport first and re-measure.
    await sourceCard.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -200));
    await page.waitForTimeout(50);
    const handleBox = await sourceCard.locator(".drag-handle").boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 6, handleBox.y + handleBox.height / 2 + 6);
    await page.waitForTimeout(60);

    // The target stop's grid can easily be thousands of pixels below the
    // handle (a whole month's worth of photos in between) - scroll toward
    // it a bit at a time while the drag is held, nudging the mouse after
    // each scroll so sortablejs's fallback drag re-evaluates the cursor's
    // position against the new scroll offset, the same way its own
    // near-the-edge autoscroll would if a real mouse just sat there.
    const viewport = page.viewportSize();
    let targetBox = await targetLocator.boundingBox();
    for (let i = 0; i < 40 && !(targetBox && targetBox.y >= 0 && targetBox.y < viewport.height - 40); i++) {
      await page.evaluate((dy) => window.scrollBy(0, dy), 400);
      // A mousemove to the *same* viewport coordinate as last time is a
      // no-op as far as the browser is concerned - nothing moved under the
      // cursor from its own point of view, even though the page just
      // scrolled underneath it, so sortablejs never gets a fresh event to
      // re-evaluate hit-testing against the new scroll position. Alternating
      // the target y by a pixel forces a real mousemove every iteration.
      await page.mouse.move(handleBox.x + handleBox.width / 2 + 6, viewport.height - 60 + (i % 2));
      await page.waitForTimeout(40);
      targetBox = await targetLocator.boundingBox();
    }
    await page.mouse.move(targetBox.x + 20, targetBox.y + 20, { steps: 5 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const landedInTarget = await targetLocator.locator(`[data-photo-id="${movedPhotoId}"]`).count();
    check(`[${tag}] dragging a photo into another section's grid moves it there`, landedInTarget === 1);
  }

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
