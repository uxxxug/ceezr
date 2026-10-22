#!/usr/bin/env python3
"""LOAD-01 · الدفعة 28 — محلّلُ السلسلةِ ومُطبِّقُ قاعدةِ القرارِ المسجَّلةِ مسبقًا (PLAN-b28.md).

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PLAN-b28.md؛ لا تُعدَّلُ عتبةٌ بعدَ رؤيةِ النتيجة.
يُعيدُ استعمالَ b27-analyze.py حرفيًّا (wave: بواباتٌ/إكمالٌ/إلحاقٌ/إثباتُ هاتفٍ/درينر) ويضيفُ مقاييسَ المجمّع
من صفوفِ `rsig` في load-trace (إجماليُّ الموجةِ لكلِّ مسارٍ وتوقيعٍ ونوع؛ `waitMs` أُضيفَ في الطرفَين):
  - الحجوزات = n لنوعَي `query` و`tx` (كلٌّ مقعدٌ واحدٌ من بوّابةِ المجمّع)، و`txQuery` ليس حجزًا.
  - الدرينر = كلُّ صفٍّ تحتَ مسارِ `POST /webhook/telegram/*` عدا الاستقبالِ (`claim_and_enqueue_telegram_update`)،
    وكلُّ صفٍّ `(background)` يظهرُ توقيعُه تحتَ مسارِ الويبهوك في الموجةِ نفسِها (تصريفُ المؤقِّت).
  - HTTP = كلُّ ما سواه من المسارات (ومنه الاستقبال). الخلفيّةُ الأخرى منفصلة.
  - لكلِّ صنف: الحجوزات، ومتوسّطُ انتظارِ المجمّعِ لكلِّ حجز، ومتوسّطُ زمنِ التنفيذِ (query) والاحتجازِ (tx).
  - الحجوزاتُ لكلِّ وظيفة = حجوزاتُ الدرينر ÷ صفوفِ k=job؛ ومنها فحصُ الأثر (`telegram_update_effect_recorded`).
  - الوظائفُ المنتظرةُ (غيرُ done عندَ الختام) والمتأخّرةُ (> 20s) لكلِّ البوتات من update-jobs.csv.

السلسلة (R = main + حقلُ waitMs في الأثرِ وحدَه، C = R + الإصلاح):
  main  R=45571268  C=3aace81e  (حدُّ 50 في الطرفَين، لا تغييرَ في المولّدِ ولا العتبات)

الاستعمال:
  b28-analyze.py wave   <RAW_WAVE_DIR> <LIMIT> <SESSION_LIMIT>          → JSON
  b28-analyze.py decide <OUT> <LIMIT> <SESSION_LIMIT> <RUN…>             → JSON (الحكم)
"""
from __future__ import annotations

import csv
import gzip
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

_spec = importlib.util.spec_from_file_location("b27", Path(__file__).with_name("b27-analyze.py"))
b27 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(b27)  # type: ignore[union-attr]
b26, b25 = b27.b26, b27.b25

# ---------------------------------------------------------------- عتباتٌ مسجَّلةٌ مسبقًا
POOL = "ceezr:gatewayRequest"
INTAKE_SIG = "select claim_and_enqueue_telegram_update("
EFFECT_SIG = "select telegram_update_effect_recorded("
M1_MIN_DROP = 0.8          # M1: وسيطُ حجوزاتِ الدرينرِ لكلِّ وظيفةٍ في C ≤ وسيطِ R − 0.8 (الشاهد: −1.04)
M2_MAX_EFFECT_PER_JOB = 0.05  # M2: حجوزاتُ فحصِ الأثرِ لكلِّ وظيفةٍ في كلِّ موجةِ C ≤ 0.05 (R ≈ 1.0)
H1_MAX_HTTP_WAIT_RATIO = 1.05  # H1: وسيطُ انتظارِ HTTP لكلِّ حجزٍ في C ≤ 1.05 × وسيطِ R
VERIFIED_MIN_RATIO = b27.VERIFIED_MIN_RATIO  # N3: 0.97
HARD_GATES, PERF_GATES = b27.HARD_GATES, b27.PERF_GATES
SERIES_SIZE = b26.SERIES_SIZE


def _rate(num, den, nd=3):
    return round(num / den, nd) if den else None


