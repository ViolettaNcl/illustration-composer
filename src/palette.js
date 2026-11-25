// Colour schemes and recolouring.
//
// Every scheme defines 8 roles: bg1..bg4 (background colours) and obj1..obj4
// (object colours). Components are stored in the source scheme ("violet"), so a
// recolour is a pure hex→hex substitution by role. Geometry is untouched.
//
// Brand rules enforced here:
//  • canvas background and background (monochrome) objects only ever receive bg roles;
//  • main objects may use both bg and obj roles ("background colours may be used in objects,
//    object colours may not be used in backgrounds").

export const ROLES = ['bg1', 'bg2', 'bg3', 'bg4', 'obj1', 'obj2', 'obj3', 'obj4'];
export const BG_ROLES = ROLES.slice(0, 4);
export const OBJ_ROLES = ROLES.slice(4);
const STORE_KEY = 'ic.customSchemes.v1';

export function normHex(c) {
  if (!c) return null;
  c = String(c).trim().toUpperCase();
  if (c === 'WHITE') return '#FFFFFF';
  if (c === 'BLACK') return '#000000';
  if (/^#[0-9A-F]{3}$/.test(c)) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
  return /^#[0-9A-F]{6}$/.test(c) ? c : null;
}

export class Palettes {
  constructor(data) {
    this.roles = data.roles;
    this.sourceId = data.source;
    this.schemes = [...data.schemes, ...loadCustom()];
  }
  get(id) {
    return this.schemes.find((s) => s.id === id) || this.schemes[0];
  }
  get source() {
    return this.get(this.sourceId);
  }

  // hex(source) -> hex(target)
  map(targetId) {
    const src = this.source.colors;
    const dst = this.get(targetId).colors;
    const m = new Map();
    for (const r of ROLES) m.set(normHex(src[r]), normHex(dst[r]));
    return m;
  }

  // role of a source colour (for validation / UI)
  roleOf(hex) {
    const src = this.source.colors;
    return ROLES.find((r) => normHex(src[r]) === normHex(hex));
  }

  add(scheme) {
    const s = validateScheme(scheme);
    s.custom = true;
    if (this.schemes.some((x) => x.id === s.id)) s.id = s.id + '-' + Date.now().toString(36);
    this.schemes.push(s);
    saveCustom(this.schemes.filter((x) => x.custom));
    return s;
  }
  remove(id) {
    this.schemes = this.schemes.filter((s) => !(s.custom && s.id === id));
    saveCustom(this.schemes.filter((x) => x.custom));
  }
}

export function recolor(markup, map) {
  return markup.replace(/(fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6}|white|black)"/g, (all, attr, c) => {
    const to = map.get(normHex(c));
    return to ? `${attr}="${to}"` : all;
  });
}

export function validateScheme(s) {
  if (!s || typeof s !== 'object') throw new Error('Схема должна быть объектом');
  const colors = {};
  for (const r of ROLES) {
    const v = normHex(s.colors?.[r]);
    if (!v) throw new Error(`Нет цвета для роли ${r}`);
    colors[r] = v;
  }
  const title = String(s.title || s.name || 'Своя схема').slice(0, 40);
  const id = String(s.id || title).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'custom';
  return { id, title, colors };
}

// Accepts:
//  • JSON scheme {title, colors:{bg1..obj4}} or {schemes:[...]};
//  • JSON / text list of 8 hex colours: 4 background then 4 object colours;
//  • SVG palette block exported from Figma: 8 swatch <rect>s in two columns
//    (left column = background colours, right column = object colours), top to bottom.
export function parsePaletteFile(name, text) {
  const t = text.trim();
  if (t.startsWith('<')) return [fromSvgSwatches(name, t)];
  if (t.startsWith('{') || t.startsWith('[')) {
    const j = JSON.parse(t);
    if (Array.isArray(j)) return [fromList(name, j)];
    if (Array.isArray(j.schemes)) return j.schemes.map(validateScheme);
    return [validateScheme({ title: name.replace(/\.\w+$/, ''), ...j })];
  }
  const hexes = t.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
  return [fromList(name, hexes)];
}

function fromList(name, list) {
  const hexes = list.map(normHex).filter(Boolean);
  if (hexes.length < 8) throw new Error(`Нужно 8 цветов (4 фона + 4 объекта), найдено ${hexes.length}`);
  const colors = Object.fromEntries(ROLES.map((r, i) => [r, hexes[i]]));
  return validateScheme({ title: name.replace(/\.\w+$/, ''), colors });
}

function fromSvgSwatches(name, svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const rects = [...doc.querySelectorAll('rect')]
    .map((r) => ({
      x: +r.getAttribute('x') || 0, y: +r.getAttribute('y') || 0,
      w: +r.getAttribute('width') || 0, fill: normHex(r.getAttribute('fill')),
    }))
    .filter((r) => r.fill && r.w > 0);
  if (rects.length < 8) throw new Error('В SVG не найдено 8 цветных прямоугольников-образцов');
  // two columns by x
  const xs = [...new Set(rects.map((r) => Math.round(r.x)))].sort((a, b) => a - b);
  const left = rects.filter((r) => Math.round(r.x) <= xs[0] + 2).sort((a, b) => a.y - b.y).slice(0, 4);
  const right = rects.filter((r) => Math.round(r.x) > xs[0] + 2).sort((a, b) => a.y - b.y).slice(0, 4);
  if (left.length < 4 || right.length < 4) return fromList(name, rects.map((r) => r.fill));
  return fromList(name, [...left, ...right].map((r) => r.fill));
}

function loadCustom() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(saved) ? saved.flatMap(s => { try { return [{ ...validateScheme(s), custom: true }]; } catch { return []; } }) : [];
  } catch {
    return [];
  }
}
function saveCustom(list) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
