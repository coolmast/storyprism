import { existsSync } from "node:fs";
import { CEWE_FONT_FOR } from "./spreadLayouts.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planBook, MAX_PHOTOS_PER_SPREAD } from "./bookPlanner.js";
import { renderSpreadSvg } from "./saalSvg.js";
import { SPREAD_LAYOUTS } from "./spreadLayouts.js";
import { getStrings } from "../i18n.js";
import { escapeHtml } from "../render.js";

const KIND_LABEL = {
  intro: "Intro",
  chapter: "Chapter opener",
  info: "Info card",
  route: "Route map",
  outro: "Outro",
  blank: "Blank",
};

// Saal's own font files, when extracted with tools/extract_saal_fonts.py,
// are served from /api/saal-fonts so the preview renders with exactly the
// glyphs Saal uses; otherwise the Google Fonts version is loaded.
const SAAL_FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/saal-fonts");

function fontHead(fonts) {
  const used = [...new Map([fonts.title, fonts.body].map((f) => [f.key, f])).values()];
  const local = used.filter((f) => existsSync(join(SAAL_FONT_DIR, `${f.key}-Regular.otf`)));
  const google = used.filter((f) => !local.includes(f) && f.google);
  const styles = [
    ["Regular", 400, "normal"],
    ["Bold", 700, "normal"],
    ["Italic", 400, "italic"],
    ["BoldItalic", 700, "italic"],
  ];
  const faces = local
    .flatMap((f) =>
      styles
        .filter(([style]) => existsSync(join(SAAL_FONT_DIR, `${f.key}-${style}.otf`)))
        .map(
          ([style, weight, fstyle]) =>
            `@font-face { font-family: 'SB-${f.key}'; src: url('/api/saal-fonts/${f.key}-${style}.otf') format('opentype'); font-weight: ${weight}; font-style: ${fstyle}; font-display: block; }`
        )
    )
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

  // Current { count, layoutId } of every photo spread per stop, in order -
  // the -/+ buttons and the per-spread layout picker both send an edited
  // copy of this back as the stop's pacing (stories.js's
  // parseSpreadCounts/serializeSpreadCounts accept either shape, so a plain
  // count-only pin from before this shipped still round-trips unchanged).
  const entriesByStop = new Map();
  plan.spreads.forEach((s) => {
    if (s.kind !== "photos") return;
    const list = entriesByStop.get(s.stopId) || [];
    // layoutId only when *this spread's* layout was actually pinned - not
    // whatever the algorithm happened to auto-pick. Otherwise the pacing
    // +/- buttons below (which carry an entry's layoutId forward unchanged)
    // would silently turn a pure count bump into an accidental layout pin
    // too, capping every future "+" click at that one layout's own photo
    // max with no visible reason why - reproduced with "hero-page" (max 5):
    // pacing up to 5 quietly latches that layout, and pushing to 6 then
    // gets clamped straight back down to 5 in the planner.
    list[s.photoIndex] = { count: s.photoCount, layoutId: s.layoutPinned ? s.layoutId : null };
    entriesByStop.set(s.stopId, list);
  });

  const pacingControls = (s) => {
    const entries = entriesByStop.get(s.stopId) || [];
    const isLast = s.photoIndex === entries.length - 1;
    // A genuinely pinned layout caps how far "+" can go (that layout's own
    // photos.max) - an honest disabled state instead of a silent no-op past
    // that point once the count-vs-layoutId fix above stops most spreads
    // from ever having a layoutId here at all.
    const maxForSpread = s.layoutPinned && SPREAD_LAYOUTS[s.layoutId] ? SPREAD_LAYOUTS[s.layoutId].photos.max : MAX_PHOTOS_PER_SPREAD;
    return `<span class="bp-pace" data-stop-id="${escapeHtml(s.stopId)}" data-index="${s.photoIndex}" data-entries="${escapeHtml(JSON.stringify(entries))}">
        <button type="button" data-delta="-1" title="Fewer photos on this spread (they move to the next one)"${s.photoCount <= 1 ? " disabled" : ""}>−</button>
        <b>${s.photoCount} 📷${s.pinned ? " 📌" : ""}</b>
        <button type="button" data-delta="1" title="More photos on this spread (taken from the following ones)"${isLast || s.photoCount >= maxForSpread ? " disabled" : ""}>+</button>
      </span>`;
  };

  // Per-spread layout choice - automatic by default (like the per-stop
  // picker below), free choice on any single spread otherwise. Shows
  // "Automatic" selected even when the spread's *actual* layout happens to
  // match a named option, unless that layout was specifically pinned here
  // (s.layoutPinned) - so the dropdown reflects what the user chose, not
  // just what the algorithm happened to land on.
  const spreadLayoutSelect = (s) => {
    const entries = entriesByStop.get(s.stopId) || [];
    return `<select class="bp-spread-override" data-stop-id="${escapeHtml(s.stopId)}" data-index="${s.photoIndex}" data-entries="${escapeHtml(JSON.stringify(entries))}">
        <option value="">Automatic</option>
        ${layoutOptions
          .map(([id, l]) => `<option value="${id}"${s.layoutPinned && s.layoutId === id ? " selected" : ""}>${escapeHtml(l.label)}</option>`)
          .join("")}
      </select>`;
  };

  const toggleBtn = (toggle, hidden, text) =>
    `<button type="button" class="bp-toggle${hidden ? "" : " bp-readd"}" data-toggle="${escapeHtml(JSON.stringify({ ...toggle, hidden }))}">${escapeHtml(text)}</button>`;
  const hiddenChips = (items) =>
    items.length
      ? `<div class="bp-hidden">${items.map((h) => toggleBtn(h.toggle, false, `↺ ${h.label}`)).join("")}</div>`
      : "";

  // Glued books (CEWE) start with a single right-hand page 1, so their
  // first spread is pages 2-3.
  const first = plan.product.singlePages ? 2 : 1;
  const spreadCard = (s, i) => {
    const label =
      s.kind === "photos"
        ? escapeHtml(SPREAD_LAYOUTS[s.layoutId]?.label || s.layoutId)
        : KIND_LABEL[s.kind] || s.kind;
    return `<figure class="bp-spread">
      <div class="bp-canvas">${inlineSvg(s, plan.spreadSize, `spread-${i}`)}<span class="bp-fold"></span></div>
      <figcaption><span>${first + i * 2}–${first + i * 2 + 1} · ${label}</span>${s.kind === "photos" ? pacingControls(s) + spreadLayoutSelect(s) : ""}${
        s.toggle ? toggleBtn(s.toggle, true, "✕ Remove from book") : ""
      }</figcaption>
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
      const hidden = stop ? plan.hiddenItems.filter((h) => h.stopId === stop.id) : [];
      return `<section class="bp-group">${head}${hiddenChips(hidden)}${g.items.map(({ s, i }) => spreadCard(s, i)).join("")}</section>`;
    })
    .join("\n");

  const warn = [];
  const notes = [];
  if (plan.product.vendor === "cewe") {
    const mapped = [story.bookTitleFont, story.bookBodyFont].filter((n) => n && CEWE_FONT_FOR[n]);
    if (mapped.length)
      notes.push(`CEWE prints with its own fonts: ${[...new Set(mapped)].map((n) => `${n} → ${CEWE_FONT_FOR[n]}`).join(", ")}`);
  }
  if (plan.burstSkips) notes.push(`${plan.burstSkips} burst shot(s) left out (photos taken within 3 s of a kept one)`);
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
  .bp-spread-override { font: inherit; font-size: 12px; padding: 3px 5px; border-radius: 6px; border: 1px solid #666; background: #444; color: #eee; max-width: 40%; }
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
  .bp-toggle { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid #777; background: #3a3a3a; color: #ddd; cursor: pointer; }
  .bp-toggle:hover { background: #555; }
  .bp-readd { border-color: #7bc47f; color: #bfe8c1; }
  .bp-hidden { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 2px 10px; }
  .bp-hidden::before { content: "Not in the book:"; color: #aaa; font-size: 12px; align-self: center; }
  .bp-reset { width: auto; height: auto; border-radius: 999px; padding: 3px 9px; font-size: 12px; margin-left: 6px; font-weight: 400; }
</style></head>
<body>
  <p class="bp-summary"><b>${escapeHtml(plan.product.label)}</b> · ${plan.overflow ? plan.contentPages : plan.numPages} pages · ${plan.spreads.length} spreads${
    warn.length ? `<br><span class="bp-warn">⚠ ${warn.map(escapeHtml).join(" · ")}</span>` : ""
  }${notes.length ? `<br><span>${notes.map(escapeHtml).join(" · ")}</span>` : ""}</p>
  ${hiddenChips(plan.hiddenItems.filter((h) => !h.stopId))}
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
      var entries = JSON.parse(pace.dataset.entries).slice(0, index + 1);
      var cur = entries[index] || {};
      entries[index] = { count: Math.max(1, (cur.count || 1) + Number(btn.dataset.delta)), layoutId: cur.layoutId || null };
      parent.postMessage({ type: "book-spread-counts", stopId: pace.dataset.stopId, counts: entries }, "*");
      return;
    }
    var tog = e.target.closest && e.target.closest(".bp-toggle");
    if (tog) {
      parent.postMessage({ type: "book-toggle", toggle: JSON.parse(tog.dataset.toggle) }, "*");
      return;
    }
    var reset = e.target.closest && e.target.closest(".bp-reset");
    if (reset) parent.postMessage({ type: "book-spread-counts", stopId: reset.dataset.stopId, counts: [] }, "*");
  });
  document.addEventListener("change", function (e) {
    var sel = e.target.closest && e.target.closest(".bp-override");
    if (sel) {
      parent.postMessage({ type: "book-layout-override", stopId: sel.dataset.stopId, layoutId: sel.value || null }, "*");
      return;
    }
    var spreadSel = e.target.closest && e.target.closest(".bp-spread-override");
    if (spreadSel) {
      var index2 = Number(spreadSel.dataset.index);
      var entries2 = JSON.parse(spreadSel.dataset.entries).slice(0, index2 + 1);
      var cur2 = entries2[index2] || {};
      var layoutId = spreadSel.value || null;
      // Only this dropdown's own layoutId changes here - an existing count
      // pin on this same spread (from the -/+ buttons) is left exactly as
      // it was, and picking "Automatic" leaves the count pin in place too
      // rather than resetting the whole spread.
      entries2[index2] = layoutId ? { count: cur2.count, layoutId: layoutId } : { count: cur2.count };
      if (!entries2[index2].count && !entries2[index2].layoutId) entries2.pop();
      parent.postMessage({ type: "book-spread-counts", stopId: spreadSel.dataset.stopId, counts: entries2 }, "*");
    }
  });
</script>
</body></html>`;
}
