#!/usr/bin/env python3
"""b33mdis — تنفيذُ خطةِ التحليلِ الاستعاديّةِ (PLAN-b33mdis-retrospective.md، المثبَّتةُ في da954fb8).

يُنتج: out-a-v2-<wave>.json (تشغيلُ b33m-analyze-v2.py المثبَّت)، وout-b33mdis.json (التحليلاتُ ب/ج/د/هـ/و
وفحوصُ الكفايةِ كما في §4 منَ الخطة)، وout-summary.json (الجدولُ الجامعُ معَ G1/P7 الرسميّين).

الاستخدام: python3 b33mdis-analyze.py <أرشيفُ b33mtick-evidence/out> <مخرجاتُ العمل>
يعتمدُ: tools/b33m-analyze.py وtools/b33m-analyze-v2.py (نسختانِ بايتيّتانِ منَ الأصلِ المحفوظِ على main،
بصماتُهما في tool-sha256.txt — §2 منَ الخطة).
"""
from __future__ import annotations
import csv, gzip, json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL_V2 = HERE / "tools" / "b33m-analyze-v2.py"


def jl(p: Path) -> list[dict]:
    out = []
    with gzip.open(p, "rt") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def tms(s: str) -> int:
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() * 1000)


def run(raw_root: Path, work: Path) -> None:
    waves = sorted(
        p.name for p in (raw_root / "raw").iterdir()
        if p.is_dir() and re.fullmatch(r"b33mtick-m-a[1-8]-(ref|cand)-750", p.name)
    )  # عيّنةُ الخطةِ §2: الموجاتُ الثماني وحدها؛ الدخانُ والتشغيلُ الأولُ خارجَ العيّنة
    summary, bcde = {}, {}
    for wdir in waves:
        w = wdir.rsplit("-750", 1)[0].replace("b33mtick-m-", "")
        # (أ) v2 classification — على نسخةِ العملِ المفكوكة
        r2 = subprocess.run(
            ["python3", str(TOOL_V2), "wave", str(work / "waves" / wdir)],
            capture_output=True, text=True, check=True,
        )
        (work / f"out-a-v2-{w}.json").write_text(r2.stdout)
        v2 = json.loads(r2.stdout)

        raw = raw_root / "raw" / wdir
        wv = work / "waves" / wdir
        ev = jl(wv / "b33m-gw-events.jsonl.gz")
        counts = json.load(open(wv / "b33m-gw-event-counts.json"))
        mock = jl(wv / "b33m-mock-egress.jsonl.gz")
        rows = list(csv.DictReader(open(wv / "b33m-outbox-rows.csv")))

        r: dict = {"wave": w}
        # (و1) الاتساقُ الداخليُّ: لكلِّ نوعٍ في الإسقاطِ المؤرشَف، تطابقُ عددِ الأسطرِ معَ عدّادِهِ في ملفِّ العدّادات
        ev_types: dict[str, int] = {}
        for e in ev:
            ev_types[e.get("event")] = ev_types.get(e.get("event"), 0) + 1
        r["و1_per_type_match"] = {k: [n, counts.get(k)] for k, n in ev_types.items()}
        r["و1_pass"] = all(counts.get(k) == n for k, n in ev_types.items())
        # (ب) أحداثُ قراراتٍ معلنةً حسبَ النوعِ والنطاق
        bp: dict[str, int] = {}
        for e in ev:
            if e.get("event") == "outbound.resilience_event":
                k = f"{e.get('outbound_event')}|{e.get('detail')}"
                bp[k] = bp.get(k, 0) + 1
        r["ب_backpressure"] = bp
        # (د) 429
        r["د_mock_429"] = sum(1 for m in mock if m.get("status") == 429)
        # (هـ) أحداثُ إعادةِ الاصطفافِ (منفصلةً عن إعادةِ اصطفافِ الصادر)
        r["هـ"] = {k: counts.get(k) for k in counts if ("redispatch" in k) or ("sweep" in k) or (k == "job.ran")}
        # (و2) تغطيةُ الزمن
        runs = [e for e in ev if e.get("event") == "job.ran" and e.get("job") == "deliver-notifications"]
        if runs:
            ats = [tms(x["at"]) for x in runs]
            r["و2_job_ran_count"], r["و2_span_sec"] = len(runs), round((max(ats) - min(ats)) / 1000, 1)
        # (ج) تراكمُ الصادرِ وأعمارُه
        st: dict[str, int] = {}
        err_: dict[str, int] = {}
        for row in rows:
            st[row["status"]] = st.get(row["status"], 0) + 1
            if row.get("last_error"):
                err_[row["last_error"]] = err_.get(row["last_error"], 0) + 1
        dbr: dict[str, int] = {}
        for row in rows:
            if row["status"] == "dead":
                dbr[row.get("dead_reason") or "(none)"] = dbr.get(row.get("dead_reason") or "(none)", 0) + 1
        r["ج_status"], r["ج_last_error_at_export"], r["ج_dead_by_reason"] = st, err_, dbr
        post = json.load(open(wv / "db-audit-post.json"))
        sat, sat_ms = post["snapshot"]["at"], tms(post["snapshot"]["at"])
        upd = [int(x["updated_ms"]) for x in rows if x.get("updated_ms")]
        r["ج_snapshot_at"] = sat
        r["ج_rows_updated_after_snapshot"] = sum(1 for u in upd if u > sat_ms)
        ages = sorted(round((sat_ms - int(x["created_ms"])) / 1000, 1) for x in rows
                      if x["status"] == "pending" and x.get("created_ms") and sat_ms - int(x["created_ms"]) >= 0)
        if ages:
            r["ج_pending_age_at_snapshot"] = {"n": len(ages), "max": ages[-1], "p50": ages[len(ages) // 2]}
        # (و3) حقولُ الربطِ المتاحة
        be = [e for e in ev if e.get("event") == "outbound.resilience_event"]
        r["و3_resilience_fields"] = sorted(be[0].keys()) if be else []
        r["و3_mock_fields"] = sorted(mock[0].keys()) if mock else []
        r["و3_outbox_fields"] = list(rows[0].keys()) if rows else []
        r["و3_row_linkage_available"] = bool(
            {"row_id", "outbox_id", "message_id"} & set(r["و3_resilience_fields"]) or
            {"row_id", "outbox_id", "message_id"} & set(r["و3_mock_fields"]))
        # (و4) نطاقاتُ الساعاتِ (حدودُها موثقةٌ في التقرير)
        dl = [int(x["delivered_ms"]) for x in rows if x.get("delivered_ms")]
        mt = [m["t"] for m in mock if m.get("t")]
        r["و4_ranges"] = {"outbox_delivered": [min(dl), max(dl)] if dl else None,
                          "mock_t": [min(mt), max(mt)] if mt else None}
        bcde[w] = r

        wr = json.load(open(wv / "wave-report.json"))
        g = {x["id"]: x for x in (wr.get("gates") or [])}
        p = {x["id"]: x for x in (wr.get("perf") or [])}
        f2 = v2["facts"]["v2"]
        summary[w] = {
            "G1": g.get("G1", {}).get("value"), "P7_official": p.get("P7", {}).get("value"),
            "P7_pass": p.get("P7", {}).get("pass"),
            "v2_H1": v2["hypotheses"]["H1_drain_loop"],
            "v2_H2": v2["hypotheses"]["H2_sender_requeue_independent"],
            "v2_H5": v2["hypotheses"]["H5_cap_in_runs"],
            "rider_rate_overall": f2.get("rider_rate_overall"),
            "egress_run_vs_gap": f2.get("egress_run_vs_gap"),
            "delivered_per_run_p50": f2.get("delivered_per_run_p50"),
        }
    (work / "out-b33mdis.json").write_text(json.dumps(bcde, ensure_ascii=False, indent=1))
    (work / "out-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(f"OK: {len(waves)} waves")


if __name__ == "__main__":
    run(Path(sys.argv[1]), Path(sys.argv[2]))
