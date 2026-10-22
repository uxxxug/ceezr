#!/usr/bin/env python3
"""LOAD-01 · الدفعة 27 — محلّلُ السلسلةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b27.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b27.md؛ لا تُعدَّلُ عتبةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ b26-analyze.py حرفيًّا (wave/validity/condition/all_gates) ويضيفُ مقاييسَ الإلحاق:
  - إخفاقاتُ الإلحاق: نتائجُ scenario.outcome بسببِ driver_onboarding_failed، وتفصيلُ خطواتِ
    driver.onboarding_failed (phoneProofJob/onboardingPost…).
  - زمنُ وظيفةِ إثباتِ الهاتف: وظائفُ بوتِ السائقِ في update-jobs.csv (done_ms − created_ms).
  - إشغالُ مساراتِ الدرينر: متوسطُ الجاري (k=job في load-trace) خلالَ نافذةِ العمل، ورحلاتُ الالتقاط.

السلسلتان (الجانبُ R = المرجعُ بلا الإصلاح، C = المرجعُ + الإصلاحُ وحدَه):
  cand  R=3d4dcbd0 (حدُّ 100)  C=d89924c6 (3d4dcbd0 + الإصلاح)  → قاعدةُ «تأكيدِ الإصلاح» F0–F4
  main  R=66528457 (حدُّ 50)   C=b16db863 (main + الإصلاح)       → قاعدةُ «عدمِ التراجع» N0–N4

الاستعمال:
  b27-analyze.py wave   <RAW_WAVE_DIR> <LIMIT> <SESSION_LIMIT>                 → JSON
  b27-analyze.py decide <OUT> <cand|main> <LIMIT> <SESSION_LIMIT> <RUN…>        → JSON (الحكم)
"""
from __future__ import annotations

import csv
import gzip
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b26", Path(__file__).with_name("b26-analyze.py"))
b26 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b26)  # type: ignore[union-attr]
b25 = b26.b25

# ---------------------------------------------------------------- عتباتٌ مسجَّلةٌ مسبقًا
PHONE_PROOF_P95_MAX_MS = 12_139   # F2: أسوأُ p95 لموجاتِ المرجعِ (حدُّ 50) في ب26 (R1–R4: 6,637–12,139ms)
VERIFIED_MIN_RATIO = 0.97         # N3: وسيطُ C ≥ 0.97 × وسيطِ R
HARD_GATES = ("G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8")
INVARIANT_GATES = ("G2", "G3", "G4", "G7", "G8")
PERF_GATES = ("P1", "P2", "P3", "P4", "P5", "P6a", "P6b", "P6c", "P7", "P8", "P9")
SERIES_SIZE = b26.SERIES_SIZE


def pct(a: list, p: float):
    a = sorted(a)
    return a[min(len(a) - 1, int(p * len(a)))] if a else None


def onboarding(d: Path) -> dict:
    ev = b25.jsonl(b25.find(d, "miniapp-load-events.jsonl"))
    outs = [e for e in ev if e.get("event") == "scenario.outcome"]
    fails = [e for e in ev if e.get("event") == "driver.onboarding_failed"]
    steps = Counter()
    for e in fails:
        s = e.get("steps") or {}
        steps[f"phoneProofJob={s.get('phoneProofJob')}|onboardingPost={s.get('onboardingPost')}"] += 1
    return {
        "scenario_driver_onboarding_failed": sum(1 for e in outs if e.get("reason") == "driver_onboarding_failed"),
        "onboarding_failed_events": len(fails),
        "by_steps": dict(steps.most_common()),
    }


def phone_proof(d: Path) -> dict:
    p = d / "update-jobs.csv.gz"
    lat, pend, status = [], 0, Counter()
    if p.exists():
        for r in csv.reader(gzip.open(p, "rt")):
            if not r or r[0] != "driver":
                continue
            status[r[4]] += 1
            if r[3]:
                lat.append(int(r[3]) - int(r[2]))
            else:
                pend += 1
    return {"n": len(lat), "not_done": pend, "status": dict(status),
            "p50_ms": pct(lat, .5), "p95_ms": pct(lat, .95), "max_ms": max(lat) if lat else None,
            "over_20s": sum(1 for x in lat if x > 20_000)}


def drainer(d: Path) -> dict:
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    J = [t for t in tr if t.get("k") == "job" and "startedAt" in t and "endedAt" in t]
    sw = [t for t in tr if t.get("k") == "sweep"]
    if not J:
        return {"jobs": 0}
    t0 = min(t["startedAt"] for t in J)
    t1 = max(t["endedAt"] for t in J)
    busy = sum(t["endedAt"] - t["startedAt"] for t in J) / max(1, t1 - t0)
    trips = sum(int(s.get("claimTrips") or 0) for s in sw)
    return {"jobs": len(J), "mean_in_service": round(busy, 2),
            "jobs_per_s": round(len(J) / max(1e-9, (t1 - t0) / 1000), 2),
            "claim_trips": trips, "jobs_per_trip": round(len(J) / trips, 2) if trips else None}


def wave(d: Path, limit: int, session_limit: int) -> dict:
    w = b26.wave(d, limit, session_limit)
    w["onboarding"] = onboarding(d)
    w["phone_proof"] = phone_proof(d)
    w["drainer"] = drainer(d)
    return w


def g1_pct(w: dict):
    v = str((w["all_gates"]["rows"].get("G1") or {}).get("value") or "")
    try:
        return float(v.split("%")[0])
    except ValueError:
        return None


