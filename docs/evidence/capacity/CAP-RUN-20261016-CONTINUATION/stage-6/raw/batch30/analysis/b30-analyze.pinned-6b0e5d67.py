#!/usr/bin/env python3
"""LOAD-01 · الدفعة 30 — محلّلُ مقارنةِ الأذرعِ الثلاثةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b30.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b30.md؛ لا تُعدَّلُ عتبةٌ ولا قاعدةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ b28-analyze.py حرفيًّا (البوابات/الإكمال/الإلحاق/إثباتُ الهاتف/الدرينر/المجمّع/حالةُ الوظائف/
الجامع) ويضيف: حجوزاتِ مسارِ `POST /v1/driver/location` وانتظارَها لكلِّ طلب، وتفكيكَ P4 (الطابورُ قبلَ أوّلِ
تنفيذ)، وإيقاعَ شوطِ الموزّع، ومتأخّراتِ وظائفِ إثباتِ الهاتف، وتشبّعَ المعالج (load1/psi/PG/البوابة).

الأذرع (اسمُ الموجةِ يحملُ الذراع: …-A<n>-750 / …-L<n>-750 / …-S<n>-750):
  A = main (19e30b5b)                  — خطُّ الأساس: الحدُّ 50 والجدولةُ القائمة
  L = A + فتحُ الجلسةِ على الرحلةِ داخلَ جملةِ الإدراج (7352dc58)
  S = L + الجدولةُ الحافظةُ للعمل (2ea1aa87)، الحدُّ 50 نفسُه
الحكمان منفصلان: L مقابلَ A (أثرُ الموقع)، وS مقابلَ L (أثرُ الجدولة)؛ وA↔S للإعلامِ فقط.

الاستعمال:
  b30-analyze.py wave     <RAW_WAVE_DIR> <SESSION_LIMIT>          → JSON
  b30-analyze.py validity <OUT> <RUN…>                            → ALL_VALID | NOT_VALID (+ تفصيلٌ على stderr)
  b30-analyze.py decide   <OUT> <SESSION_LIMIT> <RUN…>            → JSON (الحكم)
"""
from __future__ import annotations

import csv
import gzip
import importlib.util
import json
import re
import sys
from collections import Counter
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b28", Path(__file__).with_name("b28-analyze.py"))
b28 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b28)  # type: ignore[union-attr]
b27, b26, b25 = b28.b27, b28.b26, b28.b25

# ---------------------------------------------------------------- عتباتٌ مسجَّلةٌ مسبقًا (PLAN-b30.md §4)
LIMIT = 50
SERIES_SIZE = 6
LOCATION_ROUTE = "POST /v1/driver/location"
ML1_MIN_DROP = 0.9            # ML1: وسيطُ حجوزاتِ الموقعِ لكلِّ طلبٍ في L ≤ وسيطِ A − 0.9 (الشاهد: −1)
BL_MAX_RATIO = 1.0            # BL: وسيطُ زمنِ مسارِ الموقعِ وانتظارُ HTTP لكلِّ حجزٍ في L ≤ 1.0 × A (لا أسوأ) وأحدُهما أقلُّ
MS1_MIN_RATE_RATIO = 1.20     # MS1: وسيطُ معدّلِ خدمةِ الموزّع في S ≥ 1.20 × L
MS2_MAX_QUEUE_RATIO = 0.75    # MS2: وسيطُ p95 الطابورِ قبلَ أوّلِ تنفيذٍ في S ≤ 0.75 × L
VERIFIED_MIN_RATIO = b27.VERIFIED_MIN_RATIO  # N3: 0.97
HARD_GATES, PERF_GATES = b27.HARD_GATES, b27.PERF_GATES
POOL = b28.POOL


def arm(run: str) -> str | None:
    m = re.search(r"-([ALS])\d+-\d+$", run)
    return m.group(1) if m else None


def _rate(num, den, nd=3):
    return round(num / den, nd) if den else None


def location(d: Path) -> dict:
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    req = sum(int(t.get("n") or 0) for t in tr if t.get("k") == "http" and t.get("route") == LOCATION_ROUTE)
    req_ms = sum(float(t.get("sumMs") or 0) for t in tr if t.get("k") == "http" and t.get("route") == LOCATION_ROUTE)
    acq = wait = 0.0
    wait_rows = 0
    run = 0.0
    for t in tr:
        if t.get("k") != "rsig" or t.get("pool") != POOL or t.get("route") != LOCATION_ROUTE:
            continue
        if t.get("kind") == "txQuery":
            continue
        n = int(t.get("n") or 0)
        acq += n
        run += float(t.get("runMs") or 0)
        if t.get("waitMs") is not None:
            wait += float(t["waitMs"])
            wait_rows += n
    return {"requests": req, "route_mean_ms": _rate(req_ms, req, 1), "acq": int(acq),
            "acq_per_req": _rate(acq, req), "wait_ms_per_acq": _rate(wait, wait_rows, 1),
            "hold_ms_per_req": _rate(run, req, 2)}


