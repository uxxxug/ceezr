#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليلُ دورةِ LOAD-01-GAP-PROBE-RUN3 (سيمافورُ fetch المقيسُ في المولّد) — تشخيصيٌّ لا حكمَ سعة.

البروتوكول: docs/evidence/capacity/LOAD01-GAP-PROBE-RUN3-20261027/PROTOCOL-load01-gap-probe-run3.md
(مسجَّلٌ قبلَ أوّلِ موجة). يرثُ gap2-analyze.py كما هو (ومنه gap-analyze.py: الربطُ الفرديُّ، صلاحيةُ
الموجةِ المركّبة، المتوسطُ الشرطيُّ بنوافذِ 5ث، δ = 15ms، ≥ 2000 عيّنة، بصمةُ العتاد) ويضيفُ فقط:

  valid3   <wave> <cap|none> <out.json>       valid2 + حقولُ البوابةِ كاملةٌ + السعةُ المفعولةُ = المسجّلة
  aa3      <AA1> <AA2> <out.json>             بوابةُ A/A الموروثةُ (7 حدود) ∧ valid3(256) للموجتين ∧ عتادٌ متطابق
  q        <AA1> <AA2> <out.json>             السؤالُ الوحيد (§5): هل الزمنُ المفقودُ انتظارٌ في المولّدِ قبلَ الإرسال؟
  load     <S1> <N1> <N2> <S2> <out.json>     تكافؤُ الحمل: معدّلُ النداءِ والإرسالِ ±5% لكلِّ زوج (§4.5)
  describe <out.json> <wave>...               وصفيٌّ فقط — لا قاعدةَ قرارٍ ولا يُبنى عليه حكم

قاعدةُ الساعات كما في RUN2: كلُّ مدّةٍ داخلَ عمليّةٍ واحدة؛ queueWaitMs بساعةِ المولّدِ الرتيبة.
U_head (موروثٌ) = (ttfbMs − invokeMs) − (requestLeadMs + writeHeadMs)، و ttfbMs يشملُ الانتظارَ في البوابة؛
فالمتبقّي U_resid = U_head − queueWaitMs = ما بقيَ خارجَ القياسِ **بعدَ** إزالةِ الانتظارِ المقيسِ — فرقُ مدد.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("g2", os.path.join(HERE, "gap2-analyze.py"))
g2 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(g2)
ga = g2.ga

DELTA_MS = ga.DELTA_MS
WINDOW_MS = ga.WINDOW_MS
# السعةُ المسجّلةُ لذراعِ السيمافور = حدُّ Bun الافتراضيُّ نفسُه (لا رفعَ ولا خفض)
REGISTERED_CAP = 256
DEMAND_SPLIT = g2.BUN_FETCH_DEFAULT_MAX  # تقسيمُ RUN2 نفسُه: inflightAtInvoke > 256
CLIENT_NEW3 = ("queueWaitMs", "waitersAtInvoke", "activeAtSend", "demandAtInvoke")
MIN_SEM_ROWS_PER_WINDOW = 4
# قواعدُ §5 و§4.5 المسجّلةُ مسبقًا
Q_MIN_STRATUM_N = 200
Q_MIN_WAIT_SHARE = 0.80
LOAD_RATE_TOL = 0.05


def num(v):
    return ga.num(v)


def mean(v):
    v = [x for x in v if x is not None]
    return None if not v else sum(v) / len(v)


