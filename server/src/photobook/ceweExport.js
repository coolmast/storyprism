import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { stat, unlink } from "node:fs/promises";
import Database from "better-sqlite3";
import sharp from "sharp";
import { placePhoto, SAAL_EM, SAAL_LINE } from "./spreadLayouts.js";
import { ceweCoverBox } from "./products.js";
import { EXPORT_DIR, preparePhotos, photoKey, safeFileName } from "./exportShared.js";

// Builds a CEWE FOTOWELT project (.mcfx) from a planned book. Open it in the
// CEWE software (double-click / Datei -> Öffnen); everything stays editable.
//
// Format (see README "CEWE project format"): an SQLite database with one
// table Files(Filename, Data, LastModified), holding `data.mcf` - the
// project XML - and every photo as its own entry, referenced from the XML
// as "safecontainer:/<Filename>". Geometry is in 0.1 mm like the planner's;
// each area is an absolute box on its spread (or on the whole cover sheet)
// with the origin at the trimmed top-left corner, so the planner's canvas
// (which includes the bleed) is shifted by the bleed. CEWE keeps all of a
// spread's areas on the page element of its *left* page; the right page's
// element stays empty.

const APPLICATION_ID = 1128617797; // "CEWE"
const HPS_VERSION = "8.1.3";
const HPS_BUILD = "20260410";

// CEWE stores font sizes in typographic points; the planner's size unit is
// Saal's (4.15 units of 0.1 mm em size, see spreadLayouts.js).
const PT_PER_SIZE = SAAL_EM / 3.5278;

const n = (v) => String(Math.round(v * 1000) / 1000);

function xmlAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const htmlText = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

// The planner rotates a frame around its top-left corner (as Saal does);
// CEWE rotates an area around its center. Same visual result: keep the size,
// move the box to where the rotated frame's center ended up.
function areaBox(frame, rotation, dx, dy) {
  const x = frame.x - dx;
  const y = frame.y - dy;
  if (!rotation) return { left: x, top: y, width: frame.w, height: frame.h, rotation: 0 };
  const a = (rotation * Math.PI) / 180;
  const cx = x + (frame.w / 2) * Math.cos(a) - (frame.h / 2) * Math.sin(a);
  const cy = y + (frame.w / 2) * Math.sin(a) + (frame.h / 2) * Math.cos(a);
  return {
    left: cx - frame.w / 2,
    top: cy - frame.h / 2,
    width: frame.w,
    height: frame.h,
    rotation: ((rotation % 360) + 360) % 360,
  };
}

const position = (b, z) =>
  `<position height="${n(b.height)}" left="${n(b.left)}" rotation="${n(b.rotation)}" top="${n(b.top)}" width="${n(b.width)}" zposition="${z}"/>`;

// CEWE's own drop-shadow preset (as written by the software).
const SHADOW =
  '<shadow shadowAngle="135" shadowBlurNew="5" shadowDistance="50" shadowEnabled="1" shadowIntensity="128" shadowWidthInMM="4"/>';

function imageArea(el, ref, dx, dy, z) {
  const box = areaBox(el.frame, el.rotation, dx, dy);
  const p = placePhoto(el.frame, ref.width, ref.height, el.focus);
  return `        <area areatype="imagearea">
            ${position(box, z)}
            ${el.shadow ? `<decoration>${SHADOW}</decoration>` : "<decoration/>"}
            <image filename="safecontainer:/${xmlAttr(ref.name)}" useABK="1">
                <cutout left="${n(p.x - el.frame.x)}" scale="${(Math.round(p.s * 1e6) / 1e6).toString()}" top="${n(p.y - el.frame.y)}"/>
            </image>
        </area>
`;
}

// The planner already plans CEWE books with CEWE's own fonts (fontInfo in
// spreadLayouts.js), measured from the real font files - so text is written
// in exactly the font it was sized for.
const fontName = (font) => font?.name || "CEWE Head";

