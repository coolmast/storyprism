import { planBook } from "./bookPlanner.js";
import { renderSpreadSvg } from "./saalSvg.js";
import { SPREAD_LAYOUTS } from "./spreadLayouts.js";
import { getStrings } from "../i18n.js";
import { escapeHtml } from "../render.js";

const KIND_LABEL = { intro: "Intro", chapter: "Chapter opener", info: "Info card", outro: "Outro", blank: "Blank" };

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

  const spreadCard = (s, i) => {
    const label =
      s.kind === "photos"
        ? `${escapeHtml(SPREAD_LAYOUTS[s.layoutId]?.label || s.layoutId)} · ${s.elements.filter((e) => e.kind === "image").length} 📷`
        : KIND_LABEL[s.kind] || s.kind;
    return `<figure class="bp-spread">
      <div class="bp-canvas">${inlineSvg(s, plan.spreadSize, `spread-${i}`)}<span class="bp-fold"></span></div>
      <figcaption>${i * 2 + 1}–${i * 2 + 2} · ${label}</figcaption>
    </figure>`;
  };

  const groupsHtml = groups
    .map((g) => {
      const stop = stopsById.get(g.key);
      const head = stop
        ? `<div class="bp-group-head">
            <span>${escapeHtml(stop.heading || "")}</span>
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
  if (plan.blankSpreads) warn.push(`${plan.blankSpreads} blank spread(s) added to reach the ${plan.product.minPages}-page minimum`);
  if (plan.tooManyPages) warn.push(`${plan.numPages} pages exceeds the ${plan.product.maxPages}-page maximum`);

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Architects+Daughter&display=swap" rel="stylesheet">
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
  figcaption { color: #aaa; font-size: 11px; margin-top: 4px; }
</style></head>
<body>
  <p class="bp-summary"><b>${escapeHtml(plan.product.label)}</b> · ${plan.numPages} pages · ${plan.spreads.length} spreads${
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
  document.addEventListener("change", function (e) {
    var sel = e.target.closest && e.target.closest(".bp-override");
    if (!sel) return;
    parent.postMessage({ type: "book-layout-override", stopId: sel.dataset.stopId, layoutId: sel.value || null }, "*");
  });
</script>
</body></html>`;
}
