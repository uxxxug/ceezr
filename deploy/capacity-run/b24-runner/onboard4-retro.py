#!/usr/bin/env python3
"""LOAD01 onboard-retro (RUN4) — تحليلٌ استرجاعيٌّ لسببِ driver_onboarding_failed.

قراءةٌ فقط من الأداةِ الخامِ لـRUN4 (لا موجةَ جديدة). لكلِّ موجة:
  - توزيعُ أنماطِ خطواتِ التهيئةِ للفاشلين (miniapp-load-events: driver.onboarding_failed)
  - زمنُ مهامِّ contact من update-jobs.csv (created→done) ونسبةُ ما فوقَ 20s
  - تفكيكُ job-timeline: queue / claim / exec / gateWait، وإشغالُ مجمّعِ gatewayRequest
  - فحصُ قانونِ Little: lanes × mean(claim+exec) مقابلَ الإنتاجيّةِ المقيسة
الاستعمال: onboard4-retro.py <raw_dir> <out.json>
"""
import collections, gzip, json, os, sys

WAIT_MS = 20_000  # PHONE_PROOF_WAIT_MS الافتراضيّ في driver-onboarding.ts (لم يُغيَّر)


def q(v, p):
    return v[min(len(v) - 1, int(p * len(v)))] if v else None


def wave(d, lanes):
    pat = collections.Counter()
    with gzip.open(os.path.join(d, "miniapp-load-events.jsonl.gz"), "rt") as f:
        for line in f:
            if '"driver.onboarding_failed"' not in line:
                continue
            s = json.loads(line)["steps"]
            pat["|".join(str(s[k]) for k in ("session", "phoneProofWebhook", "phoneProofJob", "onboardingPost", "dbPendingVerified"))] += 1
    lat, st, created = [], collections.Counter(), []
    with gzip.open(os.path.join(d, "update-jobs.csv.gz"), "rt") as f:
        for line in f:
            b, u, c, dn, s, a, kind = line.strip().split(",")
            if kind != "contact":
                continue
            st[s] += 1
            created.append(int(c))
            if dn:
                lat.append(int(dn) - int(c))
    lat.sort()
    jt = json.load(open(os.path.join(d, "job-timeline.json")))
    a = jt["all"]
    n_all = a["n"]
    span_s = (max(created) - min(created)) / 1000 if created else None
    per_job_ms = a["claim"]["mean"] + a["exec"]["mean"]
    pool = jt["pool"]
    wr = json.load(open(os.path.join(d, "wave-report.json")))
    failed = sum(pat.values())
    over = sum(x > WAIT_MS for x in lat)
    return {
        "wave": os.path.basename(d),
        "g1": jt["g1"],
        "onboarding_failed": failed,
        "failed_step_patterns": dict(pat.most_common()),
        "failed_with_phoneProofJob_timeout_share": round(sum(v for k, v in pat.items() if k.split("|")[2] == "timeout") / failed, 4) if failed else None,
        "contact_jobs": {"n": len(lat), "status": dict(st), "p50_ms": q(lat, .5), "p90_ms": q(lat, .9), "p99_ms": q(lat, .99), "max_ms": lat[-1] if lat else None, "over_20s": over, "over_20s_share": round(over / len(lat), 4) if lat else None},
        "timeline_all": {k: a[k]["mean"] for k in ("queue", "claim", "exec", "gateWait")} | {"queue_p50": a["queue"]["p50"], "n": n_all, "notDone": a["notDone"]},
        "gatewayRequest_pool": {"seats": pool["seats"], "saturatedWindows": pool["saturatedWindows"], "windows": pool["windows"], "totalWaitS": pool["totalWaitS"], "totalHoldS": pool["totalHoldS"], "top_wait_paths": [{k: p[k] for k in ("path", "n", "waitS", "holdS")} for p in sorted(pool["byPath"], key=lambda p: -p["waitS"])[:6]]},
        "little": {"lanes": lanes, "contact_arrival_span_s": span_s, "jobs_per_s_measured": round(n_all / span_s, 2) if span_s else None, "per_job_ms_claim_plus_exec": round(per_job_ms, 2), "lane_ceiling_jobs_per_s": round(lanes / (per_job_ms / 1000), 2), "lane_utilization": round((n_all / span_s) * per_job_ms / 1000 / lanes, 4) if span_s else None, "exec_share_gateWait": round(a["gateWait"]["mean"] / a["exec"]["mean"], 4)},
        "wave_report_notverified": wr.get("verdict"),
    }


def main():
    raw, out = sys.argv[1], sys.argv[2]
    lanes = int(os.environ.get("LANES", "32"))
    waves = [wave(os.path.join(raw, w), lanes) for w in sorted(os.listdir(raw)) if os.path.isdir(os.path.join(raw, w))]
    summary = {
        "tool": "onboard4-retro.py",
        "wait_ms_reference": WAIT_MS,
        "lanes_source": "TELEGRAM_DRAIN_LANES في deploy/capacity-run/config/run.env (سجلُّ المقعد)",
        "all_failures_are_phoneProofJob_timeout": all(w["failed_with_phoneProofJob_timeout_share"] == 1.0 for w in waves),
        "all_contact_jobs_done": all(w["contact_jobs"]["status"] == {"done": w["contact_jobs"]["n"]} for w in waves),
        "waves": waves,
    }
    json.dump(summary, open(out, "w"), ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({k: summary[k] for k in ("all_failures_are_phoneProofJob_timeout", "all_contact_jobs_done")}))


if __name__ == "__main__":
    main()
