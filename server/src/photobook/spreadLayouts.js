import { readFileSync } from "node:fs";
import { photoAspect, coverRetention, collage, pickBackdrop, cardLayout } from "../pdfLayoutEngine.js";

// Spread layouts for printed photobooks, modeled on the user's hand-made Saal
// books: a lay-flat double page is designed as one canvas - a background
// photo running across the fold, shadowed photo "cards" floating on it,
// per-page mosaics, a hero page next to a gallery page, ...
//
// Everything is in Saal's native unit (0.1 mm) on the spread canvas
// (spread.w x spread.h incl. bleed, fold at spread.w / 2). A layout returns
// plain element descriptors; saalSvg.js turns the same descriptors into
// either the Saal project SVG or the live preview, so the preview can't
// drift from what gets exported.
//
// Element kinds:
//   image  { photo, frame, background, shadow, rotation }
//          frame = visible box; the photo always fills it (cover), and the
//          layouts size frames to the photo's own aspect ratio wherever the
//          design allows, so cards are never cropped.
//   text   { paragraphs: [{ text, role, size, color, align }], frame }
//   panel  { frame, color, opacity }  translucent box behind text
//
// Every layout: { label, photos: {min, max, ideal}, fit(photos, spread),
// build(photos, spread, ctx) -> { elements } }. `ctx`: { variant, title,
// typeScale }.

// Fonts offered for the printed book: names as listed in Saal Design
// Software (its family name is `${name}Embedded`), each with its average
// character width measured in Chrome (see bookFonts.json).
export const BOOK_FONTS = JSON.parse(readFileSync(new URL("./bookFonts.json", import.meta.url), "utf8")).fonts;
export const DEFAULT_TITLE_FONT = "Architects Daughter";
export const DEFAULT_BODY_FONT = "Architects Daughter";

export function fontInfo(name) {
  return BOOK_FONTS.find((f) => f.name === name) || BOOK_FONTS.find((f) => f.name === DEFAULT_TITLE_FONT);
}

export function resolveFonts(story) {
  return { title: fontInfo(story.bookTitleFont || DEFAULT_TITLE_FONT), body: fontInfo(story.bookBodyFont || DEFAULT_BODY_FONT) };
}

// Saal's text metrics: a TLF fontSize unit is 4.15 Saal units of em size
// (Saal's UI shows fontSize x 1.18 as "pt"), lines are 1.2 em apart, and
// paragraphs get no extra spacing. Glyph widths come from the OpenType fonts
// Saal itself renders with (bookFonts.json) - confirmed against a calibration
// import, where Saal's Architects Daughter measured 0.586 em per character
// and its font file says 0.587. (The ~44 mm inner margin Saal adds around
// every text element is compensated in saalSvg.js; frames here are the text
// area.)
export const SAAL_EM = 4.15;
export const SAAL_LINE = SAAL_EM * 1.2;

// Width of `text` in Saal units at `size`, from the font's advance table.
export function textWidth(text, size, font) {
  let w = 0;
  for (const ch of text) w += font.adv[ch] ?? font.avg;
  return (w / 1000) * size * SAAL_EM;
}

const roleFont = (fonts, role) => (role === "title" || role === "quote" ? fonts.title : fonts.body);

const image = (photo, frame, opts = {}) => ({ kind: "image", photo, frame, background: false, shadow: false, rotation: 0, ...opts });

function pageBox(spread, side) {
  const P = spread.w / 2;
  return { x: side === "left" ? 0 : P, y: 0, w: P, h: spread.h };
}

function fullBox(spread) {
  return { x: 0, y: 0, w: spread.w, h: spread.h };
}

function inset(box, d) {
  return { x: box.x + d, y: box.y + d, w: box.w - 2 * d, h: box.h - 2 * d };
}

// cardLayout works in "page width = 100" units; map onto a real page.
function cardsOn(photos, page, variant, sizeFactor = 1) {
  if (!photos.length) return { frames: [], freeCorners: ["tl", "tr", "bl", "br"] };
  const { boxes, freeCorners } = cardLayout(photos, page.w / page.h, { variant, sizeFactor });
  const s = page.w / 100;
  return {
    frames: boxes.map((b) => ({ x: page.x + b.x * s, y: page.y + b.y * s, w: b.w * s, h: b.h * s })),
    freeCorners,
  };
}

