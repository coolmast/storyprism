import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { renderSpreadSvg, saalUid } from "./saalSvg.js";
import { createSswWriter } from "./sswContainer.js";
import { SAAL_CATEGORY_ID, SAAL_VERSION } from "./products.js";
import { fetchThumbBuffer } from "../photoprism.js";
import { EXPORT_DIR, preparePhotos, photoKey, safeFileName } from "./exportShared.js";

// Builds a Saal Design Software project (.sswprm - the software's own
// "export/share project" format, which bundles every photo) from a planned
// book. Open it in Saal via Projekte -> Projekt importieren; everything stays
// editable there.

// Where Saal keeps imported photos on the user's machine; project.xml
// records each photo's local URL there (Saal copies the bundled files into
// that folder on import). Real projects always carry this path.
const IMAGE_URL_BASE =
  process.env.SAAL_IMAGE_URL_BASE ||
  "file:///Users/Shared/SaalDesignSoftware/Local%20Store/projects/images/";

function xml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function imageIdFor(photo) {
  return createHash("md5").update(`storybuilder:${photo.hash || photo.id}`).digest("hex");
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

export async function runSaalExport(job, story, plan) {
  const uid = saalUid("project", story.id, Date.now());
  const coverUid = saalUid("cover", uid);
  const innerUid = saalUid("inner", uid);
  const outPath = join(EXPORT_DIR, `${job.id}.sswprm`);
  const writer = await createSswWriter(outPath);

  // Photos are written as soon as they're ready - the archive order doesn't
  // matter to Saal, and it keeps memory flat.
  const refs = new Map();
  await preparePhotos(plan, job, async (key, photo, img) => {
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
    await writer.add(`images/${imageID}.jpg`, img.data);
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

  const resolveImage = (photo) => (photo ? refs.get(photoKey(photo)) || null : null);
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
}
