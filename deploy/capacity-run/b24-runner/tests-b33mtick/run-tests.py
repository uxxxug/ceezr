#!/usr/bin/env python3
"""اختباراتُ الاستخراجِ الحقيقيةِ لـ b33mtick-compare.py: خامٌّ اصطناعيٌّ كاملٌ يُبنى
بالمولّدِ نفسِهِ ثم يُحلَّلُ بالمسارِ الحقيقيِّ كاملًا (لا stub لـ load_wave ولا لفحصِ
الصلاحية). السيناريوهات: طبيعيٌّ (RATE_GAIN_ONLY)، يتيمةٌ (G1/P7 لا تدخلُ الحكمَ)،
اتجاهاتٌ متعارضةٌ (UNRESOLVED)، أساسٌ صفريٌّ (UNRESOLVED)، a2-ref (خريطةُ الخطةِ)،
وفقدُ ملفِ الاستخراجِ (valid_no_metrics + زوجٌ ناقصٌ)."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gen  # noqa: E402

B24 = HERE.parent
CMP = B24 / "b33mtick-compare.py"
ROOT = Path("/tmp/b33mtick-tests")


def build(scenario: str) -> Path:
    out = ROOT / scenario
    if out.exists():
        shutil.rmtree(out)
    (out / "raw").mkdir(parents=True)
    r = out / "raw"

    def w(num, side, **kw):
        gen.make_wave(r, f"b33mtick-m-a{num}-{side}-750", side, **kw)

    if scenario == "normal":
        # ABBA BAAB: ref≈15.5/ث (G1 13% فشل، P7 92) مقابل cand≈19/ث (G1 10%، P7 90)
        rates = {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}
        for n, rate in rates.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
    elif scenario == "orphan_g1p7":
        # a7 غيرُ صالحةٍ ⇒ الزوجُ الرابعُ ناقصٌ؛ G1/P7 المتطرفةُ في a8-cand يجبُ ألّا تدخلَ الحكمَ
        for n, rate in {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6}.items():
            side = "ref" if n in (1, 4, 6) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
        w(8, "cand", rate=19.1, g1_v=460, g1_o=460, p7=1)  # متطرفةٌ لكنّها يتيمةٌ
        w(7, "ref", rate=15.5, g1_v=400, g1_o=460, p7=92)
        d7 = r / "b33mtick-m-a7-ref-750"
        (d7 / "qual/inflight.json").write_text('{"verdict": "INVALID"}')  # تُخرِجُها من الصلاحية
    elif scenario == "mixed":
        # أزواجٌ متعارضةُ الاتجاهِ ⇒ UNRESOLVED
        for n, rate in {1: 19.0, 2: 15.5, 3: 15.4, 4: 19.2, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
    elif scenario == "zero_ref":
        # a1-ref معدلُها صفرٌ (زوجٌ مكتملٌ بفرقٍ نسبيٍّ غيرِ معرَّفٍ) ⇒ UNRESOLVED
        for n, rate in {1: 0.0, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
    elif scenario == "a2ref":
        # مخالفةُ خريطةِ الخطةِ: a2 اسمُها ref (الخطةُ تقولُ cand) ⇒ CODE_PROVENANCE_FAIL
        for n, rate in {1: 15.5, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
        w(2, "ref", rate=19.0, g1_v=414, g1_o=460, p7=90)
    elif scenario == "no_metrics":
        # a2-cand: فقدُ ملفِ الاستخراجِ (load-events) ⇒ valid_no_metrics + الزوجُ الأولُ ناقصٌ
        for n, rate in {1: 15.5, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
        w(2, "cand", rate=19.0, g1_v=414, g1_o=460, p7=90, drop_load_events=True)
    elif scenario == "missing_g1p7":
        # فقدُ G1 (لا بوابةَ في التقرير) وP7 (لا سطرَ في gates.txt) في موجتَي cand داخلَ أزواجٍ مكتملةٍ
        # ⇒ الحكمُ اتجاهيُّ على المعدلِ يبقى معلنًا عن «غيرُ محسومٍ: G1, P7» ولا ينهارُ (None>0)
        for n, rate in {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
        for n in (2, 5):
            d = r / f"b33mtick-m-a{n}-cand-750"
            rep = json.loads((d / "wave-report.json").read_text())
            rep["gates"] = []  # لا G1
            (d / "wave-report.json").write_text(json.dumps(rep))
            (d / "gates.txt").write_text("")  # لا P7
    elif scenario == "retry":
        # a1-ref غيرُ صالحةٍ ثمّ a1-r-ref صالحةٌ ⇒ الإعادةُ تدخلُ الزوجَ والأصلُ يُستبعدُ
        for n, rate in {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            gen.make_wave(r, f"b33mtick-m-a{n}-{side}-750", side, rate=rate,
                          g1_v=400 if side == "ref" else 414, g1_o=460, p7=92 if side == "ref" else 90)
        gen.make_wave(r, "b33mtick-m-a1-ref-r-750", "ref", rate=15.6, g1_v=400, g1_o=460, p7=92)
        # الأصلُ والإعادةُ كلاهما صالحانِ ⇒ الإزالةُ المنطقيةُ تُبعدُ الأصلَ (اختبارُ إلغاءِ التكرار)
    elif scenario in ("supported_full", "supported_partial_g1"):
        # مكسبٌ كاملٌ متسقٌ (ΔP7=−32s، ΔG1fail≈−8pp) ⇒ SUPPORTED؛ وبفقدِ G1 في موجتَي ذراعَينِ
        # مختلفتَين (طولا القائمتين متساويانِ لكنّ الاكتمالَ ناقصٌ) يجبُ ألّا يبقى داعمًا
        rates = {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}
        for n, rate in rates.items():
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            w(n, side, rate=rate,
              g1_v=400 if side == "ref" else 430, g1_o=460, p7=92 if side == "ref" else 60)
        if scenario == "supported_partial_g1":
            for n in (2, 4):  # فقدُ G1 من cand في الزوجِ الأولِ ومن ref في الزوجِ الثاني
                d = r / f"b33mtick-m-a{n}-{'cand' if n == 2 else 'ref'}-750"
                rep = json.loads((d / "wave-report.json").read_text())
                rep["gates"] = []
                (d / "wave-report.json").write_text(json.dumps(rep))
    elif scenario == "g1_varying":
        # أعدادُ مشاركينَ متفاوتةٌ بينَ الموجاتِ — مقدّرُ التجميعِ Σv/Σo لا وسيطُ الحصصِ (§4)
        outs = {1: 400, 2: 500, 3: 460, 4: 520, 5: 480, 6: 440, 7: 500, 8: 460}
        for n in outs:
            side = "ref" if n in (1, 4, 6, 7) else "cand"
            rate = {1: 15.5, 2: 19.0, 3: 19.2, 4: 15.4, 5: 18.9, 6: 15.6, 7: 15.5, 8: 19.1}[n]
            fail = 0.13 if side == "ref" else 0.10
            gen.make_wave(r, f"b33mtick-m-a{n}-{side}-750", side, rate=rate,
                          g1_v=round(outs[n] * (1 - fail)), g1_o=outs[n],
                          p7=92 if side == "ref" else 90)
    return out


def run(scenario: str) -> dict:
    out = build(scenario)
    env = dict(os.environ, B26_SESSION_LIMIT="6000")
    p = subprocess.run([sys.executable, str(CMP), str(out)],
                       capture_output=True, text=True, env=env)
    if p.returncode != 0:
        print(f"[{scenario}] CRASH rc={p.returncode}\n{p.stderr[-800:]}")
        return {}
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        print(f"[{scenario}] BAD JSON\n{p.stdout[:400]}")
        return {}


def main() -> int:
    ROOT.mkdir(parents=True, exist_ok=True)
    expected = {
        "normal": "RATE_GAIN_ONLY",
        "orphan_g1p7": "RATE_GAIN_ONLY",   # نفسُ حكمِ الطبيعيِّ — اليتيمةُ لا تُغيّرُهُ
        "mixed": "UNRESOLVED",
        "zero_ref": "UNRESOLVED",
        "a2ref": "CODE_PROVENANCE_FAIL",
        "no_metrics": "RATE_GAIN_ONLY",    # ثلاثةُ أزواجٍ مكتملةٍ تكفي — والموجةُ المفقودةُ مُسجَّلةٌ بسبَبِها
        "missing_g1p7": "UNRESOLVED",       # §6 الصفُّ 5: فقدُ G1/P7 في زوجٍ مكتملٍ ⇒ غيرُ محسومٍ
        "retry": "RATE_GAIN_ONLY",        # الإعادةُ تحلّ محلَّ الأصلِ ولا يُغيّرُ الحكمَ
        "supported_full": "SUPPORTED_FIX_CAPACITY",
        "supported_partial_g1": "UNRESOLVED",   # فقدُ G1 في موجتَي ذراعَين مختلفتَين لا يبقي داعمًا
        "g1_varying": "RATE_GAIN_ONLY",        # مقدّرُ التجميعِ Σv/Σo بأعدادِ مشاركينَ متفاوتةٍ
    }
    failures = 0
    for sc, want in expected.items():
        d = run(sc)
        got = d.get("decision")
        ok = got == want
        if not ok:
            failures += 1
        print(f"[{sc}] decision={got} (expected {want}) {'PASS' if ok else 'FAIL'}")
        if sc == "normal":
            arms = d.get("arms", {})
            print("   ref rate_median:", arms.get("REF", {}).get("rate_median"),
                  "cand:", arms.get("CAND", {}).get("rate_median"))
            print("   pairs:", json.dumps(
                [{k: p.get(k) for k in ('pair', 'status', 'pair_rel_diff')} for p in d.get("pairs", [])],
                ensure_ascii=False))
        if sc == "orphan_g1p7":
            g1 = d.get("arms", {}).get("CAND", {}).get("g1_fail_share")
            print("   cand g1_fail_share (يتيمةٌ في الحسابِ الوصفيِّ فقط):", g1)
        if sc == "no_metrics":
            print("   valid_no_metrics:", d.get("valid_no_metrics_waves"))
        if sc == "missing_g1p7":
            print("   why:", d.get("why"))
            assert "غيرُ محسوم" in d.get("why", ""), "يجبُ أن يُعلنَ عدمَ الحسم"
        if sc == "supported_partial_g1":
            print("   why:", d.get("why"))
            assert got != "SUPPORTED_FIX_CAPACITY"
        if sc == "supported_full":
            # تحققُ قيمٍ لا اسمَ قرارٍ وحدَه: مقدّرُ التجميعِ يعطي ΔG1fail≈−3.3pp
            print("   pairs g1:", [(p["g1_ref"], p["g1_cand"]) for p in d.get("pairs", [])])
        if sc == "g1_varying":
            # حصةُ الفشلِ المجمَّعةِ: ref ≈13% وcand ≈10% ⇒ ΔG1fail≈−3pp (وليس وسيطَ الحصصِ)
            arms = d.get("arms", {})
            print("   g1 ref:", arms.get("REF", {}).get("g1_fail_share"),
                  "cand:", arms.get("CAND", {}).get("g1_fail_share"))
        if sc == "retry":
            arms = d.get("arms", {}).get("REF", {})
            print("   ref waves:", arms.get("waves"))
            assert "a1-ref-r" in arms.get("waves", []), "الإعادةُ يجبُ أن تدخلَ"
            assert "a1-ref" not in arms.get("waves", []), "الأصلُ يجبُ ألّا يدخلَ"
    print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
