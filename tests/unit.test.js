import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromNames, fromMetaphor } from '../src/semantic.js';
import { Palettes, parsePaletteFile, recolor } from '../src/palette.js';
import { autoLayout } from '../src/layout.js';
import { exportSVG } from '../src/scene.js';
const read = path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
const manifest = read('public/library/manifest.json');
const lib = { objects: manifest.objects, get: id => manifest.objects.find(o => o.id === id) };
const palettes = new Palettes(read('public/library/palettes.json'));
test('40 source SVGs and all variants', () => {
  assert.equal(lib.objects.length, 10);
  for (const o of lib.objects) for (const k of ['main_L','main_S','bg_L','bg_S']) {
    assert.ok(o.variants[k].w > 0);
    assert.match(readFileSync(new URL('../public/library/' + o.variants[k].file, import.meta.url),'utf8'), /<svg/);
  }
});
test('named objects, quantities, backgrounds', () => {
  const r = fromNames('книга, телефон, 2 монеты, фоновые наушники', lib);
  assert.equal(r.items.length, 5);
  assert.equal(r.items.filter(i => i.object === 'coin').length, 2);
  assert.equal(r.items.at(-1).kind, 'bg');
  assert.equal(r.unknown.length, 0);
});
test('metaphor selects catalogue objects and respects no-background option', () => {
  const r = fromMetaphor('Кэшбэк за каждую покупку', lib, { background: 'none' });
  assert.ok(r.items.length >= 2 && r.items.every(i => lib.get(i.object) && i.kind === 'main'));
});
test('layout deterministic, finite and one uniform scale', () => {
  const input = { items: fromNames('книга, телефон, фоновая лампа', lib).items, dims: id => {
    const v = lib.get(id).variants.main_L; return {w:v.w,h:v.h};
  }, W:1200,H:630, style:'title',seed:42 };
  const a = autoLayout(input);
  assert.deepEqual(a, autoLayout(input));
  assert.ok(a.scale > 0 && Number.isFinite(a.scale));
  assert.ok(a.items.every(i => Number.isFinite(i.cx) && Number.isFinite(i.cy)));
});
test('custom palette maps roles and preserves path geometry', () => {
  const s = palettes.add(parsePaletteFile('sunset.json', JSON.stringify(read('examples/palettes/sunset.json')))[0]);
  const color = palettes.source.colors.bg1;
  const markup = '<path d="M1 2L3 4" fill="' + color + '"/>';
  assert.equal(recolor(markup,palettes.map(s.id)), '<path d="M1 2L3 4" fill="' + s.colors.bg1 + '"/>');
  assert.throws(() => parsePaletteFile('bad.txt','#ffffff'));
});
test('export creates groups, preserves vectors and escapes palette title', async () => {
  const p = palettes.add({title:'A & B < test',colors:palettes.source.colors});
  const l = {preload:async()=>{},norm:()=>1,component:async()=>({vb:[0,0,10,10],inner:'<path d="M1 2L3 4"/>'})};
  const svg = await exportSVG({W:1200,H:630,size:'L',schemeId:p.id,scale:1,items:[{object:'book',kind:'main',cx:10,cy:10,rot:15}]},l,palettes);
  assert.match(svg,/A &amp; B &lt; test/);
  assert.match(svg,/id="book-main-1"/);
  assert.match(svg,/d="M1 2L3 4"/);
  assert.doesNotMatch(svg,/<image/);
});
