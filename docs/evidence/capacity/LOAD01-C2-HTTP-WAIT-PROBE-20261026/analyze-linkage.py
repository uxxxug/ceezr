#!/usr/bin/env python3
"""تحليلُ الربطِ الطلبيِّ لدورةِ load01-c2-http-wait-probe — وصفيٌّ لا حكمَ فيه.

يُشغَّلُ على أدلةِ الموجاتِ المستخرجةِ (load-trace.jsonl.gz + load-events.jsonl.gz
+ miniapp-load-events.jsonl.gz) ويُخرجُ JSON واحدًا لكلِّ موجةٍ:
  - تغطيةُ الربطِ معَ جردِ التكرارِ (تفرُّدُ المعرّفاتِ يُتحقَّقُ منه لا يُفترَضُ).
  - متوسطاتُ انتظارِ المقعدِ (waitMs) واحتجازِهِ (runMs) المنسوبِ للطلبِ بحسبِ
    المسارِ والطورِ — الاحتجازُ حرفيًّا runMs منَ الأداةِ (لا holdEndAt−waitStartAt
    الذي يشملُ الانتظارَ).
  - مراحلُ الطلبِ الواحدِ منَ httpreq (مجاميعُ مقعدِ الطلبِ: gateWaitMs/gateHoldMs،
    والزمنُ الخادميُّ serverMs).
  - فجوةُ العميل/الخادمِ (http_call.elapsedMs − httpreq.serverMs) للطلباتِ
    المتطابقةِ بالمعرّفِ.
  - شريحةُ الذيلِ على الطلباتِ نفسِها: أعلى 5% بزمنِ العميلِ (مقابلُ مجسّاتِ
    p95) — تُعرضُ مراحلُ الطلباتِ نفسِها لا مجموعاتٌ مختلفةٌ.

الاستدعاءُ: python3 analyze-linkage.py <wave_dir>...
(كما نُفِّذَ على أثرِ التشغيلِ 40292412972 — موجاتُ الحكمِ الثماني.)
"""
import datetime
import gzip
import json
import sys
from collections import defaultdict