function collageOn(photos, box, { gap, fill = 0.9, variant = 0 }) {
  return collage(photos, box, { gap, fillTolerance: fill, variant }).boxes;
}

// Stop title in a page corner, handwritten, white on photos / accent on paper.
export function titleElement(title, page, corner, ctx, { dark = false } = {}) {
  const size = 34 * ctx.typeScale;
  const lineH = size * SAAL_LINE;
  const w = page.w * 0.5;
  const h = lineH * 2.2;
  const m = page.w * 0.07;
  const x = corner.includes("r") ? page.x + page.w - m - w : page.x + m;
  const y = corner.includes("b") ? page.y + page.h - m - h : page.y + m;
  return {
    kind: "text",
    frame: { x, y, w, h },
    paragraphs: [
      {
        text: title,
        role: "title",
        font: ctx.fonts.title,
        size,
        color: dark ? ctx.accentColor || "#333333" : "#ffffff",
        align: corner.includes("r") ? "right" : "left",
      },
    ],
  };
}

// Splits `photos` into a left and right group (in order) maximizing how
// well each page's collage fills its box.
function bestSplit(photos, leftBox, rightBox, opts) {
  let best = null;
  // At most 6 photos per page: beyond that the photos get too small to
  // print well, and the collage search grows exponentially.
  for (let k = Math.max(1, photos.length - 6); k <= Math.min(photos.length - 1, 6); k++) {
    const l = collage(photos.slice(0, k), leftBox, opts).coverage;
    const r = collage(photos.slice(k), rightBox, opts).coverage;
    const balance = 1 - Math.abs(k - photos.length / 2) / photos.length;
    const score = (l + r) / 2 + balance * 0.1;
    if (!best || score > best.score) best = { k, score, coverage: (l + r) / 2 };
  }
  return best;
}

function jitter(seed, i, amount) {
  const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return ((v - Math.floor(v)) * 2 - 1) * amount;
}

// Prefer the featured photo as a backdrop when its shape allows, otherwise
// the one that survives a crop to `aspect` best.
function chooseBackdrop(photos, aspect, minRetention = 0.55) {
  const featured = photos.findIndex((p) => p.featured);
  if (featured >= 0 && coverRetention(photoAspect(photos[featured]), aspect) >= minRetention) return featured;
  return pickBackdrop(photos, aspect);
}

