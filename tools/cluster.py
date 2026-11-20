# usage: python3 tools/cluster.py <bbox.json> <out.json> <min y> <gap>  — union-find clustering of overlapping bboxes
import json,sys
src,out,ymin,gap=sys.argv[1],sys.argv[2],float(sys.argv[3]),float(sys.argv[4])
d=json.load(open(src))
els=[e for e in d if e['tag']!='defs' and e['y']>ymin and e['w']*e['h']<4e6]
par=list(range(len(els)))
def f(i):
    while par[i]!=i: par[i]=par[par[i]];i=par[i]
    return i
for i,a in enumerate(els):
    for j in range(i+1,len(els)):
        b=els[j]
        if a['x']-gap<b['x']+b['w'] and b['x']-gap<a['x']+a['w'] and a['y']-gap<b['y']+b['h'] and b['y']-gap<a['y']+a['h']:
            par[f(i)]=f(j)
cl={}
for i,e in enumerate(els): cl.setdefault(f(i),[]).append(e)
res=[]
for k,v in cl.items():
    x0=min(e['x'] for e in v);y0=min(e['y'] for e in v);x1=max(e['x']+e['w'] for e in v);y1=max(e['y']+e['h'] for e in v)
    res.append(dict(idx=[e['i'] for e in v],x=x0,y=y0,w=x1-x0,h=y1-y0,n=len(v),fills=sorted(set(e['fill'] or '' for e in v))))
res.sort(key=lambda r:(round(r['y']/400),r['x']))
for r in res: print(r['n'],round(r['x']),round(r['y']),round(r['w']),round(r['h']),r['fills'])
json.dump(res,open(out,'w'))
