// Component library: manifest + lazy-loaded SVG components.
//
// Storage model: every component is a standalone SVG file in /library, drawn in the
// canonical ("violet") colour scheme. The manifest describes each object (titles,
// semantic keywords) and its four variants: {main|bg} × {L|S}.
// At runtime a component is parsed once into { viewBox, inner } and cached; the
// inner markup is reused verbatim in every composition (only fill colours are
// remapped by palette.js), so geometry is never altered.

const BASE = import.meta.env.BASE_URL + 'library/';
const CUSTOM_KEY = 'ic.customComponents.v1';

const cache = new Map(); // file -> Promise<Component>

export async function loadLibrary() {
  const [manifest, palettes] = await Promise.all([
    fetch(BASE + 'manifest.json').then((r) => r.json()),
    fetch(BASE + 'palettes.json').then((r) => r.json()),
  ]);
  for (const c of loadCustom()) manifest.objects.push(c);
  return new Library(manifest, palettes);
}

export class Library {
  constructor(manifest, palettes) {
    this.manifest = manifest;
    this.palettes = palettes;
    this.objects = manifest.objects;
    this.byId = new Map(this.objects.map((o) => [o.id, o]));
  }

  get(id) {
    return this.byId.get(id);
  }

  variant(objectId, kind, size) {
    const o = this.byId.get(objectId);
    if (!o) throw new Error(`Unknown object ${objectId}`);
    return o.variants[`${kind}_${size}`] || o.variants[`main_${size}`] || Object.values(o.variants)[0];
  }

  // S components are drawn ~2× smaller in the source file. To keep the visual size of
  // an object identical when the user switches L ↔ S (only detail changes), every
  // variant is normalised to the L main variant's width.
  norm(objectId, kind, size) {
    const o = this.byId.get(objectId);
    const ref = o.variants.main_L || Object.values(o.variants)[0];
    return ref.w / this.variant(objectId, kind, size).w;
  }

  // Visual box of an object in normalised units (L source units).
  dims(objectId) {
    const o = this.byId.get(objectId);
    const ref = o.variants.main_L || Object.values(o.variants)[0];
    return { w: ref.w, h: ref.h };
  }

  async component(objectId, kind, size) {
    const v = this.variant(objectId, kind, size);
    if (v.markup) return parseComponent(v.markup);
    if (!cache.has(v.file)) {
      cache.set(v.file, fetch(BASE + v.file).then((r) => r.text()).then(parseComponent));
    }
    return cache.get(v.file);
  }

  async preload(items, size) {
    await Promise.all(items.map((it) => this.component(it.object, it.kind, size)));
  }

  addCustom(name, markup) {
    const comp = parseComponent(markup);
    const id = 'custom-' + Date.now().toString(36);
    const v = { file: null, markup, w: comp.vb[2], h: comp.vb[3] };
    const words = name.toLowerCase().replace(/\.svg$/, '').split(/[^a-zа-яё0-9]+/i).filter(Boolean);
    const obj = {
      id, title: name.replace(/\.svg$/i, ''), titleEn: name, custom: true,
      keywords: words, meaning: 'загруженный пользователем компонент', weight: 0.6,
      variants: { main_L: v, bg_L: v, main_S: v, bg_S: v },
    };
    this.objects.push(obj);
    this.byId.set(id, obj);
    saveCustom(this.objects.filter((o) => o.custom));
    return obj;
  }

  removeCustom(id) {
    this.objects = this.objects.filter((o) => o.id !== id);
    this.manifest.objects = this.objects;
    this.byId.delete(id);
    saveCustom(this.objects.filter((o) => o.custom));
  }
}

export function parseComponent(text) {
  const open = text.match(/<svg\b[^>]*>/i);
  if (!open) throw new Error('Not an SVG');
  const tag = open[0];
  let vb = tag.match(/viewBox="([^"]+)"/i)?.[1].trim().split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4) {
    const w = parseFloat(tag.match(/\bwidth="([\d.]+)/)?.[1] || '100');
    const h = parseFloat(tag.match(/\bheight="([\d.]+)/)?.[1] || '100');
    vb = [0, 0, w, h];
  }
  const start = open.index + tag.length;
  const end = text.lastIndexOf('</svg>');
  const inner = text.slice(start, end).trim();
  return { vb, inner };
}

function loadCustom() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveCustom(list) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: custom components live for this session only */
  }
}
