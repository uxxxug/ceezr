#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""تحليلُ دورةِ LOAD-01-GAP-PROBE-RUN4 (بوابةُ A/A على ttfbResid) — تشخيصيٌّ لا حكمَ سعة.

البروتوكول: docs/evidence/capacity/LOAD01-GAP-PROBE-RUN4-20261027/PROTOCOL-load01-gap-probe-run4.md
(مسجَّلٌ قبلَ أوّلِ موجة). يرثُ gap3-analyze.py كما هو (ومنه gap2/gap-analyze: الربطُ الفرديُّ،
الصلاحيةُ المركّبةُ، المتوسطُ الشرطيُّ بنوافذِ 5ث، δ = 15ms، ≥ 2000 عيّنة، بصمةُ العتاد) ويغيّرُ
حدًّا واحدًا فقط في بوابةِ A/A (الخيارُ المسجَّلُ في §9 من بروتوكولِ RUN3: «قياسُ ttfb من لحظةِ
الإرسال»):

  aa4      <AA1> <AA2> <out.json>    بوابةُ A/A: الحدودُ السبعةُ نفسُها معَ استبدالِ ttfbMs
                                     بـ ttfbResid = ttfbMs − queueWaitMs (فرقُ مدّتينِ بساعةِ
                                     المولّدِ الرتيبةِ الواحدةِ من سطرِ http_call نفسِه — لا ساعةً
                                     أخرى ولا حقولًا جديدة). ttfbMs الخامُ يُعرضُ وصفيًّا لا
                                     يُحذف. valid3(256) للموجتينِ ∧ عتادٌ متطابق.
  q        <AA1> <AA2> <out.json>    كما في RUN3 حرفًا (لا تغيير).
  load     <S1> <N1> <N2> <S2> ...   كما في RUN3 حرفًا (لا تغيير).

مبرّرُ الاستبدالِ (مسجَّلٌ مسبقًا): ttfbMs الخامُ يشملُ انتظارَ المولّدِ نفسِهِ — وهو موضوعُ
السؤالِ q نفسِه — ويتذبذبُ بينَ الموجاتِ معَ تذبذبِ الطلبِ فوقَ 256 (RUN3: ‏−20.72ms)، فخضوعُهُ
للبوابةِ يجعلُها تقيسُ تذبذبَ المولّدِ لا قابليةَ إعادةِ إنتاجِ ما يراهُ الخادم. وttfbResid = زمنُ
الردِّ من لحظةِ الإرسالِ الفعليِّ بعدَ البوابة. ومجالُ صلاحيةِ δ=15 يبقى: متوسطاتُ ttfbResid
الشرطيةُ ≈ 186ms (حُسبت من خامِّ RUN3 نفسِهِ بنطاقِ البوابةِ نفسِهِ) — رتبةُ متوسطاتِ C2
(164–167ms) التي قيستْ لها δ.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("g3", os.path.join(HERE, "gap3-analyze.py"))
g3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(g3)
ga = g3.ga
g2 = g3.g2

DELTA_MS = g3.DELTA_MS
REGISTERED_CAP = g3.REGISTERED_CAP
# الحدودُ المسجَّرةُ: الخمسةُ عندَ الخادمِ + ttfbResid + bodyMs — ttfbMs الخامُ وصفيٌّ لا حدَّ بوابة.
AA4_METRICS = ("fetchMs", "writeHeadMs", "firstWriteMs", "endMs", "finishMs", "ttfbResid", "bodyMs")


class Wave4(g3.Wave3):
    def __init__(self, wave_dir):
        super().__init__(wave_dir)
        for s in self.samples:
            s["ttfbResid"] = ga.diff(s.get("ttfbMs"), s.get("queueWaitMs"))


