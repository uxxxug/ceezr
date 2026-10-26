#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليلُ دورةِ LOAD-01-GAP-PROBE-RUN2 (قياسُ الفجوةِ خارجَ الجسر) — تشخيصيٌّ لا حكمَ سعة.

البروتوكول: docs/evidence/capacity/LOAD01-GAP-PROBE-RUN2-20261027/PROTOCOL-load01-gap-probe-run2.md
(مسجَّلٌ قبلَ أوّلِ موجة). يرثُ gap-analyze.py كما هو (الربطُ الفرديُّ، صلاحيةُ الموجةِ المركّبة،
المتوسطُ الشرطيُّ بنوافذِ 5ث، δ = 15ms، ≥ 2000 عيّنة) ويضيفُ فقط:

  valid2   <wave> <out.json>                  الصلاحيةُ الموروثةُ + اكتمالُ حقولِ RUN2 (§4.2 في البروتوكول)
  hw       <out.json> <hw.json>...            بصمةُ العتادِ والحصّةِ: كلُّ الملفاتِ متطابقةٌ في مفاتيحِ الهويّة
  aa2      <AA1> <AA2> <out.json>             بوابةُ A/A الموروثةُ (7 حدود) ∧ valid2 للموجتين ∧ hw متطابق
  describe <out.json> <wave>...               وصفيٌّ فقط — لا قاعدةَ قرارٍ ولا يُبنى عليهِ حكم

قاعدةُ الساعات: كلُّ مدّةٍ تُحسبُ داخلَ عمليّةٍ واحدة (المولّد: invokeMs/ttfbMs/bodyMs/elapsedMs؛
البوّابة: requestLeadMs/fetchMs/writeHeadMs/finishMs). لا يُطرحُ طابعٌ رتيبٌ من عمليّةٍ من طابعِ
أخرى. «غيرُ المقيس» U = مدّةُ عميلٍ − مجموعُ مددِ خادمٍ للطلبِ نفسِه: فرقُ **مددٍ** لا طوابع، ويُعرضُ
وصفيًّا بوصفِهِ ما بقيَ خارجَ القياسِ (مقبس→حدثِ الطلب، الشبكةُ المحلية، طابورُ fetch الداخليُّ في
Bun، تسليمُ الترويساتِ للعميل) — لا يُنسبُ إلى أيٍّ منها بالطرح.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("ga", os.path.join(HERE, "gap-analyze.py"))
ga = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ga)

DELTA_MS = ga.DELTA_MS
WINDOW_MS = ga.WINDOW_MS
MIN_SAMPLES = ga.MIN_SAMPLES

# حقولُ RUN2 المطلوبةُ لكلِّ طلبِ rides مربوطٍ بحالةٍ 2xx (§4.2)
CLIENT_NEW = ("invokeMs", "inflightAtInvoke", "headersOverdueMs")
SERVER_NEW = ("requestLeadMs", "inflightAtEntry", "connSeq", "loopOverdueAtEntryMs")
# أقلُّ عددٍ من سطورِ مِجسِّ الحلقةِ لكلِّ نافذةِ 5ث في طورِ الحقن (عيّنةٌ كلَّ ثانية)
MIN_LOOP_ROWS_PER_WINDOW = 4
# مفاتيحُ الهويّة في بصمةِ العتاد — أيُّ اختلافٍ ⇒ غيرُ صالحةٍ للمقارنة (§4.3)
HW_IDENTITY_KEYS = (
    "cpu_model", "arch", "nproc", "cpuset_effective", "seat_cpu_max", "kernel",
    "os_release", "image_os", "image_version", "cpu_flags_md5", "bun_version",
)
# حدُّ Bun الموثَّقُ لطلباتِ fetch المتزامنة (يُستعملُ للتقسيمِ الوصفيِّ فقط)
BUN_FETCH_DEFAULT_MAX = 256


def num(v):
    return ga.num(v)


