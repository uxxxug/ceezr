#!/usr/bin/env python3
# مقارنةُ تدخلِ الميزانيةِ (OFF=8000 مقابلَ ON=9800) — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا
# (PROTOCOL-b33m-idle.md §4–§5). لا يُعدَّلُ هذا الملفُ بعدَ رؤيةِ النتائج؛ الخللُ يُوثَّقُ في التقرير.
import gzip
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("v1", HERE / "b33m-analyze.py")
v1 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(v1)  # type: ignore[union-attr]

RUN_RE = re.compile(r"^b33midle2?-(w\d+-(?:on|off)(?:-r)?)-M-750$")
WAVE_SEC = 180_000
SEND_METHODS = ("sendMessage", "editMessageText", "sendPhoto")


def jl(p: Path) -> list[dict]:
    with gzip.open(p, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


def is_valid_wave(raw: Path, session_limit: str) -> bool:
    r = subprocess.run(
        [sys.executable, str(HERE / "b33m-analyze.py"), "valid", str(raw), session_limit],
        capture_output=True, text=True)
    return r.stdout.strip().splitlines()[-1:] == ["VALID"]


def load_window(raw: Path) -> tuple[float, float]:
    """نافذةُ الحملِ الموحّدة (PROTOCOL-b33m-idle.md §4): injection_start = t(الأول) − sinceStartMs(الأول)."""
    evs = jl(raw / "load-events.jsonl.gz")
    first = min(evs, key=lambda e: v1.ms(e["t"]))
    start = v1.ms(first["t"]) - first.get("sinceStartMs", 0)
    return start, start + WAVE_SEC


def rider_sends(raw: Path, lo: float, hi: float) -> list[float]:
    ts = []
    for m in jl(raw / "b33m-mock-egress.jsonl.gz"):
        if (m.get("status") == 200 and m.get("bot") == "rider"
                and m.get("method") in SEND_METHODS and lo <= m["t"] < hi):
            ts.append(m["t"])
    return ts


def union_len(intervals: list[tuple[float, float]]) -> float:
    total = 0.0
    last_end = None
    for a, b in sorted(intervals):
        if last_end is None or a > last_end:
            total += b - a
            last_end = b
        elif b > last_end:
            total += b - last_end
            last_end = b
    return total


def contains(intervals: list[tuple[float, float]], t: float) -> bool:
    return any(a <= t < b for a, b in intervals)


def load_wave(raw: Path) -> dict | None:
    """مقاييسُ موجةٍ واحدةٍ من خامِّها (§4) — كلُّها داخلَ نافذةِ الحملِ الموحّدة."""
    try:
        d = v1.load(raw)
    except Exception:
        return None
    if not d.get("mock"):
        return None
    lo, hi = load_window(raw)
    evs = d["events"]
    runs = [(r["start"], r["end"]) for r in v1.drain_runs(evs)
             if r["start"] < hi and r["end"] > lo]
    if not runs:
        return None
    durs = sorted(r["dur"] for r in v1.drain_runs(evs) if lo <= r["start"] < hi)
    # idle_with_eligible — قاعدةُ v2 حرفيًا (الفجواتُ المقوسةُ بعيناتٍ eligible>0 من الجانبين) داخلَ النافذة
    S = sorted((s for s in d["samples"] if "kinds" in s and lo <= s["t"] <= hi), key=lambda s: s["t"])
    R = sorted(runs)
    gaps = [(R[i][1], R[i + 1][0]) for i in range(len(R) - 1)]
    span = R[-1][1] - R[0][0]
    elig = lambda s: sum((v.get("eligible") or 0) for v in s["kinds"].values()) > 0  # noqa: E731

    def bracketed(a: float, b: float) -> bool:
        before = [s for s in S if s["t"] <= a]
        after = [s for s in S if s["t"] >= b]
        return bool(before and after and elig(before[-1]) and elig(after[0]))

    idle_e = (sum(max(0.0, b - a) for a, b in gaps if bracketed(a, b)) / span) if span else None
    # الإرسالاتُ والمعدلات
    sends = rider_sends(raw, lo, hi)
    in_run = [t for t in sends if contains(R, t)]
    busy = union_len([(max(a, lo), min(b, hi)) for a, b in R])
    # G1 وphoneproof (قياسٌ مباشرٌ من مولّدِ الحمل) — «المكتملةُ» = أحداثُ scenario.end (تعريفُ مقارنةِ AA المسجّلة)
    outcomes = completed = pp_to = 0
    for j in jl(raw / "miniapp-load-events.jsonl.gz"):
        ev = j.get("event")
        if ev == "scenario.outcome":
            outcomes += 1
        elif ev == "scenario.end":
            completed += 1
        elif ev == "driver.onboarding_failed":
            if (j.get("steps") or {}).get("phoneProofJob") == "timeout":
                pp_to += 1
    # P7 الرسمي (gates.txt) + الثانوي من العينات
    p7 = None
    gt = raw / "gates.txt"
    if gt.exists():
        m = re.search(r"P7=(\d+)s", gt.read_text())
        if m:
            p7 = int(m.group(1))
    p7_load = None
    for s in S:
        k = (s.get("kinds") or {}).get("rider_trip_notice") or {}
        v = k.get("oldest_pending_s")
        if v is not None and (p7_load is None or v > p7_load):
            p7_load = v
    # الميزانيةُ المسجَّلةُ للبوّابةِ الحيّةِ (فحصُ التلاعب)
    budget = None
    bp = raw / "gateway-drain-budget.txt"
    if bp.exists():
        t = bp.read_text().strip()
        m = re.search(r"=(\d+)$", t)
        if m:
            budget = int(m.group(1))
    med = (durs[(len(durs) - 1) // 2] + durs[len(durs) // 2]) / 2 if durs else None
    # gap_p95 (v2 §4): صمّامُ فواتِ النبضةِ — وسيطُ حقيقيٌّ للفجواتِ داخلَ النافذةِ (بالملي ثانية)
    win_gaps = [max(0.0, b - a) for a, b in gaps if a >= lo and b <= hi]
    gap_p95 = None
    if win_gaps:
        s = sorted(win_gaps)
        gap_p95 = round(s[min(len(s) - 1, int(0.95 * (len(s) - 1) + 0.5))], 0)
    # G1 الرسميُّ (v2 §3): من wave-report.json (تحققُ قاعدةٍ) — هذا هوَ الذي يقرأُهُ القرارُ؛
    # مقياسُ scenario.end يبقى وصفيًّا (g1_outcomes/g1_completed) كما في تعريفِ مقارنةِ AA.
    g1v_off = g1o_off = None
    wr = raw / "wave-report.json"
    if wr.exists():
        try:
            for g in json.loads(wr.read_text()).get("gates", []):
                if g.get("id") == "G1":
                    m2 = re.search(r"\((\d+)/(\d+)\)", str(g.get("value", "")))
                    if m2:
                        g1v_off, g1o_off = int(m2.group(1)), int(m2.group(2))
                    break
        except Exception:
            pass
    return {
        "rider_sends": len(sends), "rider_rate_overall": round(len(sends) / (WAVE_SEC / 1000), 2),
        "rider_rate_in_runs": round(len(in_run) / (busy / 1000), 2) if busy else None,
        "busy_s": round(busy / 1000, 1), "run_duration_p50_s": round(med / 1000, 2) if med else None,
        "run_count": len(durs), "idle_with_eligible": round(idle_e, 3) if idle_e is not None else None,
        "g1_outcomes": outcomes, "g1_completed": completed,
        "g1_fail_share": round(1 - completed / outcomes, 4) if outcomes else None,
        "g1_official_verified": g1v_off, "g1_official_outcomes": g1o_off,
        "g1_official_fail_share": round(1 - g1v_off / g1o_off, 4) if g1v_off and g1o_off else None,
        "gap_ms_p95": gap_p95,
        "phoneproof_timeouts": pp_to, "p7_s": p7, "p7_during_load_s": p7_load,
        "budget_recorded": budget,
    }


def main() -> int:
    out = Path(sys.argv[1]).resolve()
    sl = os.environ.get("B26_SESSION_LIMIT", "6000")
    waves: dict[str, dict] = {}
    raw_root = out / "raw"
    for p in sorted(raw_root.iterdir()) if raw_root.is_dir() else []:
        m = RUN_RE.match(p.name)
        if m and is_valid_wave(p, sl):
            w = load_wave(p)
            if w:
                waves[m.group(1)] = w
    # إزالةُ الاسمِ الأصليِّ إن وُجدَ بديلُهُ المعادُ (الأصلُ لا يدخلُ المقارنة)
    for name in list(waves):
        if not name.endswith("-r") and f"{name}-r" in waves:
            del waves[name]
    arms = {"ON": [n for n in waves if "-on" in n], "OFF": [n for n in waves if "-off" in n]}

    def med(xs):
        xs = sorted(x for x in xs if x is not None)
        if not xs:
            return None
        n = len(xs)
        return xs[n // 2] if n % 2 else (xs[(n - 1) // 2] + xs[n // 2]) / 2

    arm = {}
    for a, names in arms.items():
        ws = [waves[n] for n in names]
        if not ws:
            arm[a] = {"valid_waves": 0}
            continue
        g1o = sum(w["g1_official_outcomes"] or 0 for w in ws)
        g1v = sum(w["g1_official_verified"] or 0 for w in ws)
        rates = sorted(w["rider_rate_overall"] for w in ws)
        p7s = sorted(w["p7_s"] for w in ws if w["p7_s"] is not None)
        gaps95 = sorted(w["gap_ms_p95"] for w in ws if w["gap_ms_p95"] is not None)
        arm[a] = {
            "valid_waves": len(ws), "waves": names,
            "rate_median": med(rates), "rate_list": rates,
            "p7_median_s": med(p7s) if p7s else None,
            "g1_verified": g1v, "g1_outcomes": g1o,
            "g1_fail_share": round(1 - g1v / g1o, 4) if g1o else None,
            "gap_p95_median_ms": med(gaps95) if gaps95 else None,
            "pp_timeouts_list": [w["phoneproof_timeouts"] for w in ws],
            "idle_list": [w["idle_with_eligible"] for w in ws],
            "run_p50_list": [w["run_duration_p50_s"] for w in ws],
            "budget_recorded_list": [w["budget_recorded"] for w in ws],
            "per_wave": {n: waves[n] for n in names},
        }
    # فحصُ التلاعبِ (v2 §4 — شرطٌ سابقٌ لأيِّ استنتاج؛ العتباتُ كما سُجّلتْ قبلَ بياناتِ v2)
    manip = None
    if arm.get("ON", {}).get("valid_waves") and arm.get("OFF", {}).get("valid_waves"):
        on_p50, off_p50 = med(arm["ON"]["run_p50_list"]), med(arm["OFF"]["run_p50_list"])
        on_idle = max(x for x in arm["ON"]["idle_list"] if x is not None) if any(
            x is not None for x in arm["ON"]["idle_list"]) else None
        off_idle = min(x for x in arm["OFF"]["idle_list"] if x is not None) if any(
            x is not None for x in arm["OFF"]["idle_list"]) else None
        on_gap95 = med(arm["ON"]["per_wave"][n]["gap_ms_p95"] for n in arm["ON"]["waves"]
                        if arm["ON"]["per_wave"][n]["gap_ms_p95"] is not None)
        budgets_ok = (all(b == 9400 for b in arm["ON"]["budget_recorded_list"]) and
                      all(b == 8000 for b in arm["OFF"]["budget_recorded_list"]))
        manip = {
            "budgets_recorded_ok": budgets_ok,
            "on_run_p50_s": on_p50, "off_run_p50_s": off_p50,
            "on_idle_max": on_idle, "off_idle_min": off_idle,
            "on_gap_p95_median_ms": on_gap95,
            "ok": bool(budgets_ok and on_p50 and off_p50 and 9.2 <= on_p50 <= 9.7
                       and 7.0 <= off_p50 <= 8.5 and on_idle is not None and on_idle <= 0.08
                       and on_gap95 is not None and on_gap95 < 2000
                       and off_idle is not None and off_idle >= 0.10),
        }
    # قرارُ التدخلِ (v2 §5 — جدولُ v1 حرفيًا) — محسومٌ فقط عندَ اكتمالِ الذراعينِ ونجاحِ التلاعب؛
    # v2 §2: ذراعٌ بموجةٍ صالحةٍ واحدةٍ ⇒ UNRESOLVED_DATA (لا يُقرأُ الجدولُ أصلًا)
    decision, why = "INCOMPLETE", "مقارنةٌ غيرُ مكتملةٍ (v2 §2: بلا موجةٍ صالحةٍ لأحدِ الذراعينِ بعدَ الإعادة)"
    adjacent = None
    if (arm.get("ON", {}).get("valid_waves", 0) >= 1 and arm.get("OFF", {}).get("valid_waves", 0) >= 1
            and (arm.get("ON", {}).get("valid_waves", 0) < 2 or arm.get("OFF", {}).get("valid_waves", 0) < 2)):
        decision = "UNRESOLVED_DATA"
        why = "ذراعٌ بموجةٍ صالحةٍ واحدةٍ (v2 §2: الحدُّ الأدنى موجمتان لكلَّ ذراع) — تُحفظُ الموجاتُ وتُعرضُ الحصصُ ولا يُقرأُ جدولُ القرار"
    elif arm.get("ON", {}).get("valid_waves", 0) >= 2 and arm.get("OFF", {}).get("valid_waves", 0) >= 2:
        if manip is None or not manip["ok"]:
            decision = "INTERVENTION_FAILED"
            why = "فشلُ التلاعبِ (الميزانيةُ لم تصلْ أو الفجواتُ لم تنخفضْ ضمنَ الحدود) — لا استنتاجَ عن الفرضية (v2 §4)"
        else:
            on, off = arm["ON"], arm["OFF"]
            d_rate = on["rate_median"] / off["rate_median"] - 1
            p7o = [w["p7_s"] for w in on["per_wave"].values() if w["p7_s"] is not None]
            p7f = [w["p7_s"] for w in off["per_wave"].values() if w["p7_s"] is not None]
            d_p7 = (med(p7o) - med(p7f)) if p7o and p7f else None
            d_g1 = round((on["g1_fail_share"] - off["g1_fail_share"]) * 100, 2)
            # اتساقُ الزوجينِ المتجاورينِ في اتجاهِ المعدل
            def wv(n):
                return waves.get(n, {}).get("rider_rate_overall")
            pairs = []
            for on_n, off_n in (("w2-on", "w1-off"), ("w3-on", "w4-off")):
                for suf in ("", "-r"):
                    if wv(on_n + suf) is not None and wv(off_n + suf) is not None:
                        pairs.append(wv(on_n + suf) - wv(off_n + suf))
                        break
            adjacent = {"rate_pair_diffs": pairs,
                        "consistent": bool(pairs) and all(x > 0 for x in pairs) or bool(pairs) and all(x < 0 for x in pairs)}
            g1_improved = d_g1 <= -1
            p7_improved = d_p7 is not None and d_p7 <= -20
            if d_rate >= 0.10 and p7_improved and g1_improved and adjacent["consistent"]:
                decision = "SUPPORTED_IDLE_CAPACITY"
                why = (f"D_rate={d_rate:+.1%} ∧ ΔP7={d_p7}s ∧ ΔG1fail={d_g1}pp باتساقِ الزوجينِ — "
                       "مساهمةٌ سببيةٌ مدعومةٌ لإعدادِ التصريف (لا ترفضُ H2 ولا تثبتُ أنها السببُ الوحيد)")
            elif d_rate >= 0.10 and (not p7_improved or not g1_improved):
                decision = "CAPACITY_LOSS_ONLY"
                why = (f"D_rate={d_rate:+.1%} بلا تحسُّنٍ متسقٍ (ΔP7={d_p7}s، ΔG1fail={d_g1}pp) — "
                       "الخمولُ خسارةُ سعةٍ فعلية؛ تفسيرُ فشلِ G1 غيرُ محسوم (H2/السقفُ مرشحان)")
            elif d_rate < 0.05:
                decision = "NO_EFFECT"
                why = (f"D_rate={d_rate:+.1%} — لا أثرًا ماديًّا مكتشفًا لهذا التدخل؛ "
                       "لا إثباتَ تلقائيًّا لH2 (قد يبقى قيدٌ آخر)")
            elif d_rate >= 0.10 and d_g1 >= 1:
                decision = "REGRESSION"
                why = f"D_rate={d_rate:+.1%} معَ تدهورِ G1 (ΔG1fail={d_g1}pp) — انحدار"
            else:
                decision = "UNRESOLVED"
                why = (f"D_rate={d_rate:+.1%} (بينَ +5% و+10%) أو تحسُّنٌ جزئيٌّ غيرُ متسقٍ "
                       f"(ΔP7={d_p7}s، ΔG1fail={d_g1}pp، adjacent={adjacent})")
    print(json.dumps({
        "protocol": "PROTOCOL-b33m-idle-v2.md", "decision": decision, "why": why,
        "manipulation": manip, "adjacent_pairs": adjacent, "arms": arm,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
