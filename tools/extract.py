import json,re,sys,os
NAMES=['book','phone','puzzle','coin','headphones','lamp','flowers','wallet','folder','pen']
def run(size,svgf,bbf,clf,out):
    lines=[l for l in open(svgf).read().split('\n')]
    # map top-level element index -> source line (top-level children are one per line, except defs/g)
    body=[l for l in lines[1:] if l and not l.startswith('</svg')]
    d=json.load(open(bbf)); cl=json.load(open(clf))
    # elements: one per line until '<g clip' / '<defs'; verify count
    els=[]; i=0; depth=0; cur=''
    for l in body:
        if depth==0 and (l.startswith('<g') or l.startswith('<defs')):
            depth=1; cur=l; continue
        if depth: cur+='\n'+l
        if depth and (l.startswith('</g>') or l.startswith('</defs>')): els.append(cur);depth=0;continue
        if depth: continue
        els.append(l)
    assert len(els)==len(d),(len(els),len(d))
    # groups
    big=[c for c in cl if c['n']>5]
    small=[c for c in cl if c['n']<=5 and c['fills']!=['black']]
    groups=[]
    for c in big:
        idx=sorted(c['idx']); parts=[[idx[0]]]
        for k in idx[1:]:
            if k-parts[-1][-1]>20: parts.append([k])
            else: parts[-1].append(k)
        tiny=[p for p in parts if len(p)<3]; parts=[p for p in parts if len(p)>=3]
        for t in tiny:
            e=d[t[0]]; cx,cy=e['x']+e['w']/2,e['y']+e['h']/2
            def dist(p):
                es=[d[k] for k in p]; x0=min(q['x'] for q in es);y0=min(q['y'] for q in es);x1=max(q['x']+q['w'] for q in es);y1=max(q['y']+q['h'] for q in es)
                return max(x0-cx,0,cx-x1)+max(y0-cy,0,cy-y1)+abs((x0+x1)/2-cx)*1e-3
            min(parts,key=dist).extend(t)
        groups+=parts
    for s in small:  # attach strays to nearest by index
        k=s['idx'][0]; g=min(groups,key=lambda g:min(abs(k-x) for x in g)); g.append(k)
    def box(g):
        es=[d[k] for k in g]; return (min(e['x'] for e in es),min(e['y'] for e in es),max(e['x']+e['w'] for e in es),max(e['y']+e['h'] for e in es))
    groups=[sorted(g) for g in groups]
    ys=sorted(box(g)[1] for g in groups); mid=(ys[9]+ys[10])/2  # 10 main above, 10 bg below
    man=[]
    for kind,sel in (('main',[g for g in groups if box(g)[1]<mid]),('bg',[g for g in groups if box(g)[1]>=mid])):
        assert len(sel)==10,(kind,len(sel))
        # row order: cluster by y into rows of 4,4,2
        sel.sort(key=lambda g:box(g)[3])  # by bottom
        rows=[sel[:4],sel[4:8],sel[8:]]
        ordered=[g for r in rows for g in sorted(r,key=lambda g:box(g)[0])]
        for name,g in zip(NAMES,ordered):
            x0,y0,x1,y1=box(g); pad=2; x0-=pad;y0-=pad;x1+=pad;y1+=pad
            w,h=x1-x0,y1-y0
            inner='\n'.join(els[k] for k in g)
            fills=sorted(set(re.findall(r'fill="([^"]+)"',inner)))
            svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.2f}" height="{h:.2f}" viewBox="{x0:.2f} {y0:.2f} {w:.2f} {h:.2f}" fill="none">\n{inner}\n</svg>\n'
            fn=f'{name}_{kind}_{size}.svg'; open(os.path.join(out,fn),'w').write(svg)
            man.append(dict(id=f'{name}_{kind}_{size}',object=name,kind=kind,size=size,file=fn,w=round(w,2),h=round(h,2),paths=len(g),fills=fills))
    return man
# usage: python3 tools/extract.py <cache dir> <out dir>
cache,out=sys.argv[1],sys.argv[2]; os.makedirs(out,exist_ok=True)
J=lambda n: os.path.join(cache,n)
m=run('L','tools/source/library_L.svg',J('bbL.json'),J('clL.json'),out)+run('S','tools/source/library_S.svg',J('bbS.json'),J('clS.json'),out)
for x in m:  # normalise named colours so every fill is a hex value
    f=os.path.join(out,x['file']); t=open(f).read().replace('fill="white"','fill="#FFFFFF"'); open(f,'w').write(t)
json.dump(m,open('tools/extract-report.json','w'),indent=1)
for x in m: print(x['id'],x['w'],x['h'],x['paths'],x['fills'])
