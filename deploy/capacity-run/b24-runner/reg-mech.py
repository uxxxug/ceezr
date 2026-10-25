#!/usr/bin/env python3
"""LOAD-01 · ذاكرةُ قائمةِ المدن (#658) + تسجيلُ السائقِ بجملةٍ واحدة (#659) — محكُّ الآليّة (REG_RULE في PROTOCOL-load01-reg-ab.md §6).

لكلِّ موجةٍ (SLOT:DIR) من pg_stat_statements: نداءاتُ قراءةِ المدنِ المفعَّلة (`from cities where is_active`، `name_ar`)،
ونداءاتُ جملةِ التسجيلِ الواحدة (`with u as (` + `insert into driver_capabilities`)، ونداءاتُ الإدراجِ المنفردِ في
`driver_capabilities (city_id, driver_id, service, is_enabled)` (خارجَ تلك الجملة؛ إدراجُ `(city_id, driver_id, service)` في مسارٍ آخرَ لا يُعَدّ).
الحكم MECH_ENGAGED إن تحقّقَ في كلِّ موجاتِ B: المدنُ < min(A)/10، وجملةُ التسجيلِ > 0، والإدراجُ المنفردُ = 0؛
وفي كلِّ موجاتِ A: جملةُ التسجيلِ = 0 والإدراجُ المنفردُ > 0. لا يحذفُ ولا يُقدِّر: ملفٌّ غائبٌ ⇒ خطأٌ صريح.
"""
import csv, gzip, json, re, sys
csv.field_size_limit(10**9)

def wave(slot, d):
    cities = single = solo = 0
    for x in csv.DictReader(gzip.open(f"{d}/pgss-full.csv.gz", "rt")):
        q = " ".join(x["query"].split()).lower()
        n = int(x["calls"])
        if "from cities where is_active" in q and "name_ar" in q:
            cities += n
        elif q.startswith("with u as (") and "insert into driver_capabilities" in q:
            single += n
        elif q.startswith("insert into driver_capabilities (city_id, driver_id, service, is_enabled)"):
            solo += n
    return {"slot": slot, "arm": slot[0], "cityListCalls": cities, "registerSingleCalls": single, "capabilityInsertCalls": solo}

last = {}
for a in sys.argv[1:]:
    slot, d = a.split(":", 1)
    last[slot] = d  # موجةٌ أُعيدت ⇒ الأخيرةُ تستبدلُ الأصل (PROTOCOL §4)
rows = [wave(s, d) for s, d in last.items()]
A = [r for r in rows if r["arm"] == "A"]; B = [r for r in rows if r["arm"] == "B"]
verdict, why = "NO_VERDICT", "ذراعٌ بلا موجات"
if A and B:
    lim = min(r["cityListCalls"] for r in A) / 10
    bad = [f"{r['slot']}:cities={r['cityListCalls']}>={lim}" for r in B if r["cityListCalls"] >= lim]
    bad += [f"{r['slot']}:single=0" for r in B if r["registerSingleCalls"] <= 0]
    bad += [f"{r['slot']}:capInsert={r['capabilityInsertCalls']}" for r in B if r["capabilityInsertCalls"] != 0]
    bad += [f"{r['slot']}:A_single={r['registerSingleCalls']}" for r in A if r["registerSingleCalls"] != 0]
    bad += [f"{r['slot']}:A_capInsert=0" for r in A if r["capabilityInsertCalls"] <= 0]
    verdict = "MECH_NOT_ENGAGED" if bad else "MECH_ENGAGED"
    why = bad or [f"cityLimit={lim}"]
print(json.dumps({"rule": "REG_RULE", "verdict": verdict, "why": why, "waves": rows}, ensure_ascii=False, indent=1))
