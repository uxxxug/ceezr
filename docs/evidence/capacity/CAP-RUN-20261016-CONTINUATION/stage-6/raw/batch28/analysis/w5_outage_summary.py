#!/usr/bin/env python3
"""الدفعة 28 — ملخّصُ تجاربِ انقطاعِ PG (W5) من الخامِّ المحفوظ. التعليقُ ≥ 10s = تعليقُ مهلةِ الاستعلام (~15s).
w5ab/cand = نسخةٌ سابقةٌ مستبدَلةٌ من المرشّح (بوابةُ إيجارٍ فقط، لا فحصَ أثرٍ في W5) — تُعرَضُ ولا تدخلُ مقارنةَ المرشّحِ النهائيّ.
الاستعمال: python3 analysis/w5_outage_summary.py  (من مجلّد raw/batch28)"""
import glob, json
from math import comb

def fisher(a, b, c, d):
    n, r1, c1 = a + b + c + d, a + b, a + c
    p = lambda x: comb(r1, x) * comb(n - r1, c1 - x) / comb(n, c1)
    p0 = p(a)
    return sum(p(x) for x in range(0, min(r1, c1) + 1) if p(x) <= p0 + 1e-12)

def load(pattern):
    out = []
    for f in sorted(glob.glob(pattern)):
        w = json.load(open(f))["W5"]
        out.append({"file": f, "recoveryMs": w["recoveryMs"], "hang": w["recoveryMs"] > 10000,
                    "effect_check_in_W5": any("effect_recorded(" in e[3] for e in w["events"]),
                    "rows": [(r["status"], r["attempts"]) for r in w["rows"]]})
    return out

sets = {"witness/main": "witness/main-run*.json", "witness/cand": "witness/cand-run*.json",
        "w5c/main": "w5-outage/interleaved-w5c/main-*.json", "w5c/cand": "w5-outage/interleaved-w5c/cand-*.json",
        "w5d/main": "w5-outage/interleaved-w5d/main-*.json", "w5d/cand": "w5-outage/interleaved-w5d/cand-*.json",
        "w5ab/main": "w5-outage/main-w5ab/main-*.json", "w5ab/cand-superseded": "w5-outage/superseded-variant-w5ab/cand-*.json"}
res = {}
for k, pat in sets.items():
    r = load(pat)
    res[k] = {"runs": len(r), "hangs": sum(x["hang"] for x in r), "all_done": all(s == "done" for x in r for s, _ in x["rows"]),
              "effect_check_in_W5_runs": sum(x["effect_check_in_W5"] for x in r),
              "recovery_ms_sorted": sorted(x["recoveryMs"] for x in r)}
mh = res["w5c/main"]["hangs"] + res["w5d/main"]["hangs"]; ch = res["w5c/cand"]["hangs"] + res["w5d/cand"]["hangs"]
mn = res["w5c/main"]["runs"] + res["w5d/main"]["runs"]; cn = res["w5c/cand"]["runs"] + res["w5d/cand"]["runs"]
res["interleaved_w5c_w5d"] = {"main": f"{mh}/{mn}", "cand": f"{ch}/{cn}", "fisher_two_sided_p": round(fisher(ch, cn - ch, mh, mn - mh), 4)}
print(json.dumps(res, ensure_ascii=False, indent=1))
