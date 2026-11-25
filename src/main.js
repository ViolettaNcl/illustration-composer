import './style.css';
import { loadLibrary } from './library.js';
import { Palettes, parsePaletteFile, ROLES, BG_ROLES, normHex } from './palette.js';
import { autoLayout, STYLES, regions } from './layout.js';
import { fromMetaphor, fromNames } from './semantic.js';
import { aiFromMetaphor, getKey, setKey } from './ai.js';
import { Editor } from './editor.js';
import { exportSVG, download, newUid } from './scene.js';

const $ = (s) => document.querySelector(s);
const FORMATS = [
  { w: 1200, h: 630, label: '1200×630', note: 'обложка / соцсети' },
  { w: 1080, h: 1080, label: '1:1', note: '1080×1080' },
  { w: 1080, h: 1350, label: '4:5', note: '1080×1350' },
  { w: 900, h: 1200, label: '3:4', note: '900×1200' },
  { w: 1920, h: 1080, label: '16:9', note: '1920×1080' },
  { w: 1080, h: 1920, label: '9:16', note: 'сторис' },
];
const EXAMPLES = {
  metaphor: ['Кэшбэк за каждую покупку', 'Готовимся к экзамену', 'Командная работа над проектом', 'Поздравляем с 8 Марта', 'Документы без бюрократии', 'Подкаст для вечерней работы'],
  names: ['книга, телефон, пазл', 'кошелёк, 2 монеты, фоновая папка', 'лампа, ручка, фоновые цветы, фоновые наушники'],
};
const SCENE_KEY = 'ic.scene.v1';

const lib = await loadLibrary();
const palettes = new Palettes(lib.palettes);

let scene = loadScene() || {
  W: 1200, H: 630, size: 'L', schemeId: 'violet', style: 'assembled', seed: 1, scale: 0.35, items: [], lastPrompt: null,
};
let mode = 'metaphor';
const history = { past: [], future: [] };

const editor = new Editor($('#canvas'), {
  lib, palettes,
  onCommit: () => commit(),
  onSelect: () => { renderSelbar(); renderLayers(); },
});

// ---------- history ----------
let lastSnap = JSON.stringify(scene);
function commit() {
  const snap = JSON.stringify(scene);
  if (snap === lastSnap) return;
  history.past.push(lastSnap);
  if (history.past.length > 100) history.past.shift();
  history.future = [];
  lastSnap = snap;
  saveScene();
  refresh();
}
function undo() {
  if (!history.past.length) return;
  history.future.push(lastSnap);
  lastSnap = history.past.pop();
  scene = JSON.parse(lastSnap);
  saveScene();
  refresh();
}
function redo() {
  if (!history.future.length) return;
  history.past.push(lastSnap);
  lastSnap = history.future.pop();
  scene = JSON.parse(lastSnap);
  saveScene();
  refresh();
}

// ---------- render ----------
function refresh() {
  const guide = scene.style === 'title' && scene.items.length ? regions('title', scene.W, scene.H).copy : null;
  editor.render(scene, { guide });
  $('#empty').hidden = scene.items.length > 0;
  const wrap = $('#canvas-wrap');
  wrap.style.setProperty('--ar', `${scene.W} / ${scene.H}`);
  wrap.classList.toggle('tall', scene.H > scene.W);
  $('#undo').disabled = !history.past.length;
  $('#redo').disabled = !history.future.length;
  renderFormats();
  renderSize();
  renderSchemes();
  renderLayers();
  renderSelbar();
  renderRules();
  renderLibrary();
  if (scene.lastItems?.length) renderVariants(scene.lastItems);
}

function renderFormats() {
  const box = $('#formats');
  box.innerHTML = '';
  for (const f of FORMATS) {
    const b = document.createElement('button');
    b.className = 'fmt' + (f.w === scene.W && f.h === scene.H ? ' on' : '');
    const k = 26 / Math.max(f.w, f.h);
    b.innerHTML = `<i style="width:${f.w * k}px;height:${f.h * k}px"></i><span>${f.label}</span><small>${f.note}</small>`;
    b.onclick = () => setFormat(f.w, f.h);
    box.append(b);
  }
  $('#fw').value = scene.W;
  $('#fh').value = scene.H;
}

function renderSize() {
  for (const b of document.querySelectorAll('#size button')) b.setAttribute('aria-selected', b.dataset.size === scene.size);
}

