import { getTheme } from "./themes.js";
import { getStrings } from "./i18n.js";
import { escapeHtml } from "./render.js";
import { planPdfPages } from "./pdfPlanner.js";
import { getTemplate, PDF_TEMPLATE_CSS } from "./pdfTemplates.js";

// Shared by both the actual PDF export (pdf.js, which converts this HTML to
// PDF bytes via headless Chrome) and the live preview route (index.js,
// which just serves it as-is) - the whole point of staying on HTML/CSS
// instead of a separate document-generation language is that you can look
// at the exact thing that will become the PDF in an ordinary browser tab.
export function buildPdfHtml(story, { pack, paperSize } = {}) {
  const theme = getTheme(story.theme);
  const strings = getStrings(story.contentLanguage);
  const { pages, paperSize: resolvedPaperSize } = planPdfPages(story, { pack, paperSize });

  const pagesHtml = pages.map((page) => getTemplate(page.templateId).render(page, strings)).join("\n");

  return `<!doctype html>
<html lang="${story.contentLanguage || "en"}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(story.title)} — PDF</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${theme.fontImport}&display=swap" rel="stylesheet">
<style>
  @page { size: ${resolvedPaperSize.css}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ${theme.bodyFont};
    line-height: 1.5;
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
  }
  ${PDF_TEMPLATE_CSS}
</style>
</head>
<body>
${pagesHtml}
</body>
</html>`;
}
