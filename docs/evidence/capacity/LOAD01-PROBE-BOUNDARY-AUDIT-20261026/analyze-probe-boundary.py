#!/usr/bin/env python3
"""تدقيقُ حدودِ قياسِ مجسّاتِ P1/P6a — دورةُ LOAD-01-PROBE-BOUNDARY-AUDIT (2026-10-26).

السؤالُ المحصورُ: هل مجسّاتُ الذيلِ (P1/P6a — p95/p99 لإنشاءِ الرحلةِ) مقيسةٌ على
مجتمعِ الطلباتِ المرتبطةِ نفسِهِ الذي يربطُهُ محلّلُ الدورةِ السابقةِ (http_call↔httpreq)،
أم على عملياتٍ مستقلةٍ؟

الطريقةُ (استرجاعيةٌ على خامِّ الدورةِ LOAD-01-C2-HTTP-WAIT-PROBE المحفوظِ):
  1. من `load-events.jsonl.gz` لكلِّ موجةٍ: سطورُ `http_call` الفرديةُ لمسارِ `rides_create`
     (gen=genA) — العمودُ الذي يربطُهُ المحلّلُ بالطلباتِ الخادميةِ.
  2. إعادةُ حسابِ p95/p99 بنفسِ طريقةِ `PathRecorder.latencyPercentiles` في
     `deploy/capacity-run/load/lib.ts` (المؤشرُ floor(q·n) المقصوصُ على الطولِ)، وبمقارنةٍ
     مركّبةٍ: المئينانِ **وعددُ العيّنةِ (n)** مقابلَ آخرِ سطرِ `latency_percentiles`.
  3. مقارنةُ ذلكَ بقيمِ P1/P6a في `wave-report.json` — التطابقُ عندَ دقّةِ التقريرِ (1ms).
  4. تركيبُ العيّنةِ: توزيعُ رموزِ الحالةِ (بما فيه حالةُ 0 للفاشلِ شبكيًّا — مسارُ الخطأِ
     يمرُّ عبرَ httpLatency وhttpCallLog معًا)، وحصةُ الصفوفِ بلا معرّفِ طلبٍ، وتغطيةُ
     الأطوارِ (حقنٌ/تصريفٌ) من أحداثِ الأطوارِ في `miniapp-load-events.jsonl.gz`، وذيلُ
     أعلى 5% (بالمراتبِ لا بالعتبةِ — فلا تُضمُّ متعادلاتٌ خارجَ الشريحةِ).

المدخلاتُ اللازمةُ لإعادةِ الإنتاجِ: خامُ الموجاتِ (`load-events.jsonl.gz` و
`miniapp-load-events.jsonl.gz`) — محفوظةٌ عيناتُها المستخدمةُ في أرشيفِ الدورةِ
(`docs/evidence/archive/LOAD01-PROBE-BOUNDARY-AUDIT-20261026/samples/`)، والأصلُ الكاملُ
في أثرِ أفعالِ التشغيلِ 40292412972 (احتفاظُ 30 يومًا من 2026-10-26).
"""
from __future__ import annotations

import gzip
import json
import math
import os
import sys
from collections import Counter

USAGE = "الاستعمالُ: analyze-probe-boundary.py <دليلُ خامِّ الموجاتِ> <دليلُ ملخصاتِ الأرشيفِ>"


def js_round(x: float) -> int:
    """تدويرُ JavaScript (Math.round) للقيمِ غيرِ السالبةِ: نصفٌ إلى الأعلى —
    لا تدويرُ بايثونَ المصرفيُّ إلى الزوجِ (round(452.5)=452 هناك و453 هنا)."""
    if x < 0:
        raise ValueError("تدويرُ السوالبِ غيرُ مطلوبٍ هنا")
    return math.floor(x + 0.5)


# نفسُ قصِّ المئينِ في lib.ts: sorted[min(len-1, floor(q*n))]
def percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        raise ValueError("عيّنةٌ فارغة")
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def parse_report_value(text: str) -> int:
    """«453ms» → 453 (قيمُ المجسّاتِ في wave-report مدوّرةٌ إلى الملّي ثانيةِ)."""
    return int(text.rstrip("ms"))


