#!/usr/bin/env python3
"""LOAD-01 · الدفعة 32 — جدولُ انتظارِ مقعدِ البوّابةِ واحتجازِه لكلِّ مسار (وصفيٌّ، PLAN-b32 §7.4).

يقرأُ b32-decision.json وحدَه (ناتجَ b32-analyze.py) ويطبعُ وسيطَ موجاتِ كلِّ ذراعٍ لكلِّ صنفِ مسار:
عددُ الحجوزات، والانتظارُ/حجز، والاحتجازُ/حجز، وحصّةُ الاحتجاز؛ والمقاعدُ المشغولةُ وسطيّاً في نافذةِ الحقن.
لا يدخلُ شيءٌ من هذا في القرار؛ القرارُ في b32-decision.json وحدَه.
الاستعمال:  python3 b32-paths-table.py <b32-decision.json>
"""
import json
import statistics as st
import sys

d = json.load(open(sys.argv[1]))
W, r = d["waves"], d["result"]
arms = {"C": [], "P": [], "I": []}
for w in r["runs"]:
    arms[W[w]["arm"]].append(W[w])


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 2) if xs else None


print("الذراع: عددُ الموجات", {a: len(v) for a, v in arms.items()})
for pool in ("ceezr:gatewayRequest", "ceezr:gatewayDispatch"):
    print(f"## {pool} (الموجةُ كلُّها، pagg)")
    classes = sorted(
        {c for a in arms.values() for w in a for c in w["paths_b32"]["by_pool_class"].get(pool, {})}
    )
    for c in classes:
        cells = []
        for a in "CPI":
            vs = [w["paths_b32"]["by_pool_class"].get(pool, {}).get(c) for w in arms[a]]
            vs = [v for v in vs if v]
            cells.append(
                f"{a}: acq={med([v['acq'] for v in vs])} wait/acq={med([v['wait_ms_per_acq'] for v in vs])}ms"
                f" hold/acq={med([v['hold_ms_per_acq'] for v in vs])}ms hold_share={med([v['hold_share'] for v in vs])}"
            )
        print(f"{c:16s} " + " | ".join(cells))
print("## ceezr:gatewayRequest — نافذةُ الحقن (30–180ث، pdb): المقاعدُ المشغولةُ وسطيّاً من 5")
classes = sorted({c for a in arms.values() for w in a for c in w["inject_b32"]["by_class"]})
for c in classes:
    cells = []
    for a in "CPI":
        g = [w["inject_b32"]["by_class"].get(c, {}) for w in arms[a]]
        cells.append(
            f"{a}: busy={med([x.get('busy_slots_mean') for x in g])} wait/acq={med([x.get('wait_ms_per_acq') for x in g])}ms"
        )
    print(f"{c:16s} " + " | ".join(cells))
print("## وظائفُ الدرينر (jobs_b32.all) والموارد")
for a in "CPI":
    ws = arms[a]
    print(
        a,
        "lane_wait_mean_ms", med([w["jobs_b32"]["all"]["lane_wait_ms"]["mean"] for w in ws]),
        "non_pool_ms_per_job", med([w["jobs_b32"]["all"]["non_pool_ms_per_job"]["mean"] for w in ws]),
        "gate_acq_per_job", med([w["jobs_b32"]["all"]["gate_acq_per_job"] for w in ws]),
        "gateway_cpu_p50", med([w["cpu"]["gateway_cpu_p50"] for w in ws]),
        "pg_cpu_p50", med([w["cpu"]["pg_cpu_p50"] for w in ws]),
        "location_route_mean_ms", med([w["location"]["route_mean_ms"] for w in ws]),
        "scenarios", med([w["completions"]["scenarios_total"] for w in ws]),
        "arrival_per_s", med([w["rates"]["arrival_per_s"] for w in ws]),
        "P4_queue_p50_ms", med([w["p4"]["queue_p50"] for w in ws]),
    )
print("## البواباتُ لكلِّ موجة")
for a in "CPI":
    for w in arms[a]:
        s = w["gates"]["summary_line"]
        print(a, w["wave"], w["gates"]["verdict"], w["gates"]["failed"], "G1", s.get("G1"),
              "P1", s.get("P1"), "P4", s.get("P4"), "P7", s.get("P7"))
