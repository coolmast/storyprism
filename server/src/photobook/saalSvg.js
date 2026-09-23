import { createHash } from "node:crypto";
import { SAAL_EM, SAAL_LINE, fontInfo } from "./spreadLayouts.js";

// Saal lays text out inside its element box with a fixed ~44 mm inner margin
// on every side (measured in a calibration import; Saal's own projects show
// the same oversized text boxes). Layout frames are the intended text area,
// so the element box written to the project is grown by this margin.
const SAAL_TEXT_MARGIN = 440;

// Renders a planned spread (see spreadLayouts.js) as SVG, in one of two
// modes that share all geometry:
//
//   "saal"    - the exact dialect Saal Design Software 4.7 writes into its
//               projects: every photo is an <image> placed at its full size
//               behind a clip rect (= the visible frame), print shadows are
//               the software's own filter recipe, text is an Adobe TLF
//               TextFlow in ws:textData, translucent boxes are Saal "shape"
//               rects with a rounded-rect mask. Verified by round-tripping
//               through the real software.
//   "preview" - the same SVG for a browser: thumbnails instead of embedded
//               files, text drawn with <foreignObject> in the same font.
//
// `resolveImage(photo)` -> { href, imageID, width, height, uid, fileName }
// (width/height = pixel size of the image file the href points to).

const NS =
  'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ws="http://www.saal-digital.de/photoProductOrderSoftware" xmlns:wsBorderStyle="http://www.saal-digital.de/photoProductOrderSoftwareBorderStyle" xmlns:wsMaskStyle="http://www.saal-digital.de/photoProductOrderSoftwareMaskStyle" xmlns:ImSo="http://www.imagingsolutions.ch/ImSo"';

