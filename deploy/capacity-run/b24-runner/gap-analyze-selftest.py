#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لـgap-analyze.py على موجاتٍ صناعيّةٍ بصيغِ الأداةِ الحقيقيّةِ (httpgap/httpreq/http_call).
يُشغَّلُ قبلَ أيِّ موجةٍ في المقعدِ؛ أيُّ إخفاقٍ = لا موجة."""
import datetime
import gzip
import importlib.util
import json
import os
import random
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("ga", os.path.join(HERE, "gap-analyze.py"))
ga = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ga)

T0 = 1_790_000_000_000
INJ_MS = 300_000
DRAIN_MS = 60_000


def iso(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, tz=datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def make_wave(root, name, n=2600, extra_finish=0.0, extra_residual=0.0, seed=1,
              drop_gap=0, dup_call=0, noid_gap=0, verified_off=0, gz=True, bad_line=False):
    d = os.path.join(root, name)
    os.makedirs(d)
    rng = random.Random(seed)
    ev = [{"t": iso(T0), "event": "phase.start"},
          {"t": iso(T0 + INJ_MS), "event": "phase.drain_start"},
          {"t": iso(T0 + INJ_MS + DRAIN_MS), "event": "phase.end"}]
    calls, trace = [], []
    for i in range(n):
        rid = f"{name}-r{i}"
        start = T0 + 10 + (INJ_MS - 100) * i / n
        fetch = 40 + rng.random() * 20
        head = fetch + 0.3
        first = head + 0.2
        end = first + 0.1
        finish = end + 0.5 + extra_finish
        resid = 6 + rng.random() * 4 + extra_residual
        el = finish + resid
        ttfb = el - 2
        calls.append({"t": iso(start + el), "event": "http_call", "label": "rides_create", "status": 201,
                      "elapsedMs": round(el, 2), "requestId": rid, "ttfbMs": round(ttfb, 2), "bodyMs": 2.0})
        if i >= drop_gap:
            trace.append({"k": "httpgap", "at": int(start + finish), "requestId": None if i < drop_gap + noid_gap else rid,
                          "route": "POST /v1/rides", "fetchMs": round(fetch, 2), "writeHeadMs": round(head, 2),
                          "firstWriteMs": round(first, 2), "endMs": round(end, 2), "finishMs": round(finish, 2),
                          "closed": False})
        trace.append({"k": "httpreq", "at": int(start + fetch), "requestId": rid, "route": "POST /v1/rides",
                      "serverMs": round(fetch - 1, 2), "status": 201, "gateWaitMs": 0, "gateHoldMs": 0,
                      "gateAcquisitions": 1})
    for i in range(dup_call):
        calls.append(dict(calls[i]))
    # مسارٌ آخرُ (webhook) بلا نداءِ عميلٍ — يُعدُّ وصفيًّا ولا يُبطلُ
    trace.append({"k": "httpgap", "at": T0 + 5, "requestId": "wh-1", "route": "POST /telegram/webhook",
                  "fetchMs": 1, "writeHeadMs": 1, "firstWriteMs": 1, "endMs": 1, "finishMs": 1, "closed": False})
    calls.append({"t": iso(T0 + INJ_MS + DRAIN_MS + 1), "event": "latency_percentiles",
                  "rides_create": {"n": n + dup_call, "p50": 1, "p95": 1, "p99": 1, "max": 1}})
    op = (lambda p: gzip.open(p + ".gz", "wt", encoding="utf-8")) if gz else (lambda p: open(p, "w", encoding="utf-8"))
    for fn, rows in (("miniapp-load-events.jsonl", ev), ("load-events.jsonl", calls), ("load-trace.jsonl", trace)):
        with op(os.path.join(d, fn)) as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
            if bad_line and fn == "load-events.jsonl":
                f.write("{broken\n")
    with open(os.path.join(d, "wave-report.json"), "w") as f:
        json.dump({"verified": n + dup_call + verified_off}, f)
    return d


def check(cond, msg):
    if not cond:
        raise SystemExit(f"SELFTEST_FAIL: {msg}")
    print(f"ok  {msg}")


def run_ab(root, tag, **b_kwargs):
    dirs = []
    for i, slot in enumerate(ga.AB_ORDER):
        kw = b_kwargs if slot.startswith("B") else {}
        dirs.append(make_wave(root, f"{tag}-{slot}", seed=100 + i, **kw))
    out = os.path.join(root, f"{tag}.json")
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        return ga.mode_ab(dirs, out)


def main():
    with tempfile.TemporaryDirectory() as root:
        import contextlib, io
        q = contextlib.redirect_stdout(io.StringIO())
        # 1) صلاحيةٌ سليمة
        w = make_wave(root, "v-ok")
        v = ga.Wave(w).validity()
        check(v["valid"] and v["counts"]["linked"] == 2600 and v["counts"]["httpgap_other_routes"] == 1,
              "موجةٌ سليمةٌ صالحةٌ ومساراتٌ أخرى معدودةٌ وصفيًّا")
        # 2) فشلُ الربطِ / التكرارُ / بلا معرّف / عدٌّ غيرُ متطابقٍ / سطرٌ مكسور
        check(not ga.Wave(make_wave(root, "v-drop", drop_gap=5)).validity()["valid"], "نداءُ عميلٍ بلا httpgap يُبطلُ الموجة")
        check(not ga.Wave(make_wave(root, "v-dup", dup_call=3)).validity()["valid"], "معرّفُ عميلٍ مكرّرٌ يُبطلُ الموجة")
        check(not ga.Wave(make_wave(root, "v-noid", noid_gap=2)).validity()["valid"], "httpgap بلا معرّفٍ يُبطلُ الموجة")
        check(not ga.Wave(make_wave(root, "v-cnt", verified_off=1)).validity()["valid"], "عدُّ المتحقّقِ غيرُ المطابقِ يُبطلُ الموجة")
        check(not ga.Wave(make_wave(root, "v-bad", bad_line=True)).validity()["valid"], "سطرٌ غيرُ قابلٍ للقراءةِ يُبطلُ الموجة")
        check(ga.Wave(make_wave(root, "v-plain", gz=False)).validity()["valid"], "ملفاتٌ غيرُ مضغوطةٍ تُقرأ")
        # 3) قاعدةُ الحالاتِ الثلاثِ
        check(ga.three_case(-3, 4) == "متّسق", "فاصلٌ داخلَ (−δ,+δ) ⇒ متّسق")
        check(ga.three_case(16, 30) == "تفسيرٌ_سلوكيٌّ_مطلوب", "فاصلٌ كلُّه وراءَ +δ ⇒ تفسيرٌ سلوكيٌّ مطلوب")
        check(ga.three_case(5, 30) == "غيرُ_محسوم", "فاصلٌ يعبرُ +δ ⇒ غيرُ محسوم")
        check(ga.three_case(-40, -20) == "غيرُ_محسوم", "فاصلٌ كلُّه وراءَ −δ (B أسرع) ⇒ غيرُ محسوم")
        check(ga.three_case(-15, 3) == "غيرُ_محسوم", "الحدُّ −δ نفسُه خارجَ الفترةِ المفتوحة")
        # 4) AB: لا فرق ⇒ كلُّ الحدودِ متّسقة
        r = run_ab(root, "ab-null")
        check(r["overall"] == "كلُّ_الحدودِ_متّسقة_والبقايا_مسمّاةٌ_غيرُ_مفصولة" and not r["behavioral_candidates"],
              f"ab بلا فرقٍ ⇒ متّسق ({r['overall']})")
        # 5) AB: B أبطأُ في finish بـ40ms ⇒ مرشّحٌ في finishMs/seg_flush، والبقايا متّسقة
        r = run_ab(root, "ab-finish", extra_finish=40.0)
        check("finishMs" in r["behavioral_candidates"] and "seg_flush" in r["behavioral_candidates"]
              and "fetchMs" not in r["behavioral_candidates"] and r["metrics"]["residual"]["rule"] == "متّسق"
              and r["overall"] == "مرشّحُ_تفسيرٍ_وصفيّ", f"ab بإبطاءِ finish ⇒ مرشّحٌ وصفيٌّ ({r['overall']})")
        # 6) AB: الزيادةُ في البقايا وحدَها ⇒ غيرُ محسوم (قصةٌ ناقصة)
        r = run_ab(root, "ab-resid", extra_residual=40.0)
        check(r["overall"] == "غيرُ_محسوم" and r["metrics"]["residual"]["rule"] == "تفسيرٌ_سلوكيٌّ_مطلوب",
              f"ab بزيادةِ البقايا وحدَها ⇒ غيرُ محسوم ({r['overall']})")
        # 7) AB: عيّناتٌ أقلُّ من 2000 ⇒ غيرُ محسوم حتى معَ فرقٍ كبير
        r = run_ab(root, "ab-small", extra_finish=40.0, n=1500)
        check(r["overall"] == "غيرُ_محسوم" and r["metrics"]["finishMs"]["rule"] == "غيرُ_محسوم",
              "ab بعيّناتٍ < 2000 ⇒ غيرُ محسوم")
        # 8) AB: موجةٌ غيرُ صالحةٍ ⇒ غيرُ محسوم
        r = run_ab(root, "ab-invalid", drop_gap=3)
        check(r["overall"] == "غيرُ_محسوم", "ab بموجةٍ غيرِ صالحةٍ ⇒ غيرُ محسوم")
        # 9) AA
        with q:
            a = ga.mode_aa(make_wave(root, "aa1", seed=7), make_wave(root, "aa2", seed=8), os.path.join(root, "aa.json"))
        check(a["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ", "A/A متطابقٌ ⇒ يُجاز")
        with contextlib.redirect_stdout(io.StringIO()):
            a = ga.mode_aa(make_wave(root, "aa3", seed=7), make_wave(root, "aa4", seed=8, extra_finish=30.0),
                           os.path.join(root, "aa2.json"))
        check(a["verdict"] == "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة", "A/A بفرقٍ > δ ⇒ توقف")
        # 10) الإسنادُ للنافذةِ: كلُّ العيّناتِ داخلَ الحقنِ تُستعمل
        m, n_used, nw = ga.Wave(make_wave(root, "win")).conditional_mean("finishMs")
        check(n_used == 2600 and nw == 60, f"الإسنادُ: 2600 عيّنةً على 60 نافذةً ({n_used}, {nw})")
    print("GAP_ANALYZER_SELFTEST_OK")


if __name__ == "__main__":
    main()
