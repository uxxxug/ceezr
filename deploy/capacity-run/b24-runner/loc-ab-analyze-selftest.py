#!/usr/bin/env python3
"""اختبارٌ ذاتيٌّ لـloc-ab-analyze.py (PROTOCOL-load01-loc-ab.md §6) — يُشغَّلُ في المقعدِ قبلَ أيِّ موجة.

يغطّي كلَّ فرعٍ من قواعدِ الحكم: LOC_RULE (انخراطُ الآليّة)، CORRECT_RULE (السلوك)، AB_RULE (G1)، MERGE_RULE،
وقراءةَ أثرِ load-trace لمسارِ driver/location من ملفٍّ مصطنَعٍ صغير.
"""
import importlib.util, json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("loc_ab", os.path.join(HERE, "loc-ab-analyze.py"))
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

FAILS = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f" :: {detail}"))
    if not cond:
        FAILS.append(name)


def loc(arm, acq, status=None, n=1000):
    status = status or {"200": n}
    sep = arm == "A"
    return {
        "requests": n, "acq_per_req": acq, "acq_dist": {}, "wait_ms_per_req": 100.0, "hold_ms_per_req": 20.0,
        "server_ms": {"p50": 1.0, "p95": 2.0, "p99": 3.0}, "status": status,
        "non2xx_pct": round(100 * sum(v for k, v in status.items() if not k.startswith("2")) / n, 3),
        "sig_account": n if sep else 0, "sig_driver": n if sep else 0, "sig_combined": 0 if sep else n, "sigs": {},
    }


def base(g1, failed=None):
    return {
        "g1": {"pct": g1}, "failedGates": failed if failed is not None else ["G1"],
        "onboarding": {"contact_jobs": {"p50_ms": 1, "over_20s_share": 0.1}, "onboarding_failed": 1},
        "pool": {"totalWaitS": 1, "totalHoldS": 1},
    }


def world(g1a, g1b, b_acq=7.0, b_loc=None, b_failed=None):
    W = {}
    for i, (ga, gb) in enumerate(zip(g1a, g1b), start=1):
        W[f"A{i}"] = {"arm": "A", "location": loc("A", 8.0), "base": base(ga)}
        W[f"B{i}"] = {"arm": "B", "location": (b_loc or (lambda: loc("B", b_acq)))(), "base": base(gb, b_failed)}
    return W


def run(W):
    M.wave = lambda d: W[d]
    return M.ab([(s, s) for s in W])


r = run(world([40, 41, 42, 43], [40.5, 41.2, 42.1, 43.4]))
check("آليّةٌ منخرطةٌ وأثرٌ دونَ 2 نقطة ⇒ NO_DETECTABLE_EFFECT ومسموحٌ بالدمج",
      r["loc_rule"]["ok"] and r["g1"]["decision"] == "NO_DETECTABLE_EFFECT" and r["merge"].startswith("ALLOWED"), r)

r = run(world([40, 41, 42, 43], [46, 47, 48, 49]))
check("فرقٌ ≥ 5 وكلُّ الأزواجِ موجبة ⇒ B_BETTER", r["g1"]["decision"] == "B_BETTER" and r["merge"].startswith("ALLOWED"), r["g1"])

r = run(world([40, 41, 42, 43], [34, 35, 36, 37]))
check("فرقٌ ≤ −5 وكلُّها سالبة ⇒ B_WORSE وحظرُ الدمج", r["g1"]["decision"] == "B_WORSE" and r["merge"].startswith("BLOCKED"), r["g1"])

r = run(world([40, 41, 42, 43], [43, 44, 40, 47]))
check("بينَ العتبتين ⇒ UNRESOLVED وحظرُ الدمج", r["g1"]["decision"] == "UNRESOLVED" and r["merge"].startswith("BLOCKED"), r["g1"])

r = run(world([40, 41], [40, 41]))
check("أقلُّ من 3 أزواج ⇒ NO_VERDICT وحظر", r["g1"]["decision"] == "NO_VERDICT" and r["merge"].startswith("BLOCKED"), r["g1"])

r = run(world([40, 41, 42, 43], [40, 41, 42, 43], b_acq=8.0))
check("لا انخفاضَ في الحجوزات ⇒ MECH_MISMATCH بلا حكمِ G1", r["g1"]["decision"] == "MECH_MISMATCH" and not r["loc_rule"]["ok"], r["loc_rule"])

r = run(world([40, 41, 42, 43], [40, 41, 42, 43], b_acq=6.0))
check("انخفاضُ حجزَين ⇒ MECH_MISMATCH (ليس سلوكَ الحزمة)", r["g1"]["decision"] == "MECH_MISMATCH", r["loc_rule"])


def leaky():
    x = loc("B", 7.0)
    x["sig_account"] = 10
    return x


r = run(world([40, 41, 42, 43], [40, 41, 42, 43], b_loc=leaky))
check("بقاءُ قراءةِ الحسابِ المنفصلةِ في B ⇒ MECH_MISMATCH", not r["loc_rule"]["ok"], r["loc_rule"])

r = run(world([40, 41, 42, 43], [40, 41, 42, 43], b_loc=lambda: loc("B", 7.0, {"200": 990, "503": 10})))
check("رمزُ حالةٍ جديدٌ في B ⇒ CORRECT_RULE مخالَفةٌ وحظر", not r["correct_rule"]["ok"] and r["merge"].startswith("BLOCKED"), r["correct_rule"])

r = run(world([40, 41, 42, 43], [40, 41, 42, 43], b_failed=["G1", "G3"]))
check("بوّابةٌ فاشلةٌ جديدةٌ في B ⇒ حظر", not r["correct_rule"]["ok"] and r["merge"].startswith("BLOCKED"), r["correct_rule"])

# قراءةُ الأثرِ الخامّ من ملفٍّ مصطنَع
with tempfile.TemporaryDirectory() as d:
    lines = [
        {"k": "httpreq", "route": M.ROUTE, "status": 200, "gateAcquisitions": 7, "gateWaitMs": 70, "gateHoldMs": 14, "serverMs": 90},
        {"k": "httpreq", "route": M.ROUTE, "status": 200, "gateAcquisitions": 7, "gateWaitMs": 50, "gateHoldMs": 10, "serverMs": 60},
        {"k": "httpreq", "route": "POST /v1/rides", "status": 201, "gateAcquisitions": 3, "gateWaitMs": 9, "gateHoldMs": 9, "serverMs": 9},
        {"k": "psig", "path": M.PATH, "sig": "\n  select u.role::text as role, u.is_blocked, u.language_code,\n d.id as driver_id from users u", "n": 2, "waitMs": 1, "runMs": 1},
        {"k": "psig", "path": M.PATH, "sig": "with current as ( select id from drivers where id =", "n": 2, "waitMs": 1, "runMs": 1},
    ]
    with open(os.path.join(d, "load-trace.jsonl"), "w", encoding="utf-8") as f:
        for e in lines:
            f.write(json.dumps(e) + "\n")
    L = M.location(d)
    check("قراءةُ الأثر: طلبان، 7 حجوزات، المدمجةُ معدودةٌ بالبادئةِ بعدَ طيِّ المسافات",
          L["requests"] == 2 and L["acq_per_req"] == 7.0 and L["sig_combined"] == 2 and L["sig_account"] == 0 and L["wait_ms_per_req"] == 60.0, L)

print("SELFTEST", "FAIL" if FAILS else "PASS", len(FAILS))
sys.exit(1 if FAILS else 0)
