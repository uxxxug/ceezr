import gzip, json, sys
from collections import defaultdict

# شرط الاستقرار (§11) كما في RESULT §4: p95 زمن الدورة من أحداث scenario.end
# (elapsedMs) لكل نافذة 10 دقائق؛ النسبة = آخر نافذة/أول نافذة ≤ 1.5×.

def p95(vals):
    s = sorted(vals)
    if not s: return None
    k = max(0, min(len(s) - 1, round(0.95 * (len(s) - 1))))
    return s[k]

def analyze(root, wave):
    events = []
    with gzip.open(f"{root}/miniapp-load-events.jsonl.gz", "rt") as f:
        for line in f:
            d = json.loads(line)
            if d.get("event") == "scenario.end":
                events.append((d["t"], d["elapsedMs"]))
    t0 = events[0][0]
    import datetime
    t0 = datetime.datetime.fromisoformat(t0.replace("Z", "+00:00")).timestamp() * 1000
    buckets = defaultdict(list)
    for t, ms in events:
        ts = datetime.datetime.fromisoformat(t.replace("Z", "+00:00")).timestamp() * 1000
        buckets[int((ts - t0) / 600000)].append(ms)
    print(f"== {wave} (n={len(events)}) ==")
    for k in sorted(buckets):
        if len(buckets[k]) < 500: continue
        print(f"  +{k*10}min: n={len(buckets[k]):6d} p95={p95(buckets[k]):6.0f}ms")
    keys = [k for k in sorted(buckets) if len(buckets[k]) >= 500]
    first, last = p95(buckets[keys[0]]), p95(buckets[keys[-1]])
    ratio = last / first
    print(f"  النسبة (آخر/أول): {ratio:.2f} ({first:.0f}ms → {last:.0f}ms) — {'PASS' if ratio <= 1.5 else 'FAIL'}\n")

base, prev = sys.argv[1], sys.argv[2]
analyze(f"{prev}/prev-r10-a/raw/load01m-soak2-r10-a-M-500", "prev-r10-a")
analyze(f"{prev}/prev-r10-b/raw/load01m-soak2-r10-b-M-500", "prev-r10-b")
analyze(f"{base}/r10-a/raw/load01m-soak2-r10-a-M-500", "r10-a (الجديدة)")
analyze(f"{base}/r10-b/raw/load01m-soak2-r10-b-M-500", "r10-b (الجديدة)")