function renderSchemes() {
  const box = $('#schemes');
  box.innerHTML = '';
  for (const s of palettes.schemes) {
    const b = document.createElement('button');
    b.className = 'scheme' + (s.id === scene.schemeId ? ' on' : '');
    b.title = s.title;
    const strip = ROLES.map((r) => `<i style="background:${s.colors[r]}"></i>`).join('');
    b.innerHTML = `<span class="strip">${strip}</span><span class="sname">${esc(s.title)}</span>${s.custom ? '<span class="x" data-del="1" title="Удалить схему">×</span>' : ''}`;
    b.onclick = (e) => {
      if (e.target.dataset.del) {
        palettes.remove(s.id);
        if (scene.schemeId === s.id) scene.schemeId = palettes.schemes[0].id;
        commit();
        refresh();
        return;
      }
      scene.schemeId = s.id;
      commit();
    };
    box.append(b);
  }
}

function renderRules() {
  // Verify the colour rules on the actual scene: canvas + background objects use bg roles only.
  const s = palettes.get(scene.schemeId);
  const bgSet = new Set(BG_ROLES.map((r) => normHex(s.colors[r])));
  const objOnly = ROLES.slice(4).map((r) => normHex(s.colors[r])).filter((c) => !bgSet.has(c));
  const bgItems = scene.items.filter((i) => i.kind === 'bg').length;
  const ok = bgSet.has(normHex(s.colors.bg1));
  $('#rules').innerHTML = ok
    ? `✓ Фон холста и фоновые объекты (${bgItems}) окрашены только цветами фона. Цвета объектов (${objOnly.length}) — только в главных объектах.`
    : '⚠ Схема некорректна';
}

const objName = (id) => lib.get(id)?.title || id;

function renderLayers() {
  const ol = $('#layers');
  ol.innerHTML = '';
  if (!scene.items.length) {
    ol.innerHTML = '<li class="muted">Нет объектов</li>';
    return;
  }
  [...scene.items].reverse().forEach((it) => {
    const li = document.createElement('li');
    li.className = it.uid === editor.selected ? 'on' : '';
    li.innerHTML = `<span class="kind ${it.kind}">${it.kind === 'main' ? 'гл.' : 'фон'}</span><span class="lname">${esc(objName(it.object))}</span>
      <button class="ghost sm icon" data-a="up" title="Выше">▲</button><button class="ghost sm icon" data-a="down" title="Ниже">▼</button><button class="ghost sm icon" data-a="del" title="Удалить">×</button>`;
    li.onclick = (e) => {
      const a = e.target.dataset.a;
      editor.select(it.uid);
      if (a) act(a === 'del' ? 'del' : a);
    };
    ol.append(li);
  });
}

function renderSelbar() {
  const it = editor.item();
  $('#selbar').hidden = !it;
  if (it) $('#sel-name').textContent = `${objName(it.object)} · ${it.kind === 'main' ? 'главный' : 'фоновый'}${it.rot ? ` · ${it.rot}°` : ''}`;
}

let libKey = '';
async function renderLibrary() {
  const key = `${scene.size}|${scene.schemeId}|${lib.objects.length}`;
  if (key === libKey) return;
  libKey = key;
  const box = $('#library');
  box.innerHTML = '';
  const map = palettes.map(scene.schemeId);
  const { recolor } = await import('./palette.js');
  for (const o of lib.objects) {
    const card = document.createElement('div');
    card.className = 'card';
    const comp = await lib.component(o.id, 'main', scene.size);
    if (key !== libKey) return;
    const [x, y, w, h] = comp.vb;
    card.innerHTML = `<div class="thumb" style="background:${palettes.get(scene.schemeId).colors.bg1}"><svg viewBox="${x} ${y} ${w} ${h}">${recolor(comp.inner, map)}</svg></div>
      <div class="ctitle">${esc(o.title)}${o.custom ? ' <span class="x" title="Удалить из библиотеки">×</span>' : ''}</div>
      <div class="cbtns"><button class="ghost sm" data-k="main" title="Добавить цветной (главный) вариант">+ главный</button><button class="ghost sm" data-k="bg" title="Добавить монохромный (фоновый) вариант">+ фон</button></div>`;
    card.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => addObject(o.id, b.dataset.k)));
    const del = card.querySelector('.x');
    if (del) del.onclick = () => { lib.removeCustom(o.id); scene.items = scene.items.filter((i) => i.object !== o.id); libKey = ''; commit(); refresh(); };
    box.append(card);
  }
}

