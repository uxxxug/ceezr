#!/usr/bin/env python3
"""خريطةُ استعلامِ البحثِ عن المرشّحين: العبارة ← المسار ← التجمّع (Batch32، موجاتُ C/P/I).

قراءةٌ فقط من الخامِ الملتزَم: pgss-full.csv.gz (غيرُ مرشَّحٍ بـapplication_name)، dispatch-trace.jsonl.gz
(أثرُ شوطِ إعادةِ التوزيعِ الفوريِّ في البوابة)، load-trace.jsonl.gz (سجلّاتُ pdb/pagg لكلِّ مسارٍ وتجمّعٍ —
`runSumMs` = زمنُ احتجازِ مقعدِ بوّابةِ التجمّعِ من المنحِ حتى الحسم، مقيسٌ من جهةِ العميل؛ ليس زمنَ CPU)،
offers.csv.gz (جولاتُ العروضِ في القاعدة).
الاستعمال: python3 query-map.py [موجة ...]   (افتراضيًّا: كلُّ موجاتِ s1r/s2/a1)
"""
import collections, csv, gzip, io, json, os, sys
csv.field_size_limit(10**9)
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "raw", "batch32", "gh-seat-39711901468", "raw")

def pgss(w):
    r = csv.reader(io.TextIOWrapper(gzip.open(f"{RAW}/{w}/pgss-full.csv.gz"), encoding="utf-8")); h = next(r)
    out = {"nearby": None, "inCity": None, "openRound": None}
    for row in r:
        d = dict(zip(h, row)); q = d["query"]
        if "as driver_id" in q and "st_dwithin" in q: out["nearby"] = (int(d["calls"]), float(d["total_ms"]))
        elif "as driver_id" in q and "where d.city_id = $" in q: out["inCity"] = (int(d["calls"]), float(d["total_ms"]))
        elif q.startswith("select open_offer_round"): out["openRound"] = (int(d["calls"]), float(d["total_ms"]))
    return out

def dtrace(w):
    ph = collections.Counter(); orders = 0; passes = 0; opened = []
    for l in gzip.open(f"{RAW}/{w}/dispatch-trace.jsonl.gz", "rt"):
        j = json.loads(l)
        if j.get("k") == "order":
            orders += 1
            for p in j.get("phases", {}): ph[p] += 1
            if "openRound" in j.get("phases", {}): opened.append((j["orderId"], j["startAt"], j["startAt"] + j["totalMs"]))
        elif j.get("k") == "pass": passes += 1
    return orders, passes, ph, opened

def ltrace(w):
    pdb = collections.Counter(); seat = collections.Counter(); wait = collections.Counter(); n = collections.Counter()
    for l in gzip.open(f"{RAW}/{w}/load-trace.jsonl.gz", "rt"):
        j = json.loads(l)
        if j.get("k") == "pdb": pdb[(j["path"], j["pool"])] += j["n"]
        if j.get("k") == "pagg" and j["kind"] != "txQuery":
            k = (j["pool"].replace("ceezr:", ""), j["path"]); seat[k] += j["runSumMs"]; wait[k] += j["waitSumMs"]; n[k] += j["n"]
    return pdb, seat, wait, n

def unattributed(w, opened):
    rounds = {}
    for r in csv.DictReader(io.TextIOWrapper(gzip.open(f"{RAW}/{w}/offers.csv.gz"))):
        rounds.setdefault((r["order_id"], int(r["round"])), int(r["created_ms"]))
    by = collections.defaultdict(list)
    for (o, rd), t in rounds.items(): by[o].append((t, rd))
    used = set()
    for o, s, e in opened:
        for t, rd in sorted(by[o]):
            if (o, rd) not in used and s - 5 <= t <= e + 5: used.add((o, rd)); break
    rest = sorted(t for k, t in rounds.items() if k not in used)
    cl = []
    for t in rest:
        if cl and t - cl[-1][-1] <= 2000: cl[-1].append(t)
        else: cl.append([t])
    t0 = min(rounds.values()) if rounds else 0
    return len(rounds), len(used), cl, t0

waves = sys.argv[1:] or sorted(d for d in os.listdir(RAW) if d.startswith(("b32main-s1r-", "b32main-s2-", "b32main-a1-")))
for w in waves:
    p = pgss(w); orders, passes, ph, opened = dtrace(w); pdb, seat, wait, n = ltrace(w)
    rq = pdb.get(("redispatch:immediate", "ceezr:gatewayDispatch"), 0)
    expect = ph["offers"] + ph["nearby"] + ph["openRound"] + ph["all"] + 2 * passes
    print(f"== {w}")
    print(f"  pgss nearby calls={p['nearby'][0]} exec_s={p['nearby'][1]/1000:.1f} | inCity calls={p['inCity'][0]} | open_offer_round calls={p['openRound'][0]}")
    print(f"  dispatch-trace (gatewayDispatch): orders={orders} passes={passes} phases={dict(ph)}")
    print(f"  load-trace redispatch:immediate@gatewayDispatch queries={rq} ; phases+2*passes={expect} ; equal={rq == expect}")
    print(f"  pgss nearby − trace nearby = {p['nearby'][0] - ph['nearby']} ; pgss open_offer_round − trace openRound = {p['openRound'][0] - ph['openRound']}")
    other = sorted({k[0] for k in pdb if k[0] != "redispatch:immediate" and k[1] == "ceezr:gatewayDispatch"})
    print(f"  other paths on gatewayDispatch: {other or 'none'}")
    total, matched, cl, t0 = unattributed(w, opened)
    print(f"  offer rounds in DB={total} matched-to-trace={matched} unattributed={total - matched} clusters={len(cl)} max_cluster={max((len(c) for c in cl), default=0)}")
    print(f"    cluster starts (s since first round): {[round((c[0]-t0)/1000, 1) for c in cl]}")
    tot = collections.Counter()
    for (pool, _), v in seat.items(): tot[pool] += v
    print("  seat-seconds by pool: " + ", ".join(f"{k}={v/1000:.1f}" for k, v in sorted(tot.items())))
    for k, v in sorted(seat.items(), key=lambda x: -x[1])[:6]:
        print(f"    {k[0]:14} {k[1]:40} n={n[k]:6} seat_s={v/1000:6.1f} ({100*v/tot[k[0]]:4.1f}%) wait_s={wait[k]/1000:7.1f}")
