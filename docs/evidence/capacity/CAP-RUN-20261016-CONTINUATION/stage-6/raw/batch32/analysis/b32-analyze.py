#!/usr/bin/env python3
"""LOAD-01 · الدفعة 32 — محلّلُ تجربةِ تمييزِ سببِ الاختناق: انتظارُ مقعدِ البوّابةِ واحتجازُه لكلِّ مسار،
ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b32.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b32.md؛ لا تُعدَّلُ عتبةٌ ولا قاعدةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ b31-analyze.py حرفيًّا لكلِّ موجة (ومن ورائه b30 ← b28 ← b27 ← b26 ← b25: البوابات G1–G8/P1–P9،
الإكمال، الإلحاق، إثباتُ الهاتف، المجمّع، P4، الموزّع، CPU، الصلاحيّة، الجامع، تفكيكُ الدرينر b31) ويُضيف:
  - `paths_b32`: من سجلّاتِ `pagg` (الموجةُ كلُّها) — لكلِّ صنفِ مسارٍ ولكلِّ تجمُّع: الحجوزات (query+tx)،
    مجموعُ انتظارِ المقعدِ ومجموعُ احتجازِه، ومتوسّطُهما لكلِّ حجز، وحصّةُ الصنفِ من الاحتجاز؛ وp95 الانتظارِ
    الدقيقُ لكلِّ مسارٍ مُفرَد (لا يُدمَجُ مئينٌ بينَ مسارات).
  - `jobs_b32`: من سطورِ `job` (gateWaitMs/gateHoldMs/gateAcq) — لكلِّ نوعِ تحديث (`contact` = إثباتُ الهاتف):
    زمنُ الطابور (created→claimed)، وزمنُ المعالجة، وانتظارُ المقعدِ واحتجازُه لكلِّ وظيفة، والباقي
    (المعالجة − الانتظار − الاحتجاز = ما ليسَ تجمُّعًا: المعالج، تيليجرام، حلقةُ الأحداث).
  - `inject_b32`: من نوافذِ `pdb` بينَ 30ث و180ث من أوّلِ نافذة — متوسّطُ الانتظارِ لكلِّ حجزٍ لكلِّ صنف.

الأذرع (اسمُ الموجةِ يحملُ الذراع: …-C<n>-750 / …-P<n>-750 / …-I<n>-750):
  C = المرجع: main 8a96fd88 + I (الأداة) + L + S (ب30، مُنتقاةٌ حرفًا)            — 16c7ad70
  P = C + أولويّةُ حجزِ الدرينرِ في بوّابةِ التجمُّعِ نفسِها (السعةُ هيَ هيَ)          — 6dbbf8d6
  I = main + الأداةُ وحدَها (مرساةٌ للإعلامِ فقط، خارجَ القرار)                        — a38db57a
الحكمُ الوحيد: P مقابلَ C.

الاستعمال:
  b32-analyze.py wave     <RAW_WAVE_DIR> <SESSION_LIMIT>          → JSON
  b32-analyze.py validity <OUT> <N> <RUN…>                        → ALL_VALID | NOT_VALID (+ تفصيلٌ على stderr)
  b32-analyze.py decide   <OUT> <SESSION_LIMIT> <RUN…>            → JSON (الحكم؛ موجاتُ I تُحلَّلُ للإعلام)
"""
from __future__ import annotations

import csv
import importlib.util
import json
import re
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b31", Path(__file__).with_name("b31-analyze.py"))
b31 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b31)  # type: ignore[union-attr]
b30, b28, b27, b26, b25 = b31.b30, b31.b28, b31.b27, b31.b26, b31.b25

