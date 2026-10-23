#!/usr/bin/env python3
# مقارنةُ تجربةِ b33mtick: أثرُ إصلاحاتِ JOB-TICK المدموجة (ref=e47ca99d مقابلَ cand=2aa557aa)
# عندَ 750 مستخدمًا بالميزانيةِ 8000 في الذراعين — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا
# (PROTOCOL-b33mtick.md §4–§6). لا يُعدَّلُ هذا الملفُ بعدَ رؤيةِ النتائج؛ الخللُ يُوثَّقُ في التقرير.
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

# الذراعان المسجَّلتان مسبقًا (بروتوكول §1) — كلُّ موجةٍ مربوطةٌ بالخطةِ الثابتةِ (الخريطةُ أدناه)
# ويُتحققُ منَ النشرِ الفعليِّ (b24-env.json + gateway-proc.json) لكلِّ موجة.
R_FULL = "e47ca99ddd7b4b74b73323fbc17963fede309cec"
C_FULL = "2aa557aa2813b77bc12d37b257de22ae733378af"
# خطةُ ABBA BAAB الثابتةُ (§1): رقمُ الموجةِ ⇒ جانبُها. الاسمُ المخالفُ للخطةِ ⇒ فشلُ نشر.
PLAN = {1: "ref", 2: "cand", 3: "cand", 4: "ref", 5: "cand", 6: "ref", 7: "ref", 8: "cand"}
RUN_RE = re.compile(r"^b33mtick-m-(a(\d+)-(ref|cand)(-r)?)-750$")
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
    """نافذةُ الحملِ الموحّدة (PROTOCOL-b33mtick §4): injection_start = t(الأول) − sinceStartMs(الأول)."""
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
    """مقاييسُ موجةٍ واحدةٍ من خامِّها (§4). المقاييسُ الأساسيةُ (المعدلُ، G1، P7، الميزانية)
    تُستخرجُ استقلالًا عن أشواطِ التصريف: الصفرُ قيمةٌ صحيحةٌ (أداءٌ صفريٌّ نتيجةٌ لا فقدُ قياس)؛
    وفقدُ الملفِ نفسِه يُميَّزُ عن ملفٍّ مكتملٍ بلا أحداثٍ (missing_files). مقياسا الخمولِ وفجواتِ
    النبضةِ وأشواطُ التصريفِ تتطلّبُ أشواطًا؛ غيابُها يُفقدُها وحدَها لا الموجةَ كلَّها."""
    try:
        return _load_wave_impl(raw)
    except Exception:
        # فقدُ أيِّ ملفِّ استخراجٍ أساسيٍّ ⇒ موجةٌ صالحةٌ بيئيًا بلا مقاييسَ (تُسجَّلُ بسبَبِها)
        return None


