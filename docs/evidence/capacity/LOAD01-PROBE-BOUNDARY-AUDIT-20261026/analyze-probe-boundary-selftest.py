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

الاستدعاءُ: python3 analyze-probe-boundary-selftest.py
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


def wline(ev):
    return json.dumps(ev, ensure_ascii=False)


def build_wave(tmp, name, calls, lp_n, p1, p6a, bad_line=False, stray_call=None):
    """موجةٌ اصطناعيةٌ: سطورُ http_call + أحداثُ أطوارٍ + سطرُ مئيناتٍ نهائيٌّ + تقريرٌ."""
    wave_dir = os.path.join(tmp, name)
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
        f.write(wline({"event": "phase.start", "t": T0}) + "\n")
        f.write(wline({"event": "phase.drain_start", "t": T_DRAIN}) + "\n")
        f.write(wline({"event": "phase.end", "t": T_END}) + "\n")
        # كلُّ نداءٍ في العيّنةِ سيناريو متحقّقٌ واحدٌ (الطريقُ الثالثُ للتحققِ المركّبِ)
        for i in range(len(calls)):
            f.write(wline({"event": "scenario.outcome", "kind": "verified"}) + "\n")
    report_dir = os.path.join(tmp, "summaries", name)
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, "wave-report.json"), "w", encoding="utf-8") as f:
        json.dump({"perf": [{"id": "P1", "value": f"{p1}ms"},
                            {"id": "P6a", "value": f"{p6a}ms"}]}, f)


def run(waves_dir, summaries_dir):
    return subprocess.run([sys.executable, SCRIPT, waves_dir, summaries_dir],
                          capture_output=True, text=True)


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

    # عيّنةٌ: 10 قيمٍ 1..10 (أطوارُ داخلَ الحقنِ) — القيمُ اليدويّةُ:
    # p95 = المؤشرُ floor(9.5)=9 ⇒ 10؛ p99 = المؤشرُ 9 ⇒ 10.
    vals = [float(x) for x in range(1, 11)]
    p95 = vals[math.floor(0.95 * 10)]

    with tempfile.TemporaryDirectory() as tmp:
        calls = [{"status": 200, "elapsedMs": v} for v in vals]
        # 3) فشلٌ شبكيٌّ (حالةٌ 0) داخلَ العيّنةِ — يُحتسبُ.
        # المرتّبةُ: 1..10 ثمّ 99.0 ⇒ المئينانِ (المؤشرُ floor(q·11)=10) = 99.0
        calls_net0 = calls + [{"status": 0, "elapsedMs": 99.0}]
        build_wave(tmp, "synth-ok", calls_net0, lp_n=11, p1=99, p6a=99)
        res = run(tmp, os.path.join(tmp, "summaries"))
        out = json.loads(res.stdout)
        w = {x["wave"]: x for x in out["waves"]}["synth-ok"]
        if res.returncode != 0:
            failures.append(f"رمزُ خروجٍ غيرِ متوقعٍ للموجةِ الصادقةِ: {res.returncode}")
        if w["n_rides_create_calls"] != 11 or w["status_all"].get("0") != 1:
            failures.append(f"الفشلُ الشبكيُّ (حالةٌ 0) لم يُحتسب: {w['status_all']}")
        if not w["report_precision_match"] or not w["n_matches_lp_row"]:
            failures.append(f"التطابقُ المركّبُ لم يُثبَت: {w}")
        # 5) الذيلُ بالمراتبِ: آخرُ 5% من 11 = سطرٌ واحدٌ (القيمةُ 99.0، حالةٌ 0).
        if w["top5_status"] != {"0": 1} or w["top5_elapsed_range_ms"] != [99.0, 99.0]:
            failures.append(f"ذيلُ المراتبِ خاطئٌ: {w['top5_status']}")
        # المتعادلاتُ: 10 قيمٍ متعادلةٍ عندَ 10.0 ⇒ الذيلُ سطرانِ فقط (لا كلُّ العشرةِ).
        calls_tie = [{"status": 200, "elapsedMs": v} for v in vals] + [{"status": 0, "elapsedMs": 10.0}]
        build_wave(tmp, "synth-tie", calls_tie, lp_n=11, p1=10, p6a=10)
        out = json.loads(run(tmp, os.path.join(tmp, "summaries")).stdout)
        wt = {x["wave"]: x for x in out["waves"]}["synth-tie"]
        # عتبةُ >= كانت ستُضمُّ المتعادلاتِ العشرةَ كلَّها؛ المراتبُ تقتطعُ سطرًا واحدًا.
        if sum(wt["top5_status"].values()) != 1:
            failures.append(f"المتعادلاتُ خارجَ الشريحةِ ضُمّت: {wt['top5_status']}")

        # 4) التحرّفُ يُكتشفُ ويُفشِلُ الخروجَ.
        build_wave(tmp, "synth-bad", calls, lp_n=10, p1=11, p6a=10)
        res = run(tmp, os.path.join(tmp, "summaries"))
        out = json.loads(res.stdout)
        if res.returncode == 0 or out.get("all_waves_match_at_report_precision"):
            failures.append("التحرّفُ لم يُفشِلِ الخروجَ")
        wb = {x["wave"]: x for x in out["waves"]}.get("synth-bad")
        if wb and (wb["report_precision_match"] or wb["P1_report_ms"] - wb["p95_recomputed_ms"] != 1):
            failures.append(f"التحرّفُ لم يُقَس: {wb['P1_report_ms']}, {wb['p95_recomputed_ms']}")

        # 6) لا موجةٌ معثورٌ عليها ⇒ رمزُ خطأٍ.
        empty = os.path.join(tmp, "empty")
        os.makedirs(empty, exist_ok=True)
        if run(empty, os.path.join(tmp, "summaries")).returncode != 3:
            failures.append("المدخلاتُ الفارغةُ لم تُرفَض")

        # 6ب) سطرٌ غيرُ قابلٍ للقراءةِ يُعَدُّ ويُفشِلُ.
        build_wave(tmp, "synth-badline", calls, lp_n=10, p1=10, p6a=10, bad_line=True)
        res = run(tmp, os.path.join(tmp, "summaries"))
        out = json.loads(res.stdout)
        wbl = {x["wave"]: x for x in out["waves"]}.get("synth-badline")
        if res.returncode == 0 or not wbl or wbl["unreadable_lines"] != 1:
            failures.append("السطرُ غيرُ القابلِ للقراءةِ لم يُعَدْ أو لم يُفشِلِ")

        # 7) نداءٌ خارجَ أحداثِ الأطوارِ يُفشِلُ تغطيةَ الأطوارِ.
        stray = {"event": "http_call", "gen": "genA", "label": "rides_create", "status": 200,
                 "elapsedMs": 5.0, "requestId": "late", "t": "2026-01-01T01:00:00.000Z",
                 "sinceStartMs": 999999}
        build_wave(tmp, "synth-stray", calls + [{"status": 200, "elapsedMs": 5.0, "t": T_END}],
                   lp_n=11, p1=10, p6a=10, stray_call=stray)
        res = run(tmp, os.path.join(tmp, "summaries"))
        out = json.loads(res.stdout)
        ws = {x["wave"]: x for x in out["waves"]}.get("synth-stray")
        if res.returncode == 0 or not ws or ws["phase_coverage"]["outside_phases"] != 1:
            failures.append("النداءُ الخارجُ عنِ الأطوارِ لم يُفشِلِ الحكمَ")

    if failures:
        for f in failures:
            print(f"✗ {f}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
