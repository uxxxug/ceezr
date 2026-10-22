import gzip,json,sys,collections,statistics as st
root=sys.argv[1]; pre=sys.argv[2]
for w in "R1 C1 C2 R2 C3 R3 R4 C4".split():
  d=f"{root}/raw/{pre}-s1-{w}-750"
  tr=[json.loads(l) for l in gzip.open(f"{d}/load-trace.jsonl.gz","rt")]
  sw=[t for t in tr if t.get('k')=='sweep']
  trips=sum(s.get('claimTrips',0) for s in sw); cms=sum(s.get('claimMs',0) for s in sw)
  pools=collections.defaultdict(lambda:[0,0.0,0.0])
  for t in tr:
    if t.get('k')=='db': p=pools[(t['pool'],t['kind'])]; p[0]+=t['n']; p[1]+=t['waitSumMs']; p[2]+=t['runSumMs']
  loop=[t for t in tr if t.get('k')=='loop']
  wr=json.load(open(f"{d}/wave-report.json"))
  g={x['id']:x['value'] for x in wr['gates']+wr['perf']}
  pr={f"{k[0]}/{k[1]}":(v[0],round(v[1]/max(1,v[0]),1)) for k,v in pools.items()}
  print(w,'sweeps',len(sw),'trips',trips,'trip_ms',round(cms/max(1,trips),1),'P1-3',g['P1'],g['P2'],g['P3'],'P4',g['P4'],'cpu',round(st.median([t['processCpuPct'] for t in loop]),1),pr)