class Wave3(g2.Wave2):
    def __init__(self, wave_dir):
        super().__init__(wave_dir)
        le, _ = ga.read_jsonl_counting(os.path.join(wave_dir, "load-events.jsonl"))
        self.gen_sem = [r for r in le if r.get("event") == "gen_sem"]
        self.http_rows = [r for r in le if r.get("event") == "http_call"]
        for s in self.samples:
            c = self.calls.get(s["rid"], {})
            for f in CLIENT_NEW3:
                s[f] = num(c.get(f))
            s["fetchCap"] = c.get("fetchCap")
            s["U_resid"] = ga.diff(s["U_head"], s["queueWaitMs"])

    def injection_2xx(self):
        if self.t0 is None or self.drain0 is None:
            return []
        return [s for s in self.samples if s["start"] is not None and self.t0 <= s["start"] < self.drain0
                and isinstance(s.get("status"), int) and 200 <= s["status"] < 300]

    def sem_in_injection(self):
        if self.t0 is None or self.drain0 is None:
            return []
        return [r for r in self.gen_sem if num(r.get("at")) is not None and self.t0 <= num(r["at"]) < self.drain0]

    def validity3(self, expected_cap):
        base = self.validity2()
        reasons = list(base["reasons"])
        missing = {f: 0 for f in CLIENT_NEW3}
        ok2xx = 0
        for s in self.samples:
            st = s.get("status")
            if not (isinstance(st, int) and 200 <= st < 300):
                continue
            ok2xx += 1
            for f in CLIENT_NEW3:
                if s.get(f) is None:
                    missing[f] += 1
        bad = {f: n for f, n in missing.items() if n}
        if bad:
            reasons.append(f"حقولُ RUN3 ناقصةٌ في طلباتٍ 2xx مربوطة: {bad}")
        env = self.gen_env[0] if len(self.gen_env) == 1 else {}
        if env.get("fetchCap") != expected_cap:
            reasons.append(f"السعةُ المفعولةُ في gen_env = {env.get('fetchCap')!r} لا المسجّلةُ {expected_cap!r}")
        caps = {r.get("fetchCap") for r in self.http_rows if "fetchCap" in r}
        if caps != {expected_cap}:
            reasons.append(f"fetchCap في سطورِ http_call = {sorted(map(str, caps))} لا {{{expected_cap!r}}}")
        sem_caps = {r.get("cap") for r in self.gen_sem}
        if sem_caps != {expected_cap}:
            reasons.append(f"cap في gen_sem = {sorted(map(str, sem_caps))} لا {{{expected_cap!r}}}")
        act = [num(r.get("activeAtSend")) for r in self.http_rows if num(r.get("activeAtSend")) is not None]
        sem_act = [num(r.get("activeMax")) for r in self.gen_sem if num(r.get("activeMax")) is not None]
        act_max = max(act + sem_act) if (act or sem_act) else None
        if expected_cap is not None and act_max is not None and act_max > expected_cap:
            reasons.append(f"الجاري تجاوزَ السعة: {act_max} > {expected_cap}")
        if self.t0 is not None and self.drain0 is not None:
            sc = self._window_counts(self.gen_sem)
            thin = sum(1 for c in sc if c < MIN_SEM_ROWS_PER_WINDOW)
            if not sc or thin:
                reasons.append(f"نوافذُ حقنٍ بأقلَّ من {MIN_SEM_ROWS_PER_WINDOW} سطورَ gen_sem = {thin}/{len(sc)}")
        else:
            sc = []
        return {
            **base,
            "valid": not reasons,
            "valid2": base["valid"],
            "reasons": reasons,
            "run3": {
                "expected_cap": expected_cap,
                "gen_env_fetchCap": env.get("fetchCap"),
                "gen_env_fetchCapEnv": env.get("fetchCapEnv"),
                "rides_2xx_linked": ok2xx,
                "missing_new_fields": missing,
                "http_call_rows": len(self.http_rows),
                "gen_sem_rows": len(self.gen_sem),
                "gen_sem_min_per_window": min(sc) if sc else None,
                "active_max": act_max,
                "aborted_in_gate": sum(int(num(r.get("aborted")) or 0) for r in self.gen_sem),
            },
        }


def _cap_arg(v):
    return None if v in ("none", "null", "") else int(v)


def mode_valid3(wave_dir, cap, out_path):
    v = Wave3(wave_dir).validity3(cap)
    ga.write(out_path, v)
    return v


def mode_aa3(aa1, aa2, out_path):
    with open(os.devnull, "w") as dn:
        old = sys.stdout
        sys.stdout = dn
        try:
            inherited = ga.mode_aa(aa1, aa2, out_path + ".inherited.json")
        finally:
            sys.stdout = old
    v1, v2 = Wave3(aa1).validity3(REGISTERED_CAP), Wave3(aa2).validity3(REGISTERED_CAP)
    hw = g2.hw_compare(sorted(os.path.join(d, f) for d in (aa1, aa2) for f in os.listdir(d)
                              if f.startswith("hw-") and f.endswith(".json")))
    if not hw["identical"]:
        verdict = "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد"
    elif not (v1["valid"] and v2["valid"]):
        verdict = "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN3"
    else:
        verdict = inherited["verdict"]
    passed = verdict == "إعادةُ_إنتاجٍ_ضمنَ_±δ"
    res = {
        "mode": "aa3", "delta_ms": DELTA_MS, "registered_cap": REGISTERED_CAP,
        "inherited_detail": inherited["detail"], "inherited_verdict": inherited["verdict"],
        "validity3": [v1, v2], "hw": hw, "pass": passed, "verdict": verdict,
        "note": "بوابةٌ تشخيصيّةٌ لا اجتيازُ اختبارِ سعة. LOAD-01 = FAIL وLOAD-01M = NOT_MET دونَ تغيير.",
    }
    ga.write(out_path, res)
    return res