export const SPREAD_LAYOUTS = {
  // One photo across the whole spread, 2-4 prints floating on it.
  "backdrop-cards": {
    label: "Background + photo cards",
    photos: { min: 3, max: 5, ideal: 4 },
    fit(photos, spread) {
      const bg = photos[chooseBackdrop(photos, spread.w / spread.h)];
      const r = coverRetention(photoAspect(bg), spread.w / spread.h);
      return r < 0.55 ? 0 : Math.min(1, r + 0.3);
    },
    build(photos, spread, ctx) {
      const bgIdx = chooseBackdrop(photos, spread.w / spread.h);
      const cards = photos.filter((_, i) => i !== bgIdx);
      const leftCount = ctx.variant % 2 ? Math.floor(cards.length / 2) : Math.ceil(cards.length / 2);
      const left = cardsOn(cards.slice(0, leftCount), pageBox(spread, "left"), ctx.variant, 0.95);
      const right = cardsOn(cards.slice(leftCount), pageBox(spread, "right"), ctx.variant + 1, 0.95);
      const elements = [
        image(photos[bgIdx], fullBox(spread), { background: true }),
        ...cards.slice(0, leftCount).map((p, i) => image(p, left.frames[i], { shadow: true })),
        ...cards.slice(leftCount).map((p, i) => image(p, right.frames[i], { shadow: true })),
      ];
      if (ctx.title) {
        const onLeft = left.freeCorners.length > 0;
        const corner = (onLeft ? left.freeCorners : right.freeCorners)[0] || "tl";
        elements.push(titleElement(ctx.title, pageBox(spread, onLeft ? "left" : "right"), corner, ctx));
      }
      return { elements };
    },
  },

  // Each page gets its own background photo with a print or two on it.
  "page-backdrops": {
    label: "Two backgrounds + cards",
    photos: { min: 2, max: 6, ideal: 4 },
    fit(photos, spread) {
      const pageAspect = spread.w / 2 / spread.h;
      const r = photos.map((p) => coverRetention(photoAspect(p), pageAspect)).sort((a, b) => b - a);
      if (r[1] < 0.6) return 0;
      return Math.min(1, (r[0] + r[1]) / 2 + 0.2);
    },
    build(photos, spread, ctx) {
      const pageAspect = spread.w / 2 / spread.h;
      const ranked = photos
        .map((p, i) => ({ i, r: coverRetention(photoAspect(p), pageAspect) }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 2)
        .map((x) => x.i)
        .sort((a, b) => a - b);
      const rest = photos.filter((_, i) => !ranked.includes(i));
      const leftCount = Math.ceil(rest.length / 2);
      const L = pageBox(spread, "left");
      const R = pageBox(spread, "right");
      const left = cardsOn(rest.slice(0, leftCount), L, ctx.variant, 0.9);
      const right = cardsOn(rest.slice(leftCount), R, ctx.variant + 2, 0.9);
      const elements = [
        image(photos[ranked[0]], L, { background: true }),
        image(photos[ranked[1]], R, { background: true }),
        ...rest.slice(0, leftCount).map((p, i) => image(p, left.frames[i], { shadow: true })),
        ...rest.slice(leftCount).map((p, i) => image(p, right.frames[i], { shadow: true })),
      ];
      if (ctx.title) elements.push(titleElement(ctx.title, L, left.freeCorners[0] || "tl", ctx));
      return { elements };
    },
  },

  // Aspect-true mosaic on each page, thin white gaps, running into the bleed.
  "page-mosaics": {
    label: "Mosaic on both pages",
    photos: { min: 4, max: 10, ideal: 6 },
    fit(photos, spread) {
      const L = pageBox(spread, "left");
      const R = pageBox(spread, "right");
      return bestSplit(photos, L, R, { gap: 25 }).coverage;
    },
    build(photos, spread, ctx) {
      const framed = ctx.variant % 2 === 1;
      const d = framed ? 170 : 0;
      const gap = framed ? 60 : 25;
      const band = ctx.title ? spread.h * 0.14 : 0;
      let L = inset(pageBox(spread, "left"), d);
      const R = inset(pageBox(spread, "right"), d);
      if (band) L = { ...L, y: L.y + band, h: L.h - band };
      const { k } = bestSplit(photos, L, R, { gap });
      const lf = collageOn(photos.slice(0, k), L, { gap, fill: framed ? 0.9 : 0.8, variant: ctx.variant });
      const rf = collageOn(photos.slice(k), R, { gap, fill: framed ? 0.9 : 0.8, variant: ctx.variant + 1 });
      const elements = [
        ...photos.slice(0, k).map((p, i) => image(p, lf[i], { shadow: framed })),
        ...photos.slice(k).map((p, i) => image(p, rf[i], { shadow: framed })),
      ];
      if (ctx.title) elements.push(titleElement(ctx.title, pageBox(spread, "left"), "tl", ctx, { dark: true }));
      return { elements, paper: "#ffffff" };
    },
  },

  // A full-bleed hero on one page, a small gallery on the other.
  "hero-page": {
    label: "Hero page + gallery",
    photos: { min: 3, max: 5, ideal: 4 },
    fit(photos, spread) {
      const pageAspect = spread.w / 2 / spread.h;
      const hero = pickBackdrop(photos, pageAspect);
      const r = coverRetention(photoAspect(photos[hero]), pageAspect);
      if (r < 0.62) return 0;
      const rest = photos.filter((_, i) => i !== hero);
      const cov = collage(rest, inset(pageBox(spread, "right"), 200), { gap: 70 }).coverage;
      return (r + cov) / 2 + 0.05;
    },
    build(photos, spread, ctx) {
      const pageAspect = spread.w / 2 / spread.h;
      const heroIdx = chooseBackdrop(photos, pageAspect, 0.62);
      const heroSide = ctx.variant % 2 ? "right" : "left";
      const galSide = heroSide === "left" ? "right" : "left";
      const band = ctx.title ? spread.h * 0.14 : 0;
      let gal = inset(pageBox(spread, galSide), 200);
      if (band) gal = { ...gal, y: gal.y + band, h: gal.h - band };
      const rest = photos.filter((_, i) => i !== heroIdx);
      const frames = collageOn(rest, gal, { gap: 70, fill: 0.92, variant: ctx.variant });
      const elements = [
        image(photos[heroIdx], pageBox(spread, heroSide), { background: true }),
        ...rest.map((p, i) => image(p, frames[i], { shadow: true })),
      ];
      if (ctx.title) elements.push(titleElement(ctx.title, pageBox(spread, galSide), "tl", ctx, { dark: true }));
      return { elements, paper: "#ffffff" };
    },
  },

  // Loose prints on white with lots of air.
  "white-scatter": {
    label: "Scattered prints on white",
    photos: { min: 2, max: 4, ideal: 3 },
    fit(photos, spread) {
      const L = inset(pageBox(spread, "left"), 320);
      const R = inset(pageBox(spread, "right"), 320);
      return Math.min(0.85, bestSplit(photos, L, R, { gap: 220 }).coverage + 0.1);
    },
    build(photos, spread, ctx) {
      const band = ctx.title ? spread.h * 0.12 : 0;
      let L = inset(pageBox(spread, "left"), 320);
      const R = inset(pageBox(spread, "right"), 320);
      if (band) L = { ...L, y: L.y + band, h: L.h - band };
      const { k } = bestSplit(photos, L, R, { gap: 220 });
      const lf = collageOn(photos.slice(0, k), L, { gap: 220, fill: 2, variant: ctx.variant });
      const rf = collageOn(photos.slice(k), R, { gap: 220, fill: 2, variant: ctx.variant + 1 });
      const seed = ctx.variant + 1;
      const move = (f, i) => ({ ...f, x: f.x + jitter(seed, i, 70), y: f.y + jitter(seed + 5, i, 70) });
      const elements = [
        ...photos.slice(0, k).map((p, i) => image(p, move(lf[i], i), { shadow: true })),
        ...photos.slice(k).map((p, i) => image(p, move(rf[i], i + 7), { shadow: true })),
      ];
      if (ctx.title) elements.push(titleElement(ctx.title, pageBox(spread, "left"), "tl", ctx, { dark: true }));
      return { elements, paper: "#ffffff" };
    },
  },

  // One photo across the whole spread - made for panoramas, but also the
  // fallback for a single leftover photo - with up to two prints.
  panorama: {
    label: "Full-spread photo",
    photos: { min: 1, max: 3, ideal: 1 },
    fit(photos, spread) {
      const widest = photos.reduce((a, p) => (photoAspect(p) > photoAspect(a) ? p : a), photos[0]);
      const r = coverRetention(photoAspect(widest), spread.w / spread.h);
      return photoAspect(widest) >= 1.75 ? Math.min(1.2, r + 0.35) : r * 0.7;
    },
    build(photos, spread, ctx) {
      const bgIdx = photos.reduce((a, p, i) => (photoAspect(p) > photoAspect(photos[a]) ? i : a), 0);
      const cards = photos.filter((_, i) => i !== bgIdx);
      const R = pageBox(spread, "right");
      const L = pageBox(spread, "left");
      const lc = cardsOn(cards.slice(0, 1), L, 3, 0.75);
      const rc = cardsOn(cards.slice(1), R, 0, 0.75);
      const elements = [
        image(photos[bgIdx], fullBox(spread), { background: true }),
        ...cards.slice(0, 1).map((p, i) => image(p, lc.frames[i], { shadow: true })),
        ...cards.slice(1).map((p, i) => image(p, rc.frames[i], { shadow: true })),
      ];
      if (ctx.title) elements.push(titleElement(ctx.title, L, "tl", ctx));
      return { elements };
    },
  },
};

export const SPREAD_LAYOUT_IDS = Object.keys(SPREAD_LAYOUTS);

export const DEFAULT_SPREAD_WEIGHTS = {
  "backdrop-cards": 1.15,
  "hero-page": 1,
  "page-backdrops": 0.95,
  "page-mosaics": 0.95,
  panorama: 0.9,
  "white-scatter": 0.8,
};

// --- Text-led spreads (not part of the automatic photo rotation) ----------

// Line count of `text` in a box `widthUnits` wide: a word-by-word
// simulation of the line breaker with the font's real glyph widths.
function estimateLines(text, widthUnits, size, font) {
  const space = textWidth(" ", size, font);
  return String(text || "")
    .split(/\n+/)
    .reduce((n, para) => {
      let lines = 1;
      let used = 0;
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const w = textWidth(word, size, font);
        if (used > 0 && used + space + w > widthUnits) {
          lines += 1 + Math.floor(w / widthUnits);
          used = w % widthUnits;
        } else {
          used += (used > 0 ? space : 0) + w;
          if (used > widthUnits) {
            lines += Math.floor(used / widthUnits);
            used %= widthUnits;
          }
        }
      }
      return n + lines;
    }, 0);
}

