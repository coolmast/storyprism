import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { planBook } from "./bookPlanner.js";
import { vendorOf } from "./products.js";
import { getStrings } from "../i18n.js";
import { runSaalExport } from "./saalExport.js";
import { runCeweExport } from "./ceweExport.js";
import { EXPORT_DIR } from "./exportShared.js";

// Photobook export jobs: plan the book once, then hand it to the vendor's
// project writer (Saal .sswprm, CEWE .mcfx) picked by the chosen product.

const RUNNERS = { saal: runSaalExport, cewe: runCeweExport };
const jobs = new Map();

export function getBookJob(id) {
  return jobs.get(id) || null;
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
      `The book needs ${plan.contentPages} pages; the largest page count known for ${plan.product.label} is ${plan.numPages}. Condense some spreads or remove photos.`
    );
  }
  await RUNNERS[vendorOf(plan.product)](job, story, plan);
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