// Planned line pitch is 1.2 em; CEWE's proportional line height is relative
// to the font's natural line spacing (hhea ascent + descent + gap), which
// differs per font (Hoefler Text 1.0 em, Apple Chancery 1.58 em).
const lineHeightPct = (font) => Math.round((1.2 / (font?.lineSpacing || 1.2)) * 100);

const alignOf = (a) => (a === "center" ? "center" : a === "right" ? "right" : "left");

// Qt rich text, the dialect CEWE stores (and edits) text in. One <p> per
// planner paragraph, each with its own font, size, color and alignment.
function qtHtml(paragraphs) {
  const ps = paragraphs
    .map((p) => {
      const font = fontName(p.font);
      const pt = Math.round(p.size * PT_PER_SIZE * 10) / 10;
      return `<p align="${alignOf(p.align)}" style=" margin-top:0px; margin-bottom:0px; margin-left:0px; margin-right:0px; -qt-block-indent:0; text-indent:0px; line-height:${lineHeightPct(p.font)}%; -qt-line-height-type:proportional-height;"><span style=" font-family:'${font}'; font-size:${pt}pt; font-weight:${p.bold ? 700 : 400}; font-style:${p.italic ? "italic" : "normal"}; color:${p.color || "#000000"};">${htmlText(p.text)}</span></p>`;
    })
    .join("");
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd"><html><head><meta name="qrichtext" content="1" /><meta charset="utf-8" /><style type="text/css">p, li { white-space: pre-wrap; }</style></head><body style=" font-family:'CEWE Head'; font-size:12pt; font-weight:400; font-style:normal;">${ps}</body></html>`;
}

function textArea(el, dx, dy, z) {
  if (!el.paragraphs?.length) return "";
  // Small bottom margin (transparent, top-aligned box) so rounding in CEWE's
  // own text layout never clips the last planned line.
  const first = el.paragraphs[0];
  const frame = { ...el.frame, h: el.frame.h + first.size * SAAL_LINE * 0.3 };
  const box = areaBox(frame, el.rotation, dx, dy);
  const font = fontName(first.font);
  const pt = Math.round(first.size * PT_PER_SIZE);
  return `        <area areatype="textarea">
            ${position(box, z)}
            <decoration/>
            <text applySpotColor="0" areaTextType="content">${cdata(qtHtml(el.paragraphs))}<outline width="0"/>
                <textFormat Alignment="ALIGN${alignOf(first.align).toUpperCase()},ALIGNTOP" IndentMargin="0" VerticalIndentMargin="0" backgroundColor="#00000000" font="${xmlAttr(font)},${pt},-1,5,${first.bold ? 700 : 400},${first.italic ? 1 : 0},0,0,0,0,0,1,0,0,0,1" foregroundColor="#ff000000" hasOutline="0" hyphenation="0" letterSpacing="0" lineHeight="100"/>
            </text>
        </area>
`;
}

