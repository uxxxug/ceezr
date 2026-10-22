#!/usr/bin/env python3
"""B29 — عزلُ سببِ P4 من الخامِ المحفوظِ للدفعات 26/27 (قراءةٌ فقط، بلا تشغيلٍ جديد).

يُعيدُ حسابَ: إيقاعِ الشوطِ وتشبّعِه، ومعدّلِ الخدمة، وطابورِ إثباتِ الهاتف (وصول/إنجاز/متأخّرات لكلِّ 10s)،
وتزامنِ الدرينر، واستغلالِ مجمّعِ gatewayRequest (تنفيذٌ لكلِّ ثانيةٍ مقابلَ 5×1000ms)، وتوزيعِ الاستعلامات لكلِّ مسار.
الاستخدام: python3 b29_isolate.py <stage-6/raw> > b29-isolate.out.json
"""
import csv, gzip, io, json, sys
from collections import Counter, defaultdict
from pathlib import Path

RAW = Path(sys.argv[1])
WAVES = sorted((RAW / "batch26/gh").glob("b26-s1-*-750")) + sorted((RAW / "batch27").glob("gh-*/raw/*-750"))


def jl(p):
    with gzip.open(p, "rt") as f:
        for line in f:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def pct(v, q):
    v = sorted(x for x in v if x is not None)
    return round(v[min(len(v) - 1, int(q * len(v)))], 1) if v else None


def wave(w):
    out = {"wave": w.name}
    g = gzip.open(w / "gates.txt.gz", "rt").read().splitlines()
    out["verdict_line"] = g[0][:200] if g else None
    # إيقاعُ الشوط
    P = sorted((t for t in jl(w / "dispatch-trace.jsonl.gz") if t.get("k") == "pass"), key=lambda p: p["startAt"])
    if P:
        cap = max(p["picked"] for p in P)
        span = (P[-1]["startAt"] - P[0]["startAt"]) / 1000
        out["dispatch"] = {
            "passes": len(P), "cap_observed": cap,
            "passes_at_cap": sum(1 for p in P if p["picked"] >= cap),
            "gap_p50_ms": pct([b["startAt"] - a["startAt"] for a, b in zip(P, P[1:])], .5),
            "passMs_p50": pct([p["passMs"] for p in P], .5), "passMs_p95": pct([p["passMs"] for p in P], .95),
            "duty_cycle_p50": round(pct([p["passMs"] for p in P], .5) / max(1, pct([b["startAt"] - a["startAt"] for a, b in zip(P, P[1:])], .5)), 3),
            "served_per_s": round(sum(p["picked"] for p in P) / span, 2),
            "oldestWait_p95_s": pct([p["oldestWaitSec"] for p in P], .95),
        }
    # طابورُ إثباتِ الهاتف
    rows = [r for r in csv.reader(io.TextIOWrapper(gzip.open(w / "update-jobs.csv.gz"))) if len(r) >= 5 and r[2].isdigit()]
    if rows:
        d = [(int(r[2]), int(r[3]), r[4]) for r in rows]
        t0 = min(x[0] for x in d)
        arr = Counter((x[0] - t0) // 10000 for x in d)
        dn = Counter((x[1] - t0) // 10000 for x in d if x[2] == "done")
        b, backlog = 0, []
        for i in range(0, max(arr) + 1):
            b += arr[i] - dn[i]
            backlog.append(b)
        lat = [x[1] - x[0] for x in d if x[2] == "done"]
        out["phone_proof_jobs"] = {
            "n": len(d), "latency_p50_ms": pct(lat, .5), "latency_p95_ms": pct(lat, .95),
            "over_20s": sum(1 for x in lat if x > 20000),
            "backlog_10s_bins": backlog, "backlog_median_after_30s": pct(backlog[3:], .5),
        }
    # الدرينر ومجمّعُ الطلب ومسارات HTTP
    J, DB, H, R = [], defaultdict(list), defaultdict(lambda: [0, 0.0]), defaultdict(int)
    for e in jl(w / "load-trace.jsonl.gz"):
        k = e.get("k")
        if k == "job":
            J.append(e)
        elif k == "db" and e.get("n", 0) > 50:
            DB[e["pool"]].append(e)
        elif k == "http":
            H[e["route"]][0] += e["n"]; H[e["route"]][1] += e["sumMs"]
        elif k == "rsig" and e.get("pool") == "ceezr:gatewayRequest":
            R[e["route"]] += e["n"]
    if J:
        ev = sorted([(j["startedAt"], 1) for j in J] + [(j["endedAt"], -1) for j in J])
        cur = area = 0; last = ev[0][0]
        for t, dd in ev:
            area += cur * (t - last); last = t; cur += dd
        out["drainer"] = {"jobs": len(J), "mean_inflight_of_32": round(area / (ev[-1][0] - ev[0][0]), 2),
                          "proc_p50_ms": pct([j["endedAt"] - j["startedAt"] for j in J], .5)}
    pools = {}
    for p, rs in DB.items():
        rs.sort(key=lambda e: e["at"])
        if len(rs) < 3:
            continue
        iv = (rs[-1]["at"] - rs[0]["at"]) / (len(rs) - 1) / 1000
        n = sum(r["n"] for r in rs); secs = len(rs) * iv
        pools[p] = {"q_per_s": round(n / secs), "run_ms_per_s": round(sum(r["runSumMs"] for r in rs) / secs),
                    "wait_mean_ms": round(sum(r["waitSumMs"] for r in rs) / n, 1), "run_mean_ms": round(sum(r["runSumMs"] for r in rs) / n, 2)}
    out["pools_busy"] = pools
    tq = sum(R.values()) or 1
    out["http_top"] = [
        {"route": r, "req": n, "mean_ms": round(s / max(n, 1), 1), "gwReq_queries": R.get(r, 0),
         "q_per_req": round(R.get(r, 0) / max(n, 1), 2), "share_pct": round(100 * R.get(r, 0) / tq, 1)}
        for r, (n, s) in sorted(H.items(), key=lambda x: -R.get(x[0], 0))[:10]
    ]
    return out


print(json.dumps([wave(w) for w in WAVES], ensure_ascii=False, indent=1))
