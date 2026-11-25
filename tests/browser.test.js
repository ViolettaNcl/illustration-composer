import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
test('fresh browser: compose, edit, recolor, export, SVG safety', {timeout:90000}, async () => {
  const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4173','--strictPort'],{stdio:'ignore'});
  let browser;
  try {
    const url='http://127.0.0.1:4173/';
    for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{} await new Promise(r=>setTimeout(r,250));}
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:1440,height:960},recordVideo:{dir:'artifacts/demo',size:{width:1440,height:960}}});
    const page=await context.newPage();
    const show=()=>page.waitForTimeout(1100);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(()=>window.__composer?.scene.items.length>0);
    await show();
    await page.locator('#mode [data-mode=names]').click();
    await page.locator('#prompt').fill('книга, телефон, 2 монеты, фоновые наушники');
    await page.locator('#build').click();
    await page.waitForFunction(()=>window.__composer.scene.items.length===5);
    await show();
    const scene=()=>page.evaluate(()=>JSON.parse(JSON.stringify(window.__composer.scene)));
    await page.locator('#layers li').first().click();
    await page.locator('#selbar [data-act=rotr]').click();
    assert.equal((await scene()).items.at(-1).rot,15);
    await show();
    await page.locator('#selbar [data-act=dup]').click();
    assert.equal((await scene()).items.length,6);
    await show();
    const uid=(await scene()).items.at(-1).uid;
    await page.locator('#selbar [data-act=down]').click();
    assert.equal((await scene()).items.at(-2).uid,uid);
    await page.locator('#selbar [data-act=del]').click();
    assert.equal((await scene()).items.length,5);
    await page.locator('#undo').click();
    assert.equal((await scene()).items.length,6);
    await page.locator('#redo').click();
    assert.equal((await scene()).items.length,5);
    await page.locator('#library [data-k=main]').first().click();
    assert.equal((await scene()).items.length,6);
    await page.locator('#layers li').first().click();
    const old=await scene(); await page.locator('#layers li').first().press('ArrowRight');
    await page.waitForFunction(x=>window.__composer.scene.items.at(-1).cx===x+4,old.items.at(-1).cx);
    await page.locator('#size [data-size=S]').click();
    assert.equal((await scene()).size,'S');
    await page.locator('#upload-palette').setInputFiles('examples/palettes/sunset.json');
    await page.waitForFunction(()=>window.__composer.scene.schemeId!=='violet');
    assert.equal(await page.locator('#ed-bg').getAttribute('fill'),'#FFE1D6');
    await show();
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#export').click();
    const download=await downloadPromise;
    const svg=await readFile(await download.path(),'utf8');
    assert.match(svg,/<g id="composition"/);
    assert.match(svg,/<path\b/); assert.doesNotMatch(svg,/<image\b/);
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
