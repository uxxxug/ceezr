"""حصّةُ وظائفِ الكنّاسِ من حجوزاتِ مقعدِ gatewayRequest وانتظارِه في أرشيفِ LOAD01M-MIXED-AB-20261025.
الحجزُ = سجلُّ pdb بنوعٍ غيرِ txQuery (كما يعدُّه load-trace.ts: استعلامُ المعاملةِ لا يحجزُ مقعدًا جديدًا).
التشغيل: python3 docs/evidence/capacity/LOAD01-POOL-ACQ-20261025/drainer-share.py"""
import collections, glob, gzip, json
tot_n = tot_w = 0.0
n = collections.Counter(); w = collections.Counter(); jobs = 0
for f in sorted(glob.glob("docs/evidence/archive/LOAD01M-MIXED-AB-20261025/*/load-trace.jsonl.gz")):
    for line in gzip.open(f, "rt"):
        d = json.loads(line)
        if d["k"] == "job":
            jobs += 1
        if d["k"] != "pdb" or d["kind"] == "txQuery":
            continue
        tot_n += d["n"]; tot_w += d["waitSumMs"]
        if d["path"].startswith("drainer:job"):
            n[d["path"]] += d["n"]; w[d["path"]] += d["waitSumMs"]
s = sum(n.values())
print(json.dumps({"all_acq": int(tot_n), "drainer_job_acq": s, "acq_share": round(s / tot_n, 4),
                  "wait_share": round(sum(w.values()) / tot_w, 4), "jobs": jobs,
                  "one_acq_per_job_share": round(jobs / tot_n, 4), "by_path": dict(n.most_common())},
                 ensure_ascii=False, indent=2))