// ---------- actions ----------
function addObject(object, kind) {
  if (!scene.items.length) scene.scale = defaultScale();
  const n = scene.items.length;
  const it = { uid: newUid(), object, kind, cx: scene.W * (0.5 + ((n % 5) - 2) * 0.06), cy: scene.H * (0.5 + ((n % 3) - 1) * 0.08), rot: 0 };
  if (kind === 'bg') scene.items.unshift(it); else scene.items.push(it);
  editor.selected = it.uid;
  commit();
}

function defaultScale() {
  // a typical 3-object scene fills the frame at this scale
  return Math.min(scene.W / 3400, scene.H / 1900);
}

function act(a) {
  const it = editor.item();
  if (!it) return;
  const i = scene.items.indexOf(it);
  switch (a) {
    case 'del': scene.items.splice(i, 1); editor.selected = null; break;
    case 'dup': {
      const c = { ...it, uid: newUid(), cx: it.cx + 30, cy: it.cy + 20 };
      scene.items.splice(i + 1, 0, c);
      editor.selected = c.uid;
      break;
    }
    case 'up': if (i < scene.items.length - 1) scene.items.splice(i + 1, 0, ...scene.items.splice(i, 1)); break;
    case 'down': if (i > 0) scene.items.splice(i - 1, 0, ...scene.items.splice(i, 1)); break;
    case 'front': scene.items.push(...scene.items.splice(i, 1)); break;
    case 'back': scene.items.unshift(...scene.items.splice(i, 1)); break;
    case 'rotl': it.rot = ((it.rot || 0) - 15 + 540) % 360 - 180; break;
    case 'rotr': it.rot = ((it.rot || 0) + 15 + 540) % 360 - 180; break;
    case 'rot0': it.rot = 0; break;
    case 'kind': it.kind = it.kind === 'main' ? 'bg' : 'main'; break;
  }
  commit();
}

async function build({ reroll = false } = {}) {
  const text = $('#prompt').value.trim();
  const bgMode = $('#bgmode').value;
  let res;
  if (reroll && scene.lastItems?.length) {
    res = { items: scene.lastItems, explanation: $('#explain').textContent };
  } else if (mode === 'names') {
    const r = fromNames(text, lib);
    if (!r.items.length) return toast('Не узнал ни одного объекта. Пример: «книга, телефон, фоновые наушники»');
    res = { items: r.items, explanation: r.unknown.length ? `Не найдено в библиотеке: ${r.unknown.join(', ')}` : `Объекты: ${r.items.map((i) => objName(i.object) + (i.kind === 'bg' ? ' (фон)' : '')).join(', ')}.` };
  } else {
    if (!text) return toast('Введите метафору или заголовок');
    $('#build').disabled = true;
    $('#explain').textContent = getKey() ? 'Claude подбирает объекты…' : '';
    try {
      res = getKey() ? await aiFromMetaphor(text, lib, { background: bgMode }) : fromMetaphor(text, lib, { background: bgMode });
    } catch (e) {
      console.warn(e);
      res = fromMetaphor(text, lib, { background: bgMode });
      res.explanation = `ИИ недоступен (${e.message}), использован офлайн-словарь. ` + res.explanation;
    } finally {
      $('#build').disabled = false;
    }
  }
  scene.style = $('#style').value;
  scene.lastItems = res.items;
  scene.seed = reroll ? (scene.seed * 7 + 13) % 100000 : 1 + Math.floor(Math.random() * 99999);
  applyLayout(res.items, scene.seed);
  $('#explain').textContent = res.explanation;
  commit();
}

function applyLayout(items, seed) {
  const L = autoLayout({ items, dims: (id) => lib.dims(id), W: scene.W, H: scene.H, style: scene.style, seed });
  scene.scale = L.scale;
  scene.items = L.items.map((it) => ({ uid: newUid(), ...it }));
  editor.selected = null;
}

