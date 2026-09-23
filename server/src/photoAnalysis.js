import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

// What matters in a photo, for deciding where a layout may cover it and how
// to crop it. Combines:
//   - objects: NanoDet-Plus (COCO classes) - people also when seen from
//     behind, animals, vehicles, boats, ...
//   - saliency: frequency-tuned saliency (Achanta et al. 2009) - distance of
//     each blurred pixel's Lab color from the image mean; lights up things
//     like a setting sun or a red jacket on grey rock
//   - faces are passed in (PhotoPrism markers or YuNet) and weigh most,
//     together with the body below them
// into an importance grid (GRID x GRID cells over the image, 0..255).

export const GRID = 24;
const MODEL = fileURLToPath(new URL("../models/object_detection_nanodet_2022nov.onnx", import.meta.url));
const IN = 416;
const STRIDES = [8, 16, 32];
const OUTPUTS = [
  ["792", "795"],
  ["814", "817"],
  ["836", "839"],
];
const REG_MAX = 7;
const MEAN = [103.53, 116.28, 123.675];
const STD = [57.375, 57.12, 58.395];
const COCO = "person bicycle car motorcycle airplane bus train truck boat traffic_light fire_hydrant stop_sign parking_meter bench bird cat dog horse sheep cow elephant bear zebra giraffe backpack umbrella handbag tie suitcase frisbee skis snowboard sports_ball kite baseball_bat baseball_glove skateboard surfboard tennis_racket bottle wine_glass cup fork knife spoon bowl banana apple sandwich orange broccoli carrot hot_dog pizza donut cake chair couch potted_plant bed dining_table toilet tv laptop mouse remote keyboard cell_phone microwave oven toaster sink refrigerator book clock vase scissors teddy_bear hair_drier toothbrush".split(" ");
// How much a detected object matters to the picture (unlisted: 0.35).
const OBJECT_WEIGHT = { person: 0.9, dog: 0.8, cat: 0.8, horse: 0.7, bird: 0.7, sheep: 0.6, cow: 0.6, boat: 0.5, bicycle: 0.45 };

let sessionPromise = null;
function session() {
  sessionPromise ??= ort.InferenceSession.create(MODEL, { logSeverityLevel: 3 });
  return sessionPromise;
}

async function oriented(buffer) {
  const img = sharp(buffer).rotate();
  const meta = await img.clone().metadata();
  const swap = (meta.orientation || 1) >= 5;
  return { img, W: swap ? meta.height : meta.width, H: swap ? meta.width : meta.height };
}

function iou(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.w * a.h + b.w * b.h - w * h);
}

// Objects in the whole photo plus - so small people in a wide scene aren't
// missed at 416 px - in its two overlapping halves (along the long side).
export async function detectObjects(buffer, { minScore = 0.4, personScore = 0.3 } = {}) {
  const { img, W, H } = await oriented(buffer);
  const regions = [{ x: 0, y: 0, w: 1, h: 1 }];
  if (W >= H) regions.push({ x: 0, y: 0, w: 0.6, h: 1 }, { x: 0.4, y: 0, w: 0.6, h: 1 });
  else regions.push({ x: 0, y: 0, w: 1, h: 0.6 }, { x: 0, y: 0.4, w: 1, h: 0.6 });
  const all = [];
  for (const r of regions) {
    const part = img.clone().extract({
      left: Math.round(r.x * W),
      top: Math.round(r.y * H),
      width: Math.round(r.w * W),
      height: Math.round(r.h * H),
    });
    const found = await detectIn(part, Math.round(r.w * W), Math.round(r.h * H), Math.min(minScore, personScore));
    for (const f of found) {
      if (f.score < (f.label === "person" ? personScore : minScore)) continue;
      all.push({ ...f, x: r.x + f.x * r.w, y: r.y + f.y * r.h, w: f.w * r.w, h: f.h * r.h });
    }
  }
  all.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of all) if (!kept.some((k) => k.label === f.label && (iou(k, f) > 0.4 || contains(k, f)))) kept.push(f);
  return kept.map((f) => ({ ...f, score: Math.round(f.score * 100) / 100 }));
}

function contains(a, b) {
  return b.x >= a.x - 0.01 && b.y >= a.y - 0.01 && b.x + b.w <= a.x + a.w + 0.01 && b.y + b.h <= a.y + a.h + 0.01;
}