def gate_pass(w: dict, gid: str):
    row = (w["all_gates"]["rows"] or {}).get(gid)
    return None if row is None else row.get("pass")


def decide(out_root: Path, series: str, limit: int, session_limit: int, runs: list[str]) -> dict:
    waves = {}
    for r in runs:
        d = out_root / "raw" / r
        w = wave(d, limit, session_limit)
        w["side"] = "R" if "-R" in r else "C"
        w["validity"] = b26.validity(d)
        waves[r] = w
    res: dict = {"series": series, "limit": limit, "session_limit": session_limit, "runs": runs,
                 "validity": {k: w["validity"] for k, w in waves.items()},
                 "condition": {k: b26.condition_ok(w, session_limit) for k, w in waves.items()}}
    if len(runs) != SERIES_SIZE or not all(b26.is_valid(w) for w in waves.values()):
        res["decision"] = "INCONCLUSIVE"
        res["why"] = "سلسلةٌ غيرُ مكتملةِ الصلاحيّة (تُعادُ كاملةً بالقاعدةِ المسجَّلة، لا انتقاء)"
        return {"waves": waves, "result": res}
    if not all(res["condition"].values()):
        res["decision"] = "INVALID-CONDITION"
        res["why"] = "شرطُ القياسِ لم يتحقّق (حدُّ الجلسةِ الفعليُّ ≠ المعلن أو 429 من حدِّ الجلسة)"
        return {"waves": waves, "result": res}
    R = [w for w in waves.values() if w["side"] == "R"]
    C = [w for w in waves.values() if w["side"] == "C"]
    obf = lambda w: w["onboarding"]["scenario_driver_onboarding_failed"]
    pp95 = lambda w: w["phone_proof"]["p95_ms"]
    ver = lambda w: (w.get("completions") or {}).get("verified_per_s")
    agg = {}
    for name, f in (("driver_onboarding_failed", obf), ("phone_proof_p95_ms", pp95),
                    ("phone_proof_over_20s", lambda w: w["phone_proof"]["over_20s"]),
                    ("drainer_mean_in_service", lambda w: w["drainer"].get("mean_in_service")),
                    ("drainer_jobs_per_trip", lambda w: w["drainer"].get("jobs_per_trip")),
                    ("verified_per_s", ver), ("P4_p95_ms", lambda w: (w.get("P4") or {}).get("p95")),
                    ("G1_pct", g1_pct)):
        agg[name] = {"R": b25.stat([f(w) for w in R]), "C": b25.stat([f(w) for w in C])}
    res["aggregate"] = agg
    fails = {g: {"R": sum(1 for w in R if gate_pass(w, g) is False),
                 "C": sum(1 for w in C if gate_pass(w, g) is False)} for g in HARD_GATES + PERF_GATES}
    res["gate_fail_counts"] = fails
    crit: dict = {}
    if series == "cand":
        crit["F1_zero_onboarding_failures_each_C"] = all(obf(w) == 0 for w in C)
        crit["F2_phone_proof_p95_each_C_le_12139ms"] = all(pp95(w) is not None and pp95(w) <= PHONE_PROOF_P95_MAX_MS for w in C)
        crit["F2b_phone_proof_p95_separated"] = (agg["phone_proof_p95_ms"]["C"]["missing"] == 0
                                                 and b25.lt(agg["phone_proof_p95_ms"]["C"]["max"], agg["phone_proof_p95_ms"]["R"]["min"]))
        crit["F3_invariant_gates_each_C"] = all(gate_pass(w, g) is True for w in C for g in INVARIANT_GATES)
        crit["F4_G1_each_C"] = all(gate_pass(w, "G1") is True for w in C)
        res["criteria"] = crit
        res["decision"] = "ROOT_CAUSE_FIX_CONFIRMED" if all(crit.values()) else "NOT_CONFIRMED"
        # معلوماتيٌّ — ليس قبولًا لـ LOAD-01 (يحتاجُ البروتوكولَ الرسميّ):
        res["info_all_C_gates_pass"] = all(w["all_gates"]["verdict"] == "PASS" for w in C)
    elif series == "main":
        crit["N1_hard_gates_each_C"] = all(gate_pass(w, g) is True for w in C for g in HARD_GATES)
        crit["N2_perf_fail_count_C_le_R"] = all(v["C"] <= v["R"] for k, v in fails.items() if k in PERF_GATES)
        rv, cv = agg["verified_per_s"]["R"]["median"], agg["verified_per_s"]["C"]["median"]
        crit["N3_verified_median_C_ge_097R"] = rv is not None and cv is not None and cv >= VERIFIED_MIN_RATIO * rv
        crit["N4_onboarding_failures_C_le_max_R"] = all(obf(w) <= max(obf(x) for x in R) for w in C)
        res["criteria"] = crit
        res["decision"] = "NO_REGRESSION" if all(crit.values()) else "REGRESSION"
    else:
        raise SystemExit(f"سلسلةٌ مجهولة: {series}")
    return {"waves": waves, "result": res}


def main() -> int:
    a = sys.argv
    if len(a) >= 5 and a[1] == "wave":
        print(json.dumps(wave(Path(a[2]), int(a[3]), int(a[4])), ensure_ascii=False, indent=1))
        return 0
    if len(a) >= 7 and a[1] == "decide":
        print(json.dumps(decide(Path(a[2]), a[3], int(a[4]), int(a[5]), a[6:]), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