let variantsKey = '';
async function renderVariants(items) {
  const key = JSON.stringify([items, scene.W, scene.H, scene.size, scene.schemeId, scene.style, scene.seed]);
  if (key === variantsKey) return;
  variantsKey = key;
  const box = $('#variants');
  box.innerHTML = '';
  const seeds = [0, 1, 2, 3].map((k) => (scene.seed + 1 + k * 7919) % 100000);
  for (const seed of seeds) {
    const L = autoLayout({ items, dims: (id) => lib.dims(id), W: scene.W, H: scene.H, style: scene.style, seed });
    const s = { ...scene, scale: L.scale, items: L.items.map((it) => ({ uid: 'v', ...it })) };
    const svg = await exportSVG(s, lib, palettes);
    if (key !== variantsKey) return; // superseded by a newer call
    const b = document.createElement('button');
    b.className = 'variant';
    b.title = 'Применить этот вариант';
    b.innerHTML = `<img alt="Вариант раскладки" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    b.onclick = () => { applyLayout(items, seed); variantsKey = key.replace(/,\d+\]$/, `,${seed}]`); scene.seed = seed; commit(); };
    box.append(b);
  }
}

function setFormat(W, H) {
  if (!Number.isFinite(W) || !Number.isFinite(H)) return toast('Укажите корректный размер');
  W = Math.max(200, Math.min(6000, Math.round(W)));
  H = Math.max(200, Math.min(6000, Math.round(H)));
  const old = { W: scene.W, H: scene.H };
  scene.W = W;
  scene.H = H;
  if (scene.items.length) {
    const items = scene.items.map(({ object, kind }) => ({ object, kind }));
    applyLayout(items, scene.seed || 1);
  } else {
    scene.scale = scene.scale * Math.min(W / old.W, H / old.H);
  }
  commit();
}

async function doExport() {
  if (!scene.items.length) return toast('Холст пуст');
  const svg = await exportSVG(scene, lib, palettes);
  download(`illustration-${scene.W}x${scene.H}-${scene.size}-${scene.schemeId}.svg`, svg);
}

// ---------- wiring ----------
$('#style').innerHTML = Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v.title}</option>`).join('');
$('#style').value = scene.style || 'assembled';
$('#style').onchange = () => {
  scene.style = $('#style').value;
  if (scene.items.length) { applyLayout(scene.items.map(({ object, kind }) => ({ object, kind })), scene.seed); commit(); }
};

function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('#mode button')) b.setAttribute('aria-selected', b.dataset.mode === m);
  $('#prompt-label').textContent = m === 'metaphor' ? 'Метафора или заголовок' : 'Названия компонентов через запятую';
  $('#prompt').placeholder = m === 'metaphor' ? 'Например: Кэшбэк за каждую покупку' : 'Например: книга, телефон, фоновые наушники';
  $('#bg-field').hidden = m === 'names';
  $('#examples').innerHTML = '';
  for (const ex of EXAMPLES[m]) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = ex;
    c.onclick = () => { $('#prompt').value = ex; build(); };
    $('#examples').append(c);
  }
}
document.querySelectorAll('#mode button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
setMode('metaphor');

$('#build').onclick = () => build();
$('#reroll').onclick = () => (scene.lastItems?.length ? build({ reroll: true }) : build());
$('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); build(); } });
$('#export').onclick = doExport;
$('#export2').onclick = doExport;
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#clear').onclick = () => { scene.items = []; scene.lastItems = null; variantsKey = ''; editor.selected = null; $('#variants').innerHTML = ''; $('#explain').textContent = ''; commit(); };
$('#copy').onclick = async () => {
  if (!scene.items.length) return toast('Холст пуст');
  try { await navigator.clipboard.writeText(await exportSVG(scene, lib, palettes)); toast('SVG скопирован — вставьте в Figma (Ctrl+V)'); } catch { toast('Браузер не дал доступ к буферу обмена'); }
};
$('#save-json').onclick = () => download('scene.json', JSON.stringify(scene, null, 2), 'application/json');
$('#open-json').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const s = JSON.parse(await f.text());
    scene = validateScene(s);
    editor.selected = null;
    commit();
  } catch { toast('Не удалось прочитать сцену'); }
  e.target.value = '';
};
document.querySelectorAll('#size button').forEach((b) => (b.onclick = () => { scene.size = b.dataset.size; commit(); }));
$('#fapply').onclick = () => setFormat(+$('#fw').value, +$('#fh').value);
document.querySelectorAll('#selbar [data-act]').forEach((b) => (b.onclick = () => act(b.dataset.act)));

$('#upload-palette').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const list = parsePaletteFile(f.name, await f.text());
    let last;
    for (const s of list) last = palettes.add(s);
    scene.schemeId = last.id;
    commit();
    toast(`Палитра «${last.title}» загружена, композиция перекрашена`);
  } catch (err) { toast('Палитра не распознана: ' + err.message); }
  e.target.value = '';
};