def dispatch(d: Path) -> dict:
    tr = b25.jsonl(b25.find(d, "dispatch-trace.jsonl"))
    P = sorted((t for t in tr if t.get("k") == "pass"), key=lambda p: p["startAt"])
    if len(P) < 2:
        return {"passes": len(P)}
    gaps = [b["startAt"] - a["startAt"] for a, b in zip(P, P[1:])]
    span = (P[-1]["startAt"] - P[0]["startAt"]) / 1000
    ms = [p.get("passMs") or 0 for p in P]
    return {"passes": len(P), "at_cap": sum(1 for p in P if (p.get("picked") or 0) >= LIMIT),
            "gap_p50_ms": b27.pct(gaps, .5), "passMs_p50": b27.pct(ms, .5),
            "duty_cycle": _rate(sum(ms) / 1000, span), "served_per_s": _rate(sum(p.get("picked") or 0 for p in P), span, 2)}


def p4(d: Path) -> dict:
    p = d / "p4-decompose.out.json"
    if not p.exists():
        return {}
    j, _ = json.JSONDecoder().raw_decode(p.read_text(encoding="utf-8"))
    q = j.get("queue_before_first_exec_ms") or {}
    return {"P4_p95": (j.get("P4") or {}).get("p95"), "queue_p50": q.get("p50"), "queue_p95": q.get("p95"),
            "queue_n": q.get("n"), "P4_n": (j.get("P4") or {}).get("n"),
            "first_exec_p95": (j.get("first_exec_ms") or {}).get("p95")}


