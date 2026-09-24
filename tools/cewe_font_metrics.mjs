// Builds server/src/photobook/ceweFonts.json - the fonts offered for CEWE
// books, with glyph advance widths and line spacing - from the macOS system
// fonts CEWE FOTOWELT renders with. Only measurements end up in the repo; the
// font files themselves stay local (copy them from /System/Library/Fonts and
// /System/Library/Fonts/Supplemental on a Mac).
//
// Every family here is on CEWE's fonts-mac.xml "good" list (printable) and
// ships with every Mac, so a book planned with it prints as planned.
//
// Usage: node tools/cewe_font_metrics.mjs <fonts dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(here, "../cewe-test/cewe-fonts");
const OUT = join(here, "../server/src/photobook/ceweFonts.json");

// name -> [kind, regular style, bold style] (style names as in the fonts).
const OFFERED = {
  Chalkboard: ["handwriting", "Regular", "Bold"],
  "Marker Felt": ["handwriting", "Thin", "Wide"],
  "Apple Chancery": ["script", "Chancery", null],
  "Brush Script MT": ["script", "Italic", null],
  Baskerville: ["serif", "Regular", "Bold"],
  "Big Caslon": ["serif", "Medium", null],
  Cochin: ["serif", "Regular", "Bold"],
  Didot: ["serif", "Regular", "Bold"],
  Georgia: ["serif", "Regular", "Bold"],
  "Hoefler Text": ["serif", "Regular", "Black"],
  "American Typewriter": ["serif", "Regular", "Bold"],
  Futura: ["text", "Medium", "Bold"],
  "Gill Sans": ["text", "Regular", "Bold"],
  Optima: ["text", "Regular", "Bold"],
  "Helvetica Neue": ["text", "Regular", "Bold"],
  "Andale Mono": ["mono", "Regular", null],
};

const CHARSET = [...Array(95).keys()].map((i) => String.fromCharCode(32 + i)).join("") +
  "ÄÖÜäöüßÅåÆæØøÉéÈèÊêÀàÂâÇçÍíÓóÚúÑñ–—‘’‚“”„…€·•";
const SAMPLE = "Nach einer langen Fahrt voller Trubel und ein wenig Verzögerung landeten wir schließlich in Lerkil.";

// A .ttc bundles several fonts sharing one file; opentype.js only reads
// single fonts, so each member is rebuilt as a standalone sfnt (its table
// directory with offsets rebased onto copied table data).
function splitCollection(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0) !== 0x74746366) return [buf]; // 'ttcf'
  const count = dv.getUint32(8);
  const out = [];
  for (let i = 0; i < count; i++) {
    const off = dv.getUint32(12 + i * 4);
    const numTables = dv.getUint16(off + 4);
    const tables = [];
    for (let t = 0; t < numTables; t++) {
      const e = off + 12 + t * 16;
      tables.push({ dir: buf.subarray(e, e + 16), offset: dv.getUint32(e + 8), length: dv.getUint32(e + 12) });
    }
    const headerLen = 12 + numTables * 16;
    let size = headerLen;
    for (const t of tables) size += (t.length + 3) & ~3;
    const font = Buffer.alloc(size);
    buf.copy(font, 0, off, off + 12);
    let pos = headerLen;
    tables.forEach((t, k) => {
      t.dir.copy(font, 12 + k * 16);
      font.writeUInt32BE(pos, 12 + k * 16 + 8);
      buf.copy(font, pos, t.offset, t.offset + t.length);
      pos += (t.length + 3) & ~3;
    });
    out.push(font);
  }
  return out;
}

