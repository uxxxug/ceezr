#!/usr/bin/env python3
"""تحليلُ الربطِ الطلبيِّ لدورةِ load01-c2-http-wait-probe — وصفيٌّ لا حكمَ فيه.

يُشغَّلُ على أدلةِ الموجاتِ المستخرجةِ (load-trace.jsonl.gz + load-events.jsonl.gz
+ miniapp-load-events.jsonl.gz) ويُخرجُ:
  linkage-summary.json   — تغطيةُ الربطِ (httpreq/pseat/http_call) ومتوسطاتُ
                           انتظارِ/احتجازِ المقعدِ المنسوبِ للطلبِ بحسبِ
                           المسارِ والطورِ، ومتوسطاتُ gateWait/serverMs.
  client-server-gap.json — فجوةُ العميل/الخادمِ (http_call.elapsedMs −
                           httpreq.serverMs) للطلباتِ المتطابقةِ بالمعرّفِ.

الاستدعاءُ: python3 analyze-linkage.py <wave_dir>... > summary.json
(كما نُفِّذَ على أثرِ التشغيلِ 40292412972 — الموجاتُ الثمانيُ للحكمِ.)
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


def q(v, p):
    if not v:
        return None
    v = sorted(v)
    i = (len(v) - 1) * p
    lo, hi = int(i), min(int(i) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (i - lo), 2)


def analyze(wave_dir):
    t0, d0, e0 = phases_of(wave_dir)
    httpreq, pseat = [], []
    hcall = {}
    for r in read_jsonl(f"{wave_dir}/load-trace.jsonl.gz"):
        k = r.get("k")
        if k == "httpreq":
            httpreq.append(r)
        elif k == "pseat":
            pseat.append(r)
    for r in read_jsonl(f"{wave_dir}/load-events.jsonl.gz"):
        if r.get("event") == "http_call":
            hcall[r["requestId"]] = r.get("elapsedMs")

    def phase_of(at):
        return "inj" if t0 <= at < d0 else ("drain" if d0 <= at <= e0 else "out")

    ids = {r["requestId"] for r in httpreq}
    linked = [r for r in pseat if r.get("requestId") in ids]
    stats = defaultdict(lambda: {"n": 0, "wait": [], "hold": []})
    for r in linked:
        cls = "rides" if r.get("path") == "http:POST /v1/rides" else "other"
        s = stats[(cls, phase_of(r.get("waitStartAt") or r["at"]))]
        s["n"] += 1
        s["wait"].append(r.get("waitMs", 0))
        he, ws = r.get("holdEndAt"), r.get("waitStartAt")
        if he and ws:
            s["hold"].append(he - ws)
    gaps = {"rides": [], "other": []}
    hmap = {r["requestId"]: (r["route"], r.get("serverMs", 0)) for r in httpreq}
    for rid, el in hcall.items():
        if rid in hmap:
            route, sv = hmap[rid]
            gaps["rides" if route == "POST /v1/rides" else "other"].append(el - sv)
    return {
        "httpreq": len(httpreq),
        "httpreq_with_gate": sum(1 for r in httpreq if r.get("gateAcquisitions", 0) > 0),
        "pseat": len(pseat),
        "pseat_linked": len(linked),
        "pseat_noreq": sum(1 for r in pseat if not r.get("requestId")),
        "pseat_unmatched": sum(
            1 for r in pseat if r.get("requestId") and r["requestId"] not in ids
        ),
        "hcall": len(hcall),
        "hcall_matched": sum(1 for k in hcall if k in ids),
        "seat_stats": {
            f"{c}|{p}": {
                "n": s["n"],
                "wait_mean": round(sum(s["wait"]) / len(s["wait"]), 2) if s["wait"] else None,
                "wait_p95": q(s["wait"], 0.95),
                "hold_mean": round(sum(s["hold"]) / len(s["hold"]), 2) if s["hold"] else None,
            }
            for (c, p), s in stats.items()
        },
        "client_server_gap": {
            cls: {"n": len(v), "mean": round(sum(v) / len(v), 2), "p50": q(v, 0.5), "p95": q(v, 0.95)}
            for cls, v in gaps.items()
            if v
        },
    }


if __name__ == "__main__":
    print(json.dumps({d.rstrip("/").split("/")[-1]: analyze(d) for d in sys.argv[1:]}, ensure_ascii=False, indent=1))
