#!/usr/bin/env python3
"""حجوزات gatewayRequest لكل موجة — بالمنهج المعتمد نفسه لدفعة analyze-acq.py.

المصدر المعتمد: load-trace.jsonl.gz — أحداث k=job بحقل gateAcq (عداد الحجوزات
الخاص بكل وظيفة على حدة؛ نفس العداد الذي استخدمته أدلة الدفعة). اختيار موجات
الحكم حسب اللاحقة المسجلة -M-1500 (موجات التحقق S عند -M-100 مستثناة من الحكم
أصلًا). الذراع من arm.txt لا من عدد الوظائف.
يُشغَّل من جذر الأرشيف: python3 analyze-acq.py
"""
import csv, glob, gzip, io, json, os

JUDGMENT_SUFFIX = "-M-1500"

out = {"per_wave": {}, "per_arm": {}}
for w in sorted(glob.glob("load01c2-c2ab-*-M-*")):
    if not w.endswith(JUDGMENT_SUFFIX):
        continue  # موجات التحقق (S) لا تدخل في الحكم
    arm = open(os.path.join(w, "arm.txt")).read().strip()
    kinds = {}
    for line in gzip.open(os.path.join(w, "load-trace.jsonl.gz"), "rt"):
        d = json.loads(line)
        if d.get("k") != "job":
            continue
        k = kinds.setdefault(d["kind"], {"n": 0, "acq": 0, "hist": {}, "ok": 0})
        k["n"] += 1
        k["acq"] += d["gateAcq"]
        k["hist"][d["gateAcq"]] = k["hist"].get(d["gateAcq"], 0) + 1
        if d.get("ok"):
            k["ok"] += 1
    tl = json.load(open(os.path.join(w, "job-timeline.json")))
    g1 = tl["g1"]
    # مصالحة SQL من pgss: نداءات get_user_language والاستعلام المدمج (B فقط)
    sql = {}
    with gzip.open(os.path.join(w, "pgss-full.csv.gz"), "rt") as f:
        for row in csv.reader(f):
            q = row[-1].strip().lower()
            if "select get_user_language(" in q:
                sql["get_user_language_calls"] = int(row[0])
            elif q.startswith("select u.language_code"):
                sql["merged_query_calls"] = int(row[0])
    contact = kinds.get("contact", {"n": 0, "acq": 0, "hist": {}, "ok": 0})
    out["per_wave"][w] = {
        "arm": arm,
        "jobs": sum(k["n"] for k in kinds.values()),
        "acq_total": sum(k["acq"] for k in kinds.values()),
        "kinds": {
            kind: {
                "n": k["n"], "acq": k["acq"],
                "acq_per_job": round(k["acq"] / max(1, k["n"]), 3),
                "hist": dict(sorted(k["hist"].items())), "ok": k["ok"],
            }
            for kind, k in kinds.items()
        },
        "contact_completed": contact["ok"],
        "acq_per_completed_contact_job": round(contact["acq"] / max(1, contact["n"]), 3),
        "g1_verified": g1["ok"], "acq_per_g1_verified": round(contact["acq"] / max(1, g1["ok"]), 2),
        "sql": sql,
    }
for arm in ("A", "B"):
    ws = [v for v in out["per_wave"].values() if v["arm"] == arm]
    c = [v["kinds"]["contact"] for v in ws]
    out["per_arm"][arm] = {
        "waves": len(ws),
        "jobs": sum(v["jobs"] for v in ws),
        "acq_total": sum(v["acq_total"] for v in ws),
        "acq_per_job": round(sum(v["acq_total"] for v in ws) / sum(v["jobs"] for v in ws), 3),
        "contact_jobs": sum(k["n"] for k in c),
        "contact_acq": sum(k["acq"] for k in c),
        "contact_acq_per_job": round(sum(k["acq"] for k in c) / sum(k["n"] for k in c), 4),
        "contact_hist": dict(sorted(
            {h: sum(k["hist"].get(h, 0) for k in c) for h in
             {i for k in c for i in k["hist"]}}.items())),
    }
json.dump(out, open("acq-c2.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(out["per_arm"], ensure_ascii=False))
