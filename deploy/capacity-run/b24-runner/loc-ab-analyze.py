#!/usr/bin/env python3
"""LOAD01-LOC-AB — محلّلُ المقارنةِ المقترنةِ لقراءةِ driver/location المدمجة (PROTOCOL-load01-loc-ab.md).

  wave <D> <out.json>              — مقاييسُ مسارِ POST /v1/driver/location لموجةٍ واحدة (حجوزات/طلب، انتظار، احتفاظ،
                                     زمنُ الخادم، توزيعُ الحالات، توقيعاتُ psig) + مقاييسُ base-analyze للموجةِ نفسِها
  ab <out.json> SLOT:D ...         — قواعدُ §6 المسجَّلةُ مسبقًا: LOC_RULE (الآليّة) وCORRECT_RULE (السلوك)
                                     وAB_RULE (G1، حرفُ C2) ثمّ توصيةُ MERGE_RULE
رموزُ الخروج: 0 = صدرَ حكمٌ (أيًّا كان)، غيرُ ذلك = إخفاقُ المحلّل (غيابُ الحكم).
لا عتبةَ قبولٍ هنا: LOAD-01 = FAIL وLOAD-01M = NOT_MET ما لم تصدرْ أدلّةُ قبولٍ رسميّة.
"""
import gzip, importlib.util, json, os, statistics, sys

ROUTE = "POST /v1/driver/location"
PATH = "http:POST /v1/driver/location"
# بادئاتُ توقيعاتِ psig (بعدَ طيِّ المسافات) — القراءتانِ المنفصلتانِ في A والمدمجةُ في B
SIG_ACCOUNT = "select role::text as role, is_blocked, language_code from users"
SIG_DRIVER = "select d.id as driver_id, d.city_id, u.telegram_id"
SIG_COMBINED = "select u.role::text as role, u.is_blocked, u.language_code,"
LOC_DROP_MIN, LOC_DROP_MAX = 0.99, 1.01      # §6.2 — حجزٌ واحدٌ بالضبطِ لكلِّ طلب
SIG_SHARE_MIN = 0.99                         # §6.2 — المدمجةُ تغطّي ≥ 99% من طلباتِ B
NON2XX_TOL_PP = 0.1                          # §6.3
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


def _sig(s):
    return " ".join(str(s).split())[:120]


def _count(sigs, prefix):
    return sum(v for k, v in sigs.items() if k.startswith(prefix))


def _q(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(q * len(xs)))], 1)


def location(d):
    n = acq = 0
    wait = hold = 0.0
    srv, dist, status, sigs = [], {}, {}, {}
    with _open(d, "load-trace.jsonl") as f:
        for line in f:
            if "driver/location" not in line:
                continue
            e = json.loads(line)
            if e.get("k") == "httpreq" and e.get("route") == ROUTE:
                n += 1
                a = int(e.get("gateAcquisitions", 0))
                acq += a
                dist[str(a)] = dist.get(str(a), 0) + 1
                wait += e.get("gateWaitMs", 0)
                hold += e.get("gateHoldMs", 0)
                srv.append(e.get("serverMs", 0))
                k = str(e.get("status"))
                status[k] = status.get(k, 0) + 1
            elif e.get("k") == "psig" and e.get("path") == PATH:
                s = _sig(e.get("sig", ""))
                sigs[s] = sigs.get(s, 0) + int(e.get("n", 0))
    non2xx = sum(v for k, v in status.items() if not k.startswith("2"))
    return {
        "requests": n,
        "acq_per_req": round(acq / n, 4) if n else None,
        "acq_dist": dist,
        "wait_ms_per_req": round(wait / n, 1) if n else None,
        "hold_ms_per_req": round(hold / n, 2) if n else None,
        "server_ms": {"p50": _q(srv, 0.5), "p95": _q(srv, 0.95), "p99": _q(srv, 0.99)},
        "status": status,
        "non2xx_pct": round(100 * non2xx / n, 3) if n else None,
        "sig_account": _count(sigs, SIG_ACCOUNT),
        "sig_driver": _count(sigs, SIG_DRIVER),
        "sig_combined": _count(sigs, SIG_COMBINED),
        "sigs": dict(sorted(sigs.items(), key=lambda kv: -kv[1])[:16]),
    }


