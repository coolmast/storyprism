import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planBook, MAX_PHOTOS_PER_SPREAD } from "./bookPlanner.js";
import { renderSpreadSvg } from "./saalSvg.js";
import { SPREAD_LAYOUTS } from "./spreadLayouts.js";
import { getStrings } from "../i18n.js";
import { escapeHtml } from "../render.js";

const KIND_LABEL = { intro: "Intro", chapter: "Chapter opener", info: "Info card", outro: "Outro", blank: "Blank" };

// Saal's own font files, when extracted with tools/extract_saal_fonts.py,
// are served from /api/saal-fonts so the preview renders with exactly the
// glyphs Saal uses; otherwise the Google Fonts version is loaded.
const SAAL_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/saal-fonts");

function fontHead(fonts) {
  const used = [...new Map([fonts.title, fonts.body].map((f) => [f.key, f])).values()];
  const local = used.filter((f) => existsSync(join(SAAL_FONT_DIR, `${f.key}-Regular.otf`)));
  const google = used.filter((f) => !local.includes(f) && f.google);
  const faces = local
    .map((f) => `@font-face { font-family: 'SB-${f.key}'; src: url('/api/saal-fonts/${f.key}-Regular.otf') format('opentype'); font-display: block; }`)
    .join("\n");
  return `${faces ? `<style>${faces}</style>` : ""}${
    google.length
      ? `<link href="https://fonts.googleapis.com/css2?${google.map((f) => "family=" + f.name.replace(/ /g, "+")).join("&")}&display=block" rel="stylesheet">`
      : ""
  }`;
}

function previewRef(photo) {
  if (!photo) return null;
  return { href: photo.thumbUrl || photo.fullUrl, width: photo.width || 3, height: photo.height || 2 };
}

function inlineSvg(spread, size, key, isCover) {
  return renderSpreadSvg(spread, size, { mode: "preview", resolveImage: previewRef, key, isCover }).replace(
    /^<\?xml[^>]*>\s*<!DOCTYPE[^>]*>\s*/,
    ""
  );
}

