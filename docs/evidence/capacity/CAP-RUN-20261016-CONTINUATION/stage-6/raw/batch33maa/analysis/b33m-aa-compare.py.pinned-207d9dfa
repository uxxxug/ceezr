#!/usr/bin/env python3
"""LOAD-01 · A/A لأثرِ أداةِ الرصدِ على G1 — مُطبِّقُ PROTOCOL-b33m-aa.md §4–§5.

مُثبَّتٌ (commit) قبلَ أوّلِ موجةٍ معَ PROTOCOL-b33m-aa.md وseat-b33m-aa.sh؛ لا يُعدَّلُ بعدَ رؤيةِ النتيجة.
الاستعمال: b33m-aa-compare.py <OUT>  → JSON على stdout (القرارُ والمقاييسُ لكلِّ موجةٍ وذراع).

المقاييسُ (§4): G1 ونتائجُ السيناريوهات، وإخفاقاتُ التسجيلِ وتوزيعُ phoneProofJob،
وزمنُ إنجازِ مهمّاتِ إثباتِ الهاتفِ خادميًا (created→done: p50/p95/p99/max وعددُ ما تجاوزَ 20ث —
المقيسُ الفعليُّ لا المهلةُ المُعلنة)، وصحّةُ المضيفِ (iowait/steal/foreign من wave-host.jsonl).
قاعدةُ القرارِ (§5) على أحجامِ الفروقِ المجمَّعةِ بينَ الذراعينِ معَ اتساقِ الزوجينِ المتجاورين.
موجاتُ INVALID تُستبعَدُ ولا تُحذَف؛ وغيابُ موجةٍ صالحةٍ لأيِّ ذراعٍ ⇒ مقارنةٌ غيرُ مكتملة (§5.5).
"""
from __future__ import annotations

import gzip
import json
import re
import sys
from pathlib import Path

OUT = Path(sys.argv[1])
RAW = OUT / "raw"
RUN_RE = re.compile(r"^b33maa-(w\d+-(?:on|off)(?:-r)?)-M-750$")
PHONE_PROOF_DEADLINE_MS = 20_000  # PHONE_PROOF_WAIT_MS الافتراضيّ — غيرُ مضبوطٍ في المقعد (§3)


def pct(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, int(p * len(sorted_vals)))
    return sorted_vals[i]