# ---------------------------------------------------------------- عتباتٌ مسجَّلةٌ مسبقًا (PLAN-b32.md §7)
SERIES_SIZE = 8
ARMS = "CP"
CAND, REF = "P", "C"
MP1_MAX_DRAINER_WAIT_RATIO = 0.5   # MP1: وسيطُ انتظارِ المقعدِ لكلِّ حجزٍ في مساراتِ الدرينرِ (P) ≤ 0.5 × C
MP2_MAX_QUEUE_RATIO = 0.5          # MP2: وسيطُ p95 طابورِ وظائفِ تيليجرام (created→claimed) في P ≤ 0.5 × C
BP_P4_MAX_RATIO = 1.10             # BP: وسيطُ P4 p95 في P ≤ 1.10 × C (لا تُفقَدُ مكاسبُ S على P4)
N6_MAX_HTTP_WAIT_RATIO = 1.5       # N6: وسيطُ انتظارِ المقعدِ لكلِّ حجزٍ في مساراتِ HTTP (P) ≤ 1.5 × C
VERIFIED_MIN_RATIO = b27.VERIFIED_MIN_RATIO  # N3: 0.97
HARD_GATES, PERF_GATES = b27.HARD_GATES, b27.PERF_GATES
POOL = b28.POOL                    # ceezr:gatewayRequest
INJECT_FROM_MS, INJECT_TO_MS = 30_000, 180_000


def arm(run: str) -> str | None:
    m = re.search(r"-([CPI])\d+-\d+$", run)
    return m.group(1) if m else None


def path_class(path: str) -> str:
    if path.startswith("http:"):
        return "http"
    if path.startswith("drainer:job:"):
        return "drainer_job"
    if path == "drainer:sweep":
        return "drainer_sweep"
    if path == "drainer:replies":
        return "drainer_replies"
    if path.startswith("redispatch:"):
        return "redispatch"
    return "background"


DRAINER = ("drainer_job", "drainer_sweep", "drainer_replies")


def _r(x, n=2):
    return None if x is None else round(x, n)


def paths(d: Path) -> dict:
    """انتظارُ مقعدِ البوّابةِ واحتجازُه لكلِّ صنفِ مسارٍ ولكلِّ تجمُّع — من `pagg` (قياسٌ مباشر)."""
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    pagg = [t for t in tr if t.get("k") == "pagg"]
    if not pagg:
        return {"present": False}
    acc: dict = defaultdict(lambda: {"acq": 0, "wait": 0.0, "hold": 0.0, "txq": 0})
    per_path: dict = {}
    for t in pagg:
        pool, kind, path = t.get("pool"), t.get("kind"), str(t.get("path"))
        n = int(t.get("n") or 0)
        key = (pool, path_class(path))
        if kind == "txQuery":
            acc[key]["txq"] += n
            continue
        acc[key]["acq"] += n
        acc[key]["wait"] += float(t.get("waitSumMs") or 0)
        acc[key]["hold"] += float(t.get("runSumMs") or 0)
        per_path[f"{pool}|{path}|{kind}"] = {
            "n": n, "wait_mean": _r(float(t.get("waitSumMs") or 0) / n if n else None),
            "wait_p95": t.get("waitP95Ms"), "wait_p99": t.get("waitP99Ms"), "wait_max": t.get("waitMaxMs"),
            "hold_mean": _r(float(t.get("runSumMs") or 0) / n if n else None), "hold_p95": t.get("runP95Ms")}
    out: dict = {"present": True, "by_pool_class": {}, "per_path": per_path}
    for pool in sorted({k[0] for k in acc}):
        hold_tot = sum(v["hold"] for k, v in acc.items() if k[0] == pool)
        rows = {}
        for (p, c), v in sorted(acc.items()):
            if p != pool:
                continue
            rows[c] = {"acq": v["acq"], "txq": v["txq"], "wait_sum_s": _r(v["wait"] / 1000, 1),
                       "hold_sum_s": _r(v["hold"] / 1000, 1),
                       "wait_ms_per_acq": _r(v["wait"] / v["acq"] if v["acq"] else None),
                       "hold_ms_per_acq": _r(v["hold"] / v["acq"] if v["acq"] else None),
                       "hold_share": _r(v["hold"] / hold_tot if hold_tot else None, 4)}
        out["by_pool_class"][pool] = rows

    def combined(pool: str, classes: tuple[str, ...]) -> float | None:
        a = [acc[(pool, c)] for c in classes if (pool, c) in acc]
        n = sum(x["acq"] for x in a)
        return _r(sum(x["wait"] for x in a) / n) if n else None

    out["drainer_wait_ms_per_acq"] = combined(POOL, DRAINER)
    out["http_wait_ms_per_acq"] = combined(POOL, ("http",))
    out["drainer_job_wait_ms_per_acq"] = combined(POOL, ("drainer_job",))
    out["drainer_sweep_wait_ms_per_acq"] = combined(POOL, ("drainer_sweep",))
    return out


