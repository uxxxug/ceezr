#!/usr/bin/env python3
"""اختبارُ تحقّقٍ ذاتيٍّ لمحلّلِ تدقيقِ حدودِ المجسّاتِ — عيّنةٌ اصطناعيةٌ بلا شبكةٍ.

يبني موجاتٍ اصطناعيةً (سطورُ http_call + أحداثُ أطوارٍ + سطرُ مئيناتٍ + تقريرُ
موجاتٍ بقيمٍ محسوبةٍ يدويًّا) ثمّ يستدعي المحلّلَ نفسَهُ (subprocess) ويتحقّقُ من:
  1. قصِّ المئيناتِ بنفسِ طريقةِ lib.ts وتدويرِ JavaScript (نصفٌ إلى الأعلى) لا
     تدويرِ بايثونَ المصرفيِّ — بقيمةٍ كسريةٍ عندَ .5.
  2. التطابقِ المركّبِ: المئينانِ + عددُ العيّنةِ (n) مقابلَ سطرِ المئيناتِ النهائيِّ.
  3. مسارِ الخطأِ الفعليِّ: سطرُ فشلٍ شبكيٍّ (حالةٌ 0) يُحتسبُ في العيّنةِ ورموزِها —
     فالفشلُ الشبكيُّ يمرُّ عبرَ httpLatency وhttpCallLog معًا (مسارُ catch داخلَ http()
     يعيدُ نتيجةً لا يرميها).
  4. اكتشافِ التحرّفِ: قيمةُ مجسٍّ محرّفةٌ في التقريرِ تفشِلُ الخروجَ.
  5. ذيلِ أعلى 5% بالمراتبِ (المتعادلاتُ خارجَ الشريحةِ لا تُضمُّ).
  6. صرامةِ المدخلاتِ: لا موجةٌ معثورٌ عليها ⇒ رمزُ خطأٍ؛ والأسطرُ غيرُ القابلةِ
     للقراءةِ تُعَدُّ وتُفشِلُ، لا تُخفى بصمتٍ.
  7. تغطيةِ الأطوارِ: نداءٌ خارجَ أحداثِ الأطوارِ يُفشِلُ الحكمَ.

**عزلُ الحالاتِ السلبيةِ:** كلُّ حالةٍ سلبيةٍ تُبنى في دليلِ مدخلاتٍ مستقلٍّ خاصٍّ بها
(لا يتقاطعُ معَ غيرِها)، وتُخالِفُ شرطًا واحدًا فقط — فنجاحُ الرفضِ يُثبَتُ لكلِّ شرطٍ
على حدةٍ: تحرّفُ المئينِ، اختلافُ n في سطرِ المئيناتِ، اختلافُ عددِ السيناريوهاتِ،
سطرٌ فاسدٌ في ملفِ الأحداثِ، سطرٌ فاسدٌ في ملفِ الأطوارِ، طورٌ مفقودٌ، نداءٌ خارجَ
الأطوارِ.

الاستدعاءُ: PYTHONDONTWRITEBYTECODE=1 python3 analyze-probe-boundary-selftest.py
"""
from __future__ import annotations

import gzip
import json
import math
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "analyze-probe-boundary.py")

T0 = "2026-01-01T00:00:00.000Z"
T_DRAIN = "2026-01-01T00:00:10.000Z"
T_END = "2026-01-01T00:00:20.000Z"
ALL_PHASES = ("start", "drain_start", "end")


def wline(ev):
    return json.dumps(ev, ensure_ascii=False)


