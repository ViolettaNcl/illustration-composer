// Automatic composition.
//
// Input: a list of {object, kind} plus canvas format and composition style.
// Output: one global scale + a centre position for every item.
//
// Rules from the brief that the algorithm respects:
//  • one scale for the whole scene → relative proportions of objects never change;
//  • objects are only moved (and later optionally rotated by the user), never edited;
//  • main objects form the composition; background objects sit behind it, may be
//    cropped by the canvas edge, and never cover the copy space in "title" style.
//
// Method: seeded stochastic placement. Main objects are added largest-first; each new
// object tries ~60 candidate spots that touch an already placed object along
// isometric-friendly directions, and the candidate with the best score wins
// (aspect ratio of the group vs. target region, overlap, compactness).
// The group is then scaled uniformly into the style's target region.

export const STYLES = {
  assembled: { title: 'Собранно', note: 'Композиция заполняет кадр' },
  offset: { title: 'Со смещением', note: 'Композиция сдвинута и уходит за край' },
  title: { title: 'Под заголовок', note: 'Свободное место под текст' },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function regions(style, W, H) {
  const land = W >= H;
  if (style === 'offset') {
    return land
      ? { target: { x: 0.3 * W, y: 0.04 * H, w: 0.8 * W, h: 0.98 * H }, copy: null }
      : { target: { x: 0.02 * W, y: 0.3 * H, w: 0.98 * W, h: 0.8 * H }, copy: null };
  }
  if (style === 'title') {
    return land
      ? { target: { x: 0.52 * W, y: 0.12 * H, w: 0.42 * W, h: 0.76 * H }, copy: { x: 0, y: 0, w: 0.48 * W, h: H } }
      : { target: { x: 0.08 * W, y: 0.46 * H, w: 0.84 * W, h: 0.48 * H }, copy: { x: 0, y: 0, w: W, h: 0.42 * H } };
  }
  return { target: { x: 0.06 * W, y: 0.08 * H, w: 0.88 * W, h: 0.84 * H }, copy: null };
}

const ISO_DIRS = [30, 150, 210, 330, 0, 180, 90, 270].map((d) => (d * Math.PI) / 180);

function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2));
  const y = Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2));
  return x * y;
}
function bounds(list) {
  const x0 = Math.min(...list.map((b) => b.x - b.w / 2));
  const x1 = Math.max(...list.map((b) => b.x + b.w / 2));
  const y0 = Math.min(...list.map((b) => b.y - b.h / 2));
  const y1 = Math.max(...list.map((b) => b.y + b.h / 2));
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * @param {object} p
 * @param {{object:string, kind:'main'|'bg'}[]} p.items
 * @param {(id:string)=>{w:number,h:number}} p.dims  visual size in normalised units
 * @param {number} p.W @param {number} p.H
 * @param {'assembled'|'offset'|'title'} p.style
 * @param {number} p.seed
 * @returns {{scale:number, items:{object,kind,cx,cy,rot}[]}}
 */
export function autoLayout({ items, dims, W, H, style = 'assembled', seed = 1 }) {
  const rnd = mulberry32(seed);
  const { target: R, copy } = regions(style, W, H);
  const targetAspect = R.w / R.h;

  const withDims = items.map((it, i) => ({ ...it, i, ...dims(it.object) }));
  let mains = withDims.filter((it) => it.kind === 'main');
  let bgs = withDims.filter((it) => it.kind !== 'main');
  if (!mains.length && bgs.length) {
    mains = bgs; // a scene of background objects only is still laid out as a group
    bgs = [];
  }
  // biggest first, small random shuffle among similar sizes for variety
  mains.sort((a, b) => b.w * b.h * (0.85 + rnd() * 0.3) - a.w * a.h * (0.85 + rnd() * 0.3));

  const placed = [];
  for (const m of mains) {
    if (!placed.length) {
      placed.push({ ...m, x: 0, y: 0 });
      continue;
    }
    let best = null;
    for (let t = 0; t < 64; t++) {
      const anchor = placed[Math.floor(rnd() * placed.length)];
      const ang = ISO_DIRS[Math.floor(rnd() * ISO_DIRS.length)] + (rnd() - 0.5) * 0.5;
      const c = Math.cos(ang), s = Math.sin(ang);
      const touch = Math.min(
        Math.abs(c) > 1e-3 ? (anchor.w + m.w) / 2 / Math.abs(c) : Infinity,
        Math.abs(s) > 1e-3 ? (anchor.h + m.h) / 2 / Math.abs(s) : Infinity,
      );
      const d = touch * (0.82 + rnd() * 0.26); // allow some overlap: objects "lie" on each other
      const cand = { ...m, x: anchor.x + c * d, y: anchor.y + s * d };
      const all = [...placed, cand];
      const b = bounds(all);
      const aspectPen = Math.abs(Math.log(b.w / b.h / targetAspect));
      let ovPen = 0;
      for (const p of placed) {
        const o = overlap(p, cand) / Math.min(p.w * p.h, cand.w * cand.h);
        ovPen += o > 0.14 ? (o - 0.14) * 8 + 0.1 : o * 0.4;
      }
      const sumArea = all.reduce((acc, q) => acc + q.w * q.h, 0);
      const compactPen = Math.log((b.w * b.h) / sumArea);
      const score = aspectPen * 1.4 + ovPen + compactPen * 0.9 + rnd() * 0.12;
      if (!best || score < best.score) best = { score, cand };
    }
    placed.push(best.cand);
  }

  // Fit the group into the target region with one uniform scale.
  const b = bounds(placed);
  const fill = 0.94;
  // Upper bound: no single object may exceed ~half of the frame, so a scene of two small
  // objects is not blown up to fill everything (matches the reference compositions).
  const k = style === 'offset' ? 1.25 : 1;
  const maxScale = Math.min(...placed.map((p) => Math.min((0.5 * k * W) / p.w, (0.62 * k * H) / p.h)));
  const scale = Math.min((R.w * fill) / b.w, (R.h * fill) / b.h, maxScale);
  const ox = R.x + R.w / 2;
  const oy = R.y + R.h / 2;
  const out = placed.map((p) => ({
    object: p.object, kind: p.kind, i: p.i, rot: 0,
    cx: ox + (p.x - b.cx) * scale, cy: oy + (p.y - b.cy) * scale,
    w: p.w * scale, h: p.h * scale,
  }));

  // Background objects: same scale; placed around/behind the group, may bleed off-canvas.
  const mainBoxes = out.map((o) => ({ x: o.cx, y: o.cy, w: o.w, h: o.h }));
  const bgPlaced = [];
  for (const g of bgs) {
    const w = g.w * scale, h = g.h * scale;
    let best = null;
    for (let t = 0; t < 120; t++) {
      const cand = { x: -0.1 * W + rnd() * 1.2 * W, y: -0.1 * H + rnd() * 1.2 * H, w, h };
      const area = w * h;
      const vis = overlap(cand, { x: W / 2, y: H / 2, w: W, h: H }) / area;
      const cover = mainBoxes.reduce((a, m) => a + overlap(cand, m), 0) / area;
      const bgOv = bgPlaced.reduce((a, m) => a + overlap(cand, m), 0) / area;
      const copyOv = copy ? overlap(cand, { x: copy.x + copy.w / 2, y: copy.y + copy.h / 2, w: copy.w, h: copy.h }) / area : 0;
      const dist = Math.hypot(cand.x - ox, cand.y - oy) / Math.hypot(W, H);
      const score =
        (vis < 0.5 ? (0.5 - vis) * 4 : 0) + (vis > 0.95 ? 0.15 : 0) +
        Math.max(0, cover - 0.3) * 3 + bgOv * 3 + copyOv * 6 + dist * 0.6 + rnd() * 0.1;
      if (!best || score < best.score) best = { score, cand };
    }
    bgPlaced.push(best.cand);
    out.push({ object: g.object, kind: g.kind, i: g.i, rot: 0, cx: best.cand.x, cy: best.cand.y, w, h });
  }

  // Isometric depth: lower on screen = closer to the viewer = drawn later.
  out.sort((a, b2) => {
    if ((a.kind === 'main') !== (b2.kind === 'main')) return a.kind === 'main' ? 1 : -1;
    return a.cy + a.h / 2 - (b2.cy + b2.h / 2);
  });
  return { scale, items: out.map(({ object, kind, cx, cy, rot }) => ({ object, kind, cx, cy, rot })) };
}
