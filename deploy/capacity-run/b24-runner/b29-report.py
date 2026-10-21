#!/usr/bin/env python3
"""LOAD-01 · الدفعة 29 — إسنادُ فشلِ N2 والسعةُ الصافية (PLAN-b29.md، مثبَّتٌ قبلَ أوّلِ موجة).

لا يحسبُ بوّابةً ولا عتبةً جديدة: يستدعي b28-analyze.py حرفيًّا (ومنه b27/b26/b25) ويطبعُ ما يحسبُه
سطورًا رقميّةً في سجلِّ التشغيل — لا بصماتٍ ولا سلاسلَ طويلة — كي يبقى الإسنادُ قابلًا للتحقّق حتى لو
حُجِرَ الخامُّ بتدقيقِ الأسرار (كما حدث في 39559093346).

  b29-report.py wave     <OUT> <LIMIT> <SESSION_LIMIT> <RUN>        → سطر B29_WAVE
  b29-report.py series   <DECISION_JSON>                            → سطور B29_GATE_FAILS/B29_N2/B29_NET/B29_DECISION
  b29-report.py classify <OUT_JSON> <DECISION_JSON…>                → الحكمُ عبرَ السلاسل (القاعدةُ في PLAN-b29.md §5)
"""
from __future__ import annotations

import importlib.util
import json
import statistics
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b28", Path(__file__).with_name("b28-analyze.py"))
b28 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b28)  # type: ignore[union-attr]
b27 = b28.b27
PERF, HARD = b27.PERF_GATES, b27.HARD_GATES

# ---------------------------------------------------------------- مسجَّلٌ مسبقًا (PLAN-b29.md §5–§6)
NET_GAIN_MIN_RATIO = 1.03   # السعةُ الصافية: وسيطُ verified/s في C ≥ 1.03 × R في كلِّ سلسلةٍ صالحة
NET_LOSS_RATIO = 1.00       # أقلُّ من R في أيِّ سلسلةٍ صالحة ⇒ لا ربحَ صافيًا
REPRO_MIN_SERIES = 2        # بوّابةٌ تُسقطُ N2 في سلسلتَين صالحتَين على الأقلّ (من 3) ⇒ مُعادةُ الإنتاج


def _row(w: dict, g: str) -> dict:
    return (w.get("all_gates", {}).get("rows") or {}).get(g) or {}


def wave_line(out: Path, limit: int, sl: int, run: str) -> str:
    d = out / "raw" / run
    try:
        w = b28.wave(d, limit, sl)
    except Exception as e:  # noqa: BLE001 — الخطأُ نفسُه دليلٌ (خطأُ محلِّلٍ لا بوّابة)
        return f"B29_WAVE {run} ANALYZER_ERROR {type(e).__name__}"
    p = w.get("pool") or {}
    js = w.get("jobs_state") or {}
    gates = {g: {"v": _row(w, g).get("value"), "pass": _row(w, g).get("pass")} for g in PERF + HARD}
    rec = {
        "side": "R" if "-R" in run else "C",
        "verdict": w["all_gates"].get("verdict"),
        "failed": w["all_gates"].get("failed"),
        "gates": gates,
        "verified_per_s": (w.get("completions") or {}).get("verified_per_s"),
        "drainer_acq_per_job": p.get("drainer_acq_per_job"),
        "effect_check_acq_per_job": p.get("effect_check_acq_per_job"),
        "http_wait_ms_per_acq": (p.get("http") or {}).get("wait_ms_per_acq"),
        "drainer_wait_ms_per_acq": (p.get("drainer") or {}).get("wait_ms_per_acq"),
        "http_query_run_ms": (p.get("http") or {}).get("query_run_ms_mean"),
        "drainer_query_run_ms": (p.get("drainer") or {}).get("query_run_ms_mean"),
        "http_tx_hold_ms": (p.get("http") or {}).get("tx_hold_ms_mean"),
        "drainer_tx_hold_ms": (p.get("drainer") or {}).get("tx_hold_ms_mean"),
        "jobs": p.get("jobs"),
        "jobs_not_done": js.get("not_done"),
        "jobs_late_over_20s": js.get("late_over_20s"),
        "drainer_mean_in_service": (w.get("drainer") or {}).get("mean_in_service"),
        "onboarding_failed": (w.get("onboarding") or {}).get("scenario_driver_onboarding_failed"),
        "onboarding": w.get("onboarding"),
        "queue": w.get("queue"),
        "validity": _safe(lambda: b28.b26.validity(d)),
    }
    return f"B29_WAVE {run} {json.dumps(rec, ensure_ascii=False, separators=(',', ':'), default=str)}"


def _safe(f):
    try:
        return f()
    except Exception as e:  # noqa: BLE001
        return f"ERR:{type(e).__name__}"


def _num(v):
    """قيمةُ البوّابةِ الرقميّةُ الأولى من نصِّ wave-report (‎"85s"‎ ← 85.0)."""
    s = str(v or "")
    num = ""
    for ch in s:
        if ch.isdigit() or ch in ".-" and (num == "" or ch == "."):
            num += ch
        elif num:
            break
    try:
        return float(num)
    except ValueError:
        return None


def n2_attribution(dec: dict) -> dict:
    res, waves = dec["result"], dec["waves"]
    fails = res.get("gate_fail_counts") or {}
    culprits = [g for g in PERF if g in fails and fails[g]["C"] > fails[g]["R"]]
    per = {}
    for g in culprits:
        rv = [_num(_row(w, g).get("value")) for w in waves.values() if w.get("side") == "R"]
        cv = [_num(_row(w, g).get("value")) for w in waves.values() if w.get("side") == "C"]
        rv, cv = [x for x in rv if x is not None], [x for x in cv if x is not None]
        per[g] = {"R_values": rv, "C_values": cv,
                  "R_median": statistics.median(rv) if rv else None,
                  "C_median": statistics.median(cv) if cv else None,
                  "R_fails": fails[g]["R"], "C_fails": fails[g]["C"]}
    return {"n2": (res.get("criteria") or {}).get("N2_perf_fail_count_C_le_R"), "culprits": culprits, "detail": per}


