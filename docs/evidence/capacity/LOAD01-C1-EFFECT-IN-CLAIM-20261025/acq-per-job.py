"""حجوزات gatewayRequest لكل وظيفة كنّاس — محكّ C1_RULE للدورة الخامسة (التشغيل 40160348095).
gateAcq من سجلات k=job في load-trace.jsonl.gz لكل موجة ولكل نوع، مع التوزيع الكامل (لا المتوسط
وحده) والتكسير الشامل من سجلات pdb (مفلترة على pool=ceezr:gatewayRequest) والتحقق من اكتمال
السجلات ورفض الحقول المطلوبة المفقودة.
التشغيل على الأرشيف الخام: python3 acq-per-job.py <raw-wave-dir> [<raw-wave-dir> ...]
"""
import collections, glob, gzip, json, sys, os

REQUIRED_JOB_FIELDS = ("kind", "gateAcq")


def load(p):
    jobs = collections.Counter()
    acq = collections.Counter()
    dist = collections.Counter()  # (kind, gateAcq) -> n
    missing = collections.Counter()
    pdb_job_acq = collections.Counter()  # pool -> n
    n_lines = 0
    for f in sorted(glob.glob(os.path.join(p, "load-trace.jsonl.gz"))):
        for line in gzip.open(f, "rt"):
            n_lines += 1
            d = json.loads(line)
            if d.get("k") == "job":
                for fld in REQUIRED_JOB_FIELDS:
                    if d.get(fld) is None:
                        missing[fld] += 1
                k = d.get("kind") or "?"
                jobs[k] += 1
                g = d.get("gateAcq")
                if g is not None:
                    acq[k] += g
                    dist[(k, g)] += 1
            elif d.get("k") == "pdb" and d.get("kind") != "txQuery" and str(d.get("path", "")).startswith("drainer:job"):
                pdb_job_acq[d.get("pool")] += d.get("n", 0)
    if missing:
        raise SystemExit(f"حقول مطلوبة مفقودة في سجلات job ({dict(missing)}) — لا يُعتمد التحليل")
    unknown_pools = set(pdb_job_acq) - {"ceezr:gatewayRequest"}
    return jobs, acq, dist, pdb_job_acq, unknown_pools, n_lines


rows = []
for p in sys.argv[1:]:
    arm = "A"
    ap = os.path.join(p, "arm.txt")
    if os.path.exists(ap):
        arm = open(ap).read().strip() or "A"
    else:
        raise SystemExit(f"arm.txt غائب في {p} — لا يُفترض الذراع")
    jobs, acq, dist, pdb_job_acq, unknown_pools, n_lines = load(p)
    if unknown_pools:
        raise SystemExit(f"سجلات pdb على مسارات drainer:job بمجمّعات غير gatewayRequest: {unknown_pools} — لا يُعتمد التحليل")
    tot_j = sum(jobs.values())
    tot_a = sum(acq.values())
    row = {
        "wave": os.path.basename(p), "arm": arm, "jobs": tot_j,
        "acq_per_job_all": round(tot_a / tot_j, 4) if tot_j else None,
        "acq_per_job_by_kind": {k: round(acq[k] / jobs[k], 3) for k in sorted(jobs)},
        "gateAcq_dist": {f"{k}={g}": n for (k, g), n in sorted(dist.items())},
        "jobs_by_kind": dict(sorted(jobs.items())),
        "pdb_drainer_job_acq_gw": pdb_job_acq.get("ceezr:gatewayRequest", 0),
        "pdb_over_job": round(pdb_job_acq.get("ceezr:gatewayRequest", 0) / tot_j, 3) if tot_j else None,
        "trace_lines": n_lines,
    }
    rows.append(row)
    print(json.dumps(row, ensure_ascii=False))
print(json.dumps({"waves": len(rows), "arms": {a: sum(1 for r in rows if r["arm"] == a) for a in ("A", "B")}}, ensure_ascii=False))