def pool(d: Path) -> dict:
    tr = b25.jsonl(b25.find(d, "load-trace.jsonl"))
    rs = [t for t in tr if t.get("k") == "rsig" and t.get("pool") == POOL]
    jobs = sum(1 for t in tr if t.get("k") == "job")
    hook = lambda r: str(r.get("route", "")).startswith("POST /webhook/telegram/")
    hook_sigs = {r["sig"] for r in rs if hook(r) and r["sig"] != INTAKE_SIG}

    def cls(r):
        if hook(r):
            return "http" if r["sig"] == INTAKE_SIG else "drainer"
        if r.get("route") == "(background)":
            return "drainer" if r["sig"] in hook_sigs else "background"
        return "http"

    acc = {c: {"acq": 0, "wait": 0.0, "wait_rows": 0, "q_n": 0, "q_run": 0.0, "tx_n": 0, "tx_run": 0.0,
               "txq_n": 0} for c in ("drainer", "http", "background")}
    effect = 0
    by_sig = Counter()
    for r in rs:
        c, k, n = cls(r), r.get("kind"), int(r.get("n") or 0)
        a = acc[c]
        if k == "txQuery":
            a["txq_n"] += n
            continue
        a["acq"] += n
        if r.get("waitMs") is not None:
            a["wait"] += float(r["waitMs"])
            a["wait_rows"] += n
        if k == "query":
            a["q_n"] += n
            a["q_run"] += float(r.get("runMs") or 0)
        elif k == "tx":
            a["tx_n"] += n
            a["tx_run"] += float(r.get("runMs") or 0)
        if c == "drainer":
            by_sig[r["sig"][:60]] += n
            if r["sig"] == EFFECT_SIG:
                effect += n
    out = {"jobs": jobs, "drainer_by_sig": dict(by_sig.most_common())}
    for c, a in acc.items():
        out[c] = {"acquisitions": a["acq"],
                  "wait_ms_per_acq": _rate(a["wait"], a["wait_rows"]) if a["wait_rows"] else None,
                  "query_run_ms_mean": _rate(a["q_run"], a["q_n"]),
                  "tx_hold_ms_mean": _rate(a["tx_run"], a["tx_n"]),
                  "tx": a["tx_n"], "tx_queries": a["txq_n"]}
    out["drainer_acq_per_job"] = _rate(acc["drainer"]["acq"], jobs)
    out["effect_check_acq_per_job"] = _rate(effect, jobs)
    tot = sum(a["acq"] for a in acc.values())
    out["drainer_share_of_acq"] = _rate(acc["drainer"]["acq"], tot)
    return out


def jobs_state(d: Path) -> dict:
    p = d / "update-jobs.csv.gz"
    st, late, waiting = Counter(), 0, 0
    if p.exists():
        for r in csv.reader(gzip.open(p, "rt")):
            if len(r) < 5:
                continue
            st[(r[0], r[4])] += 1
            if r[4] != "done":
                waiting += 1
            elif r[3] and int(r[3]) - int(r[2]) > 20_000:
                late += 1
    return {"status": {f"{b}:{s}": n for (b, s), n in sorted(st.items())}, "not_done": waiting, "late_over_20s": late}


def wave(d: Path, limit: int, session_limit: int) -> dict:
    w = b27.wave(d, limit, session_limit)
    w["pool"] = pool(d)
    w["jobs_state"] = jobs_state(d)
    return w


def collect_state(d: Path) -> dict:
    """جامعُ الدفعة 28: MANIFEST.json لكلِّ موجة؛ غيابُه أو missing غيرُ فارغٍ ⇒ دليلٌ ناقص."""
    p = d / "MANIFEST.json"
    if not p.exists():
        return {"complete": False, "why": "MANIFEST.json absent"}
    m = json.loads(p.read_text(encoding="utf-8"))
    return {"complete": not m.get("missing"), "missing": m.get("missing"), "files": len(m.get("entries") or []),
            "undeclared_present": [u["name"] for u in m.get("undeclared_present") or m.get("undeclaredPresent") or []]}