def read_jsonl(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def q(v, p):
    """مئينٌ باستيفاءٍ خطّيٍّ واحدٍ موثَّقٍ (نفسُه لكلِّ الأرقامِ هنا)."""
    if not v:
        return None
    v = sorted(v)
    i = (len(v) - 1) * p
    lo, hi = int(i), min(int(i) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (i - lo), 2)


def mean(v):
    return round(sum(v) / len(v), 2) if v else None


def phases_of(wave_dir):
    ph = {}
    for r in read_jsonl(f"{wave_dir}/miniapp-load-events.jsonl.gz"):
        if r.get("event") in ("phase.start", "phase.drain_start", "phase.end"):
            ph[r["event"]] = (
                datetime.datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
                .timestamp()
                * 1000
            )
    return ph["phase.start"], ph["phase.drain_start"], ph["phase.end"]


RIDES_ROUTE = "POST /v1/rides"
TAIL_FRAC = 0.05  # أعلى 5% بزمنِ العميلِ (مقابلُ مجسّاتِ p95)


def analyze(wave_dir):
    t0, d0, e0 = phases_of(wave_dir)
    httpreq, pseat = [], []
    hcall = {}
    hcall_dup = 0
    for r in read_jsonl(f"{wave_dir}/load-trace.jsonl.gz"):
        k = r.get("k")
        if k == "httpreq":
            httpreq.append(r)
        elif k == "pseat":
            pseat.append(r)
    for r in read_jsonl(f"{wave_dir}/load-events.jsonl.gz"):
        if r.get("event") == "http_call":
            if r["requestId"] in hcall:
                hcall_dup += 1
            else:
                hcall[r["requestId"]] = r.get("elapsedMs")

    def phase_of(at):
        return "inj" if t0 <= at < d0 else ("drain" if d0 <= at <= e0 else "out")

    # جردُ التكرارِ: تفرُّدُ المعرّفاتِ يُتحقَّقُ منه ويُعلَنُ
    httpreq_ids = [r["requestId"] for r in httpreq if r.get("requestId")]
    id_counts = defaultdict(int)
    for i in httpreq_ids:
        id_counts[i] += 1
    dup_httpreq = sum(c - 1 for c in id_counts.values() if c > 1)
    ids = set(id_counts)

    # الربطُ: صفٌّ لصفٍّ (لا اختزالٌ قبلَ العدِّ)
    pseat_rows_with_id = 0
    pseat_noid = 0
    pseat_unmatched = 0
    stats = defaultdict(lambda: {"n": 0, "wait": [], "hold": []})
    for r in pseat:
        rid = r.get("requestId")
        if not rid:
            pseat_noid += 1
            continue
        pseat_rows_with_id += 1
        if rid not in ids:
            pseat_unmatched += 1
            continue
        cls = "rides" if r.get("path") == f"http:{RIDES_ROUTE}" else "other"
        s = stats[(cls, phase_of(r.get("waitStartAt") or r["at"]))]
        s["n"] += 1
        s["wait"].append(r.get("waitMs", 0))
        s["hold"].append(r.get("runMs", 0))  # الاحتجازُ حرفيًّا runMs

    # مراحلُ الطلبِ الواحدِ (httpreq) لمسارِ rides
    req = defaultdict(lambda: {"n": 0, "gw": [], "gh": [], "sv": []})
    for r in httpreq:
        if r.get("route") == RIDES_ROUTE and r.get("requestId"):
            s = req[phase_of(r["at"])]
            s["n"] += 1
            s["gw"].append(r.get("gateWaitMs", 0))
            s["gh"].append(r.get("gateHoldMs", 0))
            s["sv"].append(r.get("serverMs", 0))

    # فجوةُ العميل/الخادمِ وشريحةُ الذيلِ على الطلباتِ نفسِها
    hmap = {r["requestId"]: r for r in httpreq if r.get("requestId")}
    gaps = {"rides": [], "other": []}
    tail = {"rides": []}
    for rid, el in hcall.items():
        hr = hmap.get(rid)
        if hr is None:
            continue
        cls = "rides" if hr.get("route") == RIDES_ROUTE else "other"
        gaps[cls].append(el - hr.get("serverMs", 0))
        if cls == "rides":
            tail["rides"].append((el, hr))
    tail_rows = sorted(tail["rides"], key=lambda x: -x[0])
    tail_set = [hr for _, hr in tail_rows[: max(1, int(len(tail_rows) * TAIL_FRAC))]]

    out = {
        "wave": wave_dir.rstrip("/").split("/")[-1],
        "rows": {
            "httpreq": len(httpreq),
            "httpreq_with_id": len(httpreq_ids),
            "httpreq_dup_ids": dup_httpreq,
            "pseat": len(pseat),
            "pseat_rows_with_id": pseat_rows_with_id,
            "pseat_noid": pseat_noid,
            "pseat_unmatched_rows": pseat_unmatched,
            "http_call": len(hcall) + hcall_dup,
            "http_call_dup_ids": hcall_dup,
            "http_call_matched": sum(1 for k in hcall if k in ids),
        },
        "httpreq_with_gate": sum(1 for r in httpreq if r.get("gateAcquisitions", 0) > 0),
        "seat_stats": {
            f"{c}|{p}": {
                "n": s["n"],
                "wait_mean": mean(s["wait"]),
                "wait_p95": q(s["wait"], 0.95),
                "hold_mean": mean(s["hold"]),
                "hold_p95": q(s["hold"], 0.95),
            }
            for (c, p), s in stats.items()
        },
        "rides_request_stages": {
            p: {
                "n": s["n"],
                "gateWait_mean": mean(s["gw"]),
                "gateWait_p95": q(s["gw"], 0.95),
                "gateHold_mean": mean(s["gh"]),
                "server_mean": mean(s["sv"]),
                "server_p95": q(s["sv"], 0.95),
            }
            for p, s in req.items()
        },
        "client_server_gap": {
            cls: {"n": len(v), "mean": mean(v), "p50": q(v, 0.5), "p95": q(v, 0.95)}
            for cls, v in gaps.items()
            if v
        },
        "tail_same_requests": {
            "note": f"أعلى {int(TAIL_FRAC*100)}% بزمنِ العميلِ لمسارِ rides — المراحلُ للطلباتِ نفسِها",
            "n": len(tail_set),
            "client_elapsed_mean": mean([el for el, _ in tail_rows[: len(tail_set)]]),
            "gateWait_mean": mean([r.get("gateWaitMs", 0) for r in tail_set]),
            "gateHold_mean": mean([r.get("gateHoldMs", 0) for r in tail_set]),
            "server_mean": mean([r.get("serverMs", 0) for r in tail_set]),
        },
    }
    return out


if __name__ == "__main__":
    print(json.dumps([analyze(d) for d in sys.argv[1:]], ensure_ascii=False, indent=1))
