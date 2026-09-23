import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { planBook } from "./bookPlanner.js";
import { renderSpreadSvg, saalUid } from "./saalSvg.js";
import { createSswWriter } from "./sswContainer.js";
import { SAAL_CATEGORY_ID, SAAL_VERSION } from "./products.js";
import { fetchOriginalBuffer, fetchThumbBuffer } from "../photoprism.js";
import { getStrings } from "../i18n.js";

// Builds a Saal Design Software project (.sswprm - the software's own
// "export/share project" format, which bundles every photo) from a story.
// Open it in Saal via Projekte -> Projekt importieren; everything stays
// editable there.
//
// Photos: the original file is fetched from PhotoPrism, auto-oriented and
// downscaled to what the print needs - backgrounds that span a spread keep
// up to 6000 px on the long edge (Saal flags 2048 px backgrounds as only
// "gut"), prints up to 3400 px - then re-encoded as JPEG. Formats sharp
// can't decode (HEIC) fall back to PhotoPrism's 2048 px JPEG.

const EXPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/book-exports");
const BG_MAX = 6000;
const CARD_MAX = 3400;
const CONCURRENCY = 4;
// Where Saal keeps imported photos on the user's machine; project.xml
// records each photo's local URL there (Saal copies the bundled files into
// that folder on import). Real projects always carry this path.
const IMAGE_URL_BASE =
  process.env.SAAL_IMAGE_URL_BASE ||
  "file:///Users/Shared/SaalDesignSoftware/Local%20Store/projects/images/";

const jobs = new Map();

export function getBookJob(id) {
  return jobs.get(id) || null;
}

function xml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function imageIdFor(photo) {
  return createHash("md5").update(`storybuilder:${photo.hash || photo.id}`).digest("hex");
}