class Wave2(ga.Wave):
    def __init__(self, wave_dir):
        super().__init__(wave_dir)
        le, _ = ga.read_jsonl_counting(os.path.join(wave_dir, "load-events.jsonl"))
        tr, _ = ga.read_jsonl_counting(os.path.join(wave_dir, "load-trace.jsonl"))
        self.gen_env = [r for r in le if r.get("event") == "gen_env"]
        self.gen_loop = [r for r in le if r.get("event") == "gen_loop"]
        self.gw_loop = [r for r in tr if r.get("k") == "loop1s"]
        sp = os.path.join(wave_dir, "sched-samples.jsonl")
        self.sched = []
        if os.path.exists(sp) or os.path.exists(sp + ".gz"):
            rows, _ = ga.read_jsonl_counting(sp)
            self.sched = [r for r in rows if r.get("k") == "sched"]
        for s in self.samples:
            c = self.calls.get(s["rid"], {})
            g = self.gaps.get(s["rid"]) or {}
            for f in CLIENT_NEW:
                s[f] = num(c.get(f))
            for f in SERVER_NEW:
                s[f] = num(g.get(f))
            s["elapsedMs"] = num(c.get("elapsedMs"))
            # مددُ العميلِ بعدَ استدعاءِ fetch (ساعةُ المولّدِ وحدَها)
            s["wire_ttfb"] = ga.diff(s["ttfbMs"], s["invokeMs"])
            s["wire_total"] = ga.diff(s["elapsedMs"], s["invokeMs"])
            # مددُ الخادمِ من حدثِ الطلب (ساعةُ البوّابةِ وحدَها)
            s["srv_to_head"] = (None if s["requestLeadMs"] is None or s["writeHeadMs"] is None
                                else s["requestLeadMs"] + s["writeHeadMs"])
            s["srv_to_finish"] = (None if s["requestLeadMs"] is None or s["finishMs"] is None
                                  else s["requestLeadMs"] + s["finishMs"])
            s["U_head"] = ga.diff(s["wire_ttfb"], s["srv_to_head"])
            s["U_total"] = ga.diff(s["wire_total"], s["srv_to_finish"])

    def _window_counts(self, rows, key="at"):
        wins = self.windows()
        cnt = [0] * len(wins)
        for r in rows:
            t = num(r.get(key))
            if t is None:
                continue
            i = int((t - self.t0) // WINDOW_MS)
            if 0 <= i < len(wins) and t >= self.t0:
                cnt[i] += 1
        return cnt

    def validity2(self):
        base = self.validity()
        reasons = list(base["reasons"])
        missing = {f: 0 for f in CLIENT_NEW + SERVER_NEW}
        ok2xx = 0
        for s in self.samples:
            st = s.get("status")
            if not (isinstance(st, int) and 200 <= st < 300):
                continue
            ok2xx += 1
            for f in CLIENT_NEW + SERVER_NEW:
                if s.get(f) is None:
                    missing[f] += 1
        bad = {f: n for f, n in missing.items() if n}
        if bad:
            reasons.append(f"حقولُ RUN2 ناقصةٌ في طلباتٍ 2xx مربوطة: {bad}")
        if ok2xx == 0:
            reasons.append("لا طلباتِ rides 2xx مربوطة")
        if len(self.gen_env) != 1:
            reasons.append(f"سطورُ gen_env = {len(self.gen_env)} (المطلوبُ واحدٌ بالضبط)")
        if self.t0 is not None and self.drain0 is not None:
            gl = self._window_counts(self.gen_loop)
            wl = self._window_counts(self.gw_loop)
            thin_g = sum(1 for c in gl if c < MIN_LOOP_ROWS_PER_WINDOW)
            thin_w = sum(1 for c in wl if c < MIN_LOOP_ROWS_PER_WINDOW)
            if not gl or thin_g:
                reasons.append(f"نوافذُ حقنٍ بأقلَّ من {MIN_LOOP_ROWS_PER_WINDOW} سطورَ gen_loop = {thin_g}/{len(gl)}")
            if not wl or thin_w:
                reasons.append(f"نوافذُ حقنٍ بأقلَّ من {MIN_LOOP_ROWS_PER_WINDOW} سطورَ loop1s = {thin_w}/{len(wl)}")
        else:
            gl, wl = [], []
        env = self.gen_env[0] if len(self.gen_env) == 1 else {}
        return {
            **base,
            "valid": not reasons,
            "inherited_valid": base["valid"],
            "reasons": reasons,
            "run2": {
                "rides_2xx_linked": ok2xx,
                "missing_new_fields": missing,
                "gen_env_rows": len(self.gen_env),
                "gen_env": {k: env.get(k) for k in ("pid", "bunVersion", "maxHttpRequestsEnv")},
                "gen_loop_rows": len(self.gen_loop),
                "loop1s_rows": len(self.gw_loop),
                "gen_loop_min_per_window": min(gl) if gl else None,
                "loop1s_min_per_window": min(wl) if wl else None,
                "elu_available_gen": any(r.get("eluAvailable") for r in self.gen_loop),
                "elu_available_gw": any(r.get("eluAvailable") for r in self.gw_loop),
            },
        }


def hw_compare(paths):
    """كلُّ ملفاتِ البصمةِ (قبلَ/بعدَ كلِّ موجة) متطابقةٌ في مفاتيحِ الهويّة؟"""
    docs, reasons = [], []
    for p in paths:
        try:
            with open(p, encoding="utf-8") as f:
                docs.append((p, json.load(f)))
        except (OSError, ValueError) as e:
            reasons.append(f"بصمةٌ غيرُ مقروءة: {os.path.basename(p)} ({type(e).__name__})")
    if not docs:
        reasons.append("لا بصماتِ عتاد")
    ref = docs[0][1] if docs else {}
    for k in HW_IDENTITY_KEYS:
        if docs and (ref.get(k) in (None, "")):
            reasons.append(f"مفتاحُ هويّةٍ غائبٌ في المرجع: {k}")
    diffs = []
    for p, d in docs[1:]:
        for k in HW_IDENTITY_KEYS:
            if d.get(k) != ref.get(k):
                diffs.append({"file": os.path.basename(p), "key": k, "ref": ref.get(k), "got": d.get(k)})
    if diffs:
        reasons.append(f"اختلافُ بصمةٍ في {len(diffs)} مفتاحًا")
    return {
        "identical": not reasons,
        "reasons": reasons,
        "identity_keys": list(HW_IDENTITY_KEYS),
        "reference": {k: ref.get(k) for k in HW_IDENTITY_KEYS},
        "diffs": diffs,
        "descriptive": [
            {"file": os.path.basename(p), **{k: d.get(k) for k in
             ("phase", "cpu_stat", "psi_cpu", "steal_ticks", "loadavg", "date_utc")}}
            for p, d in docs
        ],
        "note": "المفاتيحُ الوصفيّةُ (الخنق، PSI، steal) تُعرضُ ولا تُبطلُ — لا قاعدةَ قرارٍ مسجّلةً لها.",
    }


def mode_valid2(wave_dir, out_path):
    v = Wave2(wave_dir).validity2()
    ga.write(out_path, v)
    return v


def mode_hw(out_path, paths):
    r = hw_compare(paths)
    ga.write(out_path, r)
    return r


def mode_aa2(aa1, aa2, out_path, hw_paths=None):
    with open(os.devnull, "w") as dn:
        old = sys.stdout
        sys.stdout = dn
        try:
            inherited = ga.mode_aa(aa1, aa2, out_path + ".inherited.json")
        finally:
            sys.stdout = old
    v1, v2 = Wave2(aa1).validity2(), Wave2(aa2).validity2()
    hw = hw_compare(hw_paths) if hw_paths is not None else hw_compare(
        sorted(os.path.join(d, f) for d in (aa1, aa2) for f in os.listdir(d) if f.startswith("hw-") and f.endswith(".json")))
    passed = inherited["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ" and v1["valid"] and v2["valid"] and hw["identical"]
    if not hw["identical"]:
        verdict = "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد"
    elif not (v1["valid"] and v2["valid"]):
        verdict = "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN2"
    else:
        verdict = inherited["verdict"]
    res = {
        "mode": "aa2", "delta_ms": DELTA_MS, "min_samples": MIN_SAMPLES,
        "inherited_detail": inherited["detail"], "inherited_verdict": inherited["verdict"],
        "validity2": [v1, v2], "hw": hw,
        "pass": passed, "verdict": verdict,
        "note": "الاجتيازُ بوابةٌ تشخيصيّةٌ لا اجتيازَ اختبارِ سعة. LOAD-01 = FAIL وLOAD-01M = NOT_MET دونَ تغيير.",
    }
    ga.write(out_path, res)
    return res


# ---------------- الوصفيّ ----------------
DESC_METRICS = (
    "ttfbMs", "elapsedMs", "bodyMs", "invokeMs", "wire_ttfb", "wire_total",
    "requestLeadMs", "fetchMs", "writeHeadMs", "finishMs", "srv_to_head", "srv_to_finish",
    "U_head", "U_total", "inflightAtInvoke", "inflightAtEntry", "headersOverdueMs", "loopOverdueAtEntryMs",
)


def _stats(vals):
    v = [x for x in vals if x is not None]
    if not v:
        return {"n": 0}
    v.sort()
    return {"n": len(v), "mean": round(sum(v) / len(v), 3), "p50": round(ga.percentile(v, 0.5), 3),
            "p95": round(ga.percentile(v, 0.95), 3), "p99": round(ga.percentile(v, 0.99), 3), "max": round(v[-1], 3)}


def _rank(v):
    order = sorted(range(len(v)), key=lambda i: v[i])
    r = [0.0] * len(v)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(x, y):
    pairs = [(a, b) for a, b in zip(x, y) if a is not None and b is not None]
    if len(pairs) < 3:
        return None
    rx, ry = _rank([p[0] for p in pairs]), _rank([p[1] for p in pairs])
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = sum((a - mx) ** 2 for a in rx) ** 0.5
    sy = sum((b - my) ** 2 for b in ry) ** 0.5
    return None if sx == 0 or sy == 0 else round(sxy / (sx * sy), 3)


def _bin_overdue(x):
    if x is None:
        return "null"
    if x < 1:
        return "0-1ms"
    if x < 5:
        return "1-5ms"
    if x < 20:
        return "5-20ms"
    return ">20ms"


def _window_series(w, rows, field, key="at"):
    wins = w.windows()
    sums, cnts = [0.0] * len(wins), [0] * len(wins)
    for r in rows:
        t, v = num(r.get(key)), r.get(field)
        if isinstance(v, dict):
            v = None
        v = num(v)
        if t is None or v is None or t < w.t0:
            continue
        i = int((t - w.t0) // WINDOW_MS)
        if 0 <= i < len(wins):
            sums[i] += v
            cnts[i] += 1
    return [sums[i] / cnts[i] if cnts[i] else None for i in range(len(wins))]


def _sched_series(w, cls, field):
    rows = [{"t": r.get("t"), "v": (r.get(cls) or {}).get(field) if cls else r.get(field)} for r in w.sched]
    return _window_series(w, rows, "v", key="t")


def _sample_series(w, metric):
    wins = w.windows()
    sums, cnts = [0.0] * len(wins), [0] * len(wins)
    for s in w.samples:
        v = s.get(metric)
        if v is None or s["start"] is None:
            continue
        i = int((s["start"] - w.t0) // WINDOW_MS)
        if 0 <= i < len(wins):
            sums[i] += v
            cnts[i] += 1
    return [sums[i] / cnts[i] if cnts[i] else None for i in range(len(wins))]


def describe_wave(w):
    inj = [s for s in w.samples if s["start"] is not None and w.t0 is not None and w.drain0 is not None
           and w.t0 <= s["start"] < w.drain0 and isinstance(s.get("status"), int) and 200 <= s["status"] < 300]
    cond = {}
    for m in DESC_METRICS:
        mean, n, nw = w.conditional_mean(m)
        cond[m] = {"cond_mean": None if mean is None else round(mean, 3), "n": n, "windows": nw}
    strata = {
        "inflightAtInvoke": {
            f"<={BUN_FETCH_DEFAULT_MAX}": {m: _stats([s[m] for s in inj if s["inflightAtInvoke"] is not None and s["inflightAtInvoke"] <= BUN_FETCH_DEFAULT_MAX]) for m in ("ttfbMs", "U_head", "srv_to_head")},
            f">{BUN_FETCH_DEFAULT_MAX}": {m: _stats([s[m] for s in inj if s["inflightAtInvoke"] is not None and s["inflightAtInvoke"] > BUN_FETCH_DEFAULT_MAX]) for m in ("ttfbMs", "U_head", "srv_to_head")},
        },
        "connSeq": {
            "first(1)": {m: _stats([s[m] for s in inj if s["connSeq"] == 1]) for m in ("ttfbMs", "U_head", "requestLeadMs")},
            "reused(>1)": {m: _stats([s[m] for s in inj if s["connSeq"] is not None and s["connSeq"] > 1]) for m in ("ttfbMs", "U_head", "requestLeadMs")},
        },
        "headersOverdueMs": {b: {m: _stats([s[m] for s in inj if _bin_overdue(s["headersOverdueMs"]) == b]) for m in ("ttfbMs", "U_head")}
                             for b in ("0-1ms", "1-5ms", "5-20ms", ">20ms", "null")},
        "loopOverdueAtEntryMs": {b: {m: _stats([s[m] for s in inj if _bin_overdue(s["loopOverdueAtEntryMs"]) == b]) for m in ("ttfbMs", "U_head", "requestLeadMs")}
                                 for b in ("0-1ms", "1-5ms", "5-20ms", ">20ms", "null")},
    }
    u_head = _sample_series(w, "U_head")
    ttfb = _sample_series(w, "ttfbMs")
    drivers = {
        "gen_lagP99Ms": _window_series(w, w.gen_loop, "lagP99Ms"),
        "gen_mainThreadRunqWaitPct": _window_series(w, w.gen_loop, "mainThreadRunqWaitPct"),
        "gen_mainThreadCpuPct": _window_series(w, w.gen_loop, "mainThreadCpuPct"),
        "gw_lagP99Ms": _window_series(w, w.gw_loop, "lagP99Ms"),
        "gw_mainThreadRunqWaitPct": _window_series(w, w.gw_loop, "mainThreadRunqWaitPct"),
        "gw_mainThreadCpuPct": _window_series(w, w.gw_loop, "mainThreadCpuPct"),
        "psi_some_pct": _sched_series(w, None, "psi_some_pct"),
        "procs_running": _sched_series(w, None, "procs_running"),
        "sched_generator_runq_wait": _sched_series(w, "generator", "runq_wait_pct_1core"),
        "sched_gateway_runq_wait": _sched_series(w, "gateway", "runq_wait_pct_1core"),
        "sched_postgres_run": _sched_series(w, "postgres", "run_pct_1core"),
        "inflightAtInvoke_mean": _sample_series(w, "inflightAtInvoke"),
        "inflightAtEntry_mean": _sample_series(w, "inflightAtEntry"),
    }
    corr = {k: {"U_head": spearman(u_head, v), "ttfbMs": spearman(ttfb, v)} for k, v in drivers.items()}
    driver_means = {k: (None if not [x for x in v if x is not None] else
                        round(sum(x for x in v if x is not None) / len([x for x in v if x is not None]), 3))
                    for k, v in drivers.items()}
    share_over = sum(1 for s in inj if s["inflightAtInvoke"] is not None and s["inflightAtInvoke"] > BUN_FETCH_DEFAULT_MAX)
    return {
        "wave": w.name,
        "rides_2xx_injection": len(inj),
        "conditional_means": cond,
        "injection_stats": {m: _stats([s[m] for s in inj]) for m in DESC_METRICS},
        "share_inflightAtInvoke_gt_256": None if not inj else round(share_over / len(inj), 4),
        "strata": strata,
        "window_driver_means": driver_means,
        "window_spearman": corr,
        "windows": len(w.windows()) if w.t0 is not None and w.drain0 is not None else 0,
        "gen_env": w.gen_env[0] if w.gen_env else None,
    }


def mode_describe(out_path, wave_dirs):
    waves = [Wave2(d) for d in wave_dirs]
    per = [describe_wave(w) for w in waves]
    diffs = {}
    if len(per) >= 2:
        a, b = per[0]["conditional_means"], per[1]["conditional_means"]
        for m in DESC_METRICS:
            x, y = a[m]["cond_mean"], b[m]["cond_mean"]
            diffs[m] = None if x is None or y is None else round(y - x, 3)
    res = {
        "mode": "describe",
        "descriptive_only": True,
        "note": ("وصفيٌّ فقط: لا قاعدةَ قرارٍ مسجّلةً لهذهِ المؤشّرات، ولا يُبنى عليها حكمٌ B−A ولا تدخّلٌ في المنتج. "
                 "U_head/U_total فرقُ مددٍ من عمليّتين لا طوابع؛ ما بداخلِهما غيرُ مقيسٍ مباشرةً."),
        "waves": per,
        "second_minus_first_cond_mean": diffs,
    }
    ga.write(out_path, res)
    return res


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    mode = argv[1]
    if mode == "valid2" and len(argv) == 4:
        return mode_valid2(argv[2], argv[3])
    if mode == "hw" and len(argv) >= 4:
        return mode_hw(argv[2], argv[3:])
    if mode == "aa2" and len(argv) == 5:
        r = mode_aa2(argv[2], argv[3], argv[4])
        raise SystemExit(0 if r["pass"] else 3)
    if mode == "describe" and len(argv) >= 4:
        return mode_describe(argv[2], argv[3:])
    raise SystemExit(f"USAGE_ERROR {mode} argc={len(argv)}\n{__doc__}")


if __name__ == "__main__":
    main(sys.argv)
