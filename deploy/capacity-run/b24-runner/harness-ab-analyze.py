#!/usr/bin/env python3
"""LOAD01-HARNESS-AB — محلّلُ المقارنةِ المقترنةِ لخفضِ أثرِ المراقِب (PROTOCOL-load01-harness-ab.md).

  wave <D> <out.json>        — لموجةٍ واحدة: توقيعاتُ pg_stat_statements لاستطلاعِ المهامِّ وقراءةِ notification_outbox
                               (القديمةُ والمجمّعة)، وإجماليُّ تنفيذِ PostgreSQL، وضغطُ المعالجِ في نافذةِ الموجة،
                               ومآلاتُ phoneProofJob، ومقاييسُ base-analyze للموجةِ نفسِها
  ab <out.json> SLOT:D ...   — قواعدُ §6 المسجَّلةُ مسبقًا: HARNESS_RULE وCORRECT_RULE وAB_RULE (حرفُ C2) وMERGE_RULE
رموزُ الخروج: 0 = صدرَ حكمٌ (أيًّا كان)، غيرُ ذلك = إخفاقُ المحلّل (غيابُ الحكم).
لا عتبةَ قبولٍ هنا: LOAD-01 = FAIL وLOAD-01M = NOT_MET ما لم تصدرْ أدلّةُ قبولٍ رسميّة.
"""
import csv, datetime, gzip, importlib.util, json, os, statistics, sys

# بادئاتُ نصِّ الجملةِ في pg_stat_statements بعدَ طيِّ المسافات
OLD_POLL = "select status from telegram_update_jobs where bot = $"
NEW_POLL = "select update_id::text as update_id, status from telegram_update_jobs where bot ="
OLD_OUTBOX = "select status::text, attempts, delivered_at::text from notification_outbox where order_id = $"
NEW_OUTBOX = "select order_id::text, status::text, attempts, delivered_at::text from notification_outbox"
POLL_RATIO_MAX = 0.02            # §6.2 — جملُ الاستطلاعِ في B ≤ 2% منها في A (الوسيط)
OUTCOMES = {"ok", "dead", "timeout", "not_run"}
AB = {"minPairs": 3, "better": 5.0, "worse": -5.0, "none": 2.0}   # AB_RULE حرفُ C2