def jobs(d: Path) -> dict:
    """لكلِّ نوعِ تحديث: الطابور، والمعالجة، وانتظارُ المقعدِ واحتجازُه لكلِّ وظيفة، والباقي."""
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    J = [t for t in tr if t.get("k") == "job" and "gateAcq" in t]
    if not J:
        return {"present": False}
    created: dict = {}
    p = b25.find(d, "update-jobs.csv")
    if p is not None:
        with b25.open_text(p) as f:
            for row in csv.reader(f):
                if len(row) >= 3 and row[1].isdigit() and row[2].isdigit():
                    created[(row[0], int(row[1]))] = int(row[2])
    by: dict = defaultdict(list)
    for j in J:
        by[f"{j.get('bot')}:{j.get('kind')}"].append(j)
        by["all"].append(j)
    out: dict = {"present": True}
    for k, L in sorted(by.items()):
        proc = [j["endedAt"] - j["startedAt"] for j in L]
        wait = [float(j.get("gateWaitMs") or 0) for j in L]
        hold = [float(j.get("gateHoldMs") or 0) for j in L]
        acq = [int(j.get("gateAcq") or 0) for j in L]
        rest = [pr - w - h for pr, w, h in zip(proc, wait, hold)]
        lane = [j["startedAt"] - j["claimedAt"] for j in L if j.get("claimedAt") is not None]
        queue = [j["claimedAt"] - created[(j.get("bot"), j.get("updateId"))] for j in L
                 if (j.get("bot"), j.get("updateId")) in created and j.get("claimedAt") is not None]
        out[k] = {
            "n": len(L),
            "queue_ms": {"p50": b31._pct(queue, .5), "p95": b31._pct(queue, .95), "n": len(queue)},
            "lane_wait_ms": {"mean": b31._mean(lane), "p95": b31._pct(lane, .95)},
            "process_ms": {"mean": b31._mean(proc), "p50": b31._pct(proc, .5), "p95": b31._pct(proc, .95)},
            "gate_wait_ms_per_job": {"mean": b31._mean(wait), "p50": b31._pct(wait, .5), "p95": b31._pct(wait, .95)},
            "gate_hold_ms_per_job": {"mean": b31._mean(hold), "p95": b31._pct(hold, .95)},
            "gate_acq_per_job": b31._mean(acq),
            "non_pool_ms_per_job": {"mean": b31._mean(rest), "p95": b31._pct(rest, .95)},
            "gate_wait_share_of_process": _r(sum(wait) / sum(proc), 4) if sum(proc) else None,
        }
    return out


