import json, gzip, statistics, collections

RAW = '/tmp/wave-artifact/raw'
WAVES = ['A1-i80','B1-i81','B2-i82','A2-i83','A3-i84','B3-i85','B4-i86','A4-i87']
PAIRS = [('A1-i80','B1-i81'), ('A2-i83','B2-i82'), ('A3-i84','B3-i85'), ('A4-i87','B4-i86')]
ROUTES = ['POST /v1/rides', 'POST /v1/session/telegram', 'GET /v1/driver/offers']
out = {'pairs': PAIRS, 'per_pair': {}, 'buckets': {}}

def windows(w):
    rows = []
    last_at = None; acc = {'hn': 0, 'hw': 0.0, 'dn': 0}
    for line in gzip.open(f'{RAW}/load01c2-c2ab-{w}-M-1500/load-trace.jsonl.gz', 'rt'):
        d = json.loads(line)
        if d.get('k') != 'pdb': continue
        if last_at is not None and d['at'] != last_at:
            if acc['hn'] > 0: rows.append(acc)
            acc = {'hn': 0, 'hw': 0.0, 'dn': 0}
        if d['path'].startswith('http:'):
            acc['hn'] += d['n']; acc['hw'] += d['waitSumMs']
        else:
            acc['dn'] += d['n']
        last_at = d['at']
    if acc['hn'] > 0: rows.append(acc)
    return rows

for a, b in PAIRS:
    r = {}
    http = {w: {} for w in (a, b)}; pdb = {w: {} for w in (a, b)}; loop = {w: [] for w in (a, b)}
    dur = {}
    for w in (a, b):
        first = last = None
        for line in gzip.open(f'{RAW}/load01c2-c2ab-{w}-M-1500/load-trace.jsonl.gz', 'rt'):
            d = json.loads(line)
            at = d.get('at')
            if at is not None:
                if last is None or at > last: last = at
                if first is None or at < first: first = at
            k = d.get('k')
            if k == 'http':
                e = http[w].setdefault(d['route'], [0, 0.0])
                e[0] += d['n']; e[1] += d['sumMs']
            elif k == 'pdb':
                if d['path'].startswith('http:'):
                    p = pdb[w].setdefault(d['path'], {'waitSum': 0.0, 'runSum': 0.0, 'n': 0})
                    p['waitSum'] += d['waitSumMs']; p['runSum'] += d['runSumMs']; p['n'] += d['n']
                else:
                    pdb[w]['(drainer)'] = pdb[w].get('(drainer)', {'n': 0})
                    pdb[w]['(drainer)']['n'] += d['n']
            elif k == 'loop':
                loop[w].append((d['lagP95Ms'], d['processCpuPct']))
        dur[w] = (last - first) / 1000 if last is not None and last > first else 1.0
    r['duration_s'] = {a: dur[a], b: dur[b]}
    r['http_route'] = {}
    for route in ROUTES:
        ea, eb = http[a].get(route), http[b].get(route)
        if ea and eb and ea[0] > 0 and eb[0] > 0:
            r['http_route'][route] = {'meanA_ms': ea[1]/ea[0], 'meanB_ms': eb[1]/eb[0], 'BA': (eb[1]/eb[0])/(ea[1]/ea[0])}
    r['pool_paths'] = {}
    for path in [f'http:{rt}' for rt in ROUTES[:2]]:
        pa, pb = pdb[a].get(path), pdb[b].get(path)
        if pa and pb and pa['n'] > 0 and pb['n'] > 0:
            r['pool_paths'][path] = {
                'waitA_ms': pa['waitSum']/pa['n'], 'waitB_ms': pb['waitSum']/pb['n'], 'waitBA': (pb['waitSum']/pb['n'])/(pa['waitSum']/pa['n']),
                'runA_ms': pa['runSum']/pa['n'], 'runB_ms': pb['runSum']/pb['n'], 'runBA': (pb['runSum']/pb['n'])/(pa['runSum']/pa['n'])}
    def agg(w):
        hn = hw = dn = 0
        for p, v in pdb[w].items():
            if p.startswith('http:'): hn += v['n']; hw += v['waitSum']
            else: dn += v['n']
        return hn, hw/1000, dn
    ha, hwa, da = agg(a); hb, hwb, db_ = agg(b)
    r['pool_totals'] = {'httpAcqA': ha, 'httpAcqB': hb, 'httpAcqBA': hb/ha,
                        'drainAcqA': da, 'drainAcqB': db_, 'drainAcqBA': db_/da,
                        'totalAcqBA': (hb+db_)/(ha+da), 'httpWaitTotalA_s': hwa, 'httpWaitTotalB_s': hwb, 'httpWaitBA': hwb/hwa}
    def httpn(w):
        n = 0
        for line in gzip.open(f'{RAW}/load01c2-c2ab-{w}-M-1500/load-trace.jsonl.gz', 'rt'):
            d = json.loads(line)
            if d.get('k') == 'http': n += d['n']
        return n
    na, nb = httpn(a), httpn(b)
    r['http_rate'] = {'rateA': na/dur[a], 'rateB': nb/dur[b], 'BA': (nb/dur[b])/(na/dur[a])}
    r['loop'] = {'lagP95MedA': statistics.median(x[0] for x in loop[a]), 'lagP95MedB': statistics.median(x[0] for x in loop[b]),
                 'procCpuMedA': statistics.median(x[1] for x in loop[a]), 'procCpuMedB': statistics.median(x[1] for x in loop[b])}
    out['per_pair'][f'{a[-4:]}_vs_{b[-4:]}'] = r

A, B = [], []
for w in WAVES:
    for x in windows(w):
        if x['hn'] > 100:
            (A if w.startswith('A') else B).append((x['hn'], x['dn'], x['hw']/x['hn']))
def curve(pts, keyf):
    b = collections.defaultdict(list)
    for hn, dn, wt in pts: b[keyf(hn, dn)].append(wt)
    return {str(k): {'n': len(v), 'waitMed': statistics.median(v)} for k, v in sorted(b.items()) if len(v) >= 3}
out['buckets']['equal_http_arrivals'] = {'A': curve(A, lambda h, d: round(h/1000)*1000), 'B': curve(B, lambda h, d: round(h/1000)*1000)}
out['buckets']['equal_total_acquisitions'] = {'A': curve(A, lambda h, d: round((h+d)/500)*500), 'B': curve(B, lambda h, d: round((h+d)/500)*500)}

with open('/home/user/workspace/ceezr/docs/evidence/capacity/LOAD01-C2-HTTP-WAIT-ANALYSIS-20261026/analysis.json', 'w') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print('ok — pairs:', len(out['per_pair']))
