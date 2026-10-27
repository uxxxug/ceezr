#!/usr/bin/env python3
"""اختبارٌ ذاتيٌّ لـbase-analyze.py على موجاتٍ مصغّرةٍ معروفةِ النتائج (شرطُ §6 من البروتوكول)."""
import gzip, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "base-analyze.py")


def mkwave(root, name, ok, total, acq):
    d = os.path.join(root, name)
    os.makedirs(d)
    fails = total - ok
    with gzip.open(os.path.join(d, "miniapp-load-events.jsonl.gz"), "wt") as f:
        for i in range(fails):
            f.write(json.dumps({"event": "driver.onboarding_failed", "steps": {"session": "ok", "phoneProofWebhook": 200, "phoneProofJob": "timeout", "onboardingPost": 409, "dbPendingVerified": False}}) + "\n")
    with gzip.open(os.path.join(d, "update-jobs.csv.gz"), "wt") as f:
        for i in range(total):
            lat = 25000 if i < fails else 5000
            f.write(f"driver,{i},{1000 + i * 10},{1000 + i * 10 + lat},done,1,contact\n")
    stat = {"n": total, "p50": 1, "p90": 1, "p99": 1, "mean": 100.0}
    jt = {"g1": {"ok": ok, "total": total, "pct": round(ok / total * 100, 2)},
          "all": {"n": total, "notDone": 0, "queue": dict(stat, mean=19000.0), "claim": dict(stat, mean=80.0), "exec": dict(stat, mean=250.0), "gateWait": dict(stat, mean=240.0)},
          "pool": {"seats": 5, "saturatedWindows": 30, "windows": 50, "totalWaitS": 100.0, "totalHoldS": 10.0,
                   "byPath": [{"path": "http:POST /v1/driver/location", "n": 10, "waitS": 50.0, "holdS": 2.0}, {"path": "drainer:job:driver:contact", "n": 5, "waitS": 20.0, "holdS": 1.0}]}}
    json.dump(jt, open(os.path.join(d, "job-timeline.json"), "w"))
    json.dump({"verdict": "FAIL", "failedGates": ["G1"]}, open(os.path.join(d, "wave-report.json"), "w"))
    open(os.path.join(d, "gates.txt"), "w").write(f"verdict FAIL\nG1={ok/total*100:.2f}% ({ok}/{total})✗ | G2=0 | P4=6000ms\n")
    with open(os.path.join(d, "load-trace.jsonl"), "w") as f:
        for i in range(total):
            f.write(json.dumps({"k": "job", "kind": "contact", "gateAcq": acq}) + "\n")
        f.write(json.dumps({"k": "job", "kind": "message", "gateAcq": 4}) + "\n")
    return d


def run(out, dirs):
    p = subprocess.run([sys.executable, TOOL, "summary", out, *dirs], capture_output=True, text=True)
    return p.returncode, json.load(open(out)) if os.path.exists(out) else None


def main():
    fails = 0
    cases = [
        ("established", [(43, 100, 2), (45, 100, 2), (44, 100, 2), (46, 100, 2)], 0, "BASELINE_ESTABLISHED"),
        ("mech", [(43, 100, 3), (45, 100, 3), (44, 100, 3), (46, 100, 3)], 3, "BASELINE_MECH_MISMATCH"),
        ("unstable", [(40, 100, 2), (48, 100, 2), (44, 100, 2), (45, 100, 2)], 3, "BASELINE_UNSTABLE"),
        ("incomplete", [(43, 100, 2), (45, 100, 2), (44, 100, 2)], 3, "BASELINE_INCOMPLETE"),
    ]
    for name, spec, want_rc, want in cases:
        with tempfile.TemporaryDirectory() as t:
            dirs = [mkwave(t, f"{name}-{i}", *w) for i, w in enumerate(spec)]
            rc, s = run(os.path.join(t, "s.json"), dirs)
            ok = rc == want_rc and s is not None and s["verdict"] == want
            if ok and want == "BASELINE_ESTABLISHED":
                w0 = s["waves"][0]
                ok = (s["g1_median"] == 44.5 and s["g1_range_pts"] == 3 and w0["contact_acq"]["per_job"] == 2.0
                      and w0["onboarding"]["failed_with_phoneProofJob_timeout_share"] == 1.0
                      and w0["pool"]["driver_location"]["waitS"] == 50.0 and w0["gates"]["G2"] == "0")
            print(("PASS" if ok else "FAIL"), name, rc, s and s["verdict"])
            fails += 0 if ok else 1
    print("BASE_ANALYZER_SELFTEST", "OK" if fails == 0 else f"FAIL({fails})")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
