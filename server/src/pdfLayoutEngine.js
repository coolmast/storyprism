// Aspect-ratio-aware page geometry for the PDF templates. Everything here
// is pure math on photo aspect ratios (width / height) and the page box -
// no HTML - so templates can ask "where does each photo go on this page"
// without ever cropping a landscape photo into a portrait cell.
//
// Coordinates are in page-width units: the page is 100 wide and
// 100 / pageAspect tall. `toCss()` converts a box to percentage-based
// absolute positioning, so the same layout works at any paper size and at
// any preview zoom level.

const DEFAULT_ASPECT = 3 / 2;

export function photoAspect(p) {
  const w = Number(p?.width);
  const h = Number(p?.height);
  return w > 0 && h > 0 ? w / h : DEFAULT_ASPECT;
}

export function orientation(p) {
  const a = photoAspect(p);
  if (a >= 2) return "panorama";
  if (a > 1.1) return "landscape";
  if (a < 0.9) return "portrait";
  return "square";
}

// How much of a photo survives being cropped to fill a box of `boxAspect`
// (1 = nothing lost, 0.5 = half the photo is cut away).
export function coverRetention(photoA, boxAspect) {
  return Math.min(photoA / boxAspect, boxAspect / photoA);
}

export function toCss(box, pageAspect) {
  const pageH = 100 / pageAspect;
  const f = (n) => `${Math.round(n * 1000) / 1000}%`;
  return `left:${f(box.x)};top:${f((box.y / pageH) * 100)};width:${f(box.w)};height:${f((box.h / pageH) * 100)};`;
}

// --- Guillotine collage -----------------------------------------------------
//
// Enumerates every way to recursively split a *consecutive* run of photos
// side-by-side ("h") or stacked ("v"). Each tree has an exact combined
// aspect ratio (side-by-side adds aspects, stacking adds inverse aspects),
// so picking the tree whose aspect is closest to the target box gives a
// layout where every photo is shown at its native proportions. Order is
// preserved, so the story's chronology survives. n <= 6 is at most a few
// thousand trees - trivially cheap.

function enumerateTrees(aspects, lo, hi, memo) {
  const key = `${lo}:${hi}`;
  if (memo.has(key)) return memo.get(key);
  let out;
  if (hi - lo === 1) {
    out = [{ leaf: lo, aspect: aspects[lo] }];
  } else {
    out = [];
    for (let mid = lo + 1; mid < hi; mid++) {
      const left = enumerateTrees(aspects, lo, mid, memo);
      const right = enumerateTrees(aspects, mid, hi, memo);
      for (const a of left) {
        for (const b of right) {
          out.push({ dir: "h", a, b, aspect: a.aspect + b.aspect });
          out.push({ dir: "v", a, b, aspect: 1 / (1 / a.aspect + 1 / b.aspect) });
        }
      }
    }
  }
  memo.set(key, out);
  return out;
}

function placeTree(node, box, gap, out) {
  if (node.leaf !== undefined) {
    out[node.leaf] = box;
    return;
  }
  if (node.dir === "h") {
    const avail = Math.max(0, box.w - gap);
    const wa = (avail * node.a.aspect) / node.aspect;
    placeTree(node.a, { x: box.x, y: box.y, w: wa, h: box.h }, gap, out);
    placeTree(node.b, { x: box.x + wa + gap, y: box.y, w: avail - wa, h: box.h }, gap, out);
  } else {
    const avail = Math.max(0, box.h - gap);
    const inv = 1 / node.a.aspect + 1 / node.b.aspect;
    const ha = (avail * (1 / node.a.aspect)) / inv;
    placeTree(node.a, { x: box.x, y: box.y, w: box.w, h: ha }, gap, out);
    placeTree(node.b, { x: box.x, y: box.y + ha + gap, w: box.w, h: avail - ha }, gap, out);
  }
}

// Leaf areas of a tree laid out at unit scale, used to penalize trees that
// shrink one photo to a postage stamp next to a giant neighbor.
function leafAreas(node, w, h, out) {
  if (node.leaf !== undefined) {
    out.push(w * h);
    return out;
  }
  if (node.dir === "h") {
    const wa = (w * node.a.aspect) / node.aspect;
    leafAreas(node.a, wa, h, out);
    leafAreas(node.b, w - wa, h, out);
  } else {
    const inv = 1 / node.a.aspect + 1 / node.b.aspect;
    const ha = (h * (1 / node.a.aspect)) / inv;
    leafAreas(node.a, w, ha, out);
    leafAreas(node.b, w, h - ha, out);
  }
  return out;
}

