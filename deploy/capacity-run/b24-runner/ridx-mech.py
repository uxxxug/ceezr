#!/usr/bin/env python3
"""LOAD-01 · فهرسا التقاطِ الردود — محكُّ الآليّةِ (RIDX_RULE في PROTOCOL-load01-ridx-ab.md §6).

لكلِّ موجةٍ (SLOT:DIR): من pg_stat_statements متوسّطُ وأقصى `claim_telegram_update_replies` وعددُ نداءاتِها،
ومن سجلِّ psig في load-trace احتجازُ مقعدِ gatewayRequest لنداءاتِها (runMs) وحصّتُه من احتجازِ المجمّعِ كلِّه.
الحكم: MECH_ENGAGED إن كانَ أعلى متوسّطِ PG في موجاتِ B أقلَّ من خُمسِ أدنى متوسّطٍ في موجاتِ A؛ وإلّا MECH_NOT_ENGAGED.
لا يحذفُ ولا يُقدِّرُ: حقلٌ غائبٌ ⇒ خطأٌ صريح.
"""
import csv, gzip, json, sys
csv.field_size_limit(10**9)

def wave(slot, d):
    pg = None
    for x in csv.DictReader(gzip.open(f"{d}/pgss-full.csv.gz", "rt")):
        if "claim_telegram_update_replies" in x["query"]:
            pg = {"calls": int(x["calls"]), "mean_ms": float(x["mean_ms"]), "max_ms": float(x["max_ms"])}
    if pg is None:
        raise SystemExit(f"{slot}: claim_telegram_update_replies غائبٌ من pgss")
    hold = total = 0.0; n = 0
    for line in gzip.open(f"{d}/load-trace.jsonl.gz", "rt"):
        if '"psig"' not in line:
            continue
        o = json.loads(line)
        if o.get("pool") != "ceezr:gatewayRequest":
            continue
        total += o["runMs"]
        if o["sig"].startswith("select claim_telegram_update_replies("):
            hold += o["runMs"]; n += o["n"]
    if total <= 0:
        raise SystemExit(f"{slot}: psig غائبٌ أو فارغ")
    return {"slot": slot, "arm": slot[0], "pg": pg, "psigCalls": n,
            "holdMs": round(hold, 1), "holdMeanMs": round(hold / n, 2) if n else None,
            "holdShare": round(hold / total, 4), "poolRunTotalS": round(total / 1000, 1)}

last = {}
for a in sys.argv[1:]:
    slot, d = a.split(":", 1)
    last[slot] = d  # موجةٌ أُعيدتْ ⇒ الأخيرةُ تَستبدلُ الأصلَ (PROTOCOL §4)
rows = [wave(s, d) for s, d in last.items()]
A = [r["pg"]["mean_ms"] for r in rows if r["arm"] == "A"]
B = [r["pg"]["mean_ms"] for r in rows if r["arm"] == "B"]
verdict = "NO_VERDICT"
if A and B:
    verdict = "MECH_ENGAGED" if max(B) < min(A) / 5 else "MECH_NOT_ENGAGED"
print(json.dumps({"rule": "RIDX_RULE", "verdict": verdict, "pgMeanA": A, "pgMeanB": B, "waves": rows}, ensure_ascii=False, indent=1))