def wave_metrics(run_dir: Path) -> dict | None:
    """مقاييسُ موجةٍ واحدةٍ من خامِّها (§4). يعيد None عندَ فقدِ ملفٍّ لازِم."""
    m: dict = {"run": run_dir.name}
    # 1) G1 وبواباتُ الموجة
    wr = run_dir / "wave-report.json"
    if not wr.exists():
        return None
    w = json.loads(wr.read_text())
    m["verdict"] = w.get("verdict")
    for g in w.get("gates", []):
        if g.get("id") == "G1":
            m["g1_gate"] = {"value": g.get("value"), "pass": g.get("pass")}
    # 2) نتائجُ السيناريوهات وإخفاقاتُ التسجيلِ من أحداثِ المولّد
    ev = run_dir / "miniapp-load-events.jsonl.gz"
    if not ev.exists():
        return None
    outcomes = ends = onboard_failed = 0
    pp: dict[str, int] = {}
    with gzip.open(ev, "rt") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            kind = e.get("event")
            if kind == "scenario.outcome":
                outcomes += 1
            elif kind == "scenario.end":
                ends += 1
            elif kind == "driver.onboarding_failed":
                onboard_failed += 1
                o = (e.get("steps") or {}).get("phoneProofJob")
                pp[o] = pp.get(o, 0) + 1
    m["scenario_outcomes"] = outcomes
    m["scenario_completed"] = ends
    m["g1_fail_share"] = None if not outcomes else round(1 - ends / outcomes, 4)
    m["driver_onboarding_failed"] = onboard_failed
    m["phoneproofjob_outcomes"] = pp
    # 3) زمنُ إنجازِ المهمّاتِ خادميًا (update-jobs.csv: created,done بالملليث)
    uj = run_dir / "update-jobs.csv.gz"
    lat: list[int] = []
    if uj.exists():
        with gzip.open(uj, "rt") as f:
            for line in f:
                c = line.strip().split(",")
                if len(c) < 6 or c[0] == "chat_type":
                    continue
                try:
                    created, done, status = int(c[2]), int(c[3]), c[4]
                except ValueError:
                    continue
                if status == "done" and done and created:
                    lat.append(done - created)
    lat.sort()
    ms = {k: pct(lat, p) for k, p in (("p50", .5), ("p95", .95), ("p99", .99))}
    m["phoneproof_jobs"] = {
        "done_count": len(lat),
        "p50_s": round(ms["p50"] / 1000, 3) if ms["p50"] is not None else None,
        "p95_s": round(ms["p95"] / 1000, 3) if ms["p95"] is not None else None,
        "p99_s": round(ms["p99"] / 1000, 3) if ms["p99"] is not None else None,
        "max_s": round(lat[-1] / 1000, 3) if lat else None,
        "over_20s": sum(1 for x in lat if x > PHONE_PROOF_DEADLINE_MS),
        "over_20s_share": round(sum(1 for x in lat if x > PHONE_PROOF_DEADLINE_MS) / len(lat), 4) if lat else None,
    }
    # 4) صحّةُ المضيفِ أثناءَ الموجة (iowait/steal/foreign)
    wh = run_dir / "qual" / "wave-host.jsonl"
    if wh.exists():
        iw, st, fr = [], [], []
        for line in wh.read_text().splitlines():
            r = json.loads(line)
            if r.get("k") != "host":
                continue
            c = r.get("cpu") or {}
            if "iowait" in c:
                iw.append(c["iowait"])
            if "steal" in c:
                st.append(c["steal"])
            if "foreign_cpu_pct_of_1core_5s" in r:
                fr.append(r["foreign_cpu_pct_of_1core_5s"])
        m["host_health"] = {
            "iowait_mean_pct": round(sum(iw) / len(iw), 3) if iw else None,
            "iowait_p99_pct": round(sorted(iw)[int(.99 * (len(iw) - 1))], 3) if iw else None,
            "steal_mean_pct": round(sum(st) / len(st), 3) if st else None,
            "foreign_mean_pct": round(sum(fr) / len(fr), 3) if fr else None,
        }
    return m


def validity_of(name: str) -> bool:
    for vf in (OUT / f"validity-{name}.json", RAW / f"b33maa-{name}-M-750" / "validity.json"):
        if vf.exists():
            try:
                return bool(json.loads(vf.read_text()).get("is_valid"))
            except json.JSONDecodeError:
                continue
    return False


