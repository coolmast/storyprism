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
    body: JSON.stringify({ albumUid: album.uid, contentLanguage: "en" }),
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
