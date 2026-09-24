import sharp from "sharp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOriginalBuffer, fetchThumbBuffer } from "../photoprism.js";

// Helpers shared by the vendor project writers (saalExport.js,
// ceweExport.js).
//
// Photos: the original file is fetched from PhotoPrism, auto-oriented and
// downscaled to what the print needs - backgrounds that span a spread keep
// up to 6000 px on the long edge (Saal flags 2048 px backgrounds as only
// "gut"), prints up to 3400 px - then re-encoded as JPEG. Formats sharp
// can't decode (HEIC) fall back to PhotoPrism's 2048 px JPEG.

export const EXPORT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../data/book-exports");
const BG_MAX = 6000;
const CARD_MAX = 3400;
const CONCURRENCY = 4;

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

export const photoKey = (photo) => photo.hash || photo.id;

// Every photo the book uses, prepared once. `onPhoto(key, photo, img)` is
// awaited in completion order, so writers can stream files into their
// container without holding every photo in memory.
export async function preparePhotos(plan, job, onPhoto) {
  const needed = new Map();
  [plan.cover, ...plan.spreads].forEach((s) =>
    s.elements.forEach((el) => {
      if (el.kind !== "image" || !el.photo) return;
      const key = photoKey(el.photo);
      const max = el.background ? BG_MAX : CARD_MAX;
      const prev = needed.get(key);
      needed.set(key, { photo: el.photo, max: Math.max(prev?.max || 0, max) });
    })
  );
  job.total = needed.size;
  job.stage = "photos";
  let writing = Promise.resolve();
  await mapLimit([...needed.entries()], CONCURRENCY, async ([key, { photo, max }]) => {
    const img = await prepareImage(photo, max);
    writing = writing.then(() => onPhoto(key, photo, img));
    await writing;
    job.done++;
  });
}

export function safeFileName(s) {
  return (String(s || "Photobook").replace(/[^\w äöüÄÖÜßåÅæÆøØ.-]/g, "").trim() || "Photobook").slice(0, 80);
}