def decide(out_root: Path, limit: int, session_limit: int, runs: list[str]) -> dict:
    waves = {}
    for r in runs:
        d = out_root / "raw" / r
        w = wave(d, limit, session_limit)
        w["side"] = "R" if "-R" in r else "C"
        w["validity"] = b26.validity(d)
        waves[r] = w
    res: dict = {"series": "main", "limit": limit, "session_limit": session_limit, "runs": runs,
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
    res["collect"] = {k: collect_state(out_root / "raw" / k) for k in runs}
    if not all(v["complete"] for v in res["collect"].values()):
        res["decision"] = "EVIDENCE_INCOMPLETE"
        res["why"] = "ملفٌّ مُعلَنٌ مطلوبٌ غائبٌ عن موجةٍ (MANIFEST.json ← missing)؛ لا حكمَ ولا دمج"
        return {"waves": waves, "result": res}
    R = [w for w in waves.values() if w["side"] == "R"]
    C = [w for w in waves.values() if w["side"] == "C"]
    obf = lambda w: w["onboarding"]["scenario_driver_onboarding_failed"]
    ver = lambda w: (w.get("completions") or {}).get("verified_per_s")
    dpj = lambda w: w["pool"]["drainer_acq_per_job"]
    eff = lambda w: w["pool"]["effect_check_acq_per_job"]
    hw = lambda w: w["pool"]["http"]["wait_ms_per_acq"]
    nd = lambda w: w["jobs_state"]["not_done"]
    agg = {}
    for name, f in (("drainer_acq_per_job", dpj), ("effect_check_acq_per_job", eff),
                    ("http_wait_ms_per_acq", hw), ("drainer_wait_ms_per_acq", lambda w: w["pool"]["drainer"]["wait_ms_per_acq"]),
                    ("http_query_run_ms", lambda w: w["pool"]["http"]["query_run_ms_mean"]),
                    ("drainer_query_run_ms", lambda w: w["pool"]["drainer"]["query_run_ms_mean"]),
                    ("http_tx_hold_ms", lambda w: w["pool"]["http"]["tx_hold_ms_mean"]),
                    ("drainer_share_of_acq", lambda w: w["pool"]["drainer_share_of_acq"]),
                    ("verified_per_s", ver), ("driver_onboarding_failed", obf),
                    ("jobs_not_done", nd), ("jobs_late_over_20s", lambda w: w["jobs_state"]["late_over_20s"]),
                    ("phone_proof_p95_ms", lambda w: w["phone_proof"]["p95_ms"]),
                    ("drainer_mean_in_service", lambda w: w["drainer"].get("mean_in_service")),
                    ("P4_p95_ms", lambda w: (w.get("P4") or {}).get("p95")), ("G1_pct", b27.g1_pct)):
        agg[name] = {"R": b25.stat([f(w) for w in R]), "C": b25.stat([f(w) for w in C])}
    res["aggregate"] = agg
    fails = {g: {"R": sum(1 for w in R if b27.gate_pass(w, g) is False),
                 "C": sum(1 for w in C if b27.gate_pass(w, g) is False)} for g in HARD_GATES + PERF_GATES}
    res["gate_fail_counts"] = fails
    med = lambda k, s: agg[k][s]["median"]
    crit: dict = {}
    # الآليّة
    crit["M1_drainer_acq_per_job_median_drop_ge_0.8"] = (
        agg["drainer_acq_per_job"]["R"]["missing"] == 0 and agg["drainer_acq_per_job"]["C"]["missing"] == 0
        and med("drainer_acq_per_job", "C") <= med("drainer_acq_per_job", "R") - M1_MIN_DROP)
    crit["M1b_separated_max_C_lt_min_R"] = b25.lt(agg["drainer_acq_per_job"]["C"]["max"], agg["drainer_acq_per_job"]["R"]["min"])
    crit["M2_effect_check_per_job_each_C_le_0.05"] = all(eff(w) is not None and eff(w) <= M2_MAX_EFFECT_PER_JOB for w in C)
    # السلامة وعدمُ التراجع
    crit["N1_hard_gates_each_C"] = all(b27.gate_pass(w, g) is True for w in C for g in HARD_GATES)
    crit["N2_perf_fail_count_C_le_R"] = all(v["C"] <= v["R"] for k, v in fails.items() if k in PERF_GATES)
    rv, cv = med("verified_per_s", "R"), med("verified_per_s", "C")
    crit["N3_verified_median_C_ge_097R"] = rv is not None and cv is not None and cv >= VERIFIED_MIN_RATIO * rv
    crit["N4_onboarding_failures_C_le_max_R"] = all(obf(w) <= max(obf(x) for x in R) for w in C)
    crit["N5_jobs_not_done_each_C_le_max_R"] = all(nd(w) <= max(nd(x) for x in R) for w in C)
    rh, ch = med("http_wait_ms_per_acq", "R"), med("http_wait_ms_per_acq", "C")
    crit["H1_http_wait_median_C_le_105R"] = rh is not None and ch is not None and ch <= H1_MAX_HTTP_WAIT_RATIO * rh
    res["criteria"] = crit
    mech = all(v for k, v in crit.items() if k.startswith("M"))
    safe = all(v for k, v in crit.items() if not k.startswith("M"))
    res["decision"] = "FIX_CONFIRMED" if mech and safe else ("REGRESSION" if not safe else "NOT_CONFIRMED")
    res["info_all_C_gates_pass"] = all(w["all_gates"]["verdict"] == "PASS" for w in C)
    return {"waves": waves, "result": res}


def main() -> int:
    a = sys.argv
    if len(a) >= 5 and a[1] == "wave":
        print(json.dumps(wave(Path(a[2]), int(a[3]), int(a[4])), ensure_ascii=False, indent=1))
        return 0
    if len(a) >= 6 and a[1] == "decide":
        print(json.dumps(decide(Path(a[2]), int(a[3]), int(a[4]), a[5:]), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