const roleGrid = $('#role-grid');
const roleTitles = { bg1: 'Фон 1', bg2: 'Фон 2', bg3: 'Фон 3', bg4: 'Контур', obj1: 'Объект 1', obj2: 'Объект 2', obj3: 'Объект 3', obj4: 'Объект 4' };
for (const r of ROLES) {
  roleGrid.insertAdjacentHTML('beforeend', `<label title="${esc(lib.palettes.roles[r])}"><input type="color" data-role="${r}" value="${palettes.get('violet').colors[r].toLowerCase()}"><span>${roleTitles[r]}</span></label>`);
}
$('#scheme-save').onclick = () => {
  const colors = {};
  roleGrid.querySelectorAll('input').forEach((i) => (colors[i.dataset.role] = i.value));
  try {
    const s = palettes.add({ title: $('#scheme-name').value || 'Своя схема', colors });
    scene.schemeId = s.id;
    commit();
  } catch (err) { toast(err.message); }
};

$('#upload-svg').onchange = async (e) => {
  let n = 0;
  for (const f of e.target.files) {
    try { lib.addCustom(f.name, await f.text()); n++; } catch (err) { toast(`${f.name}: ${err.message}`); }
  }
  if (n) { libKey = ''; refresh(); toast(`Добавлено в библиотеку: ${n}`); }
  e.target.value = '';
};

function renderAi() {
  const on = !!getKey();
  $('#ai-status').textContent = on ? 'Claude' : 'офлайн';
  $('#ai-status').classList.toggle('on', on);
  $('#ai-key').value = on ? '••••••••' : '';
}
$('#ai-save').onclick = () => {
  const v = $('#ai-key').value.trim();
  if (v && !v.startsWith('•')) setKey(v);
  if (!v) setKey('');
  renderAi();
  toast(getKey() ? 'Ключ действует до перезагрузки вкладки' : 'Ключ удалён');
};
renderAi();

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  const it = editor.item();
  if (!it) return;
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); act('dup'); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); act('del'); }
  else if (e.key === ']') act('up');
  else if (e.key === '[') act('down');
  else if (e.key === 'Escape') editor.select(null);
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = e.shiftKey ? 20 : 4;
    if (e.key === 'ArrowLeft') it.cx -= d;
    if (e.key === 'ArrowRight') it.cx += d;
    if (e.key === 'ArrowUp') it.cy -= d;
    if (e.key === 'ArrowDown') it.cy += d;
    editor.updateItem(it);
    clearTimeout(arrowT);
    arrowT = setTimeout(commit, 300);
  }
});
let arrowT;

let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), 3200);
}

function saveScene() {
  try { localStorage.setItem(SCENE_KEY, JSON.stringify(scene)); } catch { /* ignore */ }
}
function validateScene(s) {
  if (!s || !Array.isArray(s.items) || s.items.length > 500 ||
      ![s.W, s.H].every(v => Number.isInteger(v) && v >= 200 && v <= 6000) ||
      !Number.isFinite(s.scale) || s.scale <= 0 || s.scale > 100 ||
      !['L', 'S'].includes(s.size)) throw new Error('Некорректная сцена');
  const items = s.items.filter(i => i && lib.get(i.object) && ['main','bg'].includes(i.kind) &&
    [i.cx,i.cy,i.rot ?? 0].every(v => Number.isFinite(v) && Math.abs(v) < 1e7))
    .map(i => ({ uid: newUid(), object: i.object, kind: i.kind, cx: i.cx, cy: i.cy, rot: i.rot ?? 0 }));
  return { W: s.W, H: s.H, scale: s.scale, size: s.size,
    schemeId: palettes.get(s.schemeId).id, style: Object.hasOwn(STYLES, s.style) ? s.style : 'assembled',
    seed: Number.isSafeInteger(s.seed) ? s.seed : 1, items };
}
function loadScene() {
  try {
    const s = JSON.parse(localStorage.getItem(SCENE_KEY));
    if (s && Array.isArray(s.items)) {
      return validateScene(s);
    }
  } catch { /* ignore */ }
  return null;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// first visit: show a ready composition
let visited = false;
try { visited = !!localStorage.getItem(SCENE_KEY); } catch { /* storage blocked */ }
if (!scene.items.length && !visited) {
  $('#prompt').value = EXAMPLES.metaphor[0];
  build();
} else {
  refresh();
}

// expose for automated checks / demos
window.__composer = { get scene() { return scene; }, lib, palettes, build, setFormat, exportSVG: () => exportSVG(scene, lib, palettes) };