def _load_wave_impl(raw: Path) -> dict | None:
    d = v1.load(raw)
    # لا بوابةَ على فراغِ الإرسالات: ملفُ egress فارغٌ = صفرُ إرسالاتٍ (قيمةٌ)؛ فقدُ الملفِّ
    # نفسِهِ يُرمي استثناءً فتُسجَّلُ موجةً بلا مقاييس. المقاييسُ الأساسيةُ لا تتوقفُ
    # على وجودِ أحداثٍ في الخامِّ.
    missing = [n for n in ("load-events.jsonl.gz", "b33m-mock-egress.jsonl.gz",
                           "miniapp-load-events.jsonl.gz") if not (raw / n).exists()]
    lo, hi = load_window(raw)
    evs = d["events"]
    runs = [(r["start"], r["end"]) for r in v1.drain_runs(evs)
            if r["start"] < hi and r["end"] > lo]
    has_runs = bool(runs)
    durs = sorted(r["dur"] for r in v1.drain_runs(evs) if lo <= r["start"] < hi) if has_runs else []
    # idle_with_eligible — قاعدةُ v2 حرفيًا (الفجواتُ المقوسةُ بعيناتٍ eligible>0 من الجانبين) داخلَ النافذة
    S = sorted((s for s in d["samples"] if "kinds" in s and lo <= s["t"] <= hi), key=lambda s: s["t"])
    R = sorted(runs)
    gaps = [(R[i][1], R[i + 1][0]) for i in range(len(R) - 1)] if has_runs else []
    span = (R[-1][1] - R[0][0]) if has_runs else None
    elig = lambda s: sum((v.get("eligible") or 0) for v in s["kinds"].values()) > 0  # noqa: E731

    def bracketed(a: float, b: float) -> bool:
        before = [s for s in S if s["t"] <= a]
        after = [s for s in S if s["t"] >= b]
        return bool(before and after and elig(before[-1]) and elig(after[0]))

    idle_e = (sum(max(0.0, b - a) for a, b in gaps if bracketed(a, b)) / span) if span else None
    # الإرسالاتُ والمعدلات — صفرُ الإرسالاتِ قيمةٌ لا فقد
    sends = rider_sends(raw, lo, hi)
    in_run = [t for t in sends if contains(R, t)] if has_runs else []
    busy = union_len([(max(a, lo), min(b, hi)) for a, b in R]) if has_runs else 0.0
    # G1 وphoneproof (قياسٌ مباشرٌ من مولّدِ الحمل) — «المكتملةُ» = أحداثُ scenario.end
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
    # الميزانيةُ المسجَّلةُ للبوّابةِ الحيّةِ (تحققُ النشر §5: 8000 في الجميع)
    budget = None
    bp = raw / "gateway-drain-budget.txt"
    if bp.exists():
        t = bp.read_text().strip()
        m = re.search(r"=(\d+)$", t)
        if m:
            budget = int(m.group(1))
    med = (durs[(len(durs) - 1) // 2] + durs[len(durs) // 2]) / 2 if durs else None
    # gap_p95: صمّامُ فواتِ النبضةِ — وسيطُ حقيقيٌّ للفجواتِ داخلَ النافذةِ (بالملي ثانية)
    win_gaps = [max(0.0, b - a) for a, b in gaps if a >= lo and b <= hi]
    gap_p95 = None
    if win_gaps:
        s = sorted(win_gaps)
        gap_p95 = round(s[min(len(s) - 1, int(0.95 * (len(s) - 1) + 0.5))], 0)
    # G1 الرسميُّ: من wave-report.json (تحققُ قاعدةٍ) — هذا هوَ الذي يقرأُهُ القرارُ (§4).
    # الصفرُ في verified قيمةٌ صحيحةٌ (إخفاقٌ كامل) لا فقدُ قياس؛ وغيابُ التقريرِ فقدٌ يُعلَن.
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
        "rider_rate_in_runs": (round(len(in_run) / (busy / 1000), 2) if (has_runs and busy) else None),
        "busy_s": round(busy / 1000, 1) if has_runs else None,
        "run_duration_p50_s": round(med / 1000, 2) if med else None,
        "run_count": len(durs), "idle_with_eligible": round(idle_e, 3) if idle_e is not None else None,
        "g1_outcomes": outcomes, "g1_completed": completed,
        "g1_fail_share": round(1 - completed / outcomes, 4) if outcomes else None,
        "g1_official_verified": g1v_off, "g1_official_outcomes": g1o_off,
        "g1_official_fail_share": round(1 - g1v_off / g1o_off, 4) if (g1o_off and g1v_off is not None) else None,
        "g1_official_missing": g1v_off is None,
        "gap_ms_p95": gap_p95,
        "phoneproof_timeouts": pp_to, "p7_s": p7, "p7_during_load_s": p7_load,
        "budget_recorded": budget,
        "missing_files": missing, "has_drain_runs": has_runs,
    }


def load_provenance(raw: Path) -> dict | None:
    """سجلُّ النشرِ لكلِّ موجةٍ: b24-env.json (رؤوسُ worktrees) + gateway-proc.json
    (هويةُ البوّابةِ الحيّةِ: pid وcwd) — تحققُ §5."""
    p = raw / "b24-env.json"
    if not p.exists():
        return None
    try:
        e = json.loads(p.read_text())
    except Exception:
        return None
    gp = raw / "gateway-proc.json"
    if gp.exists():
        try:
            e["gateway_proc"] = json.loads(gp.read_text())
        except Exception:
            e["gateway_proc"] = None
    else:
        e["gateway_proc"] = None
    return e


def main() -> int:
    out = Path(sys.argv[1]).resolve()
    sl = os.environ.get("B26_SESSION_LIMIT", "6000")
    waves: dict[str, dict] = {}
    prov: dict[str, dict | None] = {}
    valid_no_metrics: list[dict] = []
    raw_root = out / "raw"
    for p in sorted(raw_root.iterdir()) if raw_root.is_dir() else []:
        m = RUN_RE.match(p.name)
        if m and is_valid_wave(p, sl):
            w = load_wave(p)
            if w:
                waves[m.group(1)] = w
                prov[m.group(1)] = load_provenance(p)
            else:
                # §2: صالحةٌ بيئيًا بلا مقاييسَ مستخرجة (فقدُ ملفاتِ الاستخراجِ الأساسية) —
                # تُسجَّلُ بسبَبِها ولا تُحذفُ بصمتٍ ولا تُعوَّضُ ببدائلَ.
                valid_no_metrics.append({"wave": m.group(1),
                                         "reason": "فقدُ ملفاتِ الاستخراجِ (load/mock-events) أو فشلُ تحليلِ الخامّ"})
    # إزالةُ الاسمِ الأصليِّ إن وُجدَ بديلُهُ المعادُ (الأصلُ لا يدخلُ المقارنة)
    for name in list(waves):
        if not name.endswith("-r") and f"{name}-r" in waves:
            del waves[name]
            del prov[name]
    valid_no_metrics = [v for v in valid_no_metrics
                        if not (not v["wave"].endswith("-r") and f"{v['wave']}-r" in waves)]

    def med(xs):
        xs = sorted(x for x in xs if x is not None)
        if not xs:
            return None
        n = len(xs)
        return xs[n // 2] if n % 2 else (xs[(n - 1) // 2] + xs[n // 2]) / 2

    # تحققُ النشرِ (§5) — الاسمُ مربوطٌ بخريطةِ الخطةِ الثابتةِ (a2 ⇒ cand) ويُطابَقُ الجانبُ
    # وSHA رأسِ worktree وهويةُ البوّابةِ الحيّةِ (cwd) والميزانيةُ وgatewayRequest.
    provenance = {"waves": {}, "ok": True}
    for name, e in sorted(prov.items()):
        num = int(re.match(r"a(\d+)-", name).group(1))
        side_plan = PLAN.get(num)
        side_in_name = "ref" if "-ref" in name else "cand"
        side = e.get("side") if e else None
        gp = (e or {}).get("gateway_proc") or {}
        cwd = gp.get("cwd") or ""
        cmd_ok = gp.get("cmd_ok") is True
        cwd_ok = (side_plan == "ref" and "wt-ref" in cwd) or (side_plan == "cand" and "wt-acc" in cwd)
        sha_ok = (
            (side == "ref" and side_in_name == "ref" and side_plan == "ref" and e.get("code_ref") == R_FULL)
            or (side == "cand" and side_in_name == "cand" and side_plan == "cand" and e.get("code_acc") == C_FULL)
        ) if e else False
        w_ok = bool(
            sha_ok and cwd_ok and cmd_ok
            and waves[name].get("budget_recorded") == 8000
            and e.get("gateway_request_ref") == 5 and e.get("gateway_request_acc") == 5)
        provenance["waves"][name] = {
            "side_in_plan": side_plan, "side_in_name": side_in_name, "side_recorded": side,
            "code_ref": (e or {}).get("code_ref"), "code_acc": (e or {}).get("code_acc"),
            "gateway_cwd": cwd or None, "gateway_pid": gp.get("pid"),
            "budget_recorded": waves[name].get("budget_recorded"), "ok": w_ok,
        }
        if not w_ok:
            provenance["ok"] = False

    # الأزواجُ المتجاورةُ غيرُ المتداخلةِ (§3): (a1,a2) (a3,a4) (a5,a6) (a7,a8) — وحدةُ الاستدلال.
    def wnum(n):
        return int(re.match(r"a(\d+)-", n).group(1))
    pairs_plan = [(1, 2), (3, 4), (5, 6), (7, 8)]
    pair_data = []
    for lo_n, hi_n in pairs_plan:
        wl = [n for n in waves if wnum(n) == lo_n]
        wh = [n for n in waves if wnum(n) == hi_n]
        entry = {"pair": (lo_n, hi_n), "status": "INCOMPLETE",
                 "ref": None, "cand": None, "pair_rel_diff": None, "notes": []}
        if wl and wh:
            nl, nh = wl[0], wh[0]
            rl = waves[nl]["rider_rate_overall"] if "-ref" in nl else waves[nh]["rider_rate_overall"]
            rc_ = waves[nh]["rider_rate_overall"] if "-cand" in nh else waves[nl]["rider_rate_overall"]
            # الصفرُ قيمةٌ: معدلُ ref صفرٌ يجعلُ الفرقَ النسبيَّ غيرَ معرَّفٍ (يُعرضُ المطلقُ فقط)
            rel = round((rc_ - rl) / rl, 4) if rl else None
            entry.update({"ref": rl, "cand": rc_, "status": "COMPLETE",
                          "pair_rel_diff": rel, "pair_abs_diff": round(rc_ - rl, 2)})
            if rel is None:
                entry["notes"].append("معدلُ خطِّ الأساسِ صفرٌ — الفرقُ النسبيُّ غيرُ معرَّفٍ (§6)")
            # G1/P7 الرسميةُ داخلَ الزوجِ (الجنسُ نفسُهُ حاكمُ الاستدلال) + فقدها يُعلَن
            for tag, n in (("ref", nl if "-ref" in nl else nh), ("cand", nh if "-cand" in nh else nl)):
                entry[f"g1_{tag}"] = waves[n]["g1_official_fail_share"]
                entry[f"g1_{tag}_v"] = waves[n]["g1_official_verified"]
                entry[f"g1_{tag}_o"] = waves[n]["g1_official_outcomes"]
                entry[f"p7_{tag}"] = waves[n]["p7_s"]
            if entry["g1_ref"] is None or entry["g1_cand"] is None:
                entry["notes"].append("G1 الرسميةُ مفقودةٌ لأحدِ طرفَي الزوج — حكمُ G1 غيرُ محسوم")
            if entry["p7_ref"] is None or entry["p7_cand"] is None:
                entry["notes"].append("P7 مفقودةٌ لأحدِ طرفَي الزوج — حكمُ P7 غيرُ محسوم")
        pair_data.append(entry)
    complete = [p for p in pair_data if p["status"] == "COMPLETE"]
    rel_diffs = [p["pair_rel_diff"] for p in complete if p["pair_rel_diff"] is not None]
    d_rate_pair = med(rel_diffs) if rel_diffs else None

    # ملخصُ الذراعين (وصفيٌّ لكلِّ الموجات؛ وحدةُ الاستدلالِ الأساسيةُ الزوجُ — §3)
    arm = {}
    for a, key in (("CAND", "-cand"), ("REF", "-ref")):
        names = sorted((n for n in waves if key in n), key=wnum)
        ws = [waves[n] for n in names]
        if not ws:
            arm[a] = {"valid_waves": 0}
            continue
        g1o = sum((w["g1_official_outcomes"] or 0) for w in ws)
        g1v = sum((w["g1_official_verified"] or 0) for w in ws)
        rates = sorted(w["rider_rate_overall"] for w in ws)
        p7s = sorted(w["p7_s"] for w in ws if w["p7_s"] is not None)
        gaps95 = sorted(w["gap_ms_p95"] for w in ws if w["gap_ms_p95"] is not None)
        idles = sorted(w["idle_with_eligible"] for w in ws if w["idle_with_eligible"] is not None)
        arm[a] = {
            "valid_waves": len(ws), "waves": names,
            "rate_median": med(rates), "rate_list": rates,
            "p7_median_s": med(p7s) if p7s else None,
            "p7_missing": sum(1 for w in ws if w["p7_s"] is None),
            "g1_verified": g1v, "g1_outcomes": g1o,
            "g1_fail_share": round(1 - g1v / g1o, 4) if g1o else None,
            "g1_official_missing": sum(1 for w in ws if w["g1_official_missing"]),
            "gap_p95_median_ms": med(gaps95) if gaps95 else None,
            "pp_timeouts_list": [w["phoneproof_timeouts"] for w in ws],
            "idle_list": idles,
            "run_p50_list": [w["run_duration_p50_s"] for w in ws],
            "budget_recorded_list": [w["budget_recorded"] for w in ws],
            "per_wave": {n: waves[n] for n in names},
        }

    # قرارُ التجربةِ (§6 — الصفوفُ بالترتيب، أولُ صفٍّ يتحققُ يسود)
    decision, why = "INCOMPLETE", "مقارنةٌ غيرُ مكتملةٍ (§2: بلا موجةٍ صالحةٍ لأحدِ الذراعينِ بعدَ الإعادة)"
    adjacent = None
    mechanism = None
    if provenance["ok"] is False:
        decision = "CODE_PROVENANCE_FAIL"
        why = ("فشلُ تحققِ النشرِ (§5): الجانبُ أو SHA الذراع أو هويةُ البوّابةِ الحيّةِ (cwd) أو "
               "الميزانيةُ المسجلةُ أو gatewayRequest — لا استنتاجَ عن الفرضية")
    elif len(complete) < 2:
        decision = "UNRESOLVED_DATA"
        why = (f"أقلُّ من زوجينِ مكتملينِ ({len(complete)} مكتمل) — §3: تُحفظُ الموجاتُ وتُعرضُ الحصصُ "
               f"ولا يُقرأُ جدولُ القرار؛ موجاتٌ صالحةٌ بلا مقاييسَ: "
               f"{[v['wave'] for v in valid_no_metrics] or 'لا شيء'}")
    elif any(p["pair_rel_diff"] is None for p in complete):
        decision = "UNRESOLVED"
        why = ("معدلُ خطِّ أساسٍ صفريٌّ في زوجٍ مكتملٍ — الفرقُ النسبيُّ غيرُ معرَّفٍ (§3/§6): "
               "تُعرضُ الفروقُ المطلقةُ ولا يُقرأُ حكمٌ اتجاهيٌّ على المعدل")
    else:
        d_rate = d_rate_pair
        # G1/P7 منَ الأزواجِ المكتملةِ وحدَها (نفسُ الجنسِ الحاكمِ للاستدلال)؛ الفقدُ يُعلَن.
        # G1 مقدِّرُ التجميعِ المسجَّلُ في §4 (Σverified/Σoutcomes) على موجاتِ الأزواجِ المكتملةِ —
        # والاكتمالُ شرطٌ في طرفَي كلِّ زوجٍ مكتملٍ وإلا كانَ فرقُ المقياسِ غيرَ محسومٍ (§6).

        def g1_agg(tag):
            if any(p.get(f"g1_{tag}") is None or not p.get(f"g1_{tag}_o") for p in complete):
                return None
            v = sum(p.get(f"g1_{tag}_v") or 0 for p in complete)
            o = sum(p[f"g1_{tag}_o"] for p in complete)
            return (v, o) if o else None

        def p7_med(tag):
            vals = [p.get(f"p7_{tag}") for p in complete]
            if any(v is None for v in vals):
                return None
            return med(vals)

        g1c, g1r = g1_agg("cand"), g1_agg("ref")
        d_g1 = round(((1 - g1c[0] / g1c[1]) - (1 - g1r[0] / g1r[1])) * 100, 2) if (g1c and g1r) else None
        p7c_, p7r_ = p7_med("cand"), p7_med("ref")
        d_p7 = (p7c_ - p7r_) if (p7c_ is not None and p7r_ is not None) else None
        consistent = bool(rel_diffs) and (all(x > 0 for x in rel_diffs) or all(x < 0 for x in rel_diffs))
        notes = [n for p in complete for n in p["notes"]]
        adjacent = {"pairs": pair_data, "consistent": consistent, "notes": notes}
        mechanism = {
            "idle_cand_median": med([waves[n]["idle_with_eligible"] for n in arm.get("CAND", {}).get("waves", [])
                                      if waves[n].get("idle_with_eligible") is not None]) or None,
            "idle_ref_median": med([waves[n]["idle_with_eligible"] for n in arm.get("REF", {}).get("waves", [])
                                     if waves[n].get("idle_with_eligible") is not None]) or None,
            "gap95_cand_median_ms": arm.get("CAND", {}).get("gap_p95_median_ms"),
            "gap95_ref_median_ms": arm.get("REF", {}).get("gap_p95_median_ms"),
        }
        g1_improved = d_g1 is not None and d_g1 <= -1
        p7_improved = d_p7 is not None and d_p7 <= -20
        g1_regressed = d_g1 is not None and d_g1 >= 1
        rate_regressed = d_rate <= -0.10
        p7_regressed = d_p7 is not None and d_p7 >= 20
        if (d_rate >= 0.10 and p7_improved and g1_improved and consistent):
            decision = "SUPPORTED_FIX_CAPACITY"
            why = (f"D_rate={d_rate:+.1%} (وسيطُ الأزواج) ∧ ΔP7={d_p7}s ∧ ΔG1fail={d_g1}pp باتساقِ الأزواجِ — "
                   "الإصلاحاتُ المدموجةُ ترفعُ السعةَ وتحسِّنُ بواباتِ القبول (لا تعني اجتيازَ LOAD-01)")
        elif g1_regressed or rate_regressed or p7_regressed:
            decision = "REGRESSION"
            why = (f"تدهورٌ مادّيّ (ΔG1fail={d_g1}pp، D_rate={d_rate:+.1%}، ΔP7={d_p7}s) — "
                   "يسودُ قبلَ قراءةِ مكسبِ المعدلِ لأنّه عنقُ القبول")
        elif d_g1 is None or d_p7 is None:
            decision = "UNRESOLVED"
            why = ("فقدُ G1/P7 لأحدِ طرفَي زوجٍ مكتملٍ ⇒ حكمُ ذاك المقياسِ غيرُ محسومٍ (§6 الصفُّ 5): "
                   f"مكسبُ المعدلِ (D_rate={d_rate:+.1%} باتساقِ {consistent}) يُعرضُ وصفًا منفصلًا "
                   "ولا يُقرأُ منه حكمٌ على بواباتِ القبولِ ولا على سببِ فشلِ G1")
        elif not consistent:
            decision = "UNRESOLVED"
            why = ("أزواجٌ مكتملةٌ باتجاهاتٍ متعارضةٍ (اتساقٌ شرطٌ لأيِّ حكمٍ اتجاهيٍّ — §6) "
                   f"D_rate={d_rate:+.1%}، ΔP7={d_p7}s، ΔG1fail={d_g1}pp")
        elif d_rate >= 0.10 and (not p7_improved or not g1_improved):
            decision = "RATE_GAIN_ONLY"
            why = (f"D_rate={d_rate:+.1%} بلا تحسُّنٍ متسقٍ (ΔP7={d_p7}s، ΔG1fail={d_g1}pp) — "
                   "الإصلاحاتُ تستعيدُ معدلًا لكنّ سببَ فشلِ G1 المتبقيَّ ليسَ التصريفَ وحدَه؛ "
                   "تفسيرُ H2/السقفِ يبقى مفتوحًا")
        elif d_rate < 0.05:
            decision = "NO_DETECTED_GAIN"
            why = (f"D_rate={d_rate:+.1%} — لم يُكتشَفْ مكسبٌ مادّيّ بهذا التصميمِ وحجمِه (ليسَ إثباتَ انعدامِ الأثر)؛ "
                   "انظر قراءةَ الآليةِ وحدودَها في التقرير")
        else:
            decision = "UNRESOLVED"
            why = (f"D_rate={d_rate:+.1%} (بينَ +5% و+10%) أو تحسُّنٌ جزئيٌّ غيرُ متسقٍ "
                   f"(ΔP7={d_p7}s، ΔG1fail={d_g1}pp)")
    print(json.dumps({
        "protocol": "PROTOCOL-b33mtick.md", "decision": decision, "why": why,
        "provenance": provenance, "pairs": pair_data, "adjacent_consistency": adjacent,
        "mechanism_readout": mechanism,
        "valid_no_metrics_waves": valid_no_metrics,
        "arms": arm,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