def phone_backlog(d: Path) -> dict:
    p = d / "update-jobs.csv.gz"
    if not p.exists():
        return {}
    rows = [r for r in csv.reader(gzip.open(p, "rt")) if len(r) >= 5 and r[2].isdigit()]
    if not rows:
        return {}
    dd = [(int(r[2]), int(r[3]) if r[3].isdigit() else None, r[4]) for r in rows]
    t0 = min(x[0] for x in dd)
    arr = Counter((x[0] - t0) // 10_000 for x in dd)
    dn = Counter((x[1] - t0) // 10_000 for x in dd if x[2] == "done" and x[1] is not None)
    b, bl = 0, []
    for i in range(0, max(arr) + 1):
        b += arr[i] - dn[i]
        bl.append(b)
    after = sorted(bl[3:]) or [0]
    return {"backlog_median_after_30s": after[len(after) // 2], "backlog_max": max(bl)}


def cpu(d: Path) -> dict:
    rows = []
    p = d / "resources.jsonl"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    busy = [r for r in rows if ((r.get("gateway") or {}).get("cpu_pct") or 0) > 20]
    f = lambda k, sub=None: [((r.get(k) or {}).get(sub) if sub else r.get(k)) for r in busy]
    clean = lambda v: [x for x in v if isinstance(x, (int, float))]
    return {"samples": len(busy), "load1_p50": b27.pct(clean(f("load1")), .5),
            "pg_cpu_p50": b27.pct(clean(f("postgres", "cpu_pct")), .5),
            "gateway_cpu_p50": b27.pct(clean(f("gateway", "cpu_pct")), .5),
            "generator_cpu_p50": b27.pct(clean(f("generator", "cpu_pct")), .5)}


def wave(d: Path, session_limit: int) -> dict:
    w = b28.wave(d, LIMIT, session_limit)
    w["location"] = location(d)
    w["dispatch"] = dispatch(d)
    w["p4"] = p4(d)
    w["phone_backlog"] = phone_backlog(d)
    w["cpu"] = cpu(d)
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
    res: dict = {"limit": LIMIT, "session_limit": session_limit, "runs": runs,
                 "validity": {k: w["validity"] for k, w in waves.items()},
                 "condition": {k: b26.condition_ok(w, session_limit) for k, w in waves.items()}}
    arms = {a: [w for w in waves.values() if w["arm"] == a] for a in "ALS"}
    if any(len(v) != 4 for v in arms.values()) or not all(b26.is_valid(w) for w in waves.values()):
        res["decision"] = {"L_vs_A": "INCONCLUSIVE", "S_vs_L": "INCONCLUSIVE"}
        res["why"] = "ليست 4 موجاتٍ صالحةً لكلِّ ذراع (القاعدةُ المسجَّلة: لا انتقاءَ ولا استبدال)"
        return {"waves": waves, "result": res}
    if not all(res["condition"].values()):
        res["decision"] = {"L_vs_A": "INVALID-CONDITION", "S_vs_L": "INVALID-CONDITION"}
        return {"waves": waves, "result": res}
    res["collect"] = {k: b28.collect_state(out_root / "raw" / k) for k in runs}
    if not all(v["complete"] for v in res["collect"].values()):
        res["decision"] = {"L_vs_A": "EVIDENCE_INCOMPLETE", "S_vs_L": "EVIDENCE_INCOMPLETE"}
        return {"waves": waves, "result": res}

    M = {
        "loc_acq_per_req": lambda w: w["location"]["acq_per_req"],
        "loc_route_mean_ms": lambda w: w["location"]["route_mean_ms"],
        "loc_wait_ms_per_acq": lambda w: w["location"]["wait_ms_per_acq"],
        "loc_hold_ms_per_req": lambda w: w["location"]["hold_ms_per_req"],
        "http_wait_ms_per_acq": lambda w: w["pool"]["http"]["wait_ms_per_acq"],
        "http_query_run_ms": lambda w: w["pool"]["http"]["query_run_ms_mean"],
        "drainer_wait_ms_per_acq": lambda w: w["pool"]["drainer"]["wait_ms_per_acq"],
        "verified_per_s": lambda w: (w.get("completions") or {}).get("verified_per_s"),
        "G1_pct": b27.g1_pct,
        "P4_p95_ms": lambda w: w["p4"].get("P4_p95"),
        "queue_p95_ms": lambda w: w["p4"].get("queue_p95"),
        "dispatch_served_per_s": lambda w: w["dispatch"].get("served_per_s"),
        "dispatch_duty_cycle": lambda w: w["dispatch"].get("duty_cycle"),
        "phone_backlog_median": lambda w: w["phone_backlog"].get("backlog_median_after_30s"),
        "phone_proof_p95_ms": lambda w: w["phone_proof"]["p95_ms"],
        "driver_onboarding_failed": lambda w: w["onboarding"]["scenario_driver_onboarding_failed"],
        "jobs_not_done": lambda w: w["jobs_state"]["not_done"],
        "load1_p50": lambda w: w["cpu"].get("load1_p50"),
        "pg_cpu_p50": lambda w: w["cpu"].get("pg_cpu_p50"),
    }
    agg = {k: {a: b25.stat([f(w) for w in arms[a]]) for a in "ALS"} for k, f in M.items()}
    res["aggregate"] = agg
    med = lambda k, a: agg[k][a]["median"]
    fails = {g: {a: sum(1 for w in arms[a] if b27.gate_pass(w, g) is False) for a in "ALS"}
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

    # L مقابلَ A
    cL: dict = {}
    la, ll = agg["loc_acq_per_req"]["A"], agg["loc_acq_per_req"]["L"]
    cL["ML1_loc_acq_median_drop_ge_0.9"] = (la["missing"] == 0 and ll["missing"] == 0
                                            and ll["median"] <= la["median"] - ML1_MIN_DROP)
    cL["ML1b_separated_max_L_lt_min_A"] = b25.lt(ll["max"], la["min"])
    cL.update(safety("L", "A"))
    rm, lm = med("loc_route_mean_ms", "A"), med("loc_route_mean_ms", "L")
    rh, lh = med("http_wait_ms_per_acq", "A"), med("http_wait_ms_per_acq", "L")
    benefit = (None not in (rm, lm, rh, lh) and lm <= BL_MAX_RATIO * rm and lh <= BL_MAX_RATIO * rh
               and (lm < rm or lh < rh))
    cL["BL_location_latency_and_http_wait_not_worse_and_one_lower"] = benefit
    mechL = cL["ML1_loc_acq_median_drop_ge_0.9"] and cL["ML1b_separated_max_L_lt_min_A"]
    safeL = all(v for k, v in cL.items() if k.startswith("N"))
    dL = "REGRESSION" if not safeL else ("NOT_CONFIRMED" if not mechL else ("CONFIRMED" if benefit else "NO_NET_GAIN"))

    # S مقابلَ L
    cS: dict = {}
    sr, lr = med("dispatch_served_per_s", "S"), med("dispatch_served_per_s", "L")
    sq, lq = med("queue_p95_ms", "S"), med("queue_p95_ms", "L")
    cS["MS1_dispatch_rate_median_ge_1.20L"] = None not in (sr, lr) and sr >= MS1_MIN_RATE_RATIO * lr
    cS["MS2_queue_p95_median_le_0.75L"] = None not in (sq, lq) and sq <= MS2_MAX_QUEUE_RATIO * lq
    cS.update(safety("S", "L"))
    mechS = cS["MS1_dispatch_rate_median_ge_1.20L"] and cS["MS2_queue_p95_median_le_0.75L"]
    safeS = all(v for k, v in cS.items() if k.startswith("N"))
    dS = "REGRESSION" if not safeS else ("CONFIRMED" if mechS else "NOT_CONFIRMED")
    # قاعدةٌ صريحة: تحسّنُ P4 معَ سقوطِ G1 أو أيِّ بوابةٍ إلزاميّة = FAIL (يحرسُها N1؛ تُكتَبُ للقارئ)
    p4_better = None not in (med("P4_p95_ms", "S"), med("P4_p95_ms", "L")) and med("P4_p95_ms", "S") < med("P4_p95_ms", "L")
    res["P4_improved_but_hard_gate_failed_S"] = bool(p4_better and not cS["N1_hard_gates_each_wave"])
    res["criteria"] = {"L_vs_A": cL, "S_vs_L": cS}
    res["decision"] = {"L_vs_A": dL, "S_vs_L": dS}
    res["info_all_gates_pass_waves"] = {a: sum(1 for w in arms[a] if w["all_gates"]["verdict"] == "PASS") for a in "ALS"}
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
