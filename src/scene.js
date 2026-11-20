// Scene model and SVG serialisation.
//
// A scene is plain JSON (easy to undo/redo, save, share):
// { W, H, size:'L'|'S', schemeId, scale, style, seed,
//   items:[{uid, object, kind:'main'|'bg', cx, cy, rot}] }   — items are in z-order (first = bottom)
//
// `scale` is ONE number for the whole scene (px per normalised unit), so objects keep
// their relative proportions. Each item becomes
//   <g transform="translate(cx cy) rotate(rot) scale(scale*norm) translate(-vbCenter)"> …original paths… </g>
// where the original paths are copied verbatim with fills remapped to the colour scheme.

import { recolor } from './palette.js';

let uidSeq = 1;
export const newUid = () => 'i' + (uidSeq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function itemTransform(scene, lib, comp, it) {
  const k = scene.scale * lib.norm(it.object, it.kind, scene.size);
  const [x, y, w, h] = comp.vb;
  return `translate(${r(it.cx)} ${r(it.cy)}) rotate(${r(it.rot || 0)}) scale(${r(k, 5)}) translate(${r(-(x + w / 2))} ${r(-(y + h / 2))})`;
}

// size of an item on canvas (unrotated)
export function itemBox(scene, lib, it) {
  const d = lib.dims(it.object);
  return { w: d.w * scene.scale, h: d.h * scene.scale };
}

export async function exportSVG(scene, lib, palettes) {
  await lib.preload(scene.items, scene.size);
  const map = palettes.map(scene.schemeId);
  const scheme = palettes.get(scene.schemeId);
  const bg = scheme.colors.bg1;
  const counters = {};
  const groups = [];
  for (const it of scene.items) {
    const comp = await lib.component(it.object, it.kind, scene.size);
    const n = (counters[`${it.object}-${it.kind}`] = (counters[`${it.object}-${it.kind}`] || 0) + 1);
    const id = `${it.object}-${it.kind === 'main' ? 'main' : 'background'}-${n}`;
    groups.push(
      `<g id="${id}" data-object="${it.object}" data-kind="${it.kind}" transform="${itemTransform(scene, lib, comp, it)}">\n${recolor(comp.inner, map)}\n</g>`,
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.W}" height="${scene.H}" viewBox="0 0 ${scene.W} ${scene.H}" fill="none">\n` +
    `<title>Illustration · ${scene.W}×${scene.H} · size ${scene.size} · ${scheme.title}</title>\n` +
    `<defs><clipPath id="canvas"><rect width="${scene.W}" height="${scene.H}"/></clipPath></defs>\n` +
    `<rect id="background" width="${scene.W}" height="${scene.H}" fill="${bg}"/>\n` +
    `<g id="composition" clip-path="url(#canvas)">\n${groups.join('\n')}\n</g>\n</svg>\n`
  );
}

export function download(name, text, type = 'image/svg+xml') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function r(v, d = 2) {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}
