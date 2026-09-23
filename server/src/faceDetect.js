import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as ort from "onnxruntime-node";

// Face detection for photos PhotoPrism has no face markers for (its face
// recognition misses many: profiles, small or partly covered faces, babies).
// YuNet (OpenCV model zoo) via onnxruntime; decoding follows OpenCV's
// FaceDetectorYN. Returns boxes relative to the (auto-oriented) image.
const MODEL = fileURLToPath(new URL("../models/face_detection_yunet_2023mar.onnx", import.meta.url));
const SIZE = 640;
const STRIDES = [8, 16, 32];
const SCORE_MIN = 0.6;
const NMS_IOU = 0.3;

let sessionPromise = null;
function session() {
  sessionPromise ??= ort.InferenceSession.create(MODEL);
  return sessionPromise;
}

function iou(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.w * b.h - i);
}

export async function detectFaces(imageBuffer) {
  // Letterbox into 640x640 (top-left), planar BGR float 0..255.
  const img = sharp(imageBuffer).rotate();
  const meta = await img.clone().metadata();
  const oriented = (meta.orientation || 1) >= 5;
  const W = oriented ? meta.height : meta.width;
  const H = oriented ? meta.width : meta.height;
  const scale = SIZE / Math.max(W, H);
  const { data } = await img
    .resize({ width: Math.round(W * scale), height: Math.round(H * scale) })
    .extend({ right: SIZE - Math.round(W * scale), bottom: SIZE - Math.round(H * scale), background: "#000" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const input = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    input[i] = data[i * 3 + 2]; // B
    input[SIZE * SIZE + i] = data[i * 3 + 1]; // G
    input[2 * SIZE * SIZE + i] = data[i * 3]; // R
  }
  const s = await session();
  const out = await s.run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });

  const found = [];
  for (const stride of STRIDES) {
    const cls = out[`cls_${stride}`].data;
    const obj = out[`obj_${stride}`].data;
    const bbox = out[`bbox_${stride}`].data;
    const cols = SIZE / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < SCORE_MIN) continue;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const cx = (col + bbox[i * 4]) * stride;
      const cy = (row + bbox[i * 4 + 1]) * stride;
      const w = Math.exp(bbox[i * 4 + 2]) * stride;
      const h = Math.exp(bbox[i * 4 + 3]) * stride;
      found.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of found) if (!kept.some((k) => iou(k, f) > NMS_IOU)) kept.push(f);
  const iw = W * scale;
  const ih = H * scale;
  return kept.map((f) => ({
    x: Math.max(0, f.x / iw),
    y: Math.max(0, f.y / ih),
    w: Math.min(1, f.w / iw),
    h: Math.min(1, f.h / ih),
    score: Math.round(f.score * 100) / 100,
  }));
}