// Saal ids look like uppercase UUIDs; derive them deterministically so
// re-exporting the same story produces the same project structure.
export function saalUid(...parts) {
  const h = createHash("md5").update(parts.join("|")).digest("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const n = (v) => (Math.round(v * 1e6) / 1e6).toString();

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shadowFilter(id) {
  return `<filter x="-10" y="-10" width="40" height="40" id="filter_${id}">
      <feOffset dx="17.67767" dy="17.67767" in="SourceAlpha" result="r2"/>
      <feFlood flood-color="#000000" flood-opacity="0.75"/>
      <feComposite in2="r2" operator="in"/>
      <feGaussianBlur stdDeviation="28.5"/>
      <feComposite in="SourceGraphic" operator="over"/>
    </filter>`;
}

// Photo placed to cover its frame (centered crop), as Saal stores it.
function placeImage(frame, pxW, pxH) {
  const s = Math.max(frame.w / pxW, frame.h / pxH);
  const w = pxW * s;
  const h = pxH * s;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h, s };
}

// Saal has exactly one background slot per spread (always clipped to the
// whole canvas) - flagging a page-sized photo as background makes Saal
// stretch it across both pages. So only photos that really cover the whole
// canvas get the flag; page-sized ones are ordinary images.
function coversCanvas(f, size) {
  return f.x <= 1 && f.y <= 1 && f.x + f.w >= size.w - 1 && f.y + f.h >= size.h - 1;
}

function imageSvg(el, id, ref, mode, defs, size) {
  const f = el.frame;
  const inBackground = el.background && coversCanvas(f, size);
  defs.push(`<clipPath id="clip_${id}">
      <rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}"/>
    </clipPath>`);
  if (el.shadow) defs.push(shadowFilter(id));
  const p = placeImage(f, ref.width, ref.height);
  const rot = el.rotation ? ` transform="rotate(${n(el.rotation)}, ${n(f.x)}, ${n(f.y)})"` : "";
  const attrs =
    mode === "saal"
      ? ` ws:imageID="${ref.imageID}" ws:imageWidth="${ref.width}" ws:imageHeight="${ref.height}" xlink:href="${xmlEscape(ref.href)}" ws:enhance="0" ImSo:autoenhance="0" ws:baseURL="${xmlEscape(ref.fileName)}"${el.shadow ? ' ws:filterType="shadow"' : ""} ws:imageUID="${ref.uid}"${inBackground ? ' ws:inBackground="1"' : ""} ws:initalContentScaleX="${n(p.s)}" ws:initalContentScaleY="${n(p.s)}"`
      : ` xlink:href="${xmlEscape(ref.href)}" preserveAspectRatio="none"`;
  const tag = `<image ws:uid="${id}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}"${attrs}${rot} clip-path="url(#clip_${id})"/>`;
  return el.shadow ? `<g filter="url(#filter_${id})">\n      ${tag}\n    </g>` : tag;
}

function tlf(paragraphs) {
  const ps = paragraphs
    .map((p) => {
      const font = (p.font || fontInfo()).saal;
      return `<p color="${p.color}" fontFamily="${xmlEscape(font)}" fontSize="${p.size}" fontStyle="normal" fontWeight="normal" lineBreak="toFit" lineHeight="120%" textAlign="${p.align === "right" ? "end" : p.align === "center" ? "center" : "start"}" textAlpha="1" textDecoration="none" verticalAlign="top"><span>${xmlEscape(p.text)}</span></p>`;
    })
    .join("");
  return `<TextFlow verticalAlign="top" whiteSpaceCollapse="preserve" version="3.0.0" xmlns="http://ns.adobe.com/textLayout/2008">${ps}</TextFlow>`;
}

function textSvg(el, id, mode) {
  const f = el.frame;
  const rot = el.rotation ? ` transform="rotate(${n(el.rotation)}, ${n(f.x)}, ${n(f.y)})"` : "";
  if (mode === "saal") {
    const m = SAAL_TEXT_MARGIN;
    const box = { x: f.x - m, y: f.y - m, w: f.w + 2 * m, h: f.h + 2 * m };
    const saalRot = el.rotation ? ` transform="rotate(${n(el.rotation)}, ${n(box.x)}, ${n(box.y)})"` : "";
    return `<image ws:uid="${id}" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" ws:modificationTime="0"${saalRot} xlink:href="${id}.png" ImSo:autoenhance="0" ws:textData="${xmlEscape(tlf(el.paragraphs))}" ws:overflow="100" ws:textAreaMode="1"/>`;
  }
  // Same metrics as Saal (see spreadLayouts.js): em size, line pitch, no
  // paragraph spacing.
  const html = el.paragraphs
    .map((p) => {
      const font = p.font || fontInfo();
      // Saal's own font file when extracted locally (@font-face "SB-<key>",
      // see bookPreview.js), the Google Fonts version otherwise.
      const generic = font.kind === "serif" ? "serif" : font.kind === "mono" ? "monospace" : "cursive";
      const family = `'SB-${font.key}', '${font.name}', ${generic}`;
      return `<p style="margin:0;font-family:${xmlEscape(family)};font-size:${n(p.size * SAAL_EM)}px;line-height:${n(p.size * SAAL_LINE)}px;color:${p.color};text-align:${p.align};white-space:pre-wrap">${xmlEscape(p.text)}</p>`;
    })
    .join("");
  return `<foreignObject x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}"${rot}><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;overflow:hidden">${html}</div></foreignObject>`;
}

function roundedRectPath(x, y, w, h, r) {
  return `M${n(x + w)} ${n(y + h - r)} c0 ${n(r * 0.552)} ${n(-r * 0.448)} ${n(r)} ${n(-r)} ${n(r)} H${n(x + r)} c${n(-r * 0.552)} 0 ${n(-r)} ${n(-r * 0.448)} ${n(-r)} ${n(-r)} V${n(y + r)} C${n(x)} ${n(y + r * 0.448)} ${n(x + r * 0.448)} ${n(y)} ${n(x + r)} ${n(y)} h${n(w - 2 * r)} c${n(r * 0.552)} 0 ${n(r)} ${n(r * 0.448)} ${n(r)} ${n(r)} V${n(y + h - r)} Z`;
}

function panelSvg(el, id, mode, defs) {
  const f = el.frame;
  if (!el.opacity) return "";
  if (mode !== "saal") {
    return `<rect x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}" rx="8" style="fill:${el.color}" opacity="${el.opacity}"/>`;
  }
  const r = 8;
  defs.push(`<mask id="mask_${id}">
      <g>
        <path d="${roundedRectPath(f.x, f.y, f.w, f.h, r)}" fill="#ffffff"/>
      </g>
    </mask>`);
  const colorInt = parseInt(el.color.replace("#", ""), 16);
  return `<g>
      <rect ws:uid="${id}" x="${n(f.x)}" y="${n(f.y)}" width="${n(f.w)}" height="${n(f.h)}" ws:modificationTime="0" opacity="${el.opacity}" ws:borderClass="com.saalGroup.skins.borders::RectBorderSkin" ws:borderAlpha="0" wsBorderStyle:borderColor="${colorInt}" wsBorderStyle:borderThickness="0" wsBorderStyle:radius="${r}" ws:maskClass="com.saalGroup.skins.masks::RoundedRectMaskSkin" wsMaskStyle:radius="${r}" mask="url(#mask_${id})" ws:color="${colorInt}" style="fill:${el.color}" ws:fillMode="0"/>
    </g>`;
}

// `key` makes element ids unique and stable per spread.
export function renderSpreadSvg(spread, size, { mode, resolveImage, key, isCover = false }) {
  const defs = [];
  const body = [];
  spread.elements.forEach((el, i) => {
    const id = saalUid(key, i, el.kind, el.photo?.id || "");
    if (el.kind === "image") {
      const ref = resolveImage(el.photo);
      if (ref) body.push(imageSvg(el, id, ref, mode, defs, size));
    } else if (el.kind === "text") {
      body.push(textSvg(el, id, mode));
    } else if (el.kind === "panel") {
      const s = panelSvg(el, id, mode, defs);
      if (s) body.push(s);
    }
  });
  const coverAttrs = isCover ? ` ws:pageType="cover" ws:lastCheckTimestamp="${Date.now()}"` : "";
  const dims =
    mode === "saal"
      ? `width="${size.w / 10}mm" height="${size.h / 10}mm"`
      : `width="100%" style="display:block;aspect-ratio:${size.w}/${size.h};height:auto"`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" viewBox="0 0 ${size.w} ${size.h}" ${dims} preserveAspectRatio="none"${coverAttrs} ${NS}>
  ${defs.length ? `<defs>\n    ${defs.join("\n    ")}\n  </defs>` : "<defs/>"}
  <g>
    <rect x="0" y="0" width="${size.w}" height="${size.h}" style="fill:${spread.paper || "#ffffff"}"/>
    ${body.join("\n    ")}
  </g>
</svg>`;
}
