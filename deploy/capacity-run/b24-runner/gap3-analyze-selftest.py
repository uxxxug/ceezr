#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لـgap3-analyze.py على موجاتٍ صناعيّةٍ بصيغِ الأداةِ الحقيقيّة (RUN3).
يُشغَّلُ قبلَ أيِّ موجةٍ في المقعد؛ أيُّ إخفاقٍ = لا موجة. يرثُ مولّدَ موجاتِ gap2-analyze-selftest.py
ويضيفُ حقولَ البوابةِ (queueWaitMs/waitersAtInvoke/activeAtSend/demandAtInvoke/fetchCap) وسطورَ gen_sem،
ويتحقّقُ من قواعدِ q وload وaa3 المسجّلةِ مسبقًا على حالاتٍ معروفةِ النتيجة، ومن رفضِ المدخلاتِ الفاسدة."""
import contextlib
import importlib.util
import io
import json
import os
import random
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fn))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


g3 = _load("g3", "gap3-analyze.py")
st2 = _load("st2", "gap2-analyze-selftest.py")
T0, INJ_MS, DRAIN_MS = st2.T0, st2.INJ_MS, st2.DRAIN_MS


def make_wave3(root, name, cap=256, seed=1, queue_extra=150.0, wait_share=1.0, few_d=False,
               env_cap="same", row_cap="same", active_over=False, drop_wait=0, sem_gap=False,
               rate=40, corrupt_events=False, **kw):
    d = st2.make_wave2(root, name, seed=seed, **kw)
    rng = random.Random(seed + 2000)
    i = [0]

    def client(rows):
        out = []
        for r in rows:
            if r.get("event") == "http_call":
                k = i[0]
                i[0] += 1
                inflight = (300 if k % 50 == 0 else 100) if few_d else 100 + (k % 400)
                r["inflightAtInvoke"] = inflight
                extra = queue_extra if inflight > 256 else 0.0
                wait = extra * wait_share
                if cap is None:
                    wait = 0.0
                r["ttfbMs"] = round(r["ttfbMs"] + extra, 2)
                r["elapsedMs"] = round(r["elapsedMs"] + extra, 2)
                r["queueWaitMs"] = None if k < drop_wait else round(wait, 2)
                r["waitersAtInvoke"] = 0 if wait == 0 else 1 + int(rng.random() * 50)
                act = inflight if cap is None else min(cap, inflight)
                r["activeAtSend"] = cap + 1 if (active_over and k == 3) else act
                r["demandAtInvoke"] = inflight
                r["fetchCap"] = cap if row_cap == "same" else row_cap
            elif r.get("event") == "gen_env":
                r["fetchCap"] = cap if env_cap == "same" else env_cap
                r["fetchCapEnv"] = None if r["fetchCap"] is None else str(r["fetchCap"])
            out.append(r)
        for s in range(0, INJ_MS + DRAIN_MS, 1000):
            if sem_gap and 30_000 <= s < 60_000:
                continue
            out.append({"event": "gen_sem", "at": T0 + s + 700, "cap": cap, "invokes": rate, "sends": rate,
                        "completions": rate, "aborted": 0, "activeNow": 10, "activeMax": 256 if cap else 300,
                        "waitersNow": 0, "waitersMax": 40 if cap else 0, "waitSumMs": 100.0 if cap else 0.0,
                        "waitMaxMs": 30.0 if cap else 0.0, "waitedSends": 5 if cap else 0})
        return out

    st2._rw(os.path.join(d, "load-events.jsonl"), client)
    if corrupt_events:
        with open(os.path.join(d, "load-events.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"event":"gen_sem", broken\n')
    st2.write_hw(d, "pre")
    st2.write_hw(d, "post")
    return d


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
        # 1) الصلاحية
        v = g3.Wave3(make_wave3(root, "s")).validity3(256)
        check(v["valid"] and v["run3"]["active_max"] <= 256, f"موجةُ سيمافورٍ سليمةٌ صالحة ({v['reasons']})")
        v = g3.Wave3(make_wave3(root, "n", cap=None)).validity3(None)
        check(v["valid"], f"موجةٌ بلا سعةٍ صالحةٌ بتوقّعِ None ({v['reasons']})")
        check(not g3.Wave3(make_wave3(root, "n2", cap=None)).validity3(256)["valid"], "موجةٌ بلا سعةٍ تُرفضُ إن سُجّلت 256")
        check(not g3.Wave3(make_wave3(root, "ec", env_cap=512)).validity3(256)["valid"], "gen_env بسعةٍ غيرِ المسجّلةِ يُبطل")
        check(not g3.Wave3(make_wave3(root, "rc", row_cap=None)).validity3(256)["valid"], "fetchCap في http_call ≠ المسجّلةِ يُبطل")
        check(not g3.Wave3(make_wave3(root, "ao", active_over=True)).validity3(256)["valid"], "جارٍ يتجاوزُ السعةَ يُبطل")
        r = g3.Wave3(make_wave3(root, "dw", drop_wait=2)).validity3(256)
        check(not r["valid"] and r["run3"]["missing_new_fields"]["queueWaitMs"] == 2, "queueWaitMs ناقصٌ يُبطل")
        check(not g3.Wave3(make_wave3(root, "sg", sem_gap=True)).validity3(256)["valid"], "ثغرةُ gen_sem في الحقنِ تُبطل")
        check(not g3.Wave3(make_wave3(root, "ce", corrupt_events=True)).validity3(256)["valid"], "سطرٌ مكسورٌ في load-events يُبطل")
        check(not g3.Wave3(make_wave3(root, "dg", drop_gap=5)).validity3(256)["valid"], "فقدُ ربطٍ (موروث) يُبطل")
        check(not g3.Wave3(make_wave3(root, "ns", drop_new_server=1)).validity3(256)["valid"], "حقلُ RUN2 ناقصٌ (موروث) يُبطل")
        # 2) q — السؤالُ الوحيد
        a, b = make_wave3(root, "qa", seed=7), make_wave3(root, "qb", seed=8)
        q = quiet(g3.mode_q, a, b, R("q1.json"))
        check(q["verdict"] == "الانتظارُ_في_المولّدِ_يفسّرُ_الفجوة" and all(p["status"] == "EXPLAINED" for p in q["per_wave"]),
              f"الزيادةُ كلُّها انتظارٌ مقيسٌ ⇒ يفسّر ({[p['status'] for p in q['per_wave']]})")
        p0 = q["per_wave"][0]
        check(abs(p0["U_head_mean_D"] - p0["U_head_mean_N"] - 150) < 5 and p0["wait_share_of_U_head_D"] > 0.9,
              "U_head في D يحملُ الزيادةَ والانتظارُ يغطّيها")
        a, b = make_wave3(root, "ea", seed=7, wait_share=0.0), make_wave3(root, "eb", seed=8, wait_share=0.0)
        q = quiet(g3.mode_q, a, b, R("q2.json"))
        check(q["verdict"] == "الاختناقُ_في_مكانٍ_آخر", "الزيادةُ بلا انتظارٍ مقيسٍ ⇒ في مكانٍ آخر")
        a, b = make_wave3(root, "pa", seed=7, wait_share=0.5), make_wave3(root, "pb", seed=8, wait_share=0.5)
        q = quiet(g3.mode_q, a, b, R("q3.json"))
        check(q["verdict"] == "الاختناقُ_في_مكانٍ_آخر" and q["per_wave"][0]["resid_gap_D_minus_N"] > 15,
              "نصفُ الزيادةِ خارجَ البوابة (> δ) ⇒ يبقى جزءٌ في مكانٍ آخر")
        a, b = make_wave3(root, "ua", seed=7, queue_extra=10.0, wait_share=0.3), make_wave3(root, "ub", seed=8, queue_extra=10.0, wait_share=0.3)
        q = quiet(g3.mode_q, a, b, R("q4.json"))
        check(q["verdict"] == "غيرُ_محسوم" and q["per_wave"][0]["status"] == "UNRESOLVED",
              "متبقٍّ ≤ δ لكنَّ الانتظارَ < 80% ⇒ غيرُ محسوم")
        a, b = make_wave3(root, "ma", seed=7), make_wave3(root, "mb", seed=8, wait_share=0.0)
        check(quiet(g3.mode_q, a, b, R("q5.json"))["verdict"] == "غيرُ_محسوم", "موجتانِ متعارضتان ⇒ غيرُ محسوم")
        a, b = make_wave3(root, "fa", seed=7, few_d=True, queue_extra=0.0), make_wave3(root, "fb", seed=8, few_d=True, queue_extra=0.0)
        q = quiet(g3.mode_q, a, b, R("q6.json"))
        check(q["per_wave"][0]["status"] == "INSUFFICIENT" and q["verdict"] == "غيرُ_محسوم", "طبقةُ D < 200 ⇒ غيرُ كافية")
        a, b = make_wave3(root, "va", seed=7), make_wave3(root, "vb", seed=8, drop_wait=1)
        check(quiet(g3.mode_q, a, b, R("q7.json"))["verdict"] == "غيرُ_صالحٍ_صلاحيةُ_RUN3", "صلاحيةٌ ناقصةٌ ⇒ لا حكمَ في q")
        # 3) load — تكافؤُ الحمل
        s1, n1, n2, s2 = (make_wave3(root, "l" + k, seed=i, cap=(256 if k[0] == "s" else None))
                          for i, k in enumerate(("s1", "n1", "n2", "s2"), start=20))
        r = quiet(g3.mode_load, s1, n1, n2, s2, R("l1.json"))
        check(r["pass"] and r["rates"]["S1"]["cap"] == 256 and r["rates"]["N1"]["cap"] is None, f"معدّلاتٌ متساويةٌ ⇒ متكافئ ({r['verdict']})")
        s1b = make_wave3(root, "ls1b", seed=20, rate=36)
        r = quiet(g3.mode_load, s1b, n1, n2, s2, R("l2.json"))
        check(not r["pass"] and r["verdict"] == "الحملُ_تغيّر", "معدّلُ إرسالٍ أقلُّ بـ10% ⇒ الحملُ تغيّر")
        s1c = make_wave3(root, "ls1c", seed=20, rate=41)
        check(quiet(g3.mode_load, s1c, n1, n2, s2, R("l3.json"))["pass"], "فرقُ 2.5% ضمنَ ±5%")
        r = quiet(g3.mode_load, s1, n1, make_wave3(root, "ln2x", seed=22, cap=256), s2, R("l4.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحٍ_صلاحيةُ_RUN3", "موجةُ N بسعةٍ مفعولةٍ ⇒ غيرُ صالح")
        # 4) aa3
        a, b = make_wave3(root, "aa1", seed=7), make_wave3(root, "aa2", seed=8)
        r = quiet(g3.mode_aa3, a, b, R("aa.json"))
        check(r["pass"] and r["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ", f"A/A بسيمافورٍ متطابقٍ ⇒ يُجاز ({r['verdict']})")
        r = quiet(g3.mode_aa3, a, make_wave3(root, "aa3", seed=8, extra_residual=30.0), R("aab.json"))
        check(not r["pass"] and r["verdict"] == "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة", "A/A بفرقِ ttfb > δ ⇒ توقف")
        r = quiet(g3.mode_aa3, a, make_wave3(root, "aa4", seed=8, cap=None), R("aac.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN3", "AA2 بلا سعةٍ ⇒ غيرُ صالحة")
        w5 = make_wave3(root, "aa5", seed=8)
        st2.write_hw(w5, "x", cpu_model="Intel Xeon 8370C")
        r = quiet(g3.mode_aa3, a, w5, R("aad.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد", "عتادٌ مختلفٌ ⇒ غيرُ صالحة")
        # 5) الوصفيّ
        d = quiet(g3.mode_describe, R("desc.json"), [make_wave3(root, "d1"), make_wave3(root, "d2", cap=None, wait_share=0.0)])
        hi = d["waves"][0]["run3"]["strata_inflightAtInvoke"][">256"]
        check(d["descriptive_only"] and hi["queueWaitMs"]["mean"] > 140 and abs(hi["U_resid"]["mean"]) < 10,
              "الوصفيُّ يعرضُ الانتظارَ والمتبقّي في الطبقة")
        check(d["waves"][1]["run3"]["cap"] is None and d["waves"][1]["run3"]["rates"]["waited_sends_share"] == 0,
              "الوصفيُّ يعرضُ موجةَ N بلا سعةٍ ولا انتظار")
    print("GAP3_ANALYZER_SELFTEST_OK")


if __name__ == "__main__":
    main()
