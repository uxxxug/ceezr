#!/usr/bin/env python3
"""LOAD-01 · الدفعة 31 — محلّلُ مقارنةِ الأذرعِ الأربعةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b31.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b31.md؛ لا تُعدَّلُ عتبةٌ ولا قاعدةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ b30-analyze.py حرفيًّا لكلِّ موجة (البوابات G1–G8/P1–P9، الإكمال، الإلحاق، إثباتُ الهاتف،
المجمّع، P4، الموزّع، CPU، الصلاحيّة، الجامع) ويضيف تفكيكَ معالجِ وظائفِ تيليجرام لاتصالاتِ PostgreSQL:
  - الحجوزاتُ لكلِّ وظيفة، وتنفيذُ SQL لكلِّ حجز (runMs = زمنُ احتجازِ الاتصال؛ المعالجُ بلا معاملات)،
    والاحتجازُ لكلِّ وظيفة،
  - الانتظار: لكلِّ حجزٍ على مستوى المجمّع (نوافذُ k=db؛ main لا يكتبُ waitMs في rsig)، ولمراحلِ الوظيفةِ
    تقديرًا (زمنُ المرحلة − تنفيذُ استعلاماتِها)، ولرحلةِ الالتقاط (claimMs/claimTrips من سجلِّ الشوط)،
  - رحلاتُ الالتقاطِ لكلِّ وظيفة، وزمنُ الطابور (created→claimed)، وزمنُ المعالجة، والتزامنُ الجاري.

الأذرع (اسمُ الموجةِ يحملُ الذراع: …-A<n>-750 / …-D<n>-750 / …-S<n>-750 / …-X<n>-750):
  A = main (19e30b5b)
  D = A + الالتقاطُ المسبَقُ في درينرِ تيليجرام (997b05d0)
  S = ب30 S (2ea1aa87): الموقع + الجدولةُ الحافظةُ للعمل
  X = S + D (161890c8، دمجُ D فوقَ S بالفرقِ نفسِه)
الحكمان منفصلان: D مقابلَ A (أثرُ D على main)، وX مقابلَ S (أثرُ D فوقَ الجدولة)؛ وX↔A للإعلامِ فقط.

الاستعمال:
  b31-analyze.py wave     <RAW_WAVE_DIR> <SESSION_LIMIT>          → JSON
  b31-analyze.py validity <OUT> <RUN…>                            → ALL_VALID | NOT_VALID (+ تفصيلٌ على stderr)
  b31-analyze.py decide   <OUT> <SESSION_LIMIT> <RUN…>            → JSON (الحكم)
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

_spec = importlib.util.spec_from_file_location("b30", Path(__file__).with_name("b30-analyze.py"))
b30 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b30)  # type: ignore[union-attr]
b28, b27, b26, b25 = b30.b28, b30.b27, b30.b26, b30.b25

# ---------------------------------------------------------------- عتباتٌ مسجَّلةٌ مسبقًا (PLAN-b31.md §6)
SERIES_SIZE = 8
ARMS = "ADSX"
PAIRS = (("D", "A"), ("X", "S"))
MD1_MAX_TRIPS_RATIO = 0.75    # MD1: وسيطُ رحلاتِ الالتقاطِ لكلِّ وظيفةٍ في المرشّح ≤ 0.75 × المرجع
MD2_MAX_QUEUE_RATIO = 0.75    # MD2: وسيطُ p95 طابورِ وظائفِ تيليجرام (created→claimed) في المرشّح ≤ 0.75 × المرجع
VERIFIED_MIN_RATIO = b27.VERIFIED_MIN_RATIO  # N3: 0.97
HARD_GATES, PERF_GATES = b27.HARD_GATES, b27.PERF_GATES
POOL = b28.POOL
INTAKE = "select claim_and_enqueue_telegram_update("
EFFECT_SIG = "select telegram_update_effect_recorded("
RECORD_SIG = "select record_telegram_update_effect("
NOT_PREPARE = (EFFECT_SIG, RECORD_SIG, "select claim_telegram_update", "select finish_telegram_update_replies(")


def arm(run: str) -> str | None:
    m = re.search(r"-([ADSX])\d+-\d+$", run)
    return m.group(1) if m else None


def _pct(a, q):
    a = sorted(x for x in a if x is not None)
    return None if not a else round(a[min(len(a) - 1, int(q * len(a)))], 1)


def _mean(a):
    a = [x for x in a if x is not None]
    return round(st.mean(a), 2) if a else None


def drainer(d: Path) -> dict:
    """تفكيكُ استهلاكِ معالجِ وظائفِ تيليجرام لاتصالاتِ gatewayRequest (وصفٌ لا يُغيّرُ البوابات)."""
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    hook = lambda r: str(r.get("route", "")).startswith("POST /webhook/telegram/")
    rs = [t for t in tr if t.get("k") == "rsig" and t.get("pool") == POOL]
    hook_sigs = {r["sig"] for r in rs if hook(r) and not r["sig"].startswith(INTAKE)}
    jobs = [t for t in tr if t.get("k") == "job"]
    sweeps = [t for t in tr if t.get("k") == "sweep"]
    nj = len(jobs)
    by: dict = defaultdict(lambda: [0, 0.0])
    for r in rs:
        if r.get("kind") == "txQuery":
            continue
        is_drainer = (hook(r) and not r["sig"].startswith(INTAKE)) or (
            r.get("route") == "(background)" and r["sig"] in hook_sigs)
        if is_drainer:
            by[r["sig"][:60]][0] += int(r.get("n") or 0)
            by[r["sig"][:60]][1] += float(r.get("runMs") or 0)
    acq = sum(v[0] for v in by.values())
    run = sum(v[1] for v in by.values())
    n = w = 0.0
    for t in tr:
        if t.get("k") == "db" and t.get("pool") == POOL and t.get("kind") != "txQuery":
            n += int(t.get("n") or 0)
            w += float(t.get("waitSumMs") or 0)
    created: dict = {}
    p = b25.find(d, "update-jobs.csv")
    if p is not None:
        with b25.open_text(p) as f:
            for row in csv.reader(f):
                if len(row) >= 3 and row[1].isdigit() and row[2].isdigit():
                    created[(row[0], int(row[1]))] = int(row[2])
    queue = [j["claimedAt"] - created[(j.get("bot"), j.get("updateId"))] for j in jobs
             if (j.get("bot"), j.get("updateId")) in created and j.get("claimedAt") is not None]
    proc = [j["endedAt"] - j["startedAt"] for j in jobs if j.get("endedAt") is not None and j.get("startedAt") is not None]
    exec_of = lambda s: (by[s][1] / by[s][0]) if by.get(s) and by[s][0] else None
    prep_keys = [k for k in by if not any(k.startswith(x) for x in NOT_PREPARE)]
    prep_exec = sum(by[k][1] for k in prep_keys) / nj if nj else None
    prep_acq = sum(by[k][0] for k in prep_keys) / nj if nj else None
    eff_mean, rec_mean, prep_mean = (_mean([j.get(k) for j in jobs]) for k in ("effectCheckMs", "recordMs", "prepareMs"))
    eff_x, rec_x = exec_of(EFFECT_SIG[:60]), exec_of(RECORD_SIG[:60])
    trips = sum(int(s.get("claimTrips") or 0) for s in sweeps)
    claim_ms = sum(float(s.get("claimMs") or 0) for s in sweeps)
    # التزامنُ الجاري: عيّنةٌ كلَّ 100ms بينَ 30s و180s من أوّلِ وظيفة (نافذةُ الحقن)
    infl = []
    if jobs:
        t0 = min(j["startedAt"] for j in jobs)
        ev = sorted([(j["startedAt"], 1) for j in jobs] + [(j["endedAt"], -1) for j in jobs])
        cur = i = 0
        for k in range(1500):
            t = t0 + 30_000 + k * 100
            while i < len(ev) and ev[i][0] <= t:
                cur += ev[i][1]
                i += 1
            infl.append(cur)
    return {
        "jobs": nj,
        "acq_per_job": round(acq / nj, 3) if nj else None,
        "exec_ms_per_acq": round(run / acq, 3) if acq else None,
        "hold_ms_per_job": round(run / nj, 2) if nj else None,
        "pool_wait_ms_per_acq": round(w / n, 2) if n else None,
        "claim_trips_per_job": round(trips / nj, 4) if nj else None,
        "claim_trip_ms_mean": round(claim_ms / trips, 1) if trips else None,
        "claim_ms_per_job": round(claim_ms / nj, 2) if nj else None,
        "sweeps": len(sweeps),
        "queue_ms": {"p50": _pct(queue, .5), "p95": _pct(queue, .95), "n": len(queue)},
        "process_ms": {"mean": _mean(proc), "p50": _pct(proc, .5), "p95": _pct(proc, .95)},
        "inflight": {"p50": _pct(infl, .5), "p95": _pct(infl, .95)},
        "phase_mean_ms": {"effectCheck": eff_mean, "prepare": prep_mean, "record": rec_mean},
        "phase_exec_ms": {"effectCheck": round(eff_x, 2) if eff_x else None,
                          "prepare_per_job": round(prep_exec, 2) if prep_exec else None,
                          "record": round(rec_x, 2) if rec_x else None},
        "phase_wait_est_ms": {
            "effectCheck": round(eff_mean - eff_x, 1) if None not in (eff_mean, eff_x) else None,
            "prepare": round(prep_mean - prep_exec, 1) if None not in (prep_mean, prep_exec) else None,
            "record": round(rec_mean - rec_x, 1) if None not in (rec_mean, rec_x) else None,
        },
        "prepare_acq_per_job": round(prep_acq, 3) if prep_acq else None,
        "by_sig": {k: {"per_job": round(v[0] / nj, 3) if nj else None,
                       "exec_ms_per_acq": round(v[1] / v[0], 2) if v[0] else None}
                   for k, v in sorted(by.items(), key=lambda kv: -kv[1][0])},
    }


def wave(d: Path, session_limit: int) -> dict:
    w = b30.wave(d, session_limit)
    w["drainer_b31"] = drainer(d)
    return w


def validity(out_root: Path, runs: list[str]) -> tuple[bool, dict]:
    vv = {r: b26.validity(out_root / "raw" / r) for r in runs}
    ok = len(runs) == SERIES_SIZE and all(all(v == "VALID" for v in x.values()) for x in vv.values())
    return ok, vv


def decide(out_root: Path, session_limit: int, runs: list[str]) -> dict:
    waves = {}
    for r in runs:
        d = out_root / "raw" / r
        w = wave(d, session_limit)
        w["arm"] = arm(r)
        w["validity"] = b26.validity(d)
        waves[r] = w
    keys = [f"{c}_vs_{r}" for c, r in PAIRS]
    res: dict = {"session_limit": session_limit, "runs": runs,
                 "validity": {k: w["validity"] for k, w in waves.items()},
                 "condition": {k: b26.condition_ok(w, session_limit) for k, w in waves.items()}}
    arms = {a: [w for w in waves.values() if w["arm"] == a] for a in ARMS}
    if any(len(v) != 4 for v in arms.values()) or not all(b26.is_valid(w) for w in waves.values()):
        res["decision"] = {k: "INCONCLUSIVE" for k in keys}
        res["why"] = "ليست 4 موجاتٍ صالحةً لكلِّ ذراع (القاعدةُ المسجَّلة: لا انتقاءَ ولا استبدال)"
        return {"waves": waves, "result": res}
    if not all(res["condition"].values()):
        res["decision"] = {k: "INVALID-CONDITION" for k in keys}
        return {"waves": waves, "result": res}
    res["collect"] = {k: b28.collect_state(out_root / "raw" / k) for k in runs}
    if not all(v["complete"] for v in res["collect"].values()):
        res["decision"] = {k: "EVIDENCE_INCOMPLETE" for k in keys}
        return {"waves": waves, "result": res}

    dr = lambda k: (lambda w: w["drainer_b31"][k])
    M = {
        "drainer_claim_trips_per_job": dr("claim_trips_per_job"),
        "drainer_claim_trip_ms": dr("claim_trip_ms_mean"),
        "drainer_queue_p95_ms": lambda w: w["drainer_b31"]["queue_ms"]["p95"],
        "drainer_queue_p50_ms": lambda w: w["drainer_b31"]["queue_ms"]["p50"],
        "drainer_process_mean_ms": lambda w: w["drainer_b31"]["process_ms"]["mean"],
        "drainer_inflight_p50": lambda w: w["drainer_b31"]["inflight"]["p50"],
        "drainer_acq_per_job": dr("acq_per_job"),
        "drainer_exec_ms_per_acq": dr("exec_ms_per_acq"),
        "drainer_hold_ms_per_job": dr("hold_ms_per_job"),
        "pool_wait_ms_per_acq": dr("pool_wait_ms_per_acq"),
        "effect_wait_est_ms": lambda w: w["drainer_b31"]["phase_wait_est_ms"]["effectCheck"],
        "http_query_run_ms": lambda w: w["pool"]["http"]["query_run_ms_mean"],
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
    med = lambda k, a: agg[k][a]["median"]
    fails = {g: {a: sum(1 for w in arms[a] if b27.gate_pass(w, g) is False) for a in ARMS}
             for g in HARD_GATES + PERF_GATES}
    res["gate_fail_counts"] = fails
    obf, nd = M["driver_onboarding_failed"], M["jobs_not_done"]

    def safety(cand: str, ref: str) -> dict:
        C, R = arms[cand], arms[ref]
        rv, cv = med("verified_per_s", ref), med("verified_per_s", cand)
        return {
            "N1_hard_gates_each_wave": all(b27.gate_pass(w, g) is True for w in C for g in HARD_GATES),
            "N2_perf_fail_count_le_ref": all(fails[g][cand] <= fails[g][ref] for g in PERF_GATES),
            "N3_verified_median_ge_097ref": rv is not None and cv is not None and cv >= VERIFIED_MIN_RATIO * rv,
            "N4_onboarding_failed_each_le_max_ref": all(obf(w) <= max(obf(x) for x in R) for w in C),
            "N5_jobs_not_done_each_le_max_ref": all(nd(w) <= max(nd(x) for x in R) for w in C),
        }

    crit, dec = {}, {}
    for cand, ref in PAIRS:
        c: dict = {}
        ct, rt = med("drainer_claim_trips_per_job", cand), med("drainer_claim_trips_per_job", ref)
        cq, rq = med("drainer_queue_p95_ms", cand), med("drainer_queue_p95_ms", ref)
        c["MD1_claim_trips_per_job_le_0.75ref"] = None not in (ct, rt) and ct <= MD1_MAX_TRIPS_RATIO * rt
        c["MD2_drainer_queue_p95_le_0.75ref"] = None not in (cq, rq) and cq <= MD2_MAX_QUEUE_RATIO * rq
        c.update(safety(cand, ref))
        cb, rb = med("phone_backlog_median", cand), med("phone_backlog_median", ref)
        co, ro = med("driver_onboarding_failed", cand), med("driver_onboarding_failed", ref)
        cv, rv = med("verified_per_s", cand), med("verified_per_s", ref)
        benefit = (None not in (cb, rb, co, ro, cv, rv) and cb <= rb and co <= ro and cv >= rv
                   and (cb < rb or co < ro or cv > rv))
        c["BD_backlog_onboarding_verified_not_worse_and_one_better"] = benefit
        mech = c["MD1_claim_trips_per_job_le_0.75ref"] and c["MD2_drainer_queue_p95_le_0.75ref"]
        safe = all(v for k, v in c.items() if k.startswith("N"))
        key = f"{cand}_vs_{ref}"
        crit[key] = c
        dec[key] = "REGRESSION" if not safe else ("NOT_CONFIRMED" if not mech else ("CONFIRMED" if benefit else "NO_NET_GAIN"))
        p4c, p4r = med("P4_p95_ms", cand), med("P4_p95_ms", ref)
        res[f"P4_improved_but_hard_gate_failed_{cand}"] = bool(
            None not in (p4c, p4r) and p4c < p4r and not c["N1_hard_gates_each_wave"])
    res["criteria"] = crit
    res["decision"] = dec
    res["info_all_gates_pass_waves"] = {a: sum(1 for w in arms[a] if w["all_gates"]["verdict"] == "PASS") for a in ARMS}
    res["info_X_vs_A_hard_gates_each_wave"] = all(b27.gate_pass(w, g) is True for w in arms["X"] for g in HARD_GATES)
    res["LOAD01_official"] = "NOT_RUN (مقارنةٌ تشخيصيّةٌ عندَ 750؛ لا موجاتِ 1000 ولا بروتوكولَ قبول)"
    return {"waves": waves, "result": res}


def main() -> int:
    a = sys.argv
    if len(a) >= 4 and a[1] == "wave":
        print(json.dumps(wave(Path(a[2]), int(a[3])), ensure_ascii=False, indent=1))
        return 0
    if len(a) >= 4 and a[1] == "validity":
        ok, vv = validity(Path(a[2]), a[3:])
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