def wave(d):
    base = _load("base_analyze", "base-analyze.py").wave(d)
    arm = open(os.path.join(d, "arm.txt"), encoding="utf-8").read().split()[0] if os.path.exists(os.path.join(d, "arm.txt")) else None
    return {"arm": arm, "location": location(d), "base": base}


def _arm_of(slot):
    return "A" if slot.startswith("A") else "B" if slot.startswith("B") else None


def ab(slots):
    """slots: [(SLOT, D)] — آخرُ مدخلٍ لكلِّ SLOT هو المعتمَد (الإعادةُ تستبدلُ الأصل)."""
    chosen = {}
    for slot, d in slots:
        chosen[slot] = d
    waves = {s: wave(d) for s, d in chosen.items()}
    reasons = []
    # §6.2 LOC_RULE
    a_acq = [w["location"]["acq_per_req"] for s, w in waves.items() if _arm_of(s) == "A" and w["location"]["acq_per_req"] is not None]
    b_acq = [w["location"]["acq_per_req"] for s, w in waves.items() if _arm_of(s) == "B" and w["location"]["acq_per_req"] is not None]
    loc_ok = bool(a_acq and b_acq)
    drop = round(statistics.median(a_acq) - statistics.median(b_acq), 4) if loc_ok else None
    if not loc_ok:
        reasons.append("لا طلباتِ driver/location مقيسةً في أحدِ الذراعين")
    elif not (LOC_DROP_MIN <= drop <= LOC_DROP_MAX):
        loc_ok = False
        reasons.append(f"انخفاضُ الحجوزات/طلب {drop} خارجَ [{LOC_DROP_MIN}، {LOC_DROP_MAX}]")
    for s, w in waves.items():
        L = w["location"]
        if _arm_of(s) == "B":
            if L["sig_account"] or L["sig_driver"]:
                loc_ok = False
                reasons.append(f"{s}: القراءتانِ المنفصلتانِ باقيتانِ في psig (حساب={L['sig_account']}، سائق={L['sig_driver']})")
            if not L["requests"] or L["sig_combined"] < SIG_SHARE_MIN * L["requests"]:
                loc_ok = False
                reasons.append(f"{s}: المدمجةُ {L['sig_combined']} < {SIG_SHARE_MIN}×{L['requests']}")
        if _arm_of(s) == "A" and L["sig_combined"]:
            loc_ok = False
            reasons.append(f"{s}: المدمجةُ ظهرت في ذراعِ A ({L['sig_combined']})")
    # §6.3 CORRECT_RULE — لكلِّ زوجٍ i: لا رمزَ حالةٍ جديدٌ في B، ولا زيادةَ non2xx فوقَ التسامح، ولا بوّابةَ فاشلةً جديدةٌ غيرُ G1
    pairs, correct, correct_notes = [], True, []
    for i in range(1, 5):
        a, b = waves.get(f"A{i}"), waves.get(f"B{i}")
        if a is None or b is None:
            continue
        la, lb = a["location"], b["location"]
        new_codes = sorted(set(lb["status"]) - set(la["status"]))
        if new_codes:
            correct = False
            correct_notes.append(f"زوج {i}: رموزُ حالةٍ جديدةٌ في B {new_codes}")
        if la["non2xx_pct"] is not None and lb["non2xx_pct"] is not None and lb["non2xx_pct"] > la["non2xx_pct"] + NON2XX_TOL_PP:
            correct = False
            correct_notes.append(f"زوج {i}: non2xx ‏B {lb['non2xx_pct']}% > A {la['non2xx_pct']}% + {NON2XX_TOL_PP}")
        fa = set(a["base"].get("failedGates") or []) | {"G1"}
        fb = set(b["base"].get("failedGates") or [])
        if fb - fa:
            correct = False
            correct_notes.append(f"زوج {i}: بوّاباتٌ فاشلةٌ جديدةٌ في B {sorted(fb - fa)}")
        pairs.append({
            "i": i,
            "g1_a": a["base"]["g1"]["pct"], "g1_b": b["base"]["g1"]["pct"],
            "d_pp": round(b["base"]["g1"]["pct"] - a["base"]["g1"]["pct"], 2),
            "loc_acq": [la["acq_per_req"], lb["acq_per_req"]],
            "loc_wait_ms": [la["wait_ms_per_req"], lb["wait_ms_per_req"]],
            "loc_server_p50": [la["server_ms"]["p50"], lb["server_ms"]["p50"]],
            "contact_p50_ms": [a["base"]["onboarding"]["contact_jobs"].get("p50_ms"), b["base"]["onboarding"]["contact_jobs"].get("p50_ms")],
            "contact_over_20s_share": [a["base"]["onboarding"]["contact_jobs"].get("over_20s_share"), b["base"]["onboarding"]["contact_jobs"].get("over_20s_share")],
            "pool_wait_s": [a["base"]["pool"].get("totalWaitS"), b["base"]["pool"].get("totalWaitS")],
            "pool_hold_s": [a["base"]["pool"].get("totalHoldS"), b["base"]["pool"].get("totalHoldS")],
            "onboarding_failed": [a["base"]["onboarding"]["onboarding_failed"], b["base"]["onboarding"]["onboarding_failed"]],
        })
    # §6.4 AB_RULE — حرفُ C2
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
    if not loc_ok:
        g1 = {"decision": "MECH_MISMATCH", "why": "LOC_RULE غيرُ محقّقة — لا يُعلَنُ حكمُ G1 (§6.2)", "meanDPp": g1.get("meanDPp")}
    # §6.5 MERGE_RULE
    if not loc_ok:
        merge = "BLOCKED — الآليّةُ لم تنخرط"
    elif not correct:
        merge = "BLOCKED — CORRECT_RULE مخالَفة"
    elif g1["decision"] == "B_BETTER":
        merge = "ALLOWED — B_BETTER (يستوجبُ تفسيرًا قبلَ التصديقِ: فوقَ السقفِ المحسوب)"
    elif g1["decision"] == "NO_DETECTABLE_EFFECT":
        merge = "ALLOWED — NO_DETECTABLE_EFFECT: لا يُعلَنُ تحسّنٌ ولا يُعدُّ دليلَ عدمِ ضرر"
    else:
        merge = f"BLOCKED — {g1['decision']}"
    return {
        "loc_rule": {"ok": loc_ok, "drop_acq_per_req": drop, "a_acq": a_acq, "b_acq": b_acq, "reasons": reasons},
        "correct_rule": {"ok": correct, "notes": correct_notes},
        "g1": g1,
        "merge": merge,
        "pairs": pairs,
        "acceptance": "LOAD-01 = FAIL و LOAD-01M = NOT_MET — هذه المقارنةُ ليست قبولًا",
        "waves": waves,
    }


def main(argv):
    if len(argv) >= 3 and argv[0] == "wave":
        json.dump(wave(argv[1]), open(argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        return 0
    if len(argv) >= 2 and argv[0] == "ab":
        slots = [tuple(a.split(":", 1)) for a in argv[2:]]
        r = ab(slots)
        json.dump(r, open(argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1, sort_keys=True)
        print("LOC_AB", json.dumps({k: r[k] for k in ("loc_rule", "correct_rule", "g1", "merge")}, ensure_ascii=False))
        for p in r["pairs"]:
            print("LOC_PAIR", json.dumps(p, ensure_ascii=False))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
