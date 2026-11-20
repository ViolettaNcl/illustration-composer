// usage: node tools/bbox.cjs <sheet.svg> <out.json>  (bbox of every top-level element, via headless Chromium)
const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
const [src,out]=process.argv.slice(2);const svg=fs.readFileSync(src,'utf8');
await p.setContent(`<body style="margin:0">${svg}</body>`);
const r=await p.evaluate(()=>{const s=document.querySelector('svg');return [...s.children].map((e,i)=>{if(e.tagName==='defs')return {i,tag:'defs'};const bb=e.getBBox();let t=e.getAttribute('transform');return {i,tag:e.tagName,x:bb.x,y:bb.y,w:bb.width,h:bb.height,fill:e.getAttribute('fill'),stroke:e.getAttribute('stroke'),t,ctm:(()=>{const m=e.getCTM();return [m.a,m.b,m.c,m.d,m.e,m.f]})()}})});
fs.writeFileSync(out,JSON.stringify(r));console.log(r.length, r.filter(x=>x.tag!=='path').map(x=>x.tag+':'+(x.t||'')).slice(0,20));
await b.close();})();
