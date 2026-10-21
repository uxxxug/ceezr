"""B27 — decompose phone-proof (driver update job) latency from batch-26 raw evidence.
Inputs per wave: update-jobs.csv.gz (bot,update_id,created_ms,done_ms,status,attempts),
load-trace.jsonl.gz (k=job drainer timings, k=sweep, k=db pool stats, k=loop).
No PII: only update ids and timings."""
import gzip,csv,json,sys,statistics as st,collections
ROOT=sys.argv[1]
def pct(a,p):
  a=sorted(a); return a[min(len(a)-1,int(p*len(a)))] if a else float('nan')
out={}
for w in "R1 C1 R2 C2 R3 C3 R4 C4".split():
  d=f"{ROOT}/b26-s1-{w}-750"
  jobs={}
  for r in csv.reader(gzip.open(f"{d}/update-jobs.csv.gz","rt")):
    if r[0]=='driver': jobs[int(r[1])]=(int(r[2]),int(r[3]) if r[3] else None)
  tr=[json.loads(l) for l in gzip.open(f"{d}/load-trace.jsonl.gz","rt")]
  J=[t for t in tr if t.get('k')=='job' and t['bot']=='driver']
  qw=[];lw=[];svc=[];eff=[];prep=[];rec=[];tot=[]
  for t in J:
    c=jobs.get(t['updateId'])
    if not c: continue
    qw.append(t['claimedAt']-c[0]); lw.append(t['startedAt']-t['claimedAt'])
    svc.append(t['endedAt']-t['startedAt']); tot.append(t['endedAt']-c[0])
    eff.append(t['effectCheckMs'] or 0); prep.append(t['prepareMs'] or 0); rec.append(t['recordMs'] or 0)
  # max concurrency of in-service jobs (lanes actually used)
  evs=sorted([(t['startedAt'],1) for t in J]+[(t['endedAt'],-1) for t in J])
  cur=mx=0; 
  for _,x in evs: cur+=x; mx=max(mx,cur)
  # time-weighted mean concurrency during busy window
  t0=min(t['startedAt'] for t in J); t1=max(t['endedAt'] for t in J)
  busy=sum(t['endedAt']-t['startedAt'] for t in J)/(t1-t0)
  sw=[t for t in tr if t.get('k')=='sweep']
  claimMs=sum(s['claimMs'] for s in sw); trips=sum(s['claimTrips'] for s in sw)
  pools=collections.defaultdict(lambda:[0,0,0])
  for t in tr:
    if t.get('k')=='db': p=pools[(t['pool'],t['kind'])]; p[0]+=t['n']; p[1]+=t['waitSumMs']; p[2]+=t['runSumMs']
  loop=[t for t in tr if t.get('k')=='loop']
  r=dict(n=len(qw),
    queue_wait_p50=pct(qw,.5),queue_wait_p95=pct(qw,.95),
    lane_wait_p50=pct(lw,.5),svc_p50=pct(svc,.5),svc_p95=pct(svc,.95),svc_mean=st.mean(svc),
    effectCheck_mean=st.mean(eff),prepare_mean=st.mean(prep),record_mean=st.mean(rec),
    effectCheck_p95=pct(eff,.95),prepare_p95=pct(prep,.95),
    total_p50=pct(tot,.5),total_p95=pct(tot,.95),
    max_concurrency=mx,mean_concurrency=busy,
    implied_capacity_per_s=mx/(st.mean(svc)/1000),
    claim_trip_mean_ms=claimMs/max(1,trips),
    loop_lag_p95_max=max(t['lagP95Ms'] for t in loop), main_cpu_p50=pct([t['mainThreadCpuPct'] for t in loop],.5),
    proc_cpu_p50=pct([t['processCpuPct'] for t in loop],.5),
    pools={f"{k[0]}/{k[1]}":dict(n=v[0],wait_mean=v[1]/max(1,v[0]),run_mean=v[2]/max(1,v[0])) for k,v in pools.items()})
  out[w]=r
  print(w, ' '.join(f"{k}={v:.1f}" if isinstance(v,float) else f"{k}={v}" for k,v in r.items() if k!='pools'))
  for k,v in r['pools'].items(): print('   ',k,{a:round(b,2) for a,b in v.items()})
json.dump(out,open(sys.argv[2],'w'),indent=1)