// Fits title + body paragraphs into `frame`, shrinking the body size until
// the estimated height fits (down to a floor).
export function textBlock(frame, { title, subtitle, body = [], quote, color, accent, typeScale, fonts, titleSize = 30 }) {
  let size = 10.5 * typeScale;
  const tSize = titleSize * typeScale;
  const measure = (s) => {
    let h = 0;
    const lines = (text, sz, font = fonts.body) => estimateLines(text, frame.w, sz, font) * sz * SAAL_LINE;
    if (title) h += lines(title, tSize, fonts.title);
    if (subtitle) h += lines(subtitle, s * 1.1);
    // Half-line gap between paragraphs: Saal adds no paragraph spacing, so
    // small spacer paragraphs are inserted below.
    body.forEach((b, i) => (h += lines(b, s) + (i < body.length - 1 ? s * SAAL_LINE * 0.5 : 0)));
    if (quote) h += lines(quote, s * 1.35, fonts.title) + s * SAAL_LINE * 0.5;
    // One spare line of slack against estimate error.
    return h + s * SAAL_LINE;
  };
  while (size > 7.5 * typeScale && measure(size) > frame.h) size -= 0.5 * typeScale;
  const paragraphs = [];
  const para = (p) => paragraphs.push({ ...p, font: roleFont(fonts, p.role) });
  if (title) para({ text: title, role: "title", size: tSize, color: accent || color, align: "left" });
  if (subtitle) para({ text: subtitle, role: "subtitle", size: size * 1.1, color: accent || color, align: "left" });
  const gap = () => para({ text: " ", role: "body", size: size * 0.5, color, align: "left" });
  body.forEach((b, i) => {
    if (i > 0) gap();
    para({ text: b, role: "body", size, color, align: "left" });
  });
  if (quote) {
    gap();
    para({ text: quote, role: "quote", size: size * 1.35, color: accent || color, align: "left" });
  }
  return { kind: "text", frame, paragraphs, estimatedHeight: measure(size) };
}

