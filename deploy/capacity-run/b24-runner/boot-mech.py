#!/usr/bin/env python3
"""LOAD-01 · الإقلاعُ المُدمَج (#656) + فحصُ الإبطالِ بـ MGET (#657) — محكُّ الآليّة (BOOT_RULE في PROTOCOL-load01-boot-ab.md §6).

لكلِّ موجةٍ (SLOT:DIR): من pg_stat_statements نداءاتُ الجملةِ المُدمَجة (`json_build_object('kind'` مع `list_user_consents`)
ونداءاتُ قراءةِ الموافقاتِ المنفردة (`select kind, version, accepted_at from list_user_consents`)،
ومن redis `info commandstats` نداءاتُ MGET وGET.
الحكم MECH_ENGAGED إن تحقّقَ في كلِّ موجاتِ B: المُدمَجةُ > 0، والمنفردةُ < min(A) (للقراءةِ المنفردةِ نداءٌ آخرُ في تسجيلِ الموافقة فلا تبلغُ الصفر)، وMGET > 0؛ وفي كلِّ موجاتِ A: MGET == 0.
لا يحذفُ ولا يُقدِّر: ملفٌّ غائبٌ ⇒ خطأٌ صريح.
"""
import csv, gzip, json, re, sys
csv.field_size_limit(10**9)

def redis(d):
    out = {}
    for line in open(f"{d}/redis-cmdstats.txt"):
        m = re.match(r"cmdstat_([a-z|]+):calls=(\d+)", line.strip())
        if m:
            out[m.group(1)] = int(m.group(2))
    if not out:
        raise SystemExit(f"{d}: commandstats فارغ")
    return out

def wave(slot, d):
    coal = solo = 0
    for x in csv.DictReader(gzip.open(f"{d}/pgss-full.csv.gz", "rt")):
        q = x["query"]
        if "list_user_consents" not in q:
            continue
        if "json_build_object" in q:
            coal += int(x["calls"])
        elif re.search(r"select\s+kind,\s*version,\s*accepted_at\s+from\s+list_user_consents", q, re.I):
            solo += int(x["calls"])
    r = redis(d)
    return {"slot": slot, "arm": slot[0], "coalescedCalls": coal, "standaloneConsentCalls": solo,
            "mget": r.get("mget", 0), "get": r.get("get", 0)}

last = {}
for a in sys.argv[1:]:
    slot, d = a.split(":", 1)
    last[slot] = d  # موجةٌ أُعيدت ⇒ الأخيرةُ تستبدلُ الأصل (PROTOCOL §4)
rows = [wave(s, d) for s, d in last.items()]
A = [r for r in rows if r["arm"] == "A"]; B = [r for r in rows if r["arm"] == "B"]
verdict, why = "NO_VERDICT", "ذراعٌ بلا موجات"
if A and B:
    lim = min(r["standaloneConsentCalls"] for r in A)
    bad = [f"{r['slot']}:coalesced=0" for r in B if r["coalescedCalls"] <= 0]
    bad += [f"{r['slot']}:standalone={r['standaloneConsentCalls']}>={lim}" for r in B if r["standaloneConsentCalls"] >= lim]
    bad += [f"{r['slot']}:mget=0" for r in B if r["mget"] <= 0]
    bad += [f"{r['slot']}:A_mget={r['mget']}" for r in A if r["mget"] != 0]
    verdict = "MECH_NOT_ENGAGED" if bad else "MECH_ENGAGED"
    why = bad or [f"standaloneLimit={lim}"]
print(json.dumps({"rule": "BOOT_RULE", "verdict": verdict, "why": why, "waves": rows}, ensure_ascii=False, indent=1))
