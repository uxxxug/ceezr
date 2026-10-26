#!/usr/bin/env python3
"""اختبارُ تحقّقٍ ذاتيٍّ لمحلّلِ تدقيقِ حدودِ المجسّاتِ — عيّنةٌ اصطناعيةٌ بلا شبكةٍ.

يبني موجتَينِ اصطناعيّتَينِ (سطورُ http_call فرديةٌ + تقاريرُ موجاتٍ بقيمٍ محسوبةٍ
يدويًّا) ثمّ يستدعي المحلّلَ نفسَهُ (subprocess) ويتحقّقُ من:
  1. إعادةِ إنتاجِ المئيناتِ بنفسِ قصِّ lib.ts (floor(q·n) المقصوصِ) — قيمٌ يدويّةٌ.
  2. التطابقِ التامِّ عندما يحملُ التقريرُ القيمَ المحسوبةَ من السطورِ نفسِها.
  3. اكتشافِ التحرّفِ: قيمةُ مجسٍّ محرّفةٌ في التقريرِ يجبُ ألا تُعدَّ تطابقًا
     (لا يمرُّ الكذبُ على الحارسِ)، ورمزُ خروجٍ غيرِ الصفرِ.
  4. تركيبِ الذيلِ (أعلى 5%): الحدُّ والعددُ ورموزُ الحالةِ.

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


def wline(ev):
    return json.dumps(ev, ensure_ascii=False)


def build_wave(tmp: str, name: str, values: list[float], p1: int, p6a: int):
    """موجةٌ اصطناعيةٌ: سطورُ http_call لـ rides_create + تقريرٌ بمجسّينَ مكتوبَينَ."""
    wave_dir = os.path.join(tmp, name)
    os.makedirs(wave_dir, exist_ok=True)
    with gzip.open(os.path.join(wave_dir, "load-events.jsonl.gz"), "wt", encoding="utf-8") as f:
        for i, v in enumerate(values):
            f.write(wline({"event": "http_call", "gen": "genA", "label": "rides_create",
                           "status": 200, "elapsedMs": v, "requestId": f"req-{i}",
                           "sinceStartMs": 1000 + i * 10}) + "\n")
    report_dir = os.path.join(tmp, "summaries", name)
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, "wave-report.json"), "w", encoding="utf-8") as f:
        json.dump({"perf": [{"id": "P1", "value": f"{p1}ms"},
                            {"id": "P6a", "value": f"{p6a}ms"}]}, f)


def main() -> int:
    failures = []

    # القيمُ اليدويّةُ: 200 نداءٍ بقيمٍ 1..200 — قصُّ lib.ts:
    # p95 = العنصرُ ذا المؤشرِ floor(0.95·200)=190 ⇒ 191؛ p99 = المؤشرُ 198 ⇒ 199.
    vals = [float(x) for x in range(1, 201)]
    p95 = vals[math.floor(0.95 * len(vals))]
    p99 = vals[math.floor(0.99 * len(vals))]
    if (p95, p99) != (191.0, 199.0):
        failures.append(f"الحسابُ اليدويُّ نفسُهُ خاطئ: {p95}, {p99}")

    with tempfile.TemporaryDirectory() as tmp:
        # موجةٌ صادقةٌ: التقريرُ يحملُ المئيناتِ المحسوبةَ من السطورِ.
        build_wave(tmp, "synth-ok", vals, int(p95), int(p99))
        # موجةٌ محرّفةٌ: P1 مزادٌ بـ1 — يجبُ اكتشافُهُ ورمزُ خروجٍ ≠ 0.
        build_wave(tmp, "synth-bad", vals, int(p95) + 1, int(p99))

        res = subprocess.run([sys.executable, SCRIPT, tmp, os.path.join(tmp, "summaries")],
                             capture_output=True, text=True)
        out = json.loads(res.stdout)
        by_wave = {w["wave"]: w for w in out["waves"]}

        ok_wave = by_wave.get("synth-ok")
        if ok_wave is None:
            failures.append("الموجةُ الصادقةُ غائبةٌ عن المخرجِ")
        else:
            if not ok_wave["exact_match"] or ok_wave["p95_diff_ms"] != 0 or ok_wave["p99_diff_ms"] != 0:
                failures.append(f"التطابقُ التامُّ لم يُثبَت: {ok_wave['p95_diff_ms']}, {ok_wave['p99_diff_ms']}")
            if ok_wave["n_rides_create_calls"] != 200:
                failures.append(f"عددُ النداءاتِ: {ok_wave['n_rides_create_calls']}")
            # الذيلُ: أعلى 5% من 200 = 10 عناصرَ تبدأُ من 191.0
            if ok_wave["top5_status"] != {"200": 10}:
                failures.append(f"تركيبُ الذيلِ: {ok_wave['top5_status']}")
            if ok_wave["top5_elapsed_range_ms"] != [191.0, 200.0]:
                failures.append(f"مدىُ الذيلِ: {ok_wave['top5_elapsed_range_ms']}")
            if ok_wave["rows_without_request_id"] != 0:
                failures.append("صفوفٌ بلا معرّفِ طلبٍ في عيّنةٍ كاملةِ المعرفاتِ")

        bad_wave = by_wave.get("synth-bad")
        if bad_wave is None:
            failures.append("الموجةُ المحرّفةُ غائبةٌ عن المخرجِ")
        elif bad_wave["exact_match"] or bad_wave["p95_diff_ms"] != -1:
            failures.append(f"التحرّفُ لم يُكتشف: {bad_wave['p95_diff_ms']}")

        if out.get("all_waves_exact_match") is not False or res.returncode == 0:
            failures.append(f"رمزُ الخروجِ عندَ التحرّفِ: {res.returncode} (المطلوبُ ≠ 0)")

    if failures:
        for f in failures:
            print(f"✗ {f}")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
