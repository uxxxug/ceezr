#!/usr/bin/env python3
"""LOAD-01 · موجةُ القياسِ b33m — محلّلٌ تشخيصيٌّ (لا حكمَ قبول) مُثبَّتٌ قبلَ أوّلِ موجة.

الاستعمال:
  b33m-analyze.py instr <RAW_WAVE_DIR>   → JSON + INSTR_PRESENT/INSTR_MISSING (رمزُ خروجٍ 0/1)
  b33m-analyze.py wave  <RAW_WAVE_DIR>   → JSON التشخيص (PROTOCOL-b33m.md §5–§7)
  b33m-analyze.py valid <RAW_WAVE_DIR> <SESSION_LIMIT> → VALID/INVALID (قواعدُ b26-analyze حرفًا لموجةٍ واحدة:
                  preflight وinflight = VALID، لا خطأَ تحليل، حكمُ البوّاباتِ مقروء، وشرطُ القياس condition_ok)

التعريفاتُ والعتباتُ هنا هي المسجَّلةُ في PROTOCOL-b33m.md ولا تُعدَّلُ بعدَ رؤيةِ النتيجة.
لا يحسبُ هذا المحلّلُ G1–G8 ولا P1–P9 ولا N1–N5 ولا يغيّرُها؛ يقرأُ wave-report.json كما هو للإعلامِ فقط.
مجموعُ أزمنةِ الاستعلاماتِ من pg_stat_statements «زمنُ تنفيذٍ في الخادم» لا «زمنُ CPU» ولا إشغالُ مقاعد.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# ── عتباتٌ مسجَّلةٌ مسبقًا (PROTOCOL-b33m.md §6) ─────────────────────────────
BUDGET_HIT_MS = 7_500          # دورةُ تصريفٍ استنفدت ميزانيّتَها (8000ms افتراضيًّا) تقريبًا
H1_IDLE_SUPPORT = 0.10         # خمولُ الحلقةِ أثناءَ التراكم ≥ 10% مع صفوفٍ مستحقّة ⇒ مدعوم
H1_IDLE_REFUTE = 0.05          # خمولٌ < 5% أثناءَ التراكم ⇒ مرفوض
H2_CONGESTION_SHARE = 0.50     # حصّةُ «آخرُ عودةٍ = ازدحام» من المعلّقِ أثناءَ التراكم
H2_WAIT_SHARE = 0.30           # انتظارُ المُرسِلِ داخلَ المسار ÷ ثواني-المساراتِ المشغولة
H3_RETRY_SHARE = 0.05          # إخفاقاتٌ/إعاداتٌ حقيقيّةٌ ÷ تسليماتِ تيليجرام
H5_RATE_FRACTION = 0.90        # المعدّلُ الفعليُّ ≥ 90% من ميزانيّةِ 25/ث ⇒ السقفُ مُلزِم
BOT_BUDGET_PER_SEC = 25        # ميزانيّةُ المُرسِلِ المعلنة (لا تُغيَّر)
LANES = 8                      # NOTIFICATION_DRAIN_DEFAULTS.lanes = outbox_queue_consumer_concurrency
COVERAGE_MIN = 0.90            # تغطيةُ العيّناتِ الدنيا لاعتبارِ البياناتِ كاملة
MIN_DRAIN_RUNS = 20
# المكسبُ اللازمُ عندَ 750 لإبقاءِ P7 ≤ 120ث بنموذجِ BATCH-33-READINESS §3: ≥20.4/ث مقابلَ 17.3/ث المقيس.
NEEDED_GAIN = 20.4 / 17.3
GAIN_SEPARATION = 1.10         # حينَ تُدعَمُ فرضيّتانِ: يُختارُ الأكبرُ مكسبًا إن فاقَ الآخرَ بـ10% على الأقل


def jl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    op = gzip.open if path.suffix == ".gz" else open
    out = []
    with op(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return out


def read_csv(path: Path) -> list[dict]:
    for p in (path, path.with_name(path.name + ".gz")):
        if p.exists():
            raw = gzip.open(p, "rt", encoding="utf-8").read() if p.suffix == ".gz" else p.read_text()
            return list(csv.DictReader(io.StringIO(raw)))
    return []


def pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(q * (len(s) - 1) + 0.5))], 1)


def ms(at: str) -> float:
    return datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000


def load(raw: Path) -> dict:
    j = lambda n: json.loads((raw / n).read_text()) if (raw / n).exists() else None  # noqa: E731
    return {
        "post": j("db-audit-post.json"),
        "report": j("wave-report.json"),
        "window": j("qual/window.json") or {},
        "extract": j("b33m-extract.json") or {},
        "events": jl(raw / "b33m-gw-events.jsonl.gz"),
        "counts": j("b33m-gw-event-counts.json") or {},
        "samples": jl(raw / "b33m-outbox-samples.jsonl.gz"),
        "rows": read_csv(raw / "b33m-outbox-rows.csv"),
        "mock": jl(raw / "b33m-mock-egress.jsonl.gz"),
        "pgss": read_csv(raw / "pgss-full.csv"),
    }


def drain_runs(events: list[dict]) -> list[dict]:
    runs = []
    for e in events:
        if e.get("event") == "job.ran" and e.get("job") == "deliver-notifications" and e.get("at"):
            end = ms(e["at"])
            dur = float(e.get("durationMs") or 0)
            d = dict(kv.split("=") for kv in str(e.get("detail", "")).split() if "=" in kv)
            runs.append({"start": end - dur, "end": end, "dur": dur, **{k: int(v) for k, v in d.items()}})
    return sorted(runs, key=lambda r: r["start"])


def instr(raw: Path) -> tuple[dict, bool]:
    d = load(raw)
    outbox = ((d["post"] or {}).get("snapshot") or {}).get("outbox") or {}
    checks = {
        "db_audit_pendingAgeByKind": "pendingAgeByKind" in outbox,
        "db_audit_egressTimeline": ((d["post"] or {}).get("snapshot") or {}).get("egressTimeline") is not None,
        "outbox_samples": sum(1 for s in d["samples"] if "kinds" in s) >= 5,
        "outbox_rows": len(d["rows"]) > 0,
        "drain_job_ran_lines": len(drain_runs(d["events"])) >= 3,
        "mock_egress_projection": len(d["mock"]) > 0,
    }
    return {"checks": checks}, all(checks.values())


def analyse(raw: Path) -> dict:
    d = load(raw)
    snap = (d["post"] or {}).get("snapshot") or {}
    outbox = snap.get("outbox") or {}
    t0 = d["window"].get("wave_from_ms")
    res: dict = {"facts": {}, "hypotheses": {}, "completeness": {}, "limits": []}
    F = res["facts"]

    # ── §5.1 أداةُ الرصد (db-audit-post) ─────────────────────────────────────
    F["p7_tool"] = {
        "oldestPendingSec": outbox.get("oldestPendingSec"),
        "oldestPendingKind": outbox.get("oldestPendingKind"),
        "pendingAgeByKind": outbox.get("pendingAgeByKind"),
        "byKind": outbox.get("byKind"),
        "riderTripChannel": snap.get("riderTripChannel"),
        "audit_at": snap.get("at"),
    }
    et = snap.get("egressTimeline") or {}
    F["egressTimeline"] = {
        b: {k: v for k, v in x.items() if k != "perSecond"} for b, x in (et.get("byBot") or {}).items()
    }

    # ── §5.2 عيّناتُ الصادر ────────────────────────────────────────────────
    S = [s for s in d["samples"] if "kinds" in s]
    errs = [s for s in d["samples"] if "err" in s]
    kinds = sorted({k for s in S for k in s["kinds"]})
    series = {}
    for k in kinds:
        pts = [(s["t"], s["kinds"].get(k) or {}) for s in S]
        mx = max(pts, key=lambda p: p[1].get("oldest_pending_s") or 0) if pts else None
        series[k] = {
            "max_oldest_pending_s": mx[1].get("oldest_pending_s") if mx else None,
            "max_oldest_at_s_since_t0": round((mx[0] - t0) / 1000) if mx and t0 else None,
            "max_oldest_eligible_s": max((p[1].get("oldest_eligible_s") or 0 for p in pts), default=None),
            "max_oldest_deferred_s": max((p[1].get("oldest_deferred_s") or 0 for p in pts), default=None),
            "max_pending": max((p[1].get("pending") or 0 for p in pts), default=0),
            "max_eligible": max((p[1].get("eligible") or 0 for p in pts), default=0),
            "max_deferred": max((p[1].get("deferred") or 0 for p in pts), default=0),
            "max_sending": max((p[1].get("sending") or 0 for p in pts), default=0),
            "max_signal_wait_count": max((p[1].get("max_signal_wait_count") or 0 for p in pts), default=0),
            "timeline_10s": [
                {"s": round((t - t0) / 1000) if t0 else None,
                 **{f: v.get(f) for f in ("pending", "eligible", "deferred", "sending", "delivered_tg",
                                           "oldest_pending_s", "oldest_eligible_s", "pending_congestion",
                                           "pending_signal_wait", "pending_fresh")}}
                for i, (t, v) in enumerate(pts) if i % 2 == 0
            ],
        }
    oldest_by_sample = Counter()
    for s in S:
        ks = [(v.get("oldest_pending_s") or -1, k) for k, v in s["kinds"].items() if (v.get("pending") or 0) > 0]
        if ks:
            oldest_by_sample[max(ks)[1]] += 1
    F["outbox_samples"] = {"n": len(S), "errors": len(errs), "kinds": series,
                           "oldest_kind_share_of_samples": dict(oldest_by_sample),
                           "q_ms_p95": pct([s.get("q_ms", 0) for s in S], 0.95)}

    # ── §5.3 حلقةُ التصريف (job.ran) ───────────────────────────────────────
    R = drain_runs(d["events"])
    gaps = [R[i + 1]["start"] - R[i]["end"] for i in range(len(R) - 1)]
    span = (R[-1]["end"] - R[0]["start"]) if R else 0
    busy = sum(r["dur"] for r in R)
    # فترةُ التراكم = عيّناتٌ فيها صفوفٌ مستحقّةٌ (eligible > 0) لأيِّ نوع
    backlog = [s["t"] for s in S if sum((v.get("eligible") or 0) for v in s["kinds"].values()) > 0]
    b_lo, b_hi = (min(backlog), max(backlog)) if backlog else (None, None)
    RB = [r for r in R if b_lo is not None and r["end"] >= b_lo and r["start"] <= b_hi]
    gb = [RB[i + 1]["start"] - RB[i]["end"] for i in range(len(RB) - 1)]
    span_b = (RB[-1]["end"] - RB[0]["start"]) if RB else 0
    idle_b = (sum(max(0.0, g) for g in gb) / span_b) if span_b else None
    # خمولٌ «بعملٍ مستحقّ»: فجوةٌ بينَ دورتينِ فيها عيّنةٌ واحدةٌ على الأقلِّ بـ eligible > 0
    def elig_in(lo: float, hi: float) -> bool:
        return any(lo <= s["t"] <= hi and sum((v.get("eligible") or 0) for v in s["kinds"].values()) > 0 for s in S)
    idle_e = (sum(max(0.0, RB[i + 1]["start"] - RB[i]["end"]) for i in range(len(RB) - 1)
                  if elig_in(RB[i]["end"], RB[i + 1]["start"])) / span_b) if span_b else None
    F["drain_loop"] = {
        "runs": len(R),
        "dur_ms_p50": pct([r["dur"] for r in R], 0.5), "dur_ms_p95": pct([r["dur"] for r in R], 0.95),
        "dur_ms_max": max((r["dur"] for r in R), default=None),
        "budget_hit_share": round(sum(r["dur"] >= BUDGET_HIT_MS for r in R) / len(R), 3) if R else None,
        "gap_ms_p50": pct(gaps, 0.5), "gap_ms_p95": pct(gaps, 0.95), "gap_ms_max": max(gaps, default=None),
        "duty_all": round(busy / span, 3) if span else None,
        "backlog_window_s": round((b_hi - b_lo) / 1000) if backlog else 0,
        "runs_in_backlog": len(RB),
        "idle_share_in_backlog": round(idle_b, 3) if idle_b is not None else None,
        "idle_with_eligible_share": round(idle_e, 3) if idle_e is not None else None,
        "budget_hit_share_in_backlog": round(sum(r["dur"] >= BUDGET_HIT_MS for r in RB) / len(RB), 3) if RB else None,
        "claimed": sum(r.get("claimed", 0) for r in R), "delivered": sum(r.get("delivered", 0) for r in R),
        "failed": sum(r.get("failed", 0) for r in R), "abandoned": sum(r.get("abandoned", 0) for r in R),
        "undeliverable": sum(r.get("undeliverable", 0) for r in R),
        "delivered_per_busy_s": round(sum(r.get("delivered", 0) for r in R) / (busy / 1000), 2) if busy else None,
    }

    # ── §5.4 المُرسِل (outbound.resilience_event) ──────────────────────────
    RE = [e for e in d["events"] if e.get("event") == "outbound.resilience_event"]
    by = defaultdict(lambda: {"n": 0, "wait_ms": 0.0})
    for e in RE:
        k = f'{e.get("outbound_event")}|{e.get("detail", "-")}|{e.get("operation", "-")}'
        by[k]["n"] += 1
        by[k]["wait_ms"] += float(e.get("waitMs") or 0)
    wait_total = sum(v["wait_ms"] for v in by.values())
    lane_busy_s = (busy / 1000) * LANES
    F["sender"] = {
        "events": len(RE),
        "by_event_detail_operation": {k: {"n": v["n"], "wait_s": round(v["wait_ms"] / 1000, 1)} for k, v in by.items()},
        "wait_s_total": round(wait_total / 1000, 1),
        "lane_busy_s_upper": round(lane_busy_s, 1),
        "wait_share_of_lane_s": round((wait_total / 1000) / lane_busy_s, 3) if lane_busy_s else None,
    }

    # ── §5.5 pg_stat_statements (زمنُ تنفيذٍ في الخادم) ───────────────────
    def q(sub: str) -> dict:
        for r in d["pgss"]:
            if sub in r.get("query", ""):
                return {"calls": int(r["calls"]), "mean_ms": float(r["mean_ms"]), "total_ms": float(r["total_ms"])}
        return {"calls": 0, "mean_ms": None, "total_ms": 0.0}
    claim, fin, req = q("claim_notification_delivery()"), q("finish_notification_delivery("), q("requeue_notification_delivery(")
    sig, board = q("requeue_notification_delivery_signal_wait("), q("finish_notification_delivery_via_board(")
    F["pgss"] = {"claim": claim, "finish": fin, "requeue_congestion": req, "requeue_signal_wait": sig,
                 "finish_via_board": board,
                 "congestion_requeue_share_of_claims": round(req["calls"] / claim["calls"], 3) if claim["calls"] else None,
                 "claims_per_telegram_finish": round(claim["calls"] / fin["calls"], 2) if fin["calls"] else None}

    # ── §5.6 صفوفُ الصادر (دورةُ الحياة) ──────────────────────────────────
    rows = d["rows"]
    st = Counter((r["kind"], r["status"], r.get("delivered_channel") or "-") for r in rows)
    lat = defaultdict(list)
    for r in rows:
        if r["status"] == "delivered" and r.get("delivered_ms") and r.get("created_ms"):
            lat[(r["kind"], r.get("delivered_channel") or "telegram")].append(
                (float(r["delivered_ms"]) - float(r["created_ms"])) / 1000)
    audit_ms = ms(snap["at"]) if snap.get("at") else None
    pend = [r for r in rows if r["status"] == "pending"]
    pend_detail = Counter((r["kind"], r.get("last_error") or "-",
                           "eligible" if audit_ms and r.get("next_attempt_ms") and float(r["next_attempt_ms"]) <= audit_ms else "deferred")
                          for r in pend)
    oldest_rows = sorted(pend, key=lambda r: float(r["created_ms"]))[:20]
    F["rows"] = {
        "n": len(rows),
        "by_kind_status_channel": {"|".join(k): v for k, v in sorted(st.items())},
        "latency_s": {"|".join(k): {"n": len(v), "p50": pct(v, .5), "p95": pct(v, .95), "max": max(v)} for k, v in lat.items()},
        "pending_by_kind_lasterror_eligibility_at_audit": {"|".join(k): v for k, v in sorted(pend_detail.items())},
        "oldest20_pending": [{"kind": r["kind"], "age_at_audit_s": round((audit_ms - float(r["created_ms"])) / 1000, 1) if audit_ms else None,
                              "last_error": r.get("last_error") or None, "attempts": int(r["attempts"] or 0),
                              "signal_wait_count": int(r.get("signal_wait_count") or 0),
                              "has_offer": r.get("has_offer")} for r in oldest_rows],
        "attempts_dist_tg_delivered": dict(Counter(int(r["attempts"] or 0) for r in rows if r["status"] == "delivered" and (r.get("delivered_channel") or "telegram") == "telegram")),
        "error_code_counts": dict(Counter(r.get("error_code") for r in rows if r.get("error_code"))),
        "dead_reason_counts": dict(Counter(r.get("dead_reason") for r in rows if r.get("dead_reason"))),
    }

    # ── §5.7 المحاكي (معدّلُ الإرسالِ الفعليّ ومباعدةُ المحادثة) ──────────
    M = d["mock"]
    per = defaultdict(Counter)
    gaps_chat = defaultdict(list)
    last = {}
    for m in sorted(M, key=lambda x: (x.get("t") or 0, x.get("seq") or 0)):
        if m.get("status") == 200 and m.get("method") in ("sendMessage", "editMessageText", "sendPhoto"):
            per[m["bot"]][int(m["t"] // 1000)] += 1
            key = (m["bot"], m.get("chat"))
            if key in last:
                gaps_chat[m["bot"]].append(m["t"] - last[key])
            last[key] = m["t"]
    F["mock"] = {b: {"accepted": sum(c.values()), "busy_s": len(c), "peak_per_s": max(c.values()),
                     "mean_per_busy_s": round(sum(c.values()) / len(c), 2),
                     "p50_per_busy_s": pct(list(c.values()), .5),
                     "rejected_429": sum(1 for m in M if m.get("bot") == b and m.get("status") == 429),
                     "same_chat_gap_ms_p05": pct(gaps_chat[b], .05), "same_chat_gap_ms_p50": pct(gaps_chat[b], .5)}
                 for b, c in per.items()}
    F["wave_report_info_only"] = {"failedGates": (d["report"] or {}).get("failedGates"),
                                  "perf": {p["id"]: p["value"] for p in (d["report"] or {}).get("perf", [])}}

    # ── §6 الفرضيات (قواعدُ مسجَّلة؛ «غير محسوم» حينَ يغيبُ الدليلُ المباشر) ──
    H = res["hypotheses"]
    dl = F["drain_loop"]
    ie = dl["idle_with_eligible_share"]
    if ie is None:
        H["H1_drain_loop"] = {"verdict": "غير محسوم", "why": "لا دوراتِ تصريفٍ أو لا تراكمَ مقيس"}
    elif ie >= H1_IDLE_SUPPORT:
        H["H1_drain_loop"] = {"verdict": "مدعوم", "why": f"خمولُ الحلقةِ وفي الطابورِ صفوفٌ مستحقّة {ie} ≥ {H1_IDLE_SUPPORT}"}
    elif ie < H1_IDLE_REFUTE:
        H["H1_drain_loop"] = {"verdict": "مرفوض", "why": f"خمولُ الحلقةِ بعملٍ مستحقّ {ie} < {H1_IDLE_REFUTE}"}
    else:
        H["H1_drain_loop"] = {"verdict": "غير محسوم", "why": "الخمولُ بين العتبتين"}
    H["H1_drain_loop"]["gain_upper"] = round(1 / (1 - ie), 3) if ie is not None and ie < 1 else None
    cong_pend = []
    for s in S:
        p = sum((v.get("pending") or 0) for v in s["kinds"].values())
        c = sum((v.get("pending_congestion") or 0) for v in s["kinds"].values())
        if p > 0 and b_lo is not None and b_lo <= s["t"] <= b_hi:
            cong_pend.append(c / p)
    cshare = round(statistics.mean(cong_pend), 3) if cong_pend else None
    ws = F["sender"]["wait_share_of_lane_s"]
    H["H2_sender_wait"] = {
        "congestion_share_of_pending_in_backlog": cshare, "wait_share_of_lane_s": ws,
        "verdict": ("مدعوم" if (cshare is not None and cshare >= H2_CONGESTION_SHARE) or (ws is not None and ws >= H2_WAIT_SHARE)
                    else "غير محسوم" if cshare is None and ws is None else "مرفوض"),
        # حدٌّ أعلى للمكسبِ من إزالةِ الانتظارِ المقيسِ داخلَ المسار (لا يشملُ زمنَ القاعدةِ في الاستحواذِ/الإعادة — غيرُ مقيسٍ من جهةِ العميل)
        "gain_upper": round(1 / (1 - ws), 3) if ws is not None and ws < 1 else None,
    }
    tg_deliv = sum(v for (k, s_, ch), v in st.items() if s_ == "delivered" and ch in ("-", "telegram"))
    real_fail = dl["failed"] + dl["abandoned"] + sum(F["rows"]["error_code_counts"].values())
    H["H3_retry_ack"] = {"real_failures": real_fail, "telegram_delivered": tg_deliv,
                         "share": round(real_fail / tg_deliv, 3) if tg_deliv else None,
                         "verdict": ("غير محسوم" if not tg_deliv else "مدعوم" if real_fail / tg_deliv >= H3_RETRY_SHARE else "مرفوض")}
    ok = F["p7_tool"]["oldestPendingKind"]
    o20 = Counter((r["kind"], r["last_error"] or "-") for r in F["rows"]["oldest20_pending"])
    H["H4_lifecycle_kind"] = {"oldestPendingKind": ok, "oldest20_by_kind_lasterror": {"|".join(k): v for k, v in o20.items()},
                              "verdict": "غير محسوم" if ok is None else "يُقرأ مع §7 (نوعُ الأقدمِ مقيسٌ مباشرةً)"}
    rider = F["mock"].get("rider") or {}
    rate = rider.get("mean_per_busy_s")
    H["H5_structural_rate"] = {"rider_mean_per_busy_s": rate, "budget": BOT_BUDGET_PER_SEC,
                               "verdict": ("غير محسوم" if rate is None else "مدعوم" if rate >= H5_RATE_FRACTION * BOT_BUDGET_PER_SEC else "مرفوض")}
    sup = [k for k, v in H.items() if v.get("verdict") == "مدعوم"]
    H["H6_mixed_or_other"] = {"supported": sup,
                              "verdict": "مختلط" if len(sup) > 1 else "لا فرضيةَ مدعومة" if not sup else "فرضيةٌ واحدةٌ مدعومة"}

    # ── §7 الاكتمالُ وقاعدةُ اختيارِ متغيّرِ Batch33 ────────────────────────
    span_s = ((audit_ms or 0) - (t0 or 0)) / 1000 if audit_ms and t0 else None
    cov = round(len(S) / (span_s / 5), 3) if span_s else None
    C = res["completeness"]
    C.update({
        "oldest_kind_measured": ok is not None,
        "egressTimeline_present": bool(et),
        "sample_coverage": cov, "sample_coverage_ok": cov is not None and cov >= COVERAGE_MIN,
        "drain_runs_ok": dl["runs"] >= MIN_DRAIN_RUNS,
        "sender_events_logged": F["sender"]["events"] > 0 or d["counts"].get("job.ran", 0) > 0,
        "rows_present": len(rows) > 0,
    })
    C["complete"] = all(v for k, v in C.items() if k.endswith(("_measured", "_present", "_ok", "_logged")))
    h1, h2, h5 = (H[k]["verdict"] for k in ("H1_drain_loop", "H2_sender_wait", "H5_structural_rate"))
    if not C["complete"]:
        choice = {"decision": "NOT_READY", "why": "بياناتٌ ناقصة — §7.1"}
    elif ok != "rider_trip_notice":
        choice = {"decision": "LIFECYCLE", "why": f"الأقدمُ نوعُ «{ok}» لا إشعارُ رحلةِ الراكب — P7 تحكمُه قاعدةُ دورةِ حياةِ هذا النوع، لا حلقةُ التصريفِ ولا المُرسِل؛ تحليلٌ منفصلٌ/قرارُ مالك"}
    elif h5 == "مدعوم":
        choice = {"decision": "OWNER", "why": "السقفُ الهيكليُّ مُلزِمٌ (≥90% من 25/ث) — قرارُ منتج/قناة"}
    else:
        g = {"drain_loop_scheduling": H["H1_drain_loop"].get("gain_upper") if h1 == "مدعوم" else None,
             "sender_congestion_requeue": H["H2_sender_wait"].get("gain_upper") if h2 == "مدعوم" else None}
        cand = sorted(((v, k) for k, v in g.items() if v is not None), reverse=True)
        if not cand:
            choice = {"decision": "NOT_READY", "why": "لا فرضيةَ هندسيّةَ مدعومةٌ بحدِّ مكسبٍ مقيس"}
        elif cand[0][0] < NEEDED_GAIN:
            choice = {"decision": "NOT_READY", "why": f"أكبرُ حدِّ مكسبٍ {cand[0][0]} < اللازمِ {round(NEEDED_GAIN, 3)} — متغيّرٌ واحدٌ لا يكفي بالدليلِ الحاليّ"}
        elif len(cand) > 1 and cand[0][0] / cand[1][0] < GAIN_SEPARATION:
            choice = {"decision": "NOT_READY", "why": "فرضيّتانِ مدعومتانِ بحدّي مكسبٍ متقاربين — يلزمُ إسنادٌ منفصل"}
        else:
            choice = {"decision": "B33_VARIABLE", "variable": cand[0][1], "gain_upper": cand[0][0]}
    choice["gains"] = {"H1": H["H1_drain_loop"].get("gain_upper"), "H2": H["H2_sender_wait"].get("gain_upper"),
                       "needed": round(NEEDED_GAIN, 3)}
    res["b33_choice_rule"] = choice
    return res


def valid(raw: Path, session_limit: int) -> tuple[dict, bool]:
    import importlib.util
    spec = importlib.util.spec_from_file_location("b26", Path(__file__).with_name("b26-analyze.py"))
    b26 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b26)  # type: ignore[union-attr]
    w = b26.wave(raw, 50, session_limit)
    w["validity"] = b26.validity(raw)
    ok_v, ok_c = b26.is_valid(w), b26.condition_ok(w, session_limit)
    return {"validity": w["validity"], "is_valid": ok_v, "condition_ok": ok_c,
            "error": w.get("error")}, ok_v and ok_c


def main() -> int:
    cmd, raw = sys.argv[1], Path(sys.argv[2])
    if cmd == "valid":
        out, ok = valid(raw, int(sys.argv[3]))
        print(json.dumps(out, ensure_ascii=False), file=sys.stderr)
        print("VALID" if ok else "INVALID")
        return 0
    if cmd == "instr":
        out, ok = instr(raw)
        print(json.dumps(out, ensure_ascii=False))
        print("INSTR_PRESENT" if ok else "INSTR_MISSING", file=sys.stderr)
        return 0 if ok else 1
    if cmd == "wave":
        print(json.dumps(analyse(raw), ensure_ascii=False, indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