def build_wave(root, name, calls, lp_n, p1, p6a, verified=None, phases=ALL_PHASES,
               bad_line=False, bad_phase_line=False, stray_call=None):
    """موجةٌ اصطناعيةٌ في جذرِ مدخلاتٍ خاصٍّ بها: أحداثٌ + أطوارٌ + مئيناتٌ + تقريرٌ.

    verified: عددُ السيناريوهاتِ المتحقّقةِ (الافتراضيُّ: عددُ النداءاتِ)؛
    phases: أيُّ حدودِ الأطوارِ تُكتبُ (لإسقاطِ حدٍّ في حالةِ النقصِ).
    """
    wave_dir = os.path.join(root, "waves", name)
    os.makedirs(wave_dir, exist_ok=True)
    with gzip.open(os.path.join(wave_dir, "load-events.jsonl.gz"), "wt", encoding="utf-8") as f:
        for i, c in enumerate(calls):
            f.write(wline({"event": "http_call", "gen": "genA", "label": "rides_create",
                           "status": c["status"], "elapsedMs": c["elapsedMs"],
                           "requestId": c.get("requestId", f"req-{i}"),
                           "t": c.get("t", T0), "sinceStartMs": 1000 + i * 10}) + "\n")
        if stray_call:
            f.write(wline(stray_call) + "\n")
        if bad_line:
            f.write("هذا سطرٌ غيرُ قابلٍ للقراءةِ\n")
        f.write(wline({"event": "latency_percentiles", "gen": "genA",
                       "rides_create": {"n": lp_n, "p50": 0, "p95": p1, "p99": p6a, "max": 0}}) + "\n")
    with gzip.open(os.path.join(wave_dir, "miniapp-load-events.jsonl.gz"), "wt", encoding="utf-8") as f:
        t = {"start": T0, "drain_start": T_DRAIN, "end": T_END}
        for p in phases:
            f.write(wline({"event": f"phase.{p}", "t": t[p]}) + "\n")
        if bad_phase_line:
            f.write("هذا سطرٌ غيرُ قابلٍ للقراءةِ\n")
        # سيناريوهاتٌ متحقّقةٌ — بعددٍ مستقلٍّ قابلٍّ للتلاعبِ بهِ.
        for _ in range(verified if verified is not None else len(calls)):
            f.write(wline({"event": "scenario.outcome", "kind": "verified"}) + "\n")
    report_dir = os.path.join(root, "summaries", name)
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, "wave-report.json"), "w", encoding="utf-8") as f:
        json.dump({"perf": [{"id": "P1", "value": f"{p1}ms"},
                            {"id": "P6a", "value": f"{p6a}ms"}]}, f)


def run_case(tmp, case, **kw):
    """بناءُ حالةٍ في جذرٍ معزولٍ وتشغيلُ المحلّلِ عليهِ وحدَهُ — يعيدُ (الرمزَ، الموجةَ)."""
    root = os.path.join(tmp, f"case-{case}")
    build_wave(root, case, **kw)
    res = subprocess.run([sys.executable, SCRIPT, os.path.join(root, "waves"),
                          os.path.join(root, "summaries")], capture_output=True, text=True)
    out = json.loads(res.stdout)
    w = {x["wave"]: x for x in out["waves"]}.get(case)
    return res.returncode, w


