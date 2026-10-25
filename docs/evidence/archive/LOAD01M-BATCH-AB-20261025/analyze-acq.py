#!/usr/bin/env python3
"""تحليلٌ قابلٌ للإعادةِ لحجوزاتِ المجمّعِ (gateAcq) و`psig` لموجاتِ LOAD-01M-BATCH-AB.
الاستخدام: python3 analyze-acq.py [جذرُ الأرشيف] (الافتراضي: جذرُ هذا الملف).
يُخرجُ acq-batch.json: لكلِّ ذراعٍ وموجةٍ — عددُ الوظائف، مجموعُ حجوزاتِ الوظائفِ (gateAcq؛
حجوزاتُ الكنّاسِ وحدها، لا طلبَ المجمّعِ الكلّيَّ)، الحجوزاتُ لكلِّ وظيفةٍ ولكلِّ وظيفةِ contact مكتملةٍ
ولكلِّ دورةٍ اجتازت G1 (مثبتةٍ من القاعدة)، ومجاميعُ `psig` (عملياتُ استعلامٍ مسجّلةً على المجمّعِ) لأهمِّ المسارات.
"""
import json, gzip, glob, os, re, sys, statistics

root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
out = {"per_wave": {}, "per_arm": {}, "note": "gateAcq = حجوزات وظائف الكنّاس حصرًا (ليست طلب المجمّع الكلي). psig.n = عمليات استعلام مسجّلة على المجمّع (مجمععة عبر موجات الذراع). مقام G1 = دورات رحلة كاملة مثبتة من القاعدة (SCENARIO_DEPTH=full)."}
paths = sorted(glob.glob(os.path.join(root, "batchab-*-M-1500")))
for run in paths:
    name = os.path.basename(run)
    arm = open(os.path.join(run, "arm.txt")).read().strip()
    jobs = 0; acq = 0; contact_ok = 0; contact_acq = 0
    g1ok = None
    for line in open(os.path.join(run, "gates.txt")):
        m = re.search(r"G1=([\d.]+)% \((\d+)/(\d+)\)", line)
        if m: g1ok = int(m.group(2))
    with gzip.open(os.path.join(run, "load-trace.jsonl.gz"), "rt") as fh:
        for line in fh:
            d = json.loads(line)
            if d.get("k") == "job":
                jobs += 1; acq += d["gateAcq"]
                if d.get("ok") and d.get("kind") == "contact":
                    contact_ok += 1; contact_acq += d["gateAcq"]
    out["per_wave"][name] = {"arm": arm, "jobs": jobs, "acq_total": acq,
        "acq_per_job": round(acq / jobs, 3),
        "contact_completed": contact_ok, "acq_per_completed_contact_job": round(contact_acq / contact_ok, 3) if contact_ok else None,
        "g1_verified": g1ok, "acq_per_g1_verified": round(acq / g1ok, 2) if g1ok else None}
for arm in ("A", "B"):
    ws = [v for v in out["per_wave"].values() if v["arm"] == arm]
    out["per_arm"][arm] = {
        "acq_total_4waves": sum(w["acq_total"] for w in ws),
        "acq_per_job_mean": round(statistics.mean(w["acq_per_job"] for w in ws), 3),
        "acq_per_completed_contact_job_mean": round(statistics.mean(w["acq_per_completed_contact_job"] for w in ws), 3),
        "acq_per_g1_verified_mean": round(statistics.mean(w["acq_per_g1_verified"] for w in ws), 2)}
out["drainer_acq_reduction_pct"] = round(100 * (1 - out["per_arm"]["B"]["acq_total_4waves"] / out["per_arm"]["A"]["acq_total_4waves"]), 1)
with open(os.path.join(root, "acq-batch.json"), "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(json.dumps(out["per_arm"], ensure_ascii=False), "drainer_acq_reduction_pct:", out["drainer_acq_reduction_pct"])

# psig لمساراتِ HTTP — كلُّ السجلاتِ على المجمّعِ ceezr:gatewayRequest، والنوعانِ query وtxQuery
# (مسارُ التسجيلِ في A يجمعُ النوعَينِ معًا؛ txQuery اختفى في B — أثرُ #659). مجمعةٌ عبرَ موجاتِ الذراعِ الأربع.
res = {}
for run in paths:
    arm = open(os.path.join(run, "arm.txt")).read().strip()
    with gzip.open(os.path.join(run, "load-trace.jsonl.gz"), "rt") as fh:
        for line in fh:
            d = json.loads(line)
            if d.get("k") == "psig" and d["path"].startswith("http:") and d["pool"] == "ceezr:gatewayRequest":
                e = res.setdefault(d["path"], {}).setdefault(d["kind"], {"A": {"n": 0, "waitMs": 0.0}, "B": {"n": 0, "waitMs": 0.0}})
                e[arm]["n"] += d["n"]; e[arm]["waitMs"] += d["waitMs"]
ps = {p: {k: {a: {"n": int(v[a]["n"]), "waitMs_sum": round(v[a]["waitMs"])} for a in ("A", "B")} for k, v in ks.items()} for p, ks in sorted(res.items())}
with open(os.path.join(root, "psig-http.json"), "w") as f:
    json.dump(ps, f, ensure_ascii=False, indent=1)
print("psig-http.json:", len(ps), "مسارًا")
