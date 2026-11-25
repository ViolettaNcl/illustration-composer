import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
test('fresh browser: compose, edit, recolor, export, SVG safety', {timeout:180000}, async () => {
  const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'ignore'});
  let browser;
  try {
    const url='http://127.0.0.1:4173/';
    for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{} await new Promise(r=>setTimeout(r,250));}
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:'artifacts/demo',size:{width:1440,height:960}}});
    const page=await context.newPage();
    await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const c=document.createElement('div');c.style.cssText='position:fixed;width:22px;height:22px;border:2px solid #7752d5;border-radius:50%;background:#e8d5ff55;box-shadow:0 0 0 2px white;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);opacity:0';document.body.append(c);
      document.addEventListener('mousemove',e=>{c.style.left=e.clientX+'px';c.style.top=e.clientY+'px';c.style.opacity='1';});
    }));
    const show=(ms=2300)=>page.waitForTimeout(ms);
    let last={x:720,y:450};
    const move=async(x,y)=>{const from=last;for(let i=1;i<=20;i++){const t=i/20,e=t*t*(3-2*t);await page.mouse.move(from.x+(x-from.x)*e,from.y+(y-from.y)*e);await show(16);}last={x,y};};
    const click=async(sel)=>{const loc=page.locator(sel).first();await loc.scrollIntoViewIfNeeded();const b=await loc.boundingBox();await move(b.x+b.width/2,b.y+b.height/2);await show(160);await page.mouse.click(last.x,last.y);};
    const note=async(text)=>page.evaluate(t=>{let n=document.getElementById('demo-note');if(!n){n=document.createElement('div');n.id='demo-note';n.style.cssText='position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:2147483646;pointer-events:none;background:#252432ee;color:white;padding:12px 22px;border-radius:10px;font:600 17px system-ui;box-shadow:0 4px 20px #0003;white-space:nowrap';document.body.append(n);}n.textContent=t;},text);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(()=>window.__composer?.scene.items.length>0);
    await note('01  /  Автокомпозиция по смыслу — без API-ключа');
    await show(3200);
    await note('02  /  Сборка по названиям компонентов');
    await click('#mode [data-mode=names]');
    await click('#prompt');
    await page.locator('#prompt').fill('');
    await page.locator('#prompt').pressSequentially('книга, телефон, 2 монеты, фоновые наушники',{delay:45});
    await show(800);
    await click('#build');
    await page.waitForFunction(()=>window.__composer.scene.items.length===5);
    await show();
    const scene=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__composer.scene)));
    await note('03  /  Выбор объекта в списке слоёв');
    await click('#layers li');
    await show(700);
    await note('04  /  Поворот объекта');
    await click('#selbar [data-act=rotr]');
    assert.equal((await scene()).items.at(-1).rot,15);
    await show();
    await note('05  /  Дублирование');
    await click('#selbar [data-act=dup]');
    assert.equal((await scene()).items.length,6);
    await show();
    const uid=(await scene()).items.at(-1).uid;
    await note('06  /  Изменение порядка слоёв');
    await click('#selbar [data-act=down]');
    await show(1800);
    assert.equal((await scene()).items.at(-2).uid,uid);
    await note('07  /  Удаление и история действий');
    await click('#selbar [data-act=del]');
    await show(1200);
    assert.equal((await scene()).items.length,5);
    await click('#undo');
    await show(1000);
    assert.equal((await scene()).items.length,6);
    await click('#redo');
    await show(1000);
    assert.equal((await scene()).items.length,5);
    await note('08  /  Добавление SVG из библиотеки');
    await click('#library [data-k=main]');
    await show(1500);
    assert.equal((await scene()).items.length,6);
    await click('#layers li');
    await note('09  /  Перемещение выбранного объекта');
    const old=await scene(); await page.keyboard.press('ArrowRight');
    await page.waitForFunction(x=>window.__composer.scene.items.at(-1).cx===x+4,old.items.at(-1).cx);
    const pos=await scene(); const bbox=await page.locator('#ed-items [data-uid="'+pos.items.at(-1).uid+'"]').boundingBox();
    if(bbox){await move(bbox.x+bbox.width/2,bbox.y+bbox.height/2);await page.mouse.down();await move(last.x+50,last.y-30);await page.mouse.up();}
    await show(1800);
    await note('10  /  Переключение детализации L/S');
    await click('#size [data-size=S]');
    await show(1500);
    assert.equal((await scene()).size,'S');
    await note('11  /  Загрузка своей палитры и перекраска');
    await page.locator('#upload-palette').setInputFiles('examples/palettes/sunset.json');
    await page.waitForFunction(()=>window.__composer.scene.schemeId!=='violet');
    assert.equal(await page.locator('#ed-bg').getAttribute('fill'),'#FFE1D6');
    await show();
    const downloadPromise=page.waitForEvent('download');
    await note('12  /  Экспорт композиции в SVG');
    await click('#export');
    const download=await downloadPromise;
    const svg=await readFile(await download.path(),'utf8');
    assert.match(svg,/<g id="composition"/);
    assert.match(svg,/<path\b/); assert.doesNotMatch(svg,/<image\b/);
    await note('Готово: SVG сохраняет редактируемые группы и контуры');
    await show(3500);
    const result=await page.evaluate(()=>{
      const lib=window.__composer.lib;
      const safe=lib.addCustom('safe.svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path onclick="alert(1)" d="M0 0L20 20"/></svg>');
      const markup=safe.variants.main_L.markup;
      let rejected=0;
      for(const inner of ['<script>alert(1)</script>','<image href="https://example.com/a.png"/>','<path fill="url(https://example.com/a)" d="M0 0"/>']){
        try{lib.addCustom('bad.svg','<svg xmlns="http://www.w3.org/2000/svg">'+inner+'</svg>');}catch{rejected++;}
      }
      return {markup,rejected};
    });
    assert.doesNotMatch(result.markup,/onclick/); assert.equal(result.rejected,3);
    assert.equal(await page.evaluate(()=>localStorage.getItem('ic.anthropicKey')),null);
    assert.deepEqual(errors,[]);
    await context.close();
  } finally { await browser?.close(); server.kill(); }
});