def q_wave(w):
    inj = w.injection_2xx()
    d = [s for s in inj if s["inflightAtInvoke"] is not None and s["inflightAtInvoke"] > DEMAND_SPLIT]
    n = [s for s in inj if s["inflightAtInvoke"] is not None and s["inflightAtInvoke"] <= DEMAND_SPLIT]
    full = lambda s: s["U_head"] is not None and s["queueWaitMs"] is not None
    d, n = [s for s in d if full(s)], [s for s in n if full(s)]
    u_d = sum(s["U_head"] for s in d)
    w_d = sum(s["queueWaitMs"] for s in d)
    r_d = mean([s["U_resid"] for s in d])
    r_n = mean([s["U_resid"] for s in n])
    share = None if u_d <= 0 else w_d / u_d
    gap = None if r_d is None or r_n is None else r_d - r_n
    if len(d) < Q_MIN_STRATUM_N or len(n) < Q_MIN_STRATUM_N or gap is None:
        status = "INSUFFICIENT"
    elif gap > DELTA_MS:
        status = "ELSEWHERE"
    elif share is not None and share >= Q_MIN_WAIT_SHARE:
        status = "EXPLAINED"
    else:
        status = "UNRESOLVED"
    rnd = lambda x: None if x is None else round(x, 3)
    return {
        "wave": w.name, "n_D_gt256": len(d), "n_N_le256": len(n),
        "U_head_mean_D": rnd(mean([s["U_head"] for s in d])), "U_head_mean_N": rnd(mean([s["U_head"] for s in n])),
        "queueWait_mean_D": rnd(mean([s["queueWaitMs"] for s in d])), "queueWait_mean_N": rnd(mean([s["queueWaitMs"] for s in n])),
        "U_resid_mean_D": rnd(r_d), "U_resid_mean_N": rnd(r_n), "resid_gap_D_minus_N": rnd(gap),
        "wait_share_of_U_head_D": rnd(share), "status": status,
    }


Q_VERDICTS = {
    "EXPLAINED": "الانتظارُ_في_المولّدِ_يفسّرُ_الفجوة",
    "ELSEWHERE": "الاختناقُ_في_مكانٍ_آخر",
}


def mode_q(aa1, aa2, out_path):
    w1, w2 = Wave3(aa1), Wave3(aa2)
    v1, v2 = w1.validity3(REGISTERED_CAP), w2.validity3(REGISTERED_CAP)
    per = [q_wave(w1), q_wave(w2)]
    st = {p["status"] for p in per}
    if not (v1["valid"] and v2["valid"]):
        verdict = "غيرُ_صالحٍ_صلاحيةُ_RUN3"
    elif len(st) == 1 and next(iter(st)) in Q_VERDICTS:
        verdict = Q_VERDICTS[next(iter(st))]
    else:
        verdict = "غيرُ_محسوم"
    res = {
        "mode": "q", "delta_ms": DELTA_MS, "min_stratum_n": Q_MIN_STRATUM_N, "min_wait_share": Q_MIN_WAIT_SHARE,
        "demand_split": DEMAND_SPLIT, "per_wave": per, "verdict": verdict,
        "rule": ("لكلِّ موجةٍ: D = inflightAtInvoke > 256، N = ≤ 256 (طلباتُ rides 2xx في طورِ الحقن). "
                 "EXPLAINED إن (U_resid_D − U_resid_N) ≤ δ و Σwait_D / ΣU_head_D ≥ 0.80؛ ELSEWHERE إن الفرقُ > δ؛ "
                 "INSUFFICIENT إن n < 200 في أيِّ طبقة؛ وإلّا UNRESOLVED. الحكمُ = الحالُ نفسُها في الموجتين، وإلّا غيرُ محسوم."),
        "interpretable_only_if": "aa3 مُجازة ∧ cost مُجازة ∧ load مُجازة (§6) — وإلّا يُعرضُ «غيرُ قابلٍ للتفسير».",
    }
    ga.write(out_path, res)
    return res