async function detectIn(img, W, H, minScore) {
  const scale = IN / Math.max(W, H);
  const rw = Math.round(W * scale);
  const rh = Math.round(H * scale);
  const { data } = await img
    .clone()
    .resize({ width: rw, height: rh })
    .extend({ right: IN - rw, bottom: IN - rh, background: "#000" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const input = new Float32Array(3 * IN * IN);
  for (let i = 0; i < IN * IN; i++) {
    // BGR, normalized like the reference implementation
    for (let c = 0; c < 3; c++) input[c * IN * IN + i] = (data[i * 3 + (2 - c)] - MEAN[c]) / STD[c];
  }
  const s = await session();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, IN, IN]) });
  const found = [];
  STRIDES.forEach((stride, level) => {
    const cls = out[OUTPUTS[level][0]].data;
    const reg = out[OUTPUTS[level][1]].data;
    const fw = IN / stride;
    const n = cls.length / 80;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let label = 0;
      for (let c = 0; c < 80; c++) {
        const v = cls[i * 80 + c];
        if (v > best) {
          best = v;
          label = c;
        }
      }
      if (best < minScore) continue;
      // Distribution focal loss: each side is the expectation over 8 bins.
      const d = [0, 0, 0, 0].map((_, side) => {
        let sum = 0;
        let acc = 0;
        for (let k = 0; k <= REG_MAX; k++) {
          const e = Math.exp(reg[i * 32 + side * 8 + k]);
          sum += e;
          acc += e * k;
        }
        return (acc / sum) * stride;
      });
      const cx = (i % fw) * stride + 0.5 * (stride - 1);
      const cy = Math.floor(i / fw) * stride + 0.5 * (stride - 1);
      const x1 = Math.max(0, cx - d[0]);
      const y1 = Math.max(0, cy - d[1]);
      const x2 = Math.min(rw, cx + d[2]);
      const y2 = Math.min(rh, cy + d[3]);
      if (x2 <= x1 || y2 <= y1) continue;
      found.push({ x: x1 / rw, y: y1 / rh, w: (x2 - x1) / rw, h: (y2 - y1) / rh, label: COCO[label], score: best });
    }
  });
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of found) if (!kept.some((k) => k.label === f.label && iou(k, f) > 0.6)) kept.push(f);
  return kept;
}

// Frequency-tuned saliency on a small, slightly blurred Lab image, averaged
// into the importance grid and normalized to 0..1.
export async function saliencyGrid(buffer) {
  const { img } = await oriented(buffer);
  const S = GRID * 4;
  const { data } = await img
    .clone()
    .resize({ width: S, height: S, fit: "fill" })
    .blur(1.2)
    .toColourspace("lab")
    .raw({ depth: "float" })
    .toBuffer({ resolveWithObject: true });
  const px = S * S;
  const lab = new Float32Array(data.buffer, data.byteOffset, data.length / 4);
  const ch = lab.length / px;
  const mean = [0, 0, 0];
  for (let i = 0; i < px; i++) for (let c = 0; c < 3; c++) mean[c] += lab[i * ch + c] / px;
  // Color distinctness counts double: a red jacket on grey rock should stand
  // out as much as a bright sun in a dark sky.
  const weight = [1, 2, 2];
  const sal = new Float32Array(px);
  let max = 0;
  for (let i = 0; i < px; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += (weight[c] * (lab[i * ch + c] - mean[c])) ** 2;
    sal[i] = Math.sqrt(d);
    max = Math.max(max, sal[i]);
  }
  const grid = new Float32Array(GRID * GRID);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) grid[Math.floor(y / 4) * GRID + Math.floor(x / 4)] += sal[y * S + x] / 16;
  return grid.map((v) => (max ? v / max : 0));
}

// Importance grid (Uint8 0..255, row-major GRID x GRID) from faces, objects
// and saliency. Faces count with the body below them.
export function importanceGrid({ faces = [], objects = [], saliency }) {
  const g = new Float32Array(GRID * GRID);
  if (saliency) {
    // Relative to the photo's own typical level: what stands out from the
    // rest of *this* picture (the sun in a dusk sky, a jacket on rock).
    const med = [...saliency].sort((a, b) => a - b)[Math.floor(saliency.length / 2)];
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, (saliency[i] - med) / Math.max(0.15, 1 - med)) ** 1.5 * 0.7;
  }
  const paint = (box, w) => {
    const x0 = Math.max(0, Math.floor(box.x * GRID));
    const y0 = Math.max(0, Math.floor(box.y * GRID));
    const x1 = Math.min(GRID - 1, Math.floor((box.x + box.w) * GRID));
    const y1 = Math.min(GRID - 1, Math.floor((box.y + box.h) * GRID));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * GRID + x] = Math.max(g[y * GRID + x], w);
  };
  for (const o of objects) paint(o, (OBJECT_WEIGHT[o.label] ?? 0.35) * Math.min(1, o.score + 0.3));
  for (const f of faces) {
    paint({ x: f.x - f.w * 0.9, y: f.y + f.h, w: f.w * 2.8, h: f.h * 4 }, 0.7); // shoulders/body
    paint({ x: f.x - f.w * 0.25, y: f.y - f.h * 0.35, w: f.w * 1.5, h: f.h * 1.6 }, 1); // head
  }
  return Array.from(g, (v) => Math.round(Math.min(1, v) * 255));
}
