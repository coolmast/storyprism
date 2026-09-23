import { getTheme } from "./themes.js";
import { getStrings } from "./i18n.js";
import { escapeHtml } from "./render.js";
import { planPdfPages } from "./pdfPlanner.js";
import { getTemplate, PDF_TEMPLATES, PDF_TEMPLATE_CSS } from "./pdfTemplates.js";
import { TITLE_FONTS } from "./pdfLayoutPacks.js";

// Shared by the actual PDF export (pdf.js converts this HTML to PDF bytes via
// headless Chrome), the standalone preview route and the editor's live
// preview panel. The page markup is identical in all three; `editor: true`
// only adds screen chrome around it (page labels, a per-stop layout picker,
// fit-to-width zoom) that never reaches the PDF.
export function buildPdfHtml(story, { pack, paperSize, editor = false, preview = false } = {}) {
  const theme = getTheme(story.theme);
  const strings = getStrings(story.contentLanguage);
  const plan = planPdfPages(story, { pack, paperSize, strings });
  const ctx = { ...plan.ctx, preview: preview || editor };
  const titleFont = TITLE_FONTS[plan.pack.titleStyle];

  const renderPage = (page) => getTemplate(page.templateId).render(page, strings, ctx);
  const pagesHtml = editor ? editorPages(plan.pages, story, renderPage) : plan.pages.map(renderPage).join("\n");

  const fontImports = [theme.fontImport, titleFont?.import].filter(Boolean).join("&");

  return `<!doctype html>
<html lang="${story.contentLanguage || "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(story.title)} — PDF</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${fontImports}&display=swap" rel="stylesheet">
<style>
  @page { size: ${plan.paperSize.css}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  html { font-size: calc(10pt * ${typeScale(plan.paperSize)}); }
  body {
    font-size: 1.2rem;
    font-family: ${theme.bodyFont};
    line-height: 1.5;
    --page-w: ${plan.paperSize.widthMm}mm;
    --page-h: ${plan.paperSize.heightMm}mm;
    --ink: ${theme.ink};
    --paper: ${theme.paper};
    --accent: ${theme.accent};
    --accent2: ${theme.accent2};
    --sand: ${theme.sand};
    --line: ${theme.line};
    --heading-font: ${theme.headingFont};
    --body-font: ${theme.bodyFont};
    --heading-case: ${theme.headingCase};
    --heading-tracking: ${theme.headingTracking};
    --title-font: ${titleFont ? titleFont.family : theme.headingFont};
    --title-case: ${titleFont ? "none" : theme.headingCase};
    --title-tracking: ${titleFont ? "normal" : theme.headingTracking};
  }
  ${PDF_TEMPLATE_CSS}
  ${!editor && preview ? PREVIEW_CSS : ""}
  ${editor ? EDITOR_CSS : ""}
</style>
</head>
<body${editor ? ' class="pv-editor"' : preview ? ' class="pv-standalone"' : ""}>
${pagesHtml}
${editor || preview ? zoomScript(plan.paperSize.widthMm, editor) : ""}
</body>
</html>`;
}

function typeScale(paperSize) {
  return Math.round((Math.min(paperSize.widthMm, paperSize.heightMm) / 210) * 1000) / 1000;
}

// Pages grouped by stop, each group headed by the stop's name and a layout
// picker; picking posts a message to the editor, which updates its draft
// (and re-renders this preview) without anything being saved yet.
function editorPages(pages, story, renderPage) {
  const selectable = Object.entries(PDF_TEMPLATES).filter(([, t]) => t.selectable);
  const stopsById = new Map(story.stops.map((s) => [s.id, s]));
  const groups = [];
  pages.forEach((page) => {
    const key = page.stopId || "_story";
    const last = groups.at(-1);
    if (last && last.key === key) last.pages.push(page);
    else groups.push({ key, pages: [page] });
  });

  return groups
    .map((g) => {
      const stop = stopsById.get(g.key);
      const header = stop
        ? `<div class="pv-group-head">
            <span class="pv-group-title">${escapeHtml(stop.heading || "")}</span>
            <select data-stop-id="${escapeHtml(stop.id)}" class="pv-override">
              <option value="">Automatic</option>
              ${selectable
                .map(([id, t]) => `<option value="${id}"${stop.pdfTemplateOverride === id ? " selected" : ""}>${escapeHtml(t.label)}</option>`)
                .join("")}
            </select>
          </div>`
        : "";
      const pagesHtml = g.pages
        .map(
          (p) => `<div class="pv-page">
            <div class="pv-scale">${renderPage(p)}</div>
            <div class="pv-label">${escapeHtml(PDF_TEMPLATES[p.templateId]?.label || p.templateId)}${p.photos?.length ? ` · ${p.photos.length} 📷` : ""}</div>
          </div>`
        )
        .join("\n");
      return `<section class="pv-group">${header}<div class="pv-pages">${pagesHtml}</div></section>`;
    })
    .join("\n");
}

const PREVIEW_CSS = `
  @media screen {
    body.pv-standalone { background: #3a3a3a; padding: 16px 0; }
    body.pv-standalone .pdf-page { margin: 0 auto 16px; box-shadow: 0 2px 12px rgba(0,0,0,0.5); zoom: var(--pv-zoom, 1); }
  }
`;

const EDITOR_CSS = `
  body.pv-editor { background: #2e2e2e; padding: 12px; }
  .pv-group { margin-bottom: 18px; }
  .pv-group-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    color: #eee; font-family: system-ui, sans-serif; margin: 0 2px 8px;
  }
  .pv-group-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv-override {
    font: inherit; font-size: 13px; padding: 4px 6px; border-radius: 6px;
    border: 1px solid #666; background: #444; color: #eee; max-width: 55%;
  }
  .pv-pages { display: flex; flex-wrap: wrap; gap: 12px; }
  .pv-page { width: var(--pv-page-w); }
  .pv-scale { width: var(--pv-page-w); overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
  .pv-scale .pdf-page { zoom: var(--pv-zoom, 0.3); }
  .pv-label { color: #aaa; font: 11px system-ui, sans-serif; margin-top: 4px; }
`;

// Fits pages to the available width: one per row on a phone, two side by
// side (like an open photobook) once there's room.
function zoomScript(pageWidthMm, editor) {
  return `<script>
  (function () {
    var pageWpx = ${pageWidthMm} * 96 / 25.4;
    function fit() {
      var avail = document.documentElement.clientWidth - ${editor ? 24 : 32};
      var cols = ${editor ? "avail > 700 ? 2 : 1" : "1"};
      var w = Math.min(${editor ? "(avail - (cols - 1) * 12) / cols" : "avail"}, pageWpx);
      document.body.style.setProperty("--pv-zoom", String(w / pageWpx));
      document.body.style.setProperty("--pv-page-w", w + "px");
    }
    fit();
    window.addEventListener("resize", fit);
    ${
      editor
        ? `document.addEventListener("change", function (e) {
      var sel = e.target.closest && e.target.closest(".pv-override");
      if (!sel) return;
      parent.postMessage({ type: "pdf-template-override", stopId: sel.dataset.stopId, templateId: sel.value || null }, "*");
    });`
        : ""
    }
  })();
  </script>`;
}