async function prepareImage(photo, maxEdge) {
  const resize = (buf) =>
    sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
      .toBuffer({ resolveWithObject: true });
  let result;
  try {
    result = await resize((await fetchOriginalBuffer(photo.hash)).buffer);
  } catch {
    // Formats sharp can't decode from the original (HEIC) fall back to
    // PhotoPrism's own 2048px JPEG rendition.
    result = await resize((await fetchThumbBuffer(photo.hash, "fit_2048")).buffer);
  }
  return { data: result.data, width: result.info.width, height: result.info.height };
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

function projectXml({ uid, coverUid, innerUid, title, product, numPages, childArticleID, images, now }) {
  const ids = product.ids;
  const d = new Date(now);
  const group = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}`;
  const common = (articleID, extra = "") => `    <name>${xml(title)}</name>
    <quantity>1</quantity>
    <creationDate>${now}</creationDate>
    <lastSaveDate>${now}</lastSaveDate>
    <articleID>${articleID}</articleID>
    <categoryID>${SAAL_CATEGORY_ID}</categoryID>
    <topicID>${SAAL_CATEGORY_ID}</topicID>${extra}
    <backgroundColor>#ffffff</backgroundColor>
    <rotated>false</rotated>
    <configuratorArticleID>${ids.configuratorArticleID}</configuratorArticleID>
    <configuratorVersion>1</configuratorVersion>`;
  const imageEntries = images
    .map(
      (img) => `      <image uid="${img.uid}">
        <url>${IMAGE_URL_BASE}${img.imageID}.jpg</url>
        <fileNameOriginal>${xml(img.fileName)}</fileNameOriginal>
        <imageID>${img.imageID}</imageID>
        <galleryImageID>${img.galleryImageID}</galleryImageID>
        <creationTime>${now}</creationTime>
        <modificationTime>${now}</modificationTime>
        <width>${img.width}</width>
        <height>${img.height}</height>
        <extension>jpg</extension>
      </image>`
    )
    .join("\n");
  return `<multiProject version="${SAAL_VERSION}" uid="${uid}">
  <name>${xml(title)}</name>
  <quantity>1</quantity>
  <creationDate>${now}</creationDate>
  <lastSaveDate>${now}</lastSaveDate>${ids.articleCategoryID ? `\n  <articleCategoryID>${ids.articleCategoryID}</articleCategoryID>` : ""}
  <categoryID>${SAAL_CATEGORY_ID}</categoryID>
  <topicID>${SAAL_CATEGORY_ID}</topicID>
  <configuratorArticleID>${ids.configuratorArticleID}</configuratorArticleID>
  <configuratorVersion>1</configuratorVersion>
  <project version="${SAAL_VERSION}" uid="${coverUid}">
${common(ids.coverArticleID)}
    <numPages>2</numPages>
  </project>
  <project version="${SAAL_VERSION}" uid="${innerUid}">
${common(ids.innerArticleID, `\n    <childArticleID>${childArticleID}</childArticleID>`)}
    <configuratorSelections>
      <configuratorSelection articleNumber="${ids.articleNumber}"/>
    </configuratorSelections>
    <numPages>${numPages}</numPages>
  </project>
  <groups>
    <group name="${group}">
${imageEntries}
    </group>
  </groups>
</multiProject>`;
}

function safeFileName(s) {
  return (String(s || "Photobook").replace(/[^\w äöüÄÖÜßåÅæÆøØ.-]/g, "").trim() || "Photobook").slice(0, 80);
}

async function cleanupOldExports() {
  try {
    const files = await readdir(EXPORT_DIR);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    await Promise.all(
      files.map(async (f) => {
        const p = join(EXPORT_DIR, f);
        if ((await stat(p)).mtimeMs < cutoff) await unlink(p);
      })
    );
  } catch {
    /* nothing to clean */
  }
}

async function runExport(job, story) {
  await mkdir(EXPORT_DIR, { recursive: true });
  await cleanupOldExports();
  const plan = planBook(story, { strings: getStrings(story.contentLanguage) });
  if (plan.overflow) {
    throw new Error(
      `The book needs ${plan.contentPages} pages; the largest page count Saal is known to accept for ${plan.product.label} is ${plan.numPages}. Condense some spreads or remove photos.`
    );
  }
  const allSpreads = [plan.cover, ...plan.spreads];

  // Every photo the book uses, with the largest size any use needs.
  const needed = new Map();
  allSpreads.forEach((s) =>
    s.elements.forEach((el) => {
      if (el.kind !== "image" || !el.photo) return;
      const key = el.photo.hash || el.photo.id;
      const max = el.background ? BG_MAX : CARD_MAX;
      const prev = needed.get(key);
      needed.set(key, { photo: el.photo, max: Math.max(prev?.max || 0, max) });
    })
  );

  job.total = needed.size;
  job.stage = "photos";
  const uid = saalUid("project", story.id, Date.now());
  const coverUid = saalUid("cover", uid);
  const innerUid = saalUid("inner", uid);
  const outPath = join(EXPORT_DIR, `${job.id}.sswprm`);
  const writer = await createSswWriter(outPath);

  // Photos are written as soon as they're ready - the archive order doesn't
  // matter to Saal, and it keeps memory flat.
  const refs = new Map();
  let writing = Promise.resolve();
  await mapLimit([...needed.entries()], CONCURRENCY, async ([key, { photo, max }]) => {
    const img = await prepareImage(photo, max);
    const imageID = imageIdFor(photo);
    refs.set(key, {
      imageID,
      width: img.width,
      height: img.height,
      href: `../images/${imageID}.jpg`,
      uid: saalUid("image", imageID),
      galleryImageID: randomUUID(),
      fileName: `${photo.photoUid || key}.jpg`,
    });
    writing = writing.then(() => writer.add(`images/${imageID}.jpg`, img.data));
    await writing;
    job.done++;
  });

  job.stage = "layout";
  const now = Date.now();
  await writer.add(
    "project.xml",
    projectXml({
      uid,
      coverUid,
      innerUid,
      title: story.title,
      product: plan.product,
      numPages: plan.numPages,
      childArticleID: plan.childArticleID,
      images: [...refs.values()],
      now,
    })
  );

  const resolveImage = (photo) => (photo ? refs.get(photo.hash || photo.id) || null : null);
  const coverThumbPhoto = plan.cover.elements.find((e) => e.kind === "image" && e.background)?.photo;
  if (coverThumbPhoto) {
    const thumb = await sharp((await fetchThumbBuffer(coverThumbPhoto.hash, "fit_720")).buffer)
      .resize({ width: 400 })
      .png()
      .toBuffer();
    await writer.add("thumbnail.png", thumb);
  }
  await writer.add(
    `${coverUid}/0.svg`,
    renderSpreadSvg(plan.cover, plan.cover.size, { mode: "saal", resolveImage, key: `${uid}-cover`, isCover: true })
  );
  for (let i = 0; i < plan.spreads.length; i++) {
    await writer.add(
      `${innerUid}/${String(i * 2).padStart(2, "0")}.svg`,
      renderSpreadSvg(plan.spreads[i], plan.spreadSize, { mode: "saal", resolveImage, key: `${uid}-${i}` })
    );
  }
  job.size = await writer.close();
  job.path = outPath;
  job.fileName = `${safeFileName(story.title)}.sswprm`;
  job.numPages = plan.numPages;
  job.stage = "done";
  job.status = "done";
}

export function startBookExport(story) {
  const job = {
    id: randomUUID(),
    storyId: story.id,
    status: "running",
    stage: "planning",
    done: 0,
    total: 0,
    startedAt: Date.now(),
  };
  jobs.set(job.id, job);
  runExport(job, story).catch((err) => {
    console.error("Book export failed:", err);
    job.status = "error";
    job.error = err.message;
  });
  return job;
}