def main() -> int:
    waves: dict[str, dict] = {}
    for d in sorted(RAW.glob("b33maa-w*-M-750")):
        mt = RUN_RE.match(d.name)
        if not mt:
            continue
        name = mt.group(1)
        mm = wave_metrics(d)
        if mm is None:
            continue
        mm["valid"] = validity_of(name)
        mm["arm"] = "ON" if re.search(r"-on(-r)?$", name) else "OFF"
        waves[name] = mm

    def pool(arm: str) -> dict:
        v = [x for x in waves.values() if x["arm"] == arm and x["valid"]]
        tot = sum(x["scenario_outcomes"] for x in v)
        end = sum(x["scenario_completed"] for x in v)
        jobs = sum(x["phoneproof_jobs"]["done_count"] for x in v)
        over = sum(x["phoneproof_jobs"]["over_20s"] for x in v)
        return {
            "valid_waves": [x["run"] for x in v],
            "invalid_waves": [x["run"] for x in waves.values() if x["arm"] == arm and not x["valid"]],
            "scenario_outcomes": tot,
            "scenario_completed": end,
            "g1_fail_share": None if not tot else round(1 - end / tot, 4),
            "phoneproof_jobs": jobs,
            "over_20s": over,
            "over_20s_share": None if not jobs else round(over / jobs, 4),
            "p95_s_list": [x["phoneproof_jobs"]["p95_s"] for x in v],
            "iowait_mean_list": [x.get("host_health", {}).get("iowait_mean_pct") for x in v],
        }

    on, off = pool("ON"), pool("OFF")
    d_g1 = None if on["g1_fail_share"] is None or off["g1_fail_share"] is None \
        else round(100 * (on["g1_fail_share"] - off["g1_fail_share"]), 2)
    d_over = None if on["over_20s_share"] is None or off["over_20s_share"] is None \
        else round(100 * (on["over_20s_share"] - off["over_20s_share"]), 2)

    # الزوجانِ المتجاورانِ (§5.1): w1-OFF مقابل w2-ON، وw3-ON مقابل w4-OFF (بالإعاداتِ الصالحةِ إن لزم)
    def fail_of(name_pat: str) -> float | None:
        cands = [x for x in waves.values() if re.match(name_pat, x["run"]) and x["valid"]]
        if not cands:
            return None
        tot = sum(x["scenario_outcomes"] for x in cands)
        end = sum(x["scenario_completed"] for x in cands)
        return None if not tot else 1 - end / tot

    pair1 = None if fail_of(r"b33maa-w1-off") is None or fail_of(r"b33maa-w2-on") is None else \
        round(100 * (fail_of(r"b33maa-w2-on") - fail_of(r"b33maa-w1-off")), 2)
    pair2 = None if fail_of(r"b33maa-w4-off") is None or fail_of(r"b33maa-w3-on") is None else \
        round(100 * (fail_of(r"b33maa-w3-on") - fail_of(r"b33maa-w4-off")), 2)

    decision, why = "UNRESOLVED", None
    if not on["valid_waves"] or not off["valid_waves"]:
        decision, why = "UNRESOLVED", "مقارنةٌ غيرُ مكتملة: لا موجةَ صالحةً لأحدِ الذراعين (§5.5) — لا إعادةَ إضافية"
    elif d_g1 is not None and d_g1 >= 5 and pair1 is not None and pair2 is not None and pair1 > 0 and pair2 > 0:
        decision, why = "SUPPORTED", (
            f"Δ(G1 fail, ON−OFF) = +{d_g1}pp ≥ 5pp والزوجانِ المتجاورانِ باتجاهٍ واحد "
            f"(w2−w1={pair1:+}pp، w3−w4={pair2:+}pp) — للمعايِنِ أثرٌ يُخِلُّ بـG1 (§5.1)")
    elif d_g1 is not None and d_g1 <= 1 and (d_over is None or d_over <= 1):
        decision, why = "REFUTED", (
            f"Δ(G1 fail) = {d_g1:+}pp ≤ 1pp وΔ(mission >20s) = {d_over if d_over is not None else 'NA'}pp ≤ 1pp "
            f"— لا أثرَ قابلًا للقياسِ للمعايِنِ على G1 في هذا المقعد (§5.2)")
    elif d_g1 is not None:
        decision, why = "UNRESOLVED", f"Δ(G1 fail) = {d_g1:+}pp بينَ عتبتَي القرارِ (§5.3)"

    res = {
        "protocol": "PROTOCOL-b33m-aa.md",
        "decision": decision,
        "why": why,
        "delta_g1_fail_pp": d_g1,
        "delta_over20s_pp": d_over,
        "adjacent_pairs_pp": {"w2on_minus_w1off": pair1, "w3on_minus_w4off": pair2},
        "arms": {"ON": on, "OFF": off},
        "arms_summary": {
            "ON": {"valid": len(on["valid_waves"]), "g1_fail_share": on["g1_fail_share"],
                   "over_20s_share": on["over_20s_share"]},
            "OFF": {"valid": len(off["valid_waves"]), "g1_fail_share": off["g1_fail_share"],
                    "over_20s_share": off["over_20s_share"]},
        },
        "waves": waves,
        "phone_proof_deadline_ms": PHONE_PROOF_DEADLINE_MS,
        "note": "فشلُ G1 في الذراعينِ معًا لا يبرّئُ المعايِنَ (§5.4)؛ والحكمُ هنا على الفرقِ بينَ الذراعينِ لا على سببِ G1 المطلق",
    }
    print(json.dumps(res, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
