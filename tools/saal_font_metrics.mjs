// Builds server/src/photobook/bookFonts.json - the fonts offered for printed
// books with Saal's exact glyph advance widths - from fonts extracted by
// tools/extract_saal_fonts.py. Only widths (measurements) end up in the repo;
// the font files themselves stay local.
//
// Usage: node tools/saal_font_metrics.mjs [fonts dir]
import opentype from "opentype.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(here, "../server/data/saal-fonts");
const OUT = join(here, "../server/src/photobook/bookFonts.json");

// The user's selection from Saal's font list, with a rough style class
// (scripts are flagged in the body-text picker).
const OFFERED = {
  "Architects Daughter": "handwriting", Allison: "script", Allura: "script", Amarante: "display",
  "Anonymous Pro": "mono", Babylonica: "script", Bainsley: "script", Bellota: "text",
  "Brygada 1918": "serif", Berenika: "serif", "Butterfly Kids": "script", Clara: "serif",
  Coelacanth: "serif", Exo: "text", Explora: "script", "Grand Hotel": "script",
  "Great Vibes": "script", "Lavishly Yours": "script", Tangerine: "script", Waterfall: "script",
};
// Characters stored per font; anything else uses the font's average.
const CHARSET = [...Array(95).keys()].map((i) => String.fromCharCode(32 + i)).join("") +
  "ÄÖÜäöüßÅåÆæØøÉéÈèÊêÀàÂâÇçÍíÓóÚúÑñ–—‘’‚“”„…€·•";

const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
const googleOk = new Set(["Architects Daughter","Allison","Allura","Amarante","Anonymous Pro","Babylonica","Bellota","Brygada 1918","Butterfly Kids","Clara","Exo","Explora","Grand Hotel","Great Vibes","Lavishly Yours","Tangerine","Waterfall"]);
const fonts = Object.entries(OFFERED).map(([name, kind]) => {
  const key = name.replace(/ /g, "");
  const entry = index.find((e) => e.key === key && e.style === "Regular");
  if (!entry) throw new Error(`font not found in extraction: ${name}`);
  const f = opentype.parse(readFileSync(join(dir, entry.file)).buffer);
  const upm = f.unitsPerEm;
  const adv = {};
  for (const ch of CHARSET) adv[ch] = Math.round((f.charToGlyph(ch).advanceWidth / upm) * 1000);
  const sample = "Nach einer langen Fahrt voller Trubel und ein wenig Verzögerung landeten wir schließlich in Lerkil.";
  const avg = Math.round([...sample].reduce((s, c) => s + adv[c], 0) / sample.length);
  return { name, saal: entry.family, key, kind, google: googleOk.has(name), avg, adv };
});
writeFileSync(
  OUT,
  JSON.stringify(
    {
      _source:
        "Fonts offered for Saal books. saal = font family name inside Saal's own font files; adv = advance width per character in 1/1000 em, read from the OpenType fonts Saal renders with (extracted by tools/extract_saal_fonts.py); avg = average over a German sample. google = also on Google Fonts (preview fallback when the Saal fonts are not extracted locally).",
      fonts,
    },
    null,
    1
  )
);
console.log(`wrote ${fonts.length} fonts to ${OUT}`);
console.log(fonts.map((f) => `${f.name}: ${f.saal} avg ${f.avg}`).join("\n"));