function splitParagraphs(text) {
  return String(text || "")
    .split(/\n\s*\n|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Chapter opener: a photo across the spread, the stop's story on a
// translucent paper panel on the right page, an optional print on the left.
export function chapterSpread(spread, ctx, { backdrop, title, narrative, pullQuote, card }) {
  const R = pageBox(spread, "right");
  const L = pageBox(spread, "left");
  const pad = 130;
  const panelFrame = { x: R.x + R.w * 0.1, y: R.h * 0.1, w: R.w * 0.8, h: R.h * 0.8 };
  const block = textBlock(
    { x: panelFrame.x + pad, y: panelFrame.y + pad, w: panelFrame.w - 2 * pad, h: panelFrame.h - 2 * pad },
    {
      title,
      body: splitParagraphs(narrative),
      quote: pullQuote,
      color: "#2b2b2b",
      accent: ctx.accentColor,
      typeScale: ctx.typeScale,
      fonts: ctx.fonts,
    }
  );
  // Shrink the panel to the text so short stories don't sit in a big box.
  const used = Math.min(block.frame.h, block.estimatedHeight + 40);
  const panelH = used + 2 * pad;
  const panelY = (R.h - panelH) / 2;
  block.frame = { ...block.frame, y: panelY + pad, h: used + 60 };
  const elements = [];
  if (backdrop) elements.push(image(backdrop, fullBox(spread), { background: true }));
  if (card) {
    const { frames } = cardsOn([card], L, 1, 0.9);
    elements.push(image(card, frames[0], { shadow: true, rotation: -2 }));
  }
  elements.push({ kind: "panel", frame: { ...panelFrame, y: panelY, h: panelH }, color: "#ffffff", opacity: backdrop ? 0.82 : 0 });
  elements.push(block);
  return { elements, paper: "#ffffff" };
}

// Info card: the place's photo as a full-bleed page, the facts on the other.
export function infoCardSpread(spread, ctx, { card, hero }) {
  const L = pageBox(spread, "left");
  const R = pageBox(spread, "right");
  const facts = (card.facts || []).map((f) => `${f.label}: ${f.value}`);
  const body = [card.summary, ...facts].filter(Boolean);
  const block = textBlock(inset(R, R.w * 0.12), {
    title: card.placeName,
    subtitle: card.subtitle,
    body,
    color: "#2b2b2b",
    accent: ctx.accentColor,
    typeScale: ctx.typeScale,
    fonts: ctx.fonts,
    titleSize: 30,
  });
  const elements = [];
  if (hero) elements.push(image(hero, L, { background: true }));
  elements.push(block);
  return { elements, paper: "#ffffff" };
}

// Wrap-around cover: backdrop over back + spine + front, a translucent band
// with the title on the front, two slightly tilted prints above it.
export function coverSpread(cover, ctx, { backdrop, cards, title, subtitle }) {
  const frontX = cover.w / 2 + 120;
  const frontW = cover.w - frontX - 60;
  const elements = [];
  if (backdrop) elements.push(image(backdrop, { x: 0, y: 0, w: cover.w, h: cover.h }, { background: true }));
  const bandY = cover.h * 0.6;
  const bandH = cover.h * 0.2;
  // Dark band at 50 %: the calibration import showed 38 % disappears on
  // darker cover photos.
  elements.push({ kind: "panel", frame: { x: -4, y: bandY, w: cover.w + 8, h: bandH }, color: "#101018", opacity: 0.5 });
  const tSize = 40 * ctx.typeScale;
  elements.push({
    kind: "text",
    frame: { x: frontX + frontW * 0.05, y: bandY + bandH * 0.12, w: frontW * 0.9, h: bandH * 0.8 },
    paragraphs: [
      { text: title, role: "title", font: ctx.fonts.title, size: tSize, color: "#ffffff", align: "center" },
      ...(subtitle
        ? [{ text: subtitle, role: "subtitle", font: ctx.fonts.body, size: 13 * ctx.typeScale, color: "#ffffff", align: "center" }]
        : []),
    ],
  });
  const tilts = [-6, 5];
  (cards || []).slice(0, 2).forEach((p, i) => {
    const a = photoAspect(p);
    let w = frontW * (a >= 1 ? 0.4 : 0.3);
    let h = w / a;
    const maxH = cover.h * 0.38;
    if (h > maxH) {
      h = maxH;
      w = h * a;
    }
    const x = frontX + frontW * (i === 0 ? 0.06 : 0.52);
    const y = cover.h * (i === 0 ? 0.1 : 0.14);
    elements.push(image(p, { x, y, w, h }, { shadow: true, rotation: tilts[i] }));
  });
  return { elements };
}