def mode_aa4(aa1, aa2, out_path):
    with open(os.devnull, "w") as dn:
        old = sys.stdout
        sys.stdout = dn
        try:
            inherited = ga.mode_aa(aa1, aa2, out_path + ".inherited.json")
        finally:
            sys.stdout = old
    w1, w2 = Wave4(aa1), Wave4(aa2)
    v1, v2 = g3.Wave3(aa1).validity3(REGISTERED_CAP), g3.Wave3(aa2).validity3(REGISTERED_CAP)
    hw = g2.hw_compare(sorted(os.path.join(d, f) for d in (aa1, aa2) for f in os.listdir(d)
                              if f.startswith("hw-") and f.endswith(".json")))
    detail, ok = {}, True
    for m in AA4_METRICS:
        m1, n1, _ = w1.conditional_mean(m)
        m2, n2, _ = w2.conditional_mean(m)
        d = None if (m1 is None or m2 is None) else m2 - m1
        enough = n1 >= ga.MIN_SAMPLES and n2 >= ga.MIN_SAMPLES
        rule = "إعادةُ_إنتاجٍ_ضمنَ_±δ" if (d is not None and abs(d) <= DELTA_MS and enough) else "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة"
        if rule != "إعادةُ_إنتاجٍ_ضمنَ_±δ":
            ok = False
        detail[m] = {"AA1": m1, "AA2": m2, "d": d, "n1": n1, "n2": n2, "rule": rule}
    # ttfbMs الخامُ وصفيًّا — يُعرضُ ولا يُحكمُ عليه (شملَ انتظارَ المولّدِ المتذبذب).
    raw = {}
    for m in ("ttfbMs", "queueWaitMs"):
        a1, na1, _ = w1.conditional_mean(m)
        a2, na2, _ = w2.conditional_mean(m)
        raw[m] = {"AA1": a1, "AA2": a2, "n1": na1, "n2": na2, "rule": "وصفيٌّ_فقط"}
    if not hw["identical"]:
        verdict = "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد"
    elif not (v1["valid"] and v2["valid"]):
        verdict = "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN3"
    else:
        verdict = "إعادةُ_إنتاجٍ_ضمنَ_±δ" if ok else "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة"
    passed = verdict == "إعادةُ_إنتاجٍ_ضمنَ_±δ"
    res = {
        "mode": "aa4", "delta_ms": DELTA_MS, "registered_cap": REGISTERED_CAP,
        "aa4_metrics": AA4_METRICS,
        "aa4_detail": detail,
        "replaced": {"ttfbMs": "ttfbResid = ttfbMs − queueWaitMs (فرقُ مدّتينِ بساعةِ المولّدِ من سطرِ http_call نفسِه)"},
        "ttfb_ms_raw_descriptive": raw,
        "inherited_detail": inherited["detail"], "inherited_verdict": inherited["verdict"],
        "validity3": [v1, v2], "hw": hw, "pass": passed, "verdict": verdict,
        "note": "بوابةٌ تشخيصيّةٌ لا اجتيازُ اختبارِ سعة. LOAD-01 = FAIL وLOAD-01M = NOT_MET دونَ تغيير.",
    }
    ga.write(out_path, res)
    return res


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    m = argv[1]
    if m == "aa4" and len(argv) == 5:
        r = mode_aa4(argv[2], argv[3], argv[4])
        raise SystemExit(0 if r["pass"] else 3)
    # q وload وvalid3 وdescribe كما في RUN3 حرفًا — القواعدُ نفسُها بلا تغيير.
    if m == "valid3" and len(argv) == 5:
        return g3.mode_valid3(argv[2], g3._cap_arg(argv[3]), argv[4])
    if m == "q" and len(argv) == 5:
        return g3.mode_q(argv[2], argv[3], argv[4])
    if m == "load" and len(argv) == 7:
        r = g3.mode_load(argv[2], argv[3], argv[4], argv[5], argv[6])
        raise SystemExit(0 if r["pass"] else 3)
    if m == "describe" and len(argv) >= 4:
        return g3.mode_describe(argv[2], argv[3:])
    raise SystemExit(f"USAGE_ERROR {m} argc={len(argv)}\n{__doc__}")


if __name__ == "__main__":
    main(sys.argv)
