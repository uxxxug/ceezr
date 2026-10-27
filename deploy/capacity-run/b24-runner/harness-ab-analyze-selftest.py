#!/usr/bin/env python3
"""اختبارٌ ذاتيٌّ لقواعدِ harness-ab-analyze.py (PROTOCOL-load01-harness-ab.md §6) على موجاتٍ مركّبة — يُشغَّلُ قبلَ أيِّ موجة."""
import copy, importlib.util, os, sys

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "harness-ab-analyze.py")
spec = importlib.util.spec_from_file_location("harness_ab", p)
H = importlib.util.module_from_spec(spec)
spec.loader.exec_module(H)


def w(arm, g1, poll_old=0, poll_new=0, ob_old=0, ob_new=0, lifecycle=5000, outbox=0, timeouts=7000, failed=("G1",)):
    return {
        "arm": arm,
        "pgss": {"total_exec_s": 350.0, "calls": 1_000_000,
                 "old_poll": {"calls": poll_old, "total_ms": 1.0}, "new_poll": {"calls": poll_new, "total_ms": 1.0},
                 "old_outbox": {"calls": ob_old, "total_ms": 1.0}, "new_outbox": {"calls": ob_new, "total_ms": 1.0}},
        "events": {"window_ms": [0, 1], "phoneProofJob": {"timeout": timeouts}, "offer_lifecycle": lifecycle, "offer_outbox": outbox},
        "sched": {"pg_run_pct_1core_p50": 180.0},
        "contact_done": 12000,
        "base": {"g1": {"pct": g1, "ok": 5000}, "failedGates": list(failed),
                 "onboarding": {"contact_jobs": {"p50_ms": 21000, "over_20s_share": 0.55}},
                 "pool": {"totalHoldS": 980.0, "totalWaitS": 44000.0}},
    }


def A(g1):
    return w("A", g1, poll_old=548_000, ob_old=5000)


def B(g1, **k):
    d = dict(poll_new=600, ob_new=3, outbox=5000)
    d.update(k)
    return w("B", g1, **d)


def run(waves):
    return H.judge(waves)


fails = 0


def check(name, cond):
    global fails
    print(("OK  " if cond else "FAIL") + " " + name)
    if not cond:
        fails += 1


base = {"A1": A(40), "B1": B(41), "A2": A(41), "B2": B(40.5), "A3": A(40), "B3": B(40.4), "A4": A(41), "B4": B(41.2)}
r = run(base)
check("آليّةٌ منخرطة + فرقٌ صغير ⇒ NO_DETECTABLE_EFFECT وALLOWED", r["harness_rule"]["ok"] and r["g1"]["decision"] == "NO_DETECTABLE_EFFECT" and r["merge"].startswith("ALLOWED"))

x = copy.deepcopy(base)
for s in ("B1", "B2", "B3", "B4"):
    x[s]["base"]["g1"]["pct"] = x["A" + s[1]]["base"]["g1"]["pct"] + 8
r = run(x)
check("كلُّ dᵢ > 0 وD ≥ 5 ⇒ B_BETTER", r["g1"]["decision"] == "B_BETTER")

x = copy.deepcopy(base)
x["B2"]["pgss"]["old_poll"]["calls"] = 10
r = run(x)
check("بقاءُ الاستطلاعِ القديمِ في B ⇒ MECH_MISMATCH وBLOCKED", r["g1"]["decision"] == "MECH_MISMATCH" and r["merge"].startswith("BLOCKED"))

x = copy.deepcopy(base)
x["A3"]["pgss"]["new_poll"]["calls"] = 5
r = run(x)
check("ظهورُ المجمّعةِ في A ⇒ MECH_MISMATCH", r["g1"]["decision"] == "MECH_MISMATCH")

x = copy.deepcopy(base)
for s in ("B1", "B2", "B3", "B4"):
    x[s]["pgss"]["new_poll"]["calls"] = 20_000
r = run(x)
check("نسبةُ الاستطلاعِ > 2% ⇒ MECH_MISMATCH", r["g1"]["decision"] == "MECH_MISMATCH")

x = copy.deepcopy(base)
x["B1"]["events"]["offer_outbox"] = 10
r = run(x)
check("نقصُ أحداثِ offer_outbox المؤجّلة ⇒ CORRECT_RULE مخالَفة وBLOCKED", not r["correct_rule"]["ok"] and r["merge"].startswith("BLOCKED"))

x = copy.deepcopy(base)
x["B4"]["base"]["failedGates"] = ["G1", "P2"]
r = run(x)
check("بوّابةٌ فاشلةٌ جديدةٌ في B ⇒ BLOCKED", not r["correct_rule"]["ok"] and r["merge"].startswith("BLOCKED"))

x = copy.deepcopy(base)
x["B2"]["events"]["phoneProofJob"] = {"weird": 1}
r = run(x)
check("مآلٌ غيرُ معروفٍ لـphoneProofJob ⇒ CORRECT_RULE مخالَفة", not r["correct_rule"]["ok"])

x = {k: v for k, v in base.items() if k in ("A1", "B1", "A2", "B2")}
r = run(x)
check("زوجانِ فقط ⇒ NO_VERDICT وBLOCKED", r["g1"]["decision"] == "NO_VERDICT" and r["merge"].startswith("BLOCKED"))

x = copy.deepcopy(base)
x["B1"]["base"]["g1"]["pct"] = 50
r = run(x)
check("فرقٌ مختلطُ الإشارة ⇒ UNRESOLVED وBLOCKED", r["g1"]["decision"] == "UNRESOLVED" and r["merge"].startswith("BLOCKED"))

print("HARNESS_ANALYZER_SELFTEST", "PASS" if fails == 0 else f"FAIL ({fails})")
sys.exit(1 if fails else 0)
