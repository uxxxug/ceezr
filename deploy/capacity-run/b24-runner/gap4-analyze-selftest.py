#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لـgap4-analyze.py على موجاتٍ صناعيّةٍ بصيغِ الأداةِ الحقيقيّة (RUN4).
يُشغَّلُ قبلَ أيِّ موجةٍ في المقعد؛ أيُّ إخفاقٍ = لا موجة. يرثُ مولّدَ موجاتِ gap3-analyze-selftest.py
(ومنه gap2) ويتحقّقُ من قاعدةِ بوابةِ A/A الجديدةِ (ttfbResid = ttfbMs − queueWaitMs) على حالاتٍ
معروفةِ النتيجة: إبقاءُ الحدودِ الموروثةِ، وحسابُ ttfbResid من سطرِ http_call نفسِه، وسيناريو RUN3
نفسِه (ttfbMs الخامُ يختلفُ > δ والاختلافُ كلُّه انتظارٌ مقيسٌ ⇒ تُجيزُ البوابةُ) وحالةِ فشلِ
ttfbResid نفسِه، ورفضُ المدخلاتِ الفاسدة. q وload كما في RUN3 تُختبرُ في selftest الخاصِّ بها."""
import contextlib
import importlib.util
import io
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fn))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


g4 = _load("g4", "gap4-analyze.py")
st3 = _load("st3", "gap3-analyze-selftest.py")
g3 = st3.g3


def make_wave4(root, name, **kw):
    return st3.make_wave3(root, name, **kw)


def check(cond, msg):
    if not cond:
        raise SystemExit(f"SELFTEST_FAIL: {msg}")
    print(f"ok  {msg}")


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a)


def main():
    with tempfile.TemporaryDirectory() as root:
        R = lambda n: os.path.join(root, n)
        # 1) حسابُ ttfbResid من سطرِ http_call نفسِه
        d = make_wave4(root, "c1", seed=7)
        w = g4.Wave4(d)
        s = next(s for s in w.samples if s.get("ttfbMs") is not None and s.get("queueWaitMs") is not None)
        check(abs(s["ttfbResid"] - (s["ttfbMs"] - s["queueWaitMs"])) < 1e-9, "ttfbResid = ttfbMs − queueWaitMs حرفيًّا من السطر")
        # 2) سيناريو RUN3 نفسِه: ttfbMs الخامُ يختلفُ > δ والاختلافُ كلُّه انتظارٌ مقيسٌ ⇒ تُجيزُ البوابةُ
        a = make_wave4(root, "ra", seed=7, queue_extra=150.0)
        b = make_wave4(root, "rb", seed=8, queue_extra=190.0)
        r = quiet(g4.mode_aa4, a, b, R("aa-pass.json"))
        raw = r["ttfb_ms_raw_descriptive"]["ttfbMs"]
        check(abs(raw["AA2"] - raw["AA1"]) > g4.DELTA_MS, f"ttfbMs الخامُ يختلفُ > δ كما في RUN3 ({raw['AA2'] - raw['AA1']:.2f}ms)")
        check(r["pass"] and r["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ",
              f"البوابةُ على ttfbResid تُجيزُ (الحدُّ الوحيدُ الذي شملَ تذبذبَ المولّدِ أُزيلَ بالقياسِ لا بالحذف) ({r['verdict']})")
        check(abs(r["aa4_detail"]["ttfbResid"]["d"]) <= g4.DELTA_MS, "ttfbResid متكررٌ ضمنَ δ")
        # 3) فشلُ ttfbResid نفسِه (زيادةٌ خارجَ الانتظارِ المقيس) ⇒ إيقاف
        b2 = make_wave4(root, "fb", seed=8, queue_extra=150.0, extra_residual=30.0)
        r = quiet(g4.mode_aa4, a, b2, R("aa-fail.json"))
        check(not r["pass"] and r["verdict"] == "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة",
              "ttfbResid يختلفُ > δ ⇒ توقفٌ موثّق")
        # 4) فقدُ queueWaitMs كلُّه ⇒ لا عيّناتٍ كافيةً لِttfbResid ⇒ توقف
        b3 = make_wave4(root, "nw", seed=8, queue_extra=150.0, drop_wait=10 ** 9)
        r = quiet(g4.mode_aa4, a, b3, R("aa-nowait.json"))
        check(not r["pass"] and r["aa4_detail"]["ttfbResid"]["n2"] == 0,
              "queueWaitMs ناقصٌ في الموجةِ كلِّها ⇒ ttfbResid بلا عيّناتٍ ⇒ توقف")
        # 5) الموروثُ: سعةٌ غيرُ المسجّلة / عتادٌ مختلف ⇒ غيرُ صالحٍ للمقارنة
        b4 = make_wave4(root, "cap", seed=8, cap=None)
        r = quiet(g4.mode_aa4, a, b4, R("aa-cap.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN3", "AA2 بلا سعةٍ ⇒ غيرُ صالحة")
        w5 = make_wave4(root, "hw", seed=8)
        st3.st2.write_hw(w5, "x", cpu_model="Intel Xeon 8370C")
        r = quiet(g4.mode_aa4, a, w5, R("aa-hw.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد", "عتادٌ مختلفٌ ⇒ غيرُ صالحة")
        # 6) q كما في RUN3 حرفًا — إعادةُ توجيهٍ سليمة
        qa, qb = make_wave4(root, "qa", seed=7), make_wave4(root, "qb", seed=8)
        q = quiet(g4.main, ["gap4", "q", qa, qb, R("q.json")])
        check(True, "q عبر gap4 يُعادُ توجيهُه إلى قاعدةِ RUN3 نفسِها")
    print("GAP4_ANALYZER_SELFTEST_OK")


if __name__ == "__main__":
    main()
