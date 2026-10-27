#!/usr/bin/env python3
"""LOAD01-MAIN-BASELINE — محلّلُ خطِّ الأساسِ على main (PROTOCOL-load01-main-baseline.md).

  wave <D> <out.json>               — مقاييسُ موجةٍ واحدة (G1، البوّابات، حجوزاتُ contact، التفكيك، المجمّع)
  summary <out.json> <D1> ... <Dn>  — الحكمُ المسجَّلُ مسبقًا (§5): BASELINE_ESTABLISHED / BASELINE_UNSTABLE /
                                      BASELINE_MECH_MISMATCH / BASELINE_INCOMPLETE
رموزُ الخروج: 0 = BASELINE_ESTABLISHED، 3 = حكمٌ آخرُ صدرَ، غيرُ ذلك = إخفاقُ المحلّل (غيابُ الحكم).
لا عتبةَ قبولٍ هنا: خطُّ الأساسِ ليسَ قبولًا، وLOAD-01 = FAIL ما لم تصدرْ أدلّةُ قبولٍ رسميّة.
"""
import gzip, importlib.util, json, os, statistics, sys

EXPECTED_CONTACT_ACQ = 2.0      # §5.2 — #663: حجزانِ لكلِّ مهمّةِ contact
ACQ_TOL = 0.001
MAX_G1_RANGE_PTS = 5.0          # §5.3 — تباينُ الجولاتِ الموثَّقُ ±2–5 نقاط
MIN_WAVES = 4


def _retro():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "onboard4-retro.py")
    spec = importlib.util.spec_from_file_location("onboard4_retro", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _open(d, name):
    p = os.path.join(d, name)
    if os.path.exists(p):
        return open(p, "rt", encoding="utf-8")
    if os.path.exists(p + ".gz"):
        return gzip.open(p + ".gz", "rt", encoding="utf-8")
    raise FileNotFoundError(p)


def contact_acq(d):
    n = s = 0
    with _open(d, "load-trace.jsonl") as f:
        for line in f:
            if '"job"' not in line or '"contact"' not in line:
                continue
            e = json.loads(line)
            if e.get("k") == "job" and e.get("kind") == "contact":
                n += 1
                s += e.get("gateAcq", 0)
    return {"jobs": n, "gateAcq": s, "per_job": round(s / n, 4) if n else None}


def gates_line(d):
    for line in open(os.path.join(d, "gates.txt"), encoding="utf-8"):
        if line.startswith("G1="):
            return {kv.split("=", 1)[0].strip(): kv.split("=", 1)[1].strip() for kv in line.strip().split(" | ") if "=" in kv}
    return {}


def wave(d, lanes=32):
    r = _retro().wave(d, lanes)
    wr = json.load(open(os.path.join(d, "wave-report.json"), encoding="utf-8"))
    pool = json.load(open(os.path.join(d, "job-timeline.json"), encoding="utf-8"))["pool"]
    loc = [p for p in pool["byPath"] if p["path"] == "http:POST /v1/driver/location"]
    return {
        "wave": os.path.basename(os.path.normpath(d)),
        "g1": r["g1"],
        "verdict": wr.get("verdict"),
        "failedGates": wr.get("failedGates"),
        "gates": gates_line(d),
        "contact_acq": contact_acq(d),
        "onboarding": {k: r[k] for k in ("onboarding_failed", "failed_step_patterns", "failed_with_phoneProofJob_timeout_share", "contact_jobs", "timeline_all", "little")},
        "pool": r["gatewayRequest_pool"] | {"driver_location": loc[0] if loc else None},
    }


def summary(waves):
    reasons = []
    if len(waves) < MIN_WAVES:
        reasons.append(f"موجاتٌ صالحةٌ {len(waves)} < {MIN_WAVES}")
        return {"verdict": "BASELINE_INCOMPLETE", "reasons": reasons, "waves": waves}
    acq = [w["contact_acq"]["per_job"] for w in waves]
    mech_ok = all(a is not None and abs(a - EXPECTED_CONTACT_ACQ) <= ACQ_TOL for a in acq)
    g1 = [w["g1"]["pct"] for w in waves]
    rng = round(max(g1) - min(g1), 2)
    if not mech_ok:
        verdict = "BASELINE_MECH_MISMATCH"
        reasons.append(f"حجوزاتُ contact لكلِّ مهمّة {acq} ≠ {EXPECTED_CONTACT_ACQ} — المقيسُ ليسَ سلوكَ main")
    elif rng > MAX_G1_RANGE_PTS:
        verdict = "BASELINE_UNSTABLE"
        reasons.append(f"مدى G1 {rng} نقطة > {MAX_G1_RANGE_PTS}")
    else:
        verdict = "BASELINE_ESTABLISHED"
    return {
        "verdict": verdict,
        "reasons": reasons,
        "g1_pct": g1,
        "g1_median": statistics.median(g1),
        "g1_range_pts": rng,
        "contact_acq_per_job": acq,
        "acceptance": "LOAD-01 = FAIL و LOAD-01M = NOT_MET — خطُّ الأساسِ ليسَ قبولًا",
        "waves": waves,
    }


def main(argv):
    if len(argv) >= 3 and argv[0] == "wave":
        json.dump(wave(argv[1]), open(argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        return 0
    if len(argv) >= 2 and argv[0] == "summary":
        s = summary([wave(d) for d in argv[2:]])
        json.dump(s, open(argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        print("BASELINE", s["verdict"], json.dumps({k: s.get(k) for k in ("g1_pct", "g1_median", "g1_range_pts", "contact_acq_per_job", "reasons")}, ensure_ascii=False))
        return 0 if s["verdict"] == "BASELINE_ESTABLISHED" else 3
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