def net(dec: dict) -> dict:
    agg = (dec["result"].get("aggregate") or {})
    m = lambda k, s: ((agg.get(k) or {}).get(s) or {}).get("median")
    rv, cv = m("verified_per_s", "R"), m("verified_per_s", "C")
    ratio = round(cv / rv, 4) if rv and cv is not None else None
    keys = ("verified_per_s", "drainer_acq_per_job", "effect_check_acq_per_job", "http_wait_ms_per_acq",
            "drainer_wait_ms_per_acq", "http_query_run_ms", "drainer_query_run_ms", "http_tx_hold_ms",
            "jobs_not_done", "jobs_late_over_20s", "driver_onboarding_failed", "P4_p95_ms", "G1_pct",
            "drainer_mean_in_service")
    return {"verified_ratio_C_over_R": ratio, "medians": {k: {"R": m(k, "R"), "C": m(k, "C")} for k in keys}}


def series_lines(p: Path) -> list[str]:
    dec = json.loads(p.read_text(encoding="utf-8"))
    res = dec["result"]
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"), default=str)
    out = [f"B29_DECISION {res.get('decision')} {j(res.get('criteria'))}"]
    if "gate_fail_counts" in res:
        out.append(f"B29_GATE_FAILS {j(res['gate_fail_counts'])}")
        out.append(f"B29_N2 {j(n2_attribution(dec))}")
        out.append(f"B29_NET {j(net(dec))}")
        out.append(f"B29_ALL_C_GATES_PASS {res.get('info_all_C_gates_pass')}")
    else:
        out.append(f"B29_NO_ATTRIBUTION why={res.get('why')}")
    return out


def classify(paths: list[Path]) -> dict:
    series = {}
    for p in paths:
        dec = json.loads(p.read_text(encoding="utf-8"))
        r = dec["result"]
        valid = r.get("decision") not in ("INCONCLUSIVE", "INVALID-CONDITION", "EVIDENCE_INCOMPLETE", None)
        series[p.parent.name or str(p)] = {
            "decision": r.get("decision"), "valid": valid, "why": r.get("why"),
            "n2": n2_attribution(dec) if valid else None, "net": net(dec) if valid else None,
            "all_C_gates_pass": r.get("info_all_C_gates_pass"),
        }
    V = {k: v for k, v in series.items() if v["valid"]}
    out: dict = {"series": series, "valid_series": len(V)}
    if len(V) < REPRO_MIN_SERIES:
        out["n2_class"] = "INSUFFICIENT_VALID_SERIES"
    else:
        cnt: dict = {}
        for v in V.values():
            for g in v["n2"]["culprits"]:
                cnt[g] = cnt.get(g, 0) + 1
        out["culprit_series_count"] = cnt
        repro = [g for g, n in cnt.items() if n >= REPRO_MIN_SERIES]
        # اتّجاهٌ ثابت: وسيطُ قيمةِ البوّابةِ في C أسوأُ (أكبرُ) من R في كلِّ سلسلةٍ أسقطتها
        consistent = [g for g in repro if all(
            (v["n2"]["detail"][g]["C_median"] or 0) > (v["n2"]["detail"][g]["R_median"] or 0)
            for v in V.values() if g in v["n2"]["culprits"])]
        if consistent:
            out["n2_class"] = "REAL_REGRESSION"
            out["n2_gates"] = consistent
        elif all(v["n2"]["n2"] for v in V.values()):
            out["n2_class"] = "N2_NOT_REPRODUCED"
        else:
            out["n2_class"] = "N2_UNSTABLE"
            out["n2_gates"] = sorted(cnt)
    ratios = [v["net"]["verified_ratio_C_over_R"] for v in V.values()]
    if not V or any(x is None for x in ratios):
        out["net_class"] = "NET_UNMEASURED"
    elif all(x >= NET_GAIN_MIN_RATIO for x in ratios) and all(v["decision"] != "REGRESSION" for v in V.values()):
        out["net_class"] = "NET_GAIN"
    elif any(x < NET_LOSS_RATIO for x in ratios):
        out["net_class"] = "NET_LOSS"
    else:
        out["net_class"] = "NO_NET_GAIN"
    out["verified_ratios"] = ratios
    out["merge_609_eligible"] = bool(
        V and len(V) == len(series)
        and all(v["decision"] == "FIX_CONFIRMED" for v in V.values())
        and out["net_class"] == "NET_GAIN"
        and all(v["all_C_gates_pass"] is True for v in V.values()))
    out["load01_acceptance_eligible"] = all(v["all_C_gates_pass"] is True for v in V.values()) if V else False
    out["governing_39559093346"] = "NON_ATTRIBUTABLE (raw quarantined; no per-gate counts in log)"
    return out


def main() -> int:
    a = sys.argv
    if len(a) == 6 and a[1] == "wave":
        print(wave_line(Path(a[2]), int(a[3]), int(a[4]), a[5]))
        return 0
    if len(a) == 3 and a[1] == "series":
        print("\n".join(series_lines(Path(a[2]))))
        return 0
    if len(a) >= 4 and a[1] == "classify":
        r = classify([Path(x) for x in a[3:]])
        Path(a[2]).write_text(json.dumps(r, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("B29_CLASSIFY", json.dumps({k: r[k] for k in r if k != "series"}, ensure_ascii=False))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