def inject(d: Path) -> dict:
    """نوافذُ `pdb` في نافذةِ الحقن (30–180ث من أوّلِ نافذة): متوسّطُ انتظارِ المقعدِ لكلِّ حجزٍ لكلِّ صنف."""
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    W = [t for t in tr if t.get("k") == "pdb" and t.get("pool") == POOL and t.get("kind") != "txQuery"]
    if not W:
        return {"present": False}
    t0 = min(int(t["at"]) for t in W)
    acc: dict = defaultdict(lambda: [0, 0.0, 0.0])
    for t in W:
        if not (INJECT_FROM_MS <= int(t["at"]) - t0 <= INJECT_TO_MS):
            continue
        a = acc[path_class(str(t.get("path")))]
        a[0] += int(t.get("n") or 0)
        a[1] += float(t.get("waitSumMs") or 0)
        a[2] += float(t.get("runSumMs") or 0)
    span_s = (INJECT_TO_MS - INJECT_FROM_MS) / 1000
    return {"present": True, "window_s": span_s,
            "by_class": {c: {"acq": v[0], "wait_ms_per_acq": _r(v[1] / v[0] if v[0] else None),
                             "busy_slots_mean": _r(v[2] / 1000 / span_s, 3)} for c, v in sorted(acc.items())}}


def wave(d: Path, session_limit: int) -> dict:
    w = b31.wave(d, session_limit)
    w["paths_b32"] = paths(d)
    w["jobs_b32"] = jobs(d)
    w["inject_b32"] = inject(d)
    return w


def validity(out_root: Path, size: int, runs: list[str]) -> tuple[bool, dict]:
    vv = {r: b26.validity(out_root / "raw" / r) for r in runs}
    ok = len(runs) == size and all(all(v == "VALID" for v in x.values()) for x in vv.values())
    return ok, vv


def _jk(w, kind, field, sub):
    j = w["jobs_b32"].get(kind) if w["jobs_b32"].get("present") else None
    return None if j is None else (j[field][sub] if sub else j[field])


