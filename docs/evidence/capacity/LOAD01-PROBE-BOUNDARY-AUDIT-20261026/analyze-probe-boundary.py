#!/usr/bin/env python3
"""تدقيقُ حدودِ قياسِ مجسّاتِ P1/P6a — دورةُ LOAD-01-PROBE-BOUNDARY-AUDIT (2026-10-26).

السؤالُ المحصورُ: هل مجسّاتُ الذيلِ (P1/P6a — p95/p99 لإنشاءِ الرحلةِ) مقيسةٌ على
مجتمعِ الطلباتِ المرتبطةِ نفسِهِ الذي يربطُهُ محلّلُ الدورةِ السابقةِ (http_call↔httpreq)،
أم على عملياتٍ مستقلةٍ؟

الطريقةُ (استرجاعيةٌ على خامِّ الدورةِ LOAD-01-C2-HTTP-WAIT-PROBE المحفوظِ):
  1. من `load-events.jsonl.gz` لكلِّ موجةٍ: سطورُ `http_call` الفرديةُ لمسارِ `rides_create`
     (gen=genA) — العمودُ الذي يربطُهُ المحلّلُ بالطلباتِ الخادميةِ.
  2. إعادةُ حسابِ p95/p99 بنفسِ طريقةِ `PathRecorder.latencyPercentiles` في
     `deploy/capacity-run/load/lib.ts` (المؤشرُ floor(q·n) المقصوصُ على الطولِ).
  3. مقارنةُ ذلكَ بقيمِ P1/P6a في `wave-report.json` (المأخوذةِ من آخرِ سطرِ
     `latency_percentiles` لِgenA) — التطابقُ التامُّ يثبتُ أنَّ المجسّينِ على المجتمعِ
     نفسِهِ لا على عملياتٍ مستقلةٍ.
  4. تركيبُ العيّنةِ: توزيعُ رموزِ الحالةِ، وحصةُ الصفوفِ بلا معرّفِ طلبٍ، ومدىُ أعلى 5%
     (الذيلُ الذي تسألُ عنهُ الدورةُ) — فلا يُخلطُ الذيلُ الناجحُ بذيلِ أخطاءٍ.

المدخلاتُ اللازمةُ لإعادةِ الإنتاجِ: خامُ الموجاتِ (`load-events.jsonl.gz` لكلِّ موجةٍ)
من أثرِ أفعالِ التشغيلِ 40292412972 (احتفاظُ 30 يومًا من 2026-10-26) — ملخصاتُ
الأرشيفِ (318 ملفًّا) لا تحملُ هذا الخامَّ؛ الناتجُ المحفوظُ هنا هو البرهانُ الباقي.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from collections import Counter

# نفسُ قصِّ المئينِ في lib.ts: sorted[min(len-1, floor(q*n))]
def percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        raise ValueError("عيّنةٌ فارغة")
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def parse_report_value(text: str) -> int:
    """«453ms» → 453 (قيمُ المجسّاتِ في wave-report مدوّرةٌ إلى الملّي ثانيةِ)."""
    return int(text.rstrip("ms"))


def wave_audit(events_path: str, report_path: str) -> dict:
    rows: list[dict] = []
    with gzip.open(events_path, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                d.get("event") == "http_call"
                and d.get("gen") == "genA"
                and d.get("label") == "rides_create"
            ):
                rows.append(d)
    report = json.load(open(report_path, encoding="utf-8"))
    perf = {r["id"]: r["value"] for r in report["perf"]}
    p1 = parse_report_value(perf["P1"])
    p6a = parse_report_value(perf["P6a"])

    elapsed = sorted(r["elapsedMs"] for r in rows)
    p95 = percentile(elapsed, 0.95)
    p99 = percentile(elapsed, 0.99)
    top5 = elapsed[int(len(elapsed) * 0.95):]

    status_all = Counter(r["status"] for r in rows)
    status_top5 = Counter(
        r["status"] for r in rows if r["elapsedMs"] >= top5[0]
    )
    # قيمُ wave-report مدوّرةٌ إلى الملّي ثانيةِ (Math.round)، وسطورُ http_call
    # محفوظةٌ بدقةِ 0.01ms — فالمقارنةُ على المدوّرِ، والفرقُ الخامُ يُحفظُ للتوثيقِ.
    return {
        "wave": os.path.basename(os.path.dirname(events_path)),
        "n_rides_create_calls": len(rows),
        "status_all": dict(sorted(status_all.items())),
        "rows_without_request_id": sum(1 for r in rows if not r.get("requestId")),
        "since_start_span_ms": (
            [min(r["sinceStartMs"] for r in rows), max(r["sinceStartMs"] for r in rows)]
            if rows else None
        ),
        "p95_recomputed_ms": p95,
        "P1_report_ms": p1,
        "p95_diff_ms": p95 - p1,
        "p99_recomputed_ms": p99,
        "P6a_report_ms": p6a,
        "p99_diff_ms": p99 - p6a,
        "top5_status": dict(sorted(status_top5.items())),
        "top5_elapsed_range_ms": [top5[0], top5[-1]] if top5 else None,
        "exact_match": round(p95) == p1 and round(p99) == p6a,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("الاستعمالُ: analyze-probe-boundary.py <دليلُ خامِّ الموجاتِ> <دليلُ ملخصاتِ الأرشيفِ>", file=sys.stderr)
        return 2
    waves_dir, summaries_dir = argv[1], argv[2]
    out = {"method_note": __doc__.split("\n")[0], "waves": []}
    all_exact = True
    for name in sorted(os.listdir(waves_dir)):
        events = os.path.join(waves_dir, name, "load-events.jsonl.gz")
        report = os.path.join(summaries_dir, name, "wave-report.json")
        if not (os.path.isfile(events) and os.path.isfile(report)):
            continue
        w = wave_audit(events, report)
        out["waves"].append(w)
        all_exact = all_exact and w["exact_match"]
    out["all_waves_exact_match"] = all_exact
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if all_exact else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