def rates(w):
    rows = w.sem_in_injection()
    secs = len(rows)
    if secs == 0:
        return {"seconds": 0, "invokes_per_s": None, "sends_per_s": None, "completions_per_s": None}
    tot = lambda k: sum(int(num(r.get(k)) or 0) for r in rows)
    return {
        "seconds": secs,
        "invokes_per_s": round(tot("invokes") / secs, 3),
        "sends_per_s": round(tot("sends") / secs, 3),
        "completions_per_s": round(tot("completions") / secs, 3),
        "waited_sends_share": None if tot("sends") == 0 else round(tot("waitedSends") / tot("sends"), 4),
        "waiters_max": max(int(num(r.get("waitersMax")) or 0) for r in rows),
        "active_max": max(int(num(r.get("activeMax")) or 0) for r in rows),
        "wait_sum_ms_per_s": round(sum(num(r.get("waitSumMs")) or 0 for r in rows) / secs, 3),
        "aborted": tot("aborted"),
        "cap": rows[0].get("cap"),
    }


def mode_load(s1, n1, n2, s2, out_path):
    ws = {k: Wave3(d) for k, d in (("S1", s1), ("N1", n1), ("N2", n2), ("S2", s2))}
    val = {k: w.validity3(REGISTERED_CAP if k.startswith("S") else None) for k, w in ws.items()}
    rt = {k: rates(w) for k, w in ws.items()}
    checks = []
    for s, n in (("S1", "N1"), ("S2", "N2")):
        for m in ("invokes_per_s", "sends_per_s"):
            a, b = rt[s][m], rt[n][m]
            rel = None if a is None or b in (None, 0) else (a - b) / b
            checks.append({"pair": f"{s}-{n}", "metric": m, "S": a, "N": b,
                           "rel": None if rel is None else round(rel, 4),
                           "ok": rel is not None and abs(rel) <= LOAD_RATE_TOL})
    all_valid = all(v["valid"] for v in val.values())
    if not all_valid:
        verdict = "غيرُ_صالحٍ_صلاحيةُ_RUN3"
    elif all(c["ok"] for c in checks):
        verdict = "حملٌ_متكافئٌ_ضمنَ_±5%"
    else:
        verdict = "الحملُ_تغيّر"
    res = {"mode": "load", "tolerance": LOAD_RATE_TOL, "rates": rt, "checks": checks,
           "validity3": {k: {"valid": v["valid"], "reasons": v["reasons"], "run3": v["run3"]} for k, v in val.items()},
           "pass": verdict == "حملٌ_متكافئٌ_ضمنَ_±5%", "verdict": verdict}
    ga.write(out_path, res)
    return res


DESC3 = ("ttfbMs", "invokeMs", "queueWaitMs", "U_head", "U_resid", "srv_to_head", "inflightAtInvoke",
         "demandAtInvoke", "activeAtSend", "waitersAtInvoke", "inflightAtEntry")


def mode_describe(out_path, wave_dirs):
    per = []
    for d in wave_dirs:
        w = Wave3(d)
        base = g2.describe_wave(w)
        inj = w.injection_2xx()
        split = lambda pred: {m: g2._stats([s[m] for s in inj if s["inflightAtInvoke"] is not None and pred(s["inflightAtInvoke"])])
                              for m in ("ttfbMs", "U_head", "queueWaitMs", "U_resid", "srv_to_head")}
        base["run3"] = {
            "cap": (w.gen_env[0] if w.gen_env else {}).get("fetchCap"),
            "injection_stats": {m: g2._stats([s[m] for s in inj]) for m in DESC3},
            "strata_inflightAtInvoke": {f"<={DEMAND_SPLIT}": split(lambda x: x <= DEMAND_SPLIT),
                                        f">{DEMAND_SPLIT}": split(lambda x: x > DEMAND_SPLIT)},
            "rates": rates(w),
            "q": q_wave(w),
        }
        per.append(base)
    res = {"mode": "describe", "descriptive_only": True,
           "note": "وصفيٌّ فقط: لا قاعدةَ قرارٍ لهذهِ المؤشّرات (القواعدُ في q وload وaa3 وcost وحدَها).",
           "waves": per}
    ga.write(out_path, res)
    return res


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    m = argv[1]
    if m == "valid3" and len(argv) == 5:
        return mode_valid3(argv[2], _cap_arg(argv[3]), argv[4])
    if m == "aa3" and len(argv) == 5:
        r = mode_aa3(argv[2], argv[3], argv[4])
        raise SystemExit(0 if r["pass"] else 3)
    if m == "q" and len(argv) == 5:
        return mode_q(argv[2], argv[3], argv[4])
    if m == "load" and len(argv) == 7:
        r = mode_load(argv[2], argv[3], argv[4], argv[5], argv[6])
        raise SystemExit(0 if r["pass"] else 3)
    if m == "describe" and len(argv) >= 4:
        return mode_describe(argv[2], argv[3:])
    raise SystemExit(f"USAGE_ERROR {m} argc={len(argv)}\n{__doc__}")


if __name__ == "__main__":
    main(sys.argv)