// Returns `{ boxes, coverage }`: one box per photo (same order as `photos`)
// inside `box`. When the best tree's aspect is within `fillTolerance` of the
// box, the collage is stretched to fill the box exactly (each photo then
// loses at most a sliver to object-fit: cover); otherwise it's centered at
// its native aspect and the leftover space shows whatever is behind it.
export function collage(photos, box, { gap = 1, fillTolerance = 0.9, variant = 0 } = {}) {
  const aspects = photos.map(photoAspect);
  const boxAspect = box.w / box.h;
  const trees = enumerateTrees(aspects, 0, aspects.length, new Map());

  const scored = trees.map((tree) => {
    const coverage = coverRetention(tree.aspect, boxAspect);
    const areas = leafAreas(tree, tree.aspect, 1, []);
    const balance = Math.min(...areas) / Math.max(...areas);
    const score = balance < 0.12 ? coverage * 0.5 : coverage * (0.7 + 0.3 * Math.sqrt(balance));
    return { tree, coverage, score };
  });
  scored.sort((a, b) => b.score - a.score);

  // `variant` lets two pages with the same photo shapes pick different
  // near-equivalent arrangements instead of looking copy-pasted.
  const top = scored.filter((s) => s.score >= scored[0].score * 0.96);
  const pick = top[variant % top.length];

  let target = box;
  if (pick.coverage < fillTolerance) {
    if (pick.tree.aspect > boxAspect) {
      const h = box.w / pick.tree.aspect;
      target = { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h };
    } else {
      const w = box.h * pick.tree.aspect;
      target = { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
    }
  }

  const boxes = [];
  placeTree(pick.tree, target, gap, boxes);
  return { boxes, coverage: pick.coverage, filled: target === box };
}

// --- Background + floating cards -------------------------------------------

// The photo that survives being cropped to the full page best becomes the
// backdrop; ties go to the wider photo (landscapes read better as scenery).
export function pickBackdrop(photos, pageAspect) {
  let best = 0;
  let bestScore = -1;
  photos.forEach((p, i) => {
    const a = photoAspect(p);
    const score = coverRetention(a, pageAspect) + (a > 1 ? 0.05 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const CARD_ANCHORS = {
  1: [["br"], ["tl"], ["tr"], ["bl"]],
  2: [["tl", "br"], ["tr", "bl"], ["tr", "br"], ["tl", "bl"]],
  3: [["tl", "tr", "br"], ["tl", "bl", "br"], ["tr", "bl", "br"], ["tl", "tr", "bl"]],
};

function anchorBox(anchor, w, h, pageW, pageH, m) {
  const x = anchor.includes("l") ? m : pageW - m - w;
  const y = anchor.includes("t") ? m : pageH - m - h;
  return { x, y, w, h };
}

function overlaps(a, b, pad) {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

// Places 1-3 photo "cards" at native aspect ratio into page corners, sized
// by a target share of the page area, shrinking until none overlap. Returns
// the boxes plus the corners left free (a spot for the stop title).
export function cardLayout(photos, pageAspect, { variant = 0, sizeFactor = 1 } = {}) {
  const n = Math.min(3, photos.length);
  const pageW = 100;
  const pageH = 100 / pageAspect;
  const m = 4.5;
  const anchorsOptions = CARD_ANCHORS[n] || CARD_ANCHORS[3];
  const anchors = anchorsOptions[variant % anchorsOptions.length];
  const targetShare = ({ 1: 0.24, 2: 0.16, 3: 0.12 }[n] || 0.12) * sizeFactor;

  let scale = 1;
  let boxes = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    boxes = photos.slice(0, n).map((p, i) => {
      const a = photoAspect(p);
      const area = pageW * pageH * targetShare * scale * scale;
      let w = Math.sqrt(area * a);
      let h = w / a;
      const maxW = pageW * 0.58;
      const maxH = pageH * 0.58;
      if (w > maxW) { w = maxW; h = w / a; }
      if (h > maxH) { h = maxH; w = h * a; }
      return anchorBox(anchors[i], w, h, pageW, pageH, m);
    });
    const clash = boxes.some((b, i) => boxes.some((o, j) => j > i && overlaps(b, o, 2)));
    if (!clash) break;
    scale *= 0.94;
  }

  const freeCorners = ["tl", "tr", "bl", "br"].filter((c) => !anchors.includes(c));
  return { boxes, anchors, freeCorners };
}