def decide(out_root: Path, session_limit: int, runs: list[str]) -> dict:
    waves = {}
    for r in runs:
        d = out_root / "raw" / r
        w = wave(d, session_limit)
        w["arm"] = arm(r)
        w["validity"] = b26.validity(d)
        waves[r] = w
    key = f"{CAND}_vs_{REF}"
    dec_runs = [r for r in runs if arm(r) in ARMS]
    res: dict = {"session_limit": session_limit, "runs": runs, "decision_runs": dec_runs,
                 "validity": {k: w["validity"] for k, w in waves.items()},
                 "condition": {k: b26.condition_ok(w, session_limit) for k, w in waves.items()}}
    arms = {a: [waves[r] for r in dec_runs if arm(r) == a] for a in ARMS}
    info_I = [w for w in waves.values() if w["arm"] == "I"]
    if (any(len(v) != SERIES_SIZE for v in arms.values())
            or not all(b26.is_valid(waves[r]) for r in dec_runs)):
        res["decision"] = {key: "INCONCLUSIVE"}
        res["why"] = "ليست 8 موجاتٍ صالحةً لكلِّ ذراعٍ من C وP (القاعدةُ المسجَّلة: لا انتقاءَ ولا استبدال)"
        return {"waves": waves, "result": res}
    if not all(res["condition"][r] for r in dec_runs):
        res["decision"] = {key: "INVALID-CONDITION"}
        return {"waves": waves, "result": res}
    res["collect"] = {k: b28.collect_state(out_root / "raw" / k) for k in runs}
    if not all(res["collect"][r]["complete"] for r in dec_runs):
        res["decision"] = {key: "EVIDENCE_INCOMPLETE"}
        return {"waves": waves, "result": res}
    if not all(waves[r]["paths_b32"].get("present") and waves[r]["jobs_b32"].get("present") for r in dec_runs):
        res["decision"] = {key: "INSTRUMENTATION_MISSING"}
        return {"waves": waves, "result": res}

    pth = lambda k: (lambda w: w["paths_b32"].get(k))
    M = {
        # القياسُ المباشرُ لكلِّ مسار (gatewayRequest)
        "drainer_wait_ms_per_acq": pth("drainer_wait_ms_per_acq"),
        "drainer_job_wait_ms_per_acq": pth("drainer_job_wait_ms_per_acq"),
        "drainer_sweep_wait_ms_per_acq": pth("drainer_sweep_wait_ms_per_acq"),
        "http_wait_ms_per_acq": pth("http_wait_ms_per_acq"),
        "contact_gate_wait_ms_per_job": lambda w: _jk(w, "driver:contact", "gate_wait_ms_per_job", "mean"),
        "contact_gate_hold_ms_per_job": lambda w: _jk(w, "driver:contact", "gate_hold_ms_per_job", "mean"),
        "contact_non_pool_ms_per_job": lambda w: _jk(w, "driver:contact", "non_pool_ms_per_job", "mean"),
        "contact_process_mean_ms": lambda w: _jk(w, "driver:contact", "process_ms", "mean"),
        "contact_queue_p95_ms": lambda w: _jk(w, "driver:contact", "queue_ms", "p95"),
        "all_jobs_gate_wait_share": lambda w: _jk(w, "all", "gate_wait_share_of_process", None),
        # من سلسلةِ b31 (التعريفاتُ نفسُها)
        "drainer_queue_p95_ms": lambda w: w["drainer_b31"]["queue_ms"]["p95"],
        "drainer_queue_p50_ms": lambda w: w["drainer_b31"]["queue_ms"]["p50"],
        "drainer_process_mean_ms": lambda w: w["drainer_b31"]["process_ms"]["mean"],
        "drainer_claim_trip_ms": lambda w: w["drainer_b31"]["claim_trip_ms_mean"],
        "drainer_inflight_p50": lambda w: w["drainer_b31"]["inflight"]["p50"],
        "pool_wait_ms_per_acq": lambda w: w["drainer_b31"]["pool_wait_ms_per_acq"],
        "verified_per_s": lambda w: (w.get("completions") or {}).get("verified_per_s"),
        "G1_pct": b27.g1_pct,
        "P4_p95_ms": lambda w: w["p4"].get("P4_p95"),
        "dispatch_served_per_s": lambda w: w["dispatch"].get("served_per_s"),
        "phone_backlog_median": lambda w: w["phone_backlog"].get("backlog_median_after_30s"),
        "phone_proof_p95_ms": lambda w: w["phone_proof"]["p95_ms"],
        "driver_onboarding_failed": lambda w: w["onboarding"]["scenario_driver_onboarding_failed"],
        "jobs_not_done": lambda w: w["jobs_state"]["not_done"],
        "load1_p50": lambda w: w["cpu"].get("load1_p50"),
        "pg_cpu_p50": lambda w: w["cpu"].get("pg_cpu_p50"),
    }
    agg = {k: {a: b25.stat([f(w) for w in arms[a]]) for a in ARMS} for k, f in M.items()}
    res["aggregate"] = agg
    if info_I:
        res["info_I_aggregate"] = {k: b25.stat([f(w) for w in info_I]) for k, f in M.items()}
    med = lambda k, a: agg[k][a]["median"]
    fails = {g: {a: sum(1 for w in arms[a] if b27.gate_pass(w, g) is False) for a in ARMS}
             for g in HARD_GATES + PERF_GATES}
    res["gate_fail_counts"] = fails
    obf, nd = M["driver_onboarding_failed"], M["jobs_not_done"]
    C, R = arms[CAND], arms[REF]
    lt = lambda a, b, ratio: None not in (a, b) and a <= ratio * b
    c: dict = {}
    c["MP1_drainer_wait_per_acq_le_0.5ref"] = lt(med("drainer_wait_ms_per_acq", CAND),
                                                 med("drainer_wait_ms_per_acq", REF), MP1_MAX_DRAINER_WAIT_RATIO)
    c["MP2_drainer_queue_p95_le_0.5ref"] = lt(med("drainer_queue_p95_ms", CAND),
                                              med("drainer_queue_p95_ms", REF), MP2_MAX_QUEUE_RATIO)
    rv, cv = med("verified_per_s", REF), med("verified_per_s", CAND)
    c["N2_perf_fail_count_le_ref"] = all(fails[g][CAND] <= fails[g][REF] for g in PERF_GATES)
    c["N3_verified_median_ge_097ref"] = None not in (rv, cv) and cv >= VERIFIED_MIN_RATIO * rv
    c["N4_onboarding_failed_each_le_max_ref"] = all(obf(w) <= max(obf(x) for x in R) for w in C)
    c["N5_jobs_not_done_each_le_max_ref"] = all(nd(w) <= max(nd(x) for x in R) for w in C)
    c["N6_http_wait_per_acq_le_1.5ref"] = lt(med("http_wait_ms_per_acq", CAND),
                                             med("http_wait_ms_per_acq", REF), N6_MAX_HTTP_WAIT_RATIO)
    c["N7_hard_gate_fail_count_le_ref"] = all(fails[g][CAND] <= fails[g][REF] for g in HARD_GATES)
    g1c, g1r = med("G1_pct", CAND), med("G1_pct", REF)
    oc, orr = med("driver_onboarding_failed", CAND), med("driver_onboarding_failed", REF)
    bc, br = med("phone_backlog_median", CAND), med("phone_backlog_median", REF)
    p4c, p4r = med("P4_p95_ms", CAND), med("P4_p95_ms", REF)
    c["BP_g1_ge_onboarding_lt_backlog_le_p4_le_1.1ref"] = (
        None not in (g1c, g1r, oc, orr, bc, br, p4c, p4r)
        and g1c >= g1r and oc < orr and bc <= br and p4c <= BP_P4_MAX_RATIO * p4r)
    c["OFFICIAL_all_gates_pass_each_P_wave"] = all(w["all_gates"]["verdict"] == "PASS" for w in C)
    res["criteria"] = {key: c}
    safe = all(v for k, v in c.items() if k.startswith("N"))
    mech = c["MP1_drainer_wait_per_acq_le_0.5ref"] and c["MP2_drainer_queue_p95_le_0.5ref"]
    benefit = c["BP_g1_ge_onboarding_lt_backlog_le_p4_le_1.1ref"]
    res["decision"] = {key: "REGRESSION" if not safe else (
        "NOT_CONFIRMED" if not mech else ("CONFIRMED" if benefit else "NO_NET_GAIN"))}
    # حكمُ الفرضيّة (منفصلٌ عن حكمِ الإصلاح): هل انتظارُ المقعدِ هوَ ما يُطيلُ طابورَ الدرينر؟
    if not c["MP1_drainer_wait_per_acq_le_0.5ref"]:
        hyp = "INCONCLUSIVE_MANIPULATION_FAILED"
    elif c["MP2_drainer_queue_p95_le_0.5ref"]:
        hyp = "H1_SUPPORTED"
    else:
        hyp = "H1_REJECTED"
    res["hypothesis"] = hyp
    res["merge_eligible"] = bool(res["decision"][key] == "CONFIRMED" and c["OFFICIAL_all_gates_pass_each_P_wave"])
    res["info_all_gates_pass_waves"] = {a: sum(1 for w in arms[a] if w["all_gates"]["verdict"] == "PASS")
                                        for a in ARMS}
    res["LOAD01_official"] = "NOT_RUN (مقارنةٌ تشخيصيّةٌ عندَ 750؛ لا موجاتِ 1000 ولا بروتوكولَ قبول)"
    return {"waves": waves, "result": res}


def main() -> int:
    a = sys.argv
    if len(a) >= 4 and a[1] == "wave":
        print(json.dumps(wave(Path(a[2]), int(a[3])), ensure_ascii=False, indent=1))
        return 0
    if len(a) >= 5 and a[1] == "validity":
        ok, vv = validity(Path(a[2]), int(a[3]), a[4:])
        print(json.dumps(vv, ensure_ascii=False), file=sys.stderr)
        print("ALL_VALID" if ok else "NOT_VALID")
        return 0
    if len(a) >= 5 and a[1] == "decide":
        print(json.dumps(decide(Path(a[2]), int(a[3]), a[4:]), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