// Minimal sfnt reader: just the tables needed for widths and line pitch.
// (opentype.js rejects several Apple fonts - AAT tables, cmap format 6.)
function readFont(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  const numTables = dv.getUint16(4);
  for (let t = 0; t < numTables; t++) {
    const e = 12 + t * 16;
    const tag = String.fromCharCode(buf[e], buf[e + 1], buf[e + 2], buf[e + 3]);
    tables[tag] = dv.getUint32(e + 8);
  }
  const unitsPerEm = dv.getUint16(tables.head + 18);
  const hh = tables.hhea;
  const hhea = { ascender: dv.getInt16(hh + 4), descender: dv.getInt16(hh + 6), lineGap: dv.getInt16(hh + 8) };
  const numHMetrics = dv.getUint16(hh + 34);
  const advance = (gid) => dv.getUint16(tables.hmtx + 4 * Math.min(gid, numHMetrics - 1));

  // cmap: prefer a Unicode subtable, formats 4 / 6 / 12.
  const cm = tables.cmap;
  const subs = [];
  for (let i = 0; i < dv.getUint16(cm + 2); i++) {
    const e = cm + 4 + i * 8;
    subs.push({ pid: dv.getUint16(e), eid: dv.getUint16(e + 2), off: cm + dv.getUint32(e + 4) });
  }
  const unicode = subs.filter((x) => x.pid === 0 || (x.pid === 3 && (x.eid === 1 || x.eid === 10)));
  const glyphMaps = unicode.map((sub) => {
    const fmt = dv.getUint16(sub.off);
    if (fmt === 4) {
      const segX2 = dv.getUint16(sub.off + 6);
      const ends = sub.off + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      return (c) => {
        for (let i = 0; i < segX2 / 2; i++) {
          if (c > dv.getUint16(ends + 2 * i)) continue;
          const start = dv.getUint16(starts + 2 * i);
          if (c < start) return 0;
          const delta = dv.getInt16(deltas + 2 * i);
          const ro = dv.getUint16(ranges + 2 * i);
          if (!ro) return (c + delta) & 0xffff;
          const g = dv.getUint16(ranges + 2 * i + ro + 2 * (c - start));
          return g ? (g + delta) & 0xffff : 0;
        }
        return 0;
      };
    }
    if (fmt === 6) {
      const first = dv.getUint16(sub.off + 6);
      const count = dv.getUint16(sub.off + 8);
      return (c) => (c >= first && c < first + count ? dv.getUint16(sub.off + 10 + 2 * (c - first)) : 0);
    }
    if (fmt === 12) {
      const n = dv.getUint32(sub.off + 12);
      return (c) => {
        for (let i = 0; i < n; i++) {
          const g = sub.off + 16 + i * 12;
          const s = dv.getUint32(g);
          const e = dv.getUint32(g + 4);
          if (c >= s && c <= e) return dv.getUint32(g + 8) + (c - s);
        }
        return 0;
      };
    }
    return () => 0;
  });
  const glyph = (ch) => {
    for (const m of glyphMaps) {
      const g = m(ch.codePointAt(0));
      if (g) return g;
    }
    return 0;
  };

  // Names: family (16, else 1) and style (17, else 2); Windows UTF-16 or Mac Roman.
  const nm = tables.name;
  const count = dv.getUint16(nm + 2);
  const strOff = nm + dv.getUint16(nm + 4);
  const names = {};
  for (let i = 0; i < count; i++) {
    const r = nm + 6 + i * 12;
    const pid = dv.getUint16(r);
    const lang = dv.getUint16(r + 4);
    const id = dv.getUint16(r + 6);
    const len = dv.getUint16(r + 8);
    const off = strOff + dv.getUint16(r + 10);
    let str = null;
    if (pid === 3 && lang === 0x409) str = Buffer.from(buf.subarray(off, off + len)).swap16().toString("utf16le");
    else if (pid === 1 && lang === 0) str = Buffer.from(buf.subarray(off, off + len)).toString("latin1");
    else if (pid === 0) str = Buffer.from(buf.subarray(off, off + len)).swap16().toString("utf16le");
    if (str && !(id in names && pid !== 3)) names[id] = str;
  }
  return {
    family: names[16] || names[1],
    style: names[17] || names[2],
    unitsPerEm,
    hhea,
    advanceOf: (ch) => advance(glyph(ch)),
  };
}

const faces = [];
for (const file of readdirSync(dir)) {
  if (!/\.(ttf|otf|ttc)$/i.test(file)) continue;
  for (const buf of splitCollection(readFileSync(join(dir, file)))) {
    try {
      const f = readFont(buf);
      faces.push({ family: f.family, style: f.style, font: f, file });
    } catch (e) {
      console.warn(`skipped a face in ${file}: ${e.message}`);
    }
  }
}

function measure(face) {
  const f = face.font;
  const adv = {};
  for (const ch of CHARSET) adv[ch] = Math.round((f.advanceOf(ch) / f.unitsPerEm) * 1000);
  const avg = Math.round([...SAMPLE].reduce((s, c) => s + adv[c], 0) / SAMPLE.length);
  // Line spacing as Qt/CoreText on macOS computes it: hhea ascent + descent
  // + line gap, in em.
  const h = f.hhea;
  const lineSpacing = (h.ascender - h.descender + h.lineGap) / f.unitsPerEm;
  return { adv, avg, lineSpacing: Math.round(lineSpacing * 1000) / 1000 };
}

const find = (family, style) => faces.find((x) => x.family === family && x.style === style);
const fonts = Object.entries(OFFERED).map(([name, [kind, regularStyle, boldStyle]]) => {
  const regular = find(name, regularStyle);
  if (!regular) {
    const have = faces.filter((x) => x.family === name).map((x) => x.style);
    throw new Error(`${name} ${regularStyle} not found (styles: ${have.join(", ") || "none"})`);
  }
  const r = measure(regular);
  const bold = boldStyle ? find(name, boldStyle) : null;
  const b = bold ? measure(bold) : r;
  return { name, key: `CEWE-${name.replace(/ /g, "")}`, kind, google: false, lineSpacing: r.lineSpacing, avg: r.avg, adv: r.adv, boldAvg: b.avg, boldAdv: b.adv };
});

writeFileSync(
  OUT,
  JSON.stringify(
    {
      _source:
        "Fonts offered for CEWE books: macOS system fonts on CEWE's printable list (fonts-mac.xml). adv/boldAdv = advance width per character in 1/1000 em (regular/bold); avg = average over a German sample; lineSpacing = the font's natural line pitch in em (hhea ascent + descent + gap), which CEWE's line-height percentage is relative to. Generated by tools/cewe_font_metrics.mjs.",
      fonts,
    },
    null,
    1
  )
);
console.log(`wrote ${fonts.length} fonts to ${OUT}`);
console.log(fonts.map((f) => `${f.name}: avg ${f.avg} line ${f.lineSpacing}`).join("\n"));
