// Interactive canvas: renders the scene into an <svg>, handles selection, drag, rotate.
// The editor mutates scene items in place while dragging and calls onCommit() when a
// gesture ends, so the host can push an undo snapshot.

import { recolor } from './palette.js';
import { itemTransform, itemBox } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';

export class Editor {
  constructor(svg, { lib, palettes, onCommit, onSelect }) {
    this.svg = svg;
    this.lib = lib;
    this.palettes = palettes;
    this.onCommit = onCommit;
    this.onSelect = onSelect;
    this.nodes = new Map(); // uid -> {g, key, comp}
    this.selected = null;
    this.scene = null;

    this.bg = el('rect', { id: 'ed-bg', x: 0, y: 0 });
    this.layer = el('g', { id: 'ed-items' });
    this.overlay = el('g', { id: 'ed-overlay' });
    this.guide = el('g', { id: 'ed-guide' });
    svg.append(this.bg, this.guide, this.layer, this.overlay);

    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e));
    new ResizeObserver(() => this.drawOverlay()).observe(svg);
  }

  async render(scene, { guide = null } = {}) {
    this.scene = scene;
    const { W, H } = scene;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.bg.setAttribute('width', W);
    this.bg.setAttribute('height', H);
    this.bg.setAttribute('fill', this.palettes.get(scene.schemeId).colors.bg1);
    await this.lib.preload(scene.items, scene.size);
    if (this.scene !== scene) return; // a newer render started meanwhile
    const map = this.palettes.map(scene.schemeId);

    const alive = new Set();
    for (const it of scene.items) {
      alive.add(it.uid);
      const key = `${it.object}|${it.kind}|${scene.size}|${scene.schemeId}`;
      let n = this.nodes.get(it.uid);
      if (!n) {
        n = { g: el('g', { 'data-uid': it.uid, class: 'ed-item' }), key: null };
        this.nodes.set(it.uid, n);
      }
      if (n.key !== key) {
        n.comp = await this.lib.component(it.object, it.kind, scene.size);
        n.g.innerHTML = recolor(n.comp.inner, map);
        n.key = key;
      }
      n.g.setAttribute('transform', itemTransform(scene, this.lib, n.comp, it));
      this.layer.append(n.g); // re-append = z-order
    }
    for (const [uid, n] of this.nodes) if (!alive.has(uid)) { n.g.remove(); this.nodes.delete(uid); }
    if (this.selected && !alive.has(this.selected)) this.selected = null;

    this.guide.innerHTML = '';
    if (guide) {
      this.guide.append(el('rect', { ...guide, class: 'ed-copyspace' }));
      const t = el('text', { x: guide.x + guide.w / 2, y: guide.y + guide.h / 2, class: 'ed-copyspace-label' });
      t.textContent = 'место под заголовок';
      this.guide.append(t);
    }
    this.drawOverlay();
  }

  item(uid = this.selected) {
    return this.scene?.items.find((i) => i.uid === uid);
  }

  select(uid) {
    this.selected = uid;
    this.drawOverlay();
    this.onSelect?.(uid);
  }

  updateItem(it) {
    const n = this.nodes.get(it.uid);
    if (n?.comp) n.g.setAttribute('transform', itemTransform(this.scene, this.lib, n.comp, it));
    if (it.uid === this.selected) this.drawOverlay();
  }

  px() {
    const w = this.svg.clientWidth || 1;
    return this.scene ? this.scene.W / w : 1; // scene units per screen px (viewBox meet)
  }

  drawOverlay() {
    this.overlay.innerHTML = '';
    const it = this.item();
    if (!it) return;
    const { w, h } = itemBox(this.scene, this.lib, it);
    const p = Math.max(this.px(), (this.scene.H) / (this.svg.clientHeight || 1));
    const g = el('g', { transform: `translate(${it.cx} ${it.cy}) rotate(${it.rot || 0})` });
    g.append(
      el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, class: 'ed-sel', 'stroke-width': 1.5 * p }),
      el('line', { x1: 0, y1: -h / 2, x2: 0, y2: -h / 2 - 28 * p, class: 'ed-sel', 'stroke-width': 1.5 * p }),
      el('circle', { cx: 0, cy: -h / 2 - 28 * p, r: 7 * p, class: 'ed-rot', 'data-handle': 'rotate', 'stroke-width': 1.5 * p }),
    );
    this.overlay.append(g);
  }

  point(e) {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  down(e) {
    if (!this.scene) return;
    const p = this.point(e);
    if (e.target.closest?.('[data-handle="rotate"]')) {
      const it = this.item();
      this.drag = { mode: 'rotate', it, start: it.rot || 0, moved: false };
    } else {
      const g = e.target.closest?.('[data-uid]');
      if (!g) {
        this.select(null);
        return;
      }
      const uid = g.getAttribute('data-uid');
      if (uid !== this.selected) this.select(uid);
      const it = this.item(uid);
      this.drag = { mode: 'move', it, dx: p.x - it.cx, dy: p.y - it.cy, moved: false };
    }
    this.svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  move(e) {
    if (!this.drag) return;
    const p = this.point(e);
    const { it } = this.drag;
    if (this.drag.mode === 'move') {
      it.cx = p.x - this.drag.dx;
      it.cy = p.y - this.drag.dy;
    } else {
      let a = (Math.atan2(p.y - it.cy, p.x - it.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((a + 540) % 360) - 180;
      it.rot = Math.round(a * 10) / 10;
    }
    this.drag.moved = true;
    this.updateItem(it);
  }

  up(e) {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    try { this.svg.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (moved) this.onCommit?.();
  }
}

function el(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
