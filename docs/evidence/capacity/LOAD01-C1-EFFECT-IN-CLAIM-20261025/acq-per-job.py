"""حجوزات gatewayRequest لكل وظيفة كنّاس — محكّ C1_RULE للدورة الخامسة (التشغيل 40160348095).
gateAcq من سجلات k=job في load-trace.jsonl.gz لكل موجة ولكل نوع، مع التكسير الشامل من سجلات pdb.
التشغيل على الأرشيف الخام: python3 acq-per-job.py <raw-wave-dir> [<raw-wave-dir> ...]
"""
import collections, glob, gzip, json, sys, os

def load(p):
    jobs = collections.Counter()
    acq = collections.Counter()
    pdb_job_acq = 0
    n_lines = 0
    for f in sorted(glob.glob(os.path.join(p, "load-trace.jsonl.gz"))):
        for line in gzip.open(f, "rt"):
            n_lines += 1
            d = json.loads(line)
            if d.get("k") == "job":
                k = d.get("kind", "?")
                jobs[k] += 1
                acq[k] += d.get("gateAcq", 0)
            elif d.get("k") == "pdb" and d.get("kind") != "txQuery" and str(d.get("path", "")).startswith("drainer:job"):
                pdb_job_acq += d.get("n", 0)
    return jobs, acq, pdb_job_acq, n_lines

rows = []
for p in sys.argv[1:]:
    arm = "A"
    ap = os.path.join(p, "arm.txt")
    if os.path.exists(ap):
        arm = open(ap).read().strip() or "A"
    jobs, acq, pdb_job_acq, n_lines = load(p)
    tot_j = sum(jobs.values()); tot_a = sum(acq.values())
    per = {k: round(acq[k] / jobs[k], 3) for k in sorted(jobs)}
    rows.append({"wave": os.path.basename(p), "arm": arm, "jobs": tot_j,
                 "acq_per_job_all": round(tot_a / tot_j, 4) if tot_j else None,
                 "acq_per_job_by_kind": per,
                 "pdb_drainer_job_acq": pdb_job_acq,
                 "pdb_over_job": round(pdb_job_acq / tot_j, 3) if tot_j else None,
                 "trace_lines": n_lines})
    print(json.dumps(rows[-1], ensure_ascii=False))

by_arm = collections.defaultdict(list)
for r in rows:
    by_arm[r["arm"]].append(r)
for arm, rs in sorted(by_arm.items()):
    jj = sum(r["jobs"] for r in rs)
    aa = sum((r["acq_per_job_by_kind"] and 0) for r in rs)  # placeholder, per-kind below
    kinds = collections.defaultdict(lambda: [0, 0])
    for r in rs:
        for k, v in r["acq_per_job_by_kind"].items():
            pass  # نسب الوسيط تُحسب من الموجات مباشرة في تحليل النتيجة
print(json.dumps({"arms": {a: len(v) for a, v in by_arm.items()}}, ensure_ascii=False))