// Translucent boxes: CEWE itself stores transparency baked into a PNG's
// alpha channel (an image area whose file is RGBA), so a panel is a
// solid-color RGBA PNG covering its frame - sized at 150 dpi, since CEWE's
// print-quality check flags a smaller image as too low-resolution even
// though it's a flat color.
const PANEL_DPI = 150;
async function panelImage(color, opacity, frame) {
  const hex = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const px = (v) => Math.max(8, Math.min(8000, Math.ceil((v / 254) * PANEL_DPI)));
  const width = px(frame.w);
  const height = px(frame.h);
  const data = await sharp({ create: { width, height, channels: 4, background: { r, g, b, alpha: opacity } } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { data, width, height };
}

function panelArea(el, ref, dx, dy, z) {
  const box = areaBox(el.frame, el.rotation, dx, dy);
  const s = Math.max(el.frame.w / ref.width, el.frame.h / ref.height);
  return `        <area areatype="imagearea">
            ${position(box, z)}
            <decoration/>
            <image filename="safecontainer:/${xmlAttr(ref.name)}" useABK="1">
                <cutout left="0" scale="${(Math.round(s * 1e6) / 1e6).toString()}" top="0"/>
            </image>
        </area>
`;
}

const pageXml = (attrs, size, alignment, areas = "") => `    <page ${attrs} rotation="0">
        <bundlesize height="${n(size.h)}" width="${n(size.w)}"/>
        <designElementIDs background="201"/>
        <background alignment="${alignment}" designElementId="201" rotation="0" type="1"/>
${areas}    </page>
`;

export async function runCeweExport(job, story, plan) {
  const product = plan.product;
  const outPath = join(EXPORT_DIR, `${job.id}.mcfx`);
  await unlink(outPath).catch(() => {});
  const db = new Database(outPath);
  db.pragma(`application_id = ${APPLICATION_ID}`);
  db.exec("CREATE TABLE Files(Filename TEXT PRIMARY KEY,Data BLOB,LastModified INTEGER)");
  const insert = db.prepare("INSERT OR REPLACE INTO Files VALUES (?,?,?)");
  const now = Date.now();

  try {
    // Photos, named the way CEWE names its own copies: <8 chars>_1_<name>.
    const refs = new Map();
    await preparePhotos(plan, job, async (key, photo, img) => {
      const id = createHash("md5").update(`storybuilder:${key}`).digest("hex").slice(0, 8);
      const name = `${id}_1_${photo.photoUid || key}.jpg`;
      refs.set(key, { name, width: img.width, height: img.height, original: `${photo.photoUid || key}.jpg` });
      insert.run(name, img.data, now);
    });

    job.stage = "layout";
    const panels = new Map();
    const panelRef = async (color, opacity, frame) => {
      const key = `${color}-${opacity}-${Math.round(frame.w)}x${Math.round(frame.h)}`;
      if (!panels.has(key)) {
        const img = await panelImage(color, opacity, frame);
        const name = `panel_${color.replace("#", "")}_${Math.round(opacity * 100)}_${img.width}x${img.height}.png`;
        insert.run(name, img.data, now);
        panels.set(key, { name, width: img.width, height: img.height });
      }
      return panels.get(key);
    };

    const areasFor = async (spread, canvas, dx, dy) => {
      const out = [];
      let z = 100;
      if (spread.paper && spread.paper.toLowerCase() !== "#ffffff") {
        const frame = { x: 0, y: 0, w: canvas.w, h: canvas.h };
        out.push(panelArea({ frame }, await panelRef(spread.paper, 1, frame), dx, dy, z++));
      }
      for (const el of spread.elements) {
        if (el.kind === "image") {
          const ref = el.photo && refs.get(photoKey(el.photo));
          if (ref) out.push(imageArea(el, ref, dx, dy, z++));
        } else if (el.kind === "panel" && el.opacity) {
          out.push(panelArea(el, await panelRef(el.color, el.opacity, el.frame), dx, dy, z++));
        } else if (el.kind === "text") {
          out.push(textArea(el, dx, dy, z++));
        }
      }
      return out.join("");
    };

    const coverBox = ceweCoverBox(product, plan.numPages);
    const pageBox = { w: 2 * product.page.w, h: product.page.h };
    const cb = product.coverBleed;
    const spineLogo = `        <area areatype="spinelogoarea">
            <position height="91" left="${n(coverBox.w / 2 - 140)}" rotation="270" top="${n(coverBox.h - 85.5)}" width="280" zposition="6999"/>
            <decoration/>
            <clipart designElementId="0">
                <ClipartConfiguration applySpotColor="0"/>
            </clipart>
        </area>
`;

    let pages = "";
    pages += pageXml('pagenr="0" type="fullcover"', coverBox, 4, (await areasFor(plan.cover, plan.cover.size, cb, cb)) + spineLogo);
    pages += pageXml('pagenr="0" type="spine"', coverBox, 4);
    pages += pageXml('pagenr="0" type="fullcover"', coverBox, 4);
    // Inside front cover + page 1 (a single right page, left blank).
    pages += pageXml('pagenr="0" type="emptypage"', pageBox, 1);
    const bleed = product.bleed;
    for (let p = 1; p <= plan.numPages; p++) {
      // Spread j covers pages 2j+2 | 2j+3; its areas live on the left page.
      const j = (p - 2) / 2;
      const spread = p % 2 === 0 ? plan.spreads[j] : null;
      pages += pageXml(`pagenr="${p}" type="normalpage"`, pageBox, 1, spread ? await areasFor(spread, plan.spreadSize, bleed, bleed) : "");
    }
    pages += pageXml('pagenr="0" type="emptypage"', pageBox, 1);

    const folderID = randomUUID();
    const d = new Date(now);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const rels = [...refs.values()]
      .map(
        (r) => `        <foto id="file:///StoryBuilder/${xmlAttr(r.original)}">
            <foto id="safecontainer:/${xmlAttr(r.name)}" nature="RELATIONSHIP_ONE_TO_ONE_COPY"/>
        </foto>
`
      )
      .join("");
    const ids = product.ids;
    const mcf = `<?xml version="1.0" encoding="UTF-8"?>
<fotobook art_id="${ids.artId}" article_name="${encodeURIComponent(ids.articleName)}" externalProjectId="" folderID="${folderID}" imagedir="" isDataMcf="0" productname="${ids.productName}" startdatecalendarium="" useSpineLogo="1" version="4.0">
    <project createdWithHPSVersion="${HPS_VERSION}" createdWithHPSVersionBuild="${HPS_BUILD}" multiPurposeText="" projectID="${randomUUID()}" projectIDCreatedEpoch="${Math.floor(now / 1000)}"/>
    <savingVersion compatibilityVersion="6.4.2" programversion="${HPS_VERSION}" programversionBuild="${HPS_BUILD}" savetime="${stamp}"/>
    <creationHistory clientId="147" clientVersion="${HPS_VERSION}-${HPS_BUILD}-default" creationDate="${stamp}"/>
    <articleConfig normalpages="${plan.numPages}" pagenaming="1" totalpages="${plan.numPages + 5}"/>
    <addOns/>
    <pagenumbering bgcolor="#00000000" fontbold="0" fontfamily="CEWE Head" fontitalics="0" fontsize="12" format="0" margin="110" position="0" textcolor="#ff000000" textstring="%" verticalMargin="50">
        <outline width="0"/>
    </pagenumbering>
    <ruler/>
    <extra>
        <lastTextFormat Alignment="ALIGNLEFT" IndentMargin="5" VerticalIndentMargin="5" backgroundColor="#00000000" font="CEWE Head,12,-1,5,400,0,0,0,0,0,0,0,0,0,0,1" foregroundColor="#ff000000" hasOutline="0" hyphenation="0" letterSpacing="0" lineHeight="100"/>
        <imageQuality version="1.3.57"/>
    </extra>
${pages}    <userfeedback></userfeedback>
    <fotoRelationships>
${rels}    </fotoRelationships>
    <statistics assistantUsed="0" countPauses="0" elapsedTimeGross="${d.toISOString().slice(0, 19)}" elapsedTimeNet="0" fotosAdded="0" fotosRemoved="0" pauseTime="0" sessionsUsed="1"/>
</fotobook>
`;
    insert.run("data.mcf", Buffer.from(mcf, "utf8"), 0);
    insert.run(
      "folderid.xml",
      // Same shape (and fixed length) as the file CEWE writes.
      Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<mcfkey folderID="${folderID}" padding="${"a".repeat(74)}"/>\n`, "utf8"),
      now
    );
  } finally {
    db.close();
  }

  job.size = (await stat(outPath)).size;
  job.path = outPath;
  job.fileName = `${safeFileName(story.title)}.mcfx`;
}