def epoch_ms(iso: str) -> int:
    import datetime
    return int(datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def read_jsonl_gz(path: str) -> tuple[list[dict], int]:
    """قراءةُ سطرٍ سطرٍ معَ عدِّ الأسطرِ غيرِ القابلةِ للقراءةِ (لا تُخفى بصمتًا)."""
    rows, bad = [], 0
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                bad += 1
    return rows, bad


def wave_audit(events_path: str, phases_path: str, report_path: str) -> dict:
    rows, bad_lines = read_jsonl_gz(events_path)
    calls = [d for d in rows if d.get("event") == "http_call" and d.get("gen") == "genA"
             and d.get("label") == "rides_create"]
    lp_rows = [d for d in rows if d.get("event") == "latency_percentiles" and d.get("gen") == "genA"]

    report = json.load(open(report_path, encoding="utf-8"))
    perf = {r["id"]: r["value"] for r in report["perf"]}
    p1 = parse_report_value(perf["P1"])
    p6a = parse_report_value(perf["P6a"])

    elapsed = sorted(r["elapsedMs"] for r in calls)
    p95 = percentile(elapsed, 0.95)
    p99 = percentile(elapsed, 0.99)
    # ذيلُ أعلى 5% بالمراتبِ (آخرُ 5% منَ العيّنةِ المرتّبةِ) — لا بعتبةِ >= فتُضمُّ متعادلاتٌ
    top5_rows = calls_sorted = sorted(calls, key=lambda r: r["elapsedMs"])[int(len(calls) * 0.95):]

    # المركّبُ: آخرُ سطرِ مئيناتٍ في السجلِّ نفسِه (ما يقرؤهُ تقريرُ الموجةِ)
    last_lp = (lp_rows[-1].get("rides_create") if lp_rows else None) or {}
    lp_n = last_lp.get("n")

    # أحداثُ المولّدِ (الأطوارُ ونتائجُ السيناريوهاتِ) من ملفِ أحداثِ الأطوارِ
    phase_rows, _ = read_jsonl_gz(phases_path)
    # وسيناريوهاتُ المولّدِ: كلُّ سيناريو متحقّقٍ بدأ بإنشاءِ رحلةٍ واحدٍ لا إعادةَ —
    # فتطابقُ عدّها معَ n يسدُّ الطريقَ الثالثَ (لا رفضَ ولا إعادةَ محاولةٍ).
    verified = sum(1 for d in phase_rows
                   if d.get("event") == "scenario.outcome" and d.get("kind") == "verified")

    # الأطوارُ: حقنٌ [start, drain) وتصريفٌ [drain, end)
    ph = {d["event"]: epoch_ms(d["t"]) for d in phase_rows if str(d.get("event", "")).startswith("phase.")}
    inj = drain = outside = 0
    if {"phase.start", "phase.drain_start", "phase.end"} <= set(ph):
        for r in calls:
            t = epoch_ms(r["t"])
            if ph["phase.start"] <= t < ph["phase.drain_start"]:
                inj += 1
            elif ph["phase.drain_start"] <= t <= ph["phase.end"]:
                drain += 1
            else:
                outside += 1

    status_all = Counter(r["status"] for r in calls)
    return {
        "wave": os.path.basename(os.path.dirname(events_path)),
        "n_rides_create_calls": len(calls),
        "unreadable_lines": bad_lines,
        "status_all": dict(sorted(status_all.items())),
        "rows_without_request_id": sum(1 for r in calls if not r.get("requestId")),
        "phase_coverage": {"injection": inj, "drain": drain, "outside_phases": outside},
        "since_start_span_ms": (
            [min(r["sinceStartMs"] for r in calls), max(r["sinceStartMs"] for r in calls)]
            if calls else None
        ),
        "p95_recomputed_ms": p95,
        "P1_report_ms": p1,
        "p99_recomputed_ms": p99,
        "P6a_report_ms": p6a,
        "last_latency_percentiles_row": {"n": lp_n, "p95": last_lp.get("p95"), "p99": last_lp.get("p99")},
        "n_matches_lp_row": lp_n == len(calls),
        "verified_scenarios": verified,
        "n_matches_verified_scenarios": verified == len(calls),
        "report_precision_match": js_round(p95) == p1 and js_round(p99) == p6a,
        "top5_status": dict(sorted(Counter(r["status"] for r in top5_rows).items())),
        "top5_elapsed_range_ms": [top5_rows[0]["elapsedMs"], top5_rows[-1]["elapsedMs"]] if top5_rows else None,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(USAGE, file=sys.stderr)
        return 2
    waves_dir, summaries_dir = argv[1], argv[2]
    out = {"method_note": __doc__.split("\n")[0], "waves": []}
    all_ok = True
    found = 0
    for name in sorted(os.listdir(waves_dir)):
        events = os.path.join(waves_dir, name, "load-events.jsonl.gz")
        phases = os.path.join(waves_dir, name, "miniapp-load-events.jsonl.gz")
        report = os.path.join(summaries_dir, name, "wave-report.json")
        if not (os.path.isfile(events) and os.path.isfile(phases) and os.path.isfile(report)):
            continue  # ليست موجةَ قياسٍ (تُحصى الموجاتُ المعثورُ عليها ويُشترطُ >0)
        w = wave_audit(events, phases, report)
        out["waves"].append(w)
        found += 1
        all_ok = all_ok and w["report_precision_match"] and w["n_matches_lp_row"] \
            and w["n_matches_verified_scenarios"] and w["unreadable_lines"] == 0 \
            and w["phase_coverage"]["outside_phases"] == 0
    if found == 0:
        print("✗ لم تُعثر على أيِّ موجةِ قياسٍ — المدخلاتُ ناقصةٌ", file=sys.stderr)
        return 3
    out["waves_found"] = found
    out["all_waves_match_at_report_precision"] = all_ok
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