def _load(name, file):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), file)
    spec = importlib.util.spec_from_file_location(name, p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _open(d, name):
    p = os.path.join(d, name)
    if os.path.exists(p):
        return open(p, "rt", encoding="utf-8")
    if os.path.exists(p + ".gz"):
        return gzip.open(p + ".gz", "rt", encoding="utf-8")
    raise FileNotFoundError(p)


def _med(xs):
    return round(statistics.median(xs), 2) if xs else None


def pgss(d):
    out = {"total_exec_s": 0.0, "calls": 0}
    for k in ("old_poll", "new_poll", "old_outbox", "new_outbox"):
        out[k] = {"calls": 0, "total_ms": 0.0}
    with _open(d, "pgss-full.csv") as f:
        for r in csv.DictReader(f):
            calls, ms = int(r["calls"]), float(r["total_ms"])
            out["total_exec_s"] += ms / 1000
            out["calls"] += calls
            q = " ".join(r["query"].split())
            for k, pre in (("old_poll", OLD_POLL), ("new_poll", NEW_POLL), ("old_outbox", OLD_OUTBOX), ("new_outbox", NEW_OUTBOX)):
                if q.startswith(pre):
                    out[k]["calls"] += calls
                    out[k]["total_ms"] += ms
    out["total_exec_s"] = round(out["total_exec_s"], 1)
    for k in ("old_poll", "new_poll", "old_outbox", "new_outbox"):
        out[k]["total_ms"] = round(out[k]["total_ms"], 1)
    return out


def _ms(iso):
    return int(datetime.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def events(d):
    win, outcomes, lifecycle, outbox = [None, None], {}, 0, 0
    with _open(d, "miniapp-load-events.jsonl") as f:
        for line in f:
            e = json.loads(line)
            ev = e.get("event")
            if ev == "phase.start" and win[0] is None:
                win[0] = _ms(e["t"])
            elif ev == "phase.end":
                win[1] = _ms(e["t"])
            elif ev in ("driver.onboarding_failed", "driver.onboarded"):
                k = str((e.get("steps") or {}).get("phoneProofJob"))
                outcomes[k] = outcomes.get(k, 0) + 1
            elif ev == "scenario.offer_lifecycle":
                lifecycle += 1
            elif ev == "scenario.offer_outbox":
                outbox += 1
    return {"window_ms": win, "phoneProofJob": outcomes, "offer_lifecycle": lifecycle, "offer_outbox": outbox}


def sched(d, win):
    run, rq, psi, pr = [], [], [], []
    if win[0] is None or win[1] is None:
        return None
    with _open(d, "sched-samples.jsonl") as f:
        for line in f:
            e = json.loads(line)
            if e.get("k") != "sched" or not (win[0] <= e["t"] <= win[1]):
                continue
            pg = e.get("postgres") or {}
            run.append(pg.get("run_pct_1core", 0))
            rq.append(pg.get("runq_wait_pct_1core", 0))
            psi.append(e.get("psi_some_pct", 0))
            pr.append(e.get("procs_running", 0))
    return {"samples": len(run), "pg_run_pct_1core_p50": _med(run), "pg_runq_wait_pct_1core_p50": _med(rq),
            "psi_some_pct_p50": _med(psi), "procs_running_p50": _med(pr)}


def contact_done(d):
    n = 0
    with _open(d, "update-jobs.csv") as f:
        for row in csv.reader(f):
            if len(row) >= 7 and row[0] == "driver" and row[6] == "contact" and row[4] == "done":
                n += 1
    return n


def wave(d):
    base = _load("base_analyze", "base-analyze.py").wave(d)
    arm = open(os.path.join(d, "arm.txt"), encoding="utf-8").read().split()[0] if os.path.exists(os.path.join(d, "arm.txt")) else None
    ev = events(d)
    return {"arm": arm, "pgss": pgss(d), "events": ev, "sched": sched(d, ev["window_ms"]), "contact_done": contact_done(d), "base": base}


def _arm_of(slot):
    return "A" if slot.startswith("A") else "B" if slot.startswith("B") else None


def judge(waves):
    """waves: {SLOT: wave-dict} — دالّةٌ نقيّةٌ (يختبرُها harness-ab-analyze-selftest.py)."""
    reasons = []
    a = {s: w for s, w in waves.items() if _arm_of(s) == "A"}
    b = {s: w for s, w in waves.items() if _arm_of(s) == "B"}
    harness_ok = bool(a and b)
    if not harness_ok:
        reasons.append("أحدُ الذراعين بلا موجاتٍ صالحة")
    for s, w in a.items():
        p = w["pgss"]
        if p["new_poll"]["calls"] or p["new_outbox"]["calls"]:
            harness_ok = False
            reasons.append(f"{s}: الجملُ المجمّعةُ ظهرت في ذراعِ A")
        if not p["old_poll"]["calls"]:
            harness_ok = False
            reasons.append(f"{s}: استطلاعُ A القديمُ غائب — القياسُ لا يمثّلُ main")
    for s, w in b.items():
        p, e = w["pgss"], w["events"]
        if p["old_poll"]["calls"] or p["old_outbox"]["calls"]:
            harness_ok = False
            reasons.append(f"{s}: الجملُ القديمةُ باقيةٌ في B (poll={p['old_poll']['calls']}، outbox={p['old_outbox']['calls']})")
        if not p["new_poll"]["calls"]:
            harness_ok = False
            reasons.append(f"{s}: الاستطلاعُ المجمّعُ غائبٌ في B")
        if e["offer_lifecycle"] and not p["new_outbox"]["calls"]:
            harness_ok = False
            reasons.append(f"{s}: قراءةُ outbox المجمّعةُ غائبةٌ في B")
    a_poll = [w["pgss"]["old_poll"]["calls"] for w in a.values()]
    b_poll = [w["pgss"]["new_poll"]["calls"] for w in b.values()]
    ratio = round(statistics.median(b_poll) / statistics.median(a_poll), 5) if a_poll and b_poll and statistics.median(a_poll) else None
    if ratio is None or ratio > POLL_RATIO_MAX:
        harness_ok = False
        reasons.append(f"نسبةُ جملِ الاستطلاعِ B/A = {ratio} > {POLL_RATIO_MAX}")
    # §6.3 CORRECT_RULE
    correct, notes = True, []
    for s, w in waves.items():
        oc = w["events"]["phoneProofJob"]
        unknown = sorted(set(oc) - OUTCOMES)
        if unknown:
            correct = False
            notes.append(f"{s}: مآلاتُ phoneProofJob غيرُ معروفة {unknown}")
        if oc.get("ok", 0) > w["contact_done"]:
            correct = False
            notes.append(f"{s}: ok={oc.get('ok', 0)} > مهامِّ contact المنجزةِ في القاعدة {w['contact_done']}")
        if _arm_of(s) == "B" and w["events"]["offer_outbox"] != w["events"]["offer_lifecycle"]:
            correct = False
            notes.append(f"{s}: offer_outbox {w['events']['offer_outbox']} ≠ offer_lifecycle {w['events']['offer_lifecycle']}")
    pairs = []
    for i in range(1, 5):
        wa, wb = waves.get(f"A{i}"), waves.get(f"B{i}")
        if wa is None or wb is None:
            continue
        fa = set(wa["base"].get("failedGates") or []) | {"G1"}
        fb = set(wb["base"].get("failedGates") or [])
        if fb - fa:
            correct = False
            notes.append(f"زوج {i}: بوّاباتٌ فاشلةٌ جديدةٌ في B {sorted(fb - fa)}")
        cj = lambda w: w["base"]["onboarding"]["contact_jobs"]
        sc = lambda w, k: (w["sched"] or {}).get(k)
        pairs.append({
            "i": i,
            "g1_a": wa["base"]["g1"]["pct"], "g1_b": wb["base"]["g1"]["pct"],
            "d_pp": round(wb["base"]["g1"]["pct"] - wa["base"]["g1"]["pct"], 2),
            "completed": [wa["base"]["g1"]["ok"], wb["base"]["g1"]["ok"]],
            "pg_exec_s": [wa["pgss"]["total_exec_s"], wb["pgss"]["total_exec_s"]],
            "pg_calls": [wa["pgss"]["calls"], wb["pgss"]["calls"]],
            "pg_run_pct_1core_p50": [sc(wa, "pg_run_pct_1core_p50"), sc(wb, "pg_run_pct_1core_p50")],
            "pg_runq_wait_pct_1core_p50": [sc(wa, "pg_runq_wait_pct_1core_p50"), sc(wb, "pg_runq_wait_pct_1core_p50")],
            "psi_some_pct_p50": [sc(wa, "psi_some_pct_p50"), sc(wb, "psi_some_pct_p50")],
            "contact_p50_ms": [cj(wa).get("p50_ms"), cj(wb).get("p50_ms")],
            "contact_over_20s_share": [cj(wa).get("over_20s_share"), cj(wb).get("over_20s_share")],
            "phoneProofJob": [wa["events"]["phoneProofJob"], wb["events"]["phoneProofJob"]],
            "pool_hold_s": [wa["base"]["pool"].get("totalHoldS"), wb["base"]["pool"].get("totalHoldS")],
            "pool_wait_s": [wa["base"]["pool"].get("totalWaitS"), wb["base"]["pool"].get("totalWaitS")],
        })
    if len(pairs) < AB["minPairs"]:
        g1 = {"decision": "NO_VERDICT", "why": f"{len(pairs)} usable pairs < {AB['minPairs']}", "meanDPp": None}
    else:
        ds = [p["d_pp"] for p in pairs]
        D = round(sum(ds) / len(ds), 2)
        if D >= AB["better"] and all(x > 0 for x in ds):
            dec = "B_BETTER"
        elif D <= AB["worse"] and all(x < 0 for x in ds):
            dec = "B_WORSE"
        elif abs(D) < AB["none"]:
            dec = "NO_DETECTABLE_EFFECT"
        else:
            dec = "UNRESOLVED"
        g1 = {"decision": dec, "why": f"mean Δ {D}pp over {len(ds)} pairs {ds}", "meanDPp": D}
    if not harness_ok:
        g1 = {"decision": "MECH_MISMATCH", "why": "HARNESS_RULE غيرُ محقّقة — لا يُعلَنُ حكمُ G1 (§6.2)", "meanDPp": g1.get("meanDPp")}
    if not harness_ok:
        merge = "BLOCKED — الآليّةُ لم تنخرط"
    elif not correct:
        merge = "BLOCKED — CORRECT_RULE مخالَفة"
    elif g1["decision"] == "B_BETTER":
        merge = "ALLOWED — B_BETTER: أثرُ المراقِبِ كانَ يُنقصُ G1 المقيس (يستوجبُ تفسيرًا من contact p50 وضغطِ المعالج)"
    elif g1["decision"] == "NO_DETECTABLE_EFFECT":
        merge = "ALLOWED — NO_DETECTABLE_EFFECT: أثرُ المراقِبِ ليسَ سببَ إخفاقِ G1"
    else:
        merge = f"BLOCKED — {g1['decision']}"
    return {
        "harness_rule": {"ok": harness_ok, "poll_ratio_b_over_a": ratio, "a_poll_calls": a_poll, "b_poll_calls": b_poll, "reasons": reasons},
        "correct_rule": {"ok": correct, "notes": notes},
        "g1": g1,
        "merge": merge,
        "pairs": pairs,
        "acceptance": "LOAD-01 = FAIL و LOAD-01M = NOT_MET — هذه المقارنةُ ليست قبولًا",
    }


def ab(slots):
    chosen = {}
    for slot, d in slots:
        chosen[slot] = d
    waves = {s: wave(d) for s, d in chosen.items()}
    r = judge(waves)
    r["waves"] = {s: {k: w[k] for k in ("arm", "pgss", "events", "sched", "contact_done")} | {"g1": w["base"]["g1"], "failedGates": w["base"].get("failedGates")} for s, w in waves.items()}
    return r


def main(argv):
    if len(argv) >= 3 and argv[0] == "wave":
        json.dump(wave(argv[1]), open(argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        return 0
    if len(argv) >= 2 and argv[0] == "ab":
        slots = [tuple(a.split(":", 1)) for a in argv[2:]]
        r = ab(slots)
        json.dump(r, open(argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        print("HARNESS_AB", json.dumps({k: r[k] for k in ("harness_rule", "correct_rule", "g1", "merge")}, ensure_ascii=False))
        for p in r["pairs"]:
            print("HARNESS_PAIR", json.dumps(p, ensure_ascii=False))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