def main() -> int:
    failures = []

    # 1) تدويرُ JS لا تدويرُ بايثونَ: 452.5 ⇒ 453 (وبايثونَ round ⇒ 452).
    sys.path.insert(0, HERE)
    import importlib.util
    spec = importlib.util.spec_from_file_location("apb", SCRIPT)
    apb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(apb)
    if apb.js_round(452.5) != 453 or round(452.5) == 453:
        failures.append("تدويرُ JS عندَ .5 خاطئٌ أو لا يفارقُ تدويرَ بايثونَ")
    if apb.percentile([1, 2, 3, 4, 5], 0.95) != 5:
        failures.append("قصُّ المئينِ خاطئ")

    # عيّنةٌ: 10 قيمٍ 1..10 ثمّ فشلٌ شبكيٌّ 99.0 — المرتّبةُ 11 قيمةً.
    vals = [float(x) for x in range(1, 11)]
    calls_net0 = [{"status": 200, "elapsedMs": v} for v in vals] + [{"status": 0, "elapsedMs": 99.0}]
    # p95 = p99 = المؤشرُ floor(q·11)=10 ⇒ 99.0 ⇒ مدوّرًا 99.
    with tempfile.TemporaryDirectory() as tmp:
        # 2+3) الحالةُ الصادقةُ: فشلٌ شبكيٌّ (حالةٌ 0) داخلَ العيّنةِ ويُحتسبُ،
        # والتطابقُ المركّبُ يثبتُ (n=11 في السطرِ وفي السيناريوهاتِ).
        rc, w = run_case(tmp, "synth-ok", calls=calls_net0, lp_n=11, p1=99, p6a=99)
        if rc != 0:
            failures.append(f"رمزُ خروجٍ غيرُ متوقعٍ للحالةِ الصادقةِ: {rc}")
        if w["n_rides_create_calls"] != 11 or w["status_all"].get("0") != 1:
            failures.append(f"الفشلُ الشبكيُّ (حالةٌ 0) لم يُحتسب: {w['status_all']}")
        if not w["report_precision_match"] or not w["n_matches_lp_row"] \
                or not w["n_matches_verified_scenarios"]:
            failures.append(f"التطابقُ المركّبُ لم يُثبَت: {w}")

        # 5) الذيلُ بالمراتبِ: آخرُ 5% من 11 = سطرٌ واحدٌ (القيمةُ 99.0، حالةٌ 0).
        if w["top5_status"] != {"0": 1} or w["top5_elapsed_range_ms"] != [99.0, 99.0]:
            failures.append(f"ذيلُ المراتبِ خاطئٌ: {w['top5_status']}")

        # المتعادلاتُ: 10 قيمٍ متعادلةٍ عندَ 10.0 ⇒ الذيلُ سطرٌ واحدٌ فقط (لا كلُّ العشرةِ).
        calls_tie = [{"status": 200, "elapsedMs": v} for v in vals] + [{"status": 0, "elapsedMs": 10.0}]
        rc, wt = run_case(tmp, "synth-tie", calls=calls_tie, lp_n=11, p1=10, p6a=10)
        if rc != 0 or sum(wt["top5_status"].values()) != 1:
            failures.append(f"المتعادلاتُ خارجَ الشريحةِ ضُمّت: {wt['top5_status']}")

        # 4) التحرّفُ يُكتشفُ — الشرطُ المخالَفُ وحدَهُ: المئينُ المحرّفُ في التقريرِ.
        calls10 = [{"status": 200, "elapsedMs": v} for v in vals]
        rc, wb = run_case(tmp, "synth-badp95", calls=calls10, lp_n=10, p1=11, p6a=10)
        if rc == 0 or not wb or wb["report_precision_match"] \
                or wb["P1_report_ms"] - wb["p95_recomputed_ms"] != 1 \
                or not wb["n_matches_lp_row"] or not wb["n_matches_verified_scenarios"]:
            failures.append(f"التحرّفُ لم يُقَسْ أو خالطَهُ شرطٌ آخرُ: {wb}")

        # اختلافُ n في سطرِ المئيناتِ وحدَهُ (11 نداءً مقابلَ lp_n=10).
        rc, wn = run_case(tmp, "synth-lpn", calls=calls_net0, lp_n=10, p1=99, p6a=99)
        if rc == 0 or not wn or wn["n_matches_lp_row"] or not wn["report_precision_match"] \
                or not wn["n_matches_verified_scenarios"]:
            failures.append(f"اختلافُ lp_n لم يُرفَضْ وحدهُ: {wn}")

        # اختلافُ عددِ السيناريوهاتِ وحدَهُ (11 نداءً و11 في السطرِ مقابلَ 10 متحقّقةٍ).
        rc, wv = run_case(tmp, "synth-scn", calls=calls_net0, lp_n=11, p1=99, p6a=99, verified=10)
        if rc == 0 or not wv or wv["n_matches_verified_scenarios"] \
                or not wv["n_matches_lp_row"] or not wv["report_precision_match"]:
            failures.append(f"اختلافُ السيناريوهاتِ لم يُرفَضْ وحدهُ: {wv}")

        # 6) سطرٌ فاسدٌ في ملفِ الأحداثِ يُعَدُّ ويُفشِلُ — وحدَهُ.
        rc, wbl = run_case(tmp, "synth-badline", calls=calls10, lp_n=10, p1=10, p6a=10,
                           bad_line=True)
        if rc == 0 or not wbl or wbl["unreadable_lines"] != 1 \
                or not wbl["report_precision_match"] or not wbl["n_matches_lp_row"]:
            failures.append(f"السطرُ الفاسدُ في الأحداثِ لم يُرفَضْ وحدهُ: {wbl}")

        # سطرٌ فاسدٌ في ملفِ الأطوارِ يُعَدُّ ويُفشِلُ — وحدَهُ.
        rc, wpl = run_case(tmp, "synth-badphaseline", calls=calls10, lp_n=10, p1=10, p6a=10,
                           bad_phase_line=True)
        if rc == 0 or not wpl or wpl["unreadable_phase_lines"] != 1 \
                or not wpl["report_precision_match"] or not wpl["n_matches_lp_row"]:
            failures.append(f"السطرُ الفاسدُ في الأطوارِ لم يُرفَضْ وحدهُ: {wpl}")

        # طورٌ مفقودٌ (phase.end) يُفشِلُ — وحدَهُ.
        rc, wph = run_case(tmp, "synth-nophaseend", calls=calls10, lp_n=10, p1=10, p6a=10,
                           phases=("start", "drain_start"))
        if rc == 0 or not wph or wph["phases_present"] or wph["phases_ordered"] \
                or not wph["report_precision_match"] or not wph["n_matches_lp_row"]:
            failures.append(f"الطورُ المفقودُ لم يُرفَضْ وحدهُ: {wph}")

        # 7) نداءٌ خارجَ أحداثِ الأطوارِ يُفشِلُ تغطيةَ الأطوارِ — وحدَهُ (n متطابقٌ
        # في السطرِ والسيناريوهاتِ والمئينانِ صادقانِ).
        stray = {"event": "http_call", "gen": "genA", "label": "rides_create", "status": 200,
                 "elapsedMs": 99.0, "requestId": "late", "t": "2026-01-01T01:00:00.000Z",
                 "sinceStartMs": 999999}
        # 12 نداءً في الملفِ (11 داخلَ الأطوارِ + الخارجُ عنها بقيمةِ 99.0) —
        # المرتّبةُ: 1..10 ثمّ 99.0، 99.0 ⇒ المئينانِ (المؤشرُ floor(q·12)=11) = 99 —
        # وlp_n=12 والسيناريوهاتُ 12 فلا يخالفُ إلا شرطَ الأطوارِ.
        calls_stray = [{"status": 200, "elapsedMs": v} for v in vals] + [{"status": 200, "elapsedMs": 99.0}]
        rc, ws = run_case(tmp, "synth-stray", calls=calls_stray, lp_n=12, p1=99, p6a=99,
                          verified=12, stray_call=stray)
        if rc == 0 or not ws or ws["phase_coverage"]["outside_phases"] != 1 \
                or ws["phases_cover_sample"] or not ws["n_matches_lp_row"] \
                or not ws["n_matches_verified_scenarios"] or not ws["report_precision_match"]:
            failures.append(f"النداءُ الخارجُ عنِ الأطوارِ لم يُرفَضْ وحدهُ: {ws}")

        # 6ب) لا موجةٌ معثورٌ عليها ⇒ رمزُ خطأٍ.
        empty = os.path.join(tmp, "case-empty", "waves")
        os.makedirs(empty, exist_ok=True)
        res = subprocess.run([sys.executable, SCRIPT, empty, empty], capture_output=True, text=True)
        if res.returncode != 3:
            failures.append("المدخلاتُ الفارغةُ لم تُرفَض")

    if failures:
        for f in failures:
            print(f"✗ {f}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