// Live preview of the printed book for the editor's side panel: the cover
// and every spread, rendered from the same plan and SVG code as the Saal
// export. Spreads are grouped by stop with a layout picker per stop that
// posts the choice back to the editor (it edits the unsaved draft).
export function buildBookPreviewHtml(story) {
  const strings = getStrings(story.contentLanguage);
  const plan = planBook(story, { strings });
  const stopsById = new Map(story.stops.map((s) => [s.id, s]));
  const layoutOptions = Object.entries(SPREAD_LAYOUTS);

  const groups = [];
  plan.spreads.forEach((s, i) => {
    const key = s.stopId || `_${s.kind}`;
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push({ s, i });
    else groups.push({ key, items: [{ s, i }] });
  });

  // Current photo count of every photo spread per stop, in order - the
  // -/+ buttons send an edited copy of this back as the stop's pacing.
  const countsByStop = new Map();
  plan.spreads.forEach((s) => {
    if (s.kind !== "photos") return;
    const list = countsByStop.get(s.stopId) || [];
    list[s.photoIndex] = s.photoCount;
    countsByStop.set(s.stopId, list);
  });

  const pacingControls = (s) => {
    const counts = countsByStop.get(s.stopId) || [];
    const isLast = s.photoIndex === counts.length - 1;
    return `<span class="bp-pace" data-stop-id="${escapeHtml(s.stopId)}" data-index="${s.photoIndex}" data-counts="${escapeHtml(JSON.stringify(counts))}">
        <button type="button" data-delta="-1" title="Fewer photos on this spread (they move to the next one)"${s.photoCount <= 1 ? " disabled" : ""}>−</button>
        <b>${s.photoCount} 📷${s.pinned ? " 📌" : ""}</b>
        <button type="button" data-delta="1" title="More photos on this spread (taken from the following ones)"${isLast || s.photoCount >= MAX_PHOTOS_PER_SPREAD ? " disabled" : ""}>+</button>
      </span>`;
  };

  const spreadCard = (s, i) => {
    const label =
      s.kind === "photos"
        ? escapeHtml(SPREAD_LAYOUTS[s.layoutId]?.label || s.layoutId)
        : KIND_LABEL[s.kind] || s.kind;
    return `<figure class="bp-spread">
      <div class="bp-canvas">${inlineSvg(s, plan.spreadSize, `spread-${i}`)}<span class="bp-fold"></span></div>
      <figcaption><span>${i * 2 + 1}–${i * 2 + 2} · ${label}</span>${s.kind === "photos" ? pacingControls(s) : ""}</figcaption>
    </figure>`;
  };

  const groupsHtml = groups
    .map((g) => {
      const stop = stopsById.get(g.key);
      const head = stop
        ? `<div class="bp-group-head">
            <span>${escapeHtml(stop.heading || "")}${
              stop.bookSpreadCounts?.length
                ? ` <button type="button" class="bp-reset" data-stop-id="${escapeHtml(stop.id)}" title="Let the photos of this stop be paced automatically again">↺ Auto</button>`
                : ""
            }</span>
            <select class="bp-override" data-stop-id="${escapeHtml(stop.id)}">
              <option value="">Automatic</option>
              ${layoutOptions
                .map(([id, l]) => `<option value="${id}"${stop.bookLayoutOverride === id ? " selected" : ""}>${escapeHtml(l.label)}</option>`)
                .join("")}
            </select>
          </div>`
        : "";
      return `<section class="bp-group">${head}${g.items.map(({ s, i }) => spreadCard(s, i)).join("")}</section>`;
    })
    .join("\n");

  const warn = [];
  if (plan.overflow) {
    warn.push(
      `The book needs ${plan.contentPages} pages, but the largest page count known for this product is ${plan.numPages} - condense some spreads (−) or remove photos before exporting`
    );
  } else if (plan.blankSpreads) {
    warn.push(`${plan.blankSpreads} blank spread(s) added to reach the ${plan.knownPageCounts[0]}-page minimum`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${fontHead(plan.fonts)}
<style>
  body { margin: 0; padding: 12px; background: #2e2e2e; color: #eee; font: 13px system-ui, sans-serif; }
  .bp-summary { margin: 0 2px 12px; opacity: 0.85; }
  .bp-summary b { color: #fff; }
  .bp-warn { color: #f5c26b; }
  .bp-group { margin-bottom: 18px; }
  .bp-group-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 0 2px 8px; font-weight: 600; font-size: 14px; }
  .bp-override { font: inherit; font-size: 13px; font-weight: 400; padding: 4px 6px; border-radius: 6px; border: 1px solid #666; background: #444; color: #eee; max-width: 55%; }
  .bp-spread { margin: 0 0 12px; }
  .bp-canvas { position: relative; box-shadow: 0 2px 10px rgba(0,0,0,0.5); background: #fff; }
  .bp-fold { position: absolute; top: 0; bottom: 0; left: 50%; width: 0; border-left: 1px dashed rgba(0,0,0,0.25); pointer-events: none; }
  .bp-cover .bp-fold { display: none; }
  figcaption { color: #aaa; font-size: 12px; margin-top: 5px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .bp-pace { display: inline-flex; align-items: center; gap: 6px; color: #eee; }
  .bp-pace b { font-weight: 600; min-width: 3.2em; text-align: center; }
  .bp-pace button, .bp-reset {
    font: inherit; font-size: 15px; line-height: 1; width: 30px; height: 30px; border-radius: 50%;
    border: 1px solid #777; background: #444; color: #fff; cursor: pointer;
  }
  .bp-pace button:disabled { opacity: 0.3; cursor: default; }
  .bp-reset { width: auto; height: auto; border-radius: 999px; padding: 3px 9px; font-size: 12px; margin-left: 6px; font-weight: 400; }
</style></head>
<body>
  <p class="bp-summary"><b>${escapeHtml(plan.product.label)}</b> · ${plan.overflow ? plan.contentPages : plan.numPages} pages · ${plan.spreads.length} spreads${
    warn.length ? `<br><span class="bp-warn">⚠ ${warn.map(escapeHtml).join(" · ")}</span>` : ""
  }</p>
  <section class="bp-group">
    <div class="bp-group-head"><span>Cover</span></div>
    <figure class="bp-spread bp-cover">
      <div class="bp-canvas">${inlineSvg(plan.cover, plan.cover.size, "cover", true)}</div>
      <figcaption>Back · spine · front</figcaption>
    </figure>
  </section>
  ${groupsHtml}
<script>
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".bp-pace button");
    if (btn && !btn.disabled) {
      var pace = btn.parentNode;
      var index = Number(pace.dataset.index);
      var counts = JSON.parse(pace.dataset.counts).slice(0, index + 1);
      counts[index] = Math.max(1, counts[index] + Number(btn.dataset.delta));
      parent.postMessage({ type: "book-spread-counts", stopId: pace.dataset.stopId, counts: counts }, "*");
      return;
    }
    var reset = e.target.closest && e.target.closest(".bp-reset");
    if (reset) parent.postMessage({ type: "book-spread-counts", stopId: reset.dataset.stopId, counts: [] }, "*");
  });
  document.addEventListener("change", function (e) {
    var sel = e.target.closest && e.target.closest(".bp-override");
    if (!sel) return;
    parent.postMessage({ type: "book-layout-override", stopId: sel.dataset.stopId, layoutId: sel.value || null }, "*");
  });
</script>
</body></html>`;
}
