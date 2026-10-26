#!/usr/bin/env python3
"""تحليلُ انتظارِ مقعدِ gatewayRequest في مسارِ HTTP — موجاتُ قياسِ C2 المقترنة.

استخدام: python3 analyze_http_wait.py [--raw-dir DIR] [--out FILE]
يقرأُ موجاتِ -M-1500 الثمانيَ (الأزواجُ الأربعةُ) وموجتَي التحقّقِ -M-100،
ويُخرجُ JSON يُوثّقُ: بصماتِ المدخلاتِ، عدَّ pdb المصفّى (مجمّعُ gatewayRequest
وحده، نوعُ query وحده)، المطابقةَ مع pagg، مئيناتِ العميلِ من المولّد،
ومقارنةَ postgres. يفشلُ بصوتٍ عالٍ عندَ فقدِ التوقيتِ أو ظهورِ توليفةِ
مجمّع/نوعٍ غيرِ متوقعةٍ.

تصنيفُ المساراتِ داخلَ gatewayRequest: http:* · drainer:* · (background) —
وredispatch:immediate على gatewayDispatch **خارجُ** هذا المجمّعِ فلا يُعدُّ
معَ الدرينرِ (خطأُ النسخةِ الأولى، مُصحَّحٌ هنا).
"""
import argparse
import collections
import csv
import gzip
import hashlib
import io
import json
import statistics
import sys

GATEWAY_REQUEST_POOL = "ceezr:gatewayRequest"
EXPECTED_KINDS = {"query"}  # tx/txQuery لا تحجزُ مقعدًا مستقلًّا؛ إن ظهرت فالسكربتُ يصرخ

WAVES_M1500 = ["A1-i80", "B1-i81", "B2-i82", "A2-i83", "A3-i84", "B3-i85", "B4-i86", "A4-i87"]
PAIRS = [("A1-i80", "B1-i81"), ("A2-i83", "B2-i82"), ("A3-i84", "B3-i85"), ("A4-i87", "B4-i86")]
VERIFY = ["S1-i90", "S2-i90"]  # m5-100 وصفيٌّ فقط
ROUTES = ["POST /v1/rides", "POST /v1/session/telegram", "GET /v1/driver/offers"]


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def open_maybe_gz(path):
    if path.endswith(".gz"):
        return gzip.open(path, "rt")
    return open(path, "rt")


def iter_jsonl(path):
    with open_maybe_gz(path) as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def pct(sorted_vals, q):
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def classify_path(path):
    if path.startswith("http:"):
        return "http"
    if path.startswith("drainer:"):
        return "drainer"
    if path == "(background)":
        return "background"
    return None  # غيرُ متوقعٍ على gatewayRequest


def load_wave(raw_dir, wave, conc):
    base = f"{raw_dir}/load01c2-c2ab-{wave}-M-{conc}"
    tr = f"{base}/load-trace.jsonl.gz"
    http = {}          # route -> {n, sumMs}
    pdb = {}           # (pool, path) -> {waitSum, runSum, n}  (المصفّى)
    pagg = {}          # (pool, path) -> {waitSum, runSum, n}  (الإجماليُّ عندَ الإيقاف)
    loop = []
    first_at = last_at = None
    unexpected = collections.Counter()
    for d in iter_jsonl(tr):
        at = d.get("at")
        if at is not None:
            if first_at is None or at < first_at:
                first_at = at
            if last_at is None or at > last_at:
                last_at = at
        k = d.get("k")
        if k == "http":
            e = http.setdefault(d["route"], {"n": 0, "sumMs": 0.0})
            e["n"] += d["n"]
            e["sumMs"] += d["sumMs"]
        elif k == "pdb":
            if d["pool"] != GATEWAY_REQUEST_POOL:
                continue  # مجموعاتٌ أخرى (gatewayDispatch) لا تُحسبُ هنا
            if d["kind"] not in EXPECTED_KINDS:
                unexpected[("pdb", d["kind"])] += 1
                continue
            key = (d["pool"], d["path"])
            p = pdb.setdefault(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
            p["waitSum"] += d["waitSumMs"]
            p["runSum"] += d["runSumMs"]
            p["n"] += d["n"]
            if classify_path(d["path"]) is None:
                unexpected[("pdb-path", d["path"])] += 1
        elif k == "pagg":
            key = (d["pool"], d["path"])
            p = pagg.setdefault(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
            p["waitSum"] += d["waitSumMs"]
            p["runSum"] += d["runSumMs"]
            p["n"] += d["n"]
        elif k == "loop":
            loop.append((d.get("lagP95Ms"), d.get("processCpuPct")))
    if first_at is None or last_at is None or last_at <= first_at:
        raise SystemExit(f"فقدُ التوقيتِ في {tr}: لا يُختلقُ مدًّى — فشلٌ صريح")
    # مطابقةُ pdb (النوافذ) معَ pagg (الإجمالي) لكلِّ مسارٍ على gatewayRequest
    recon = {}
    for key, tot in pagg.items():
        if key[0] != GATEWAY_REQUEST_POOL:
            continue
        win = pdb.get(key)
        recon[key[1]] = {
            "pagg_n": tot["n"], "pdb_n": win["n"] if win else 0,
            "pagg_waitSum": tot["waitSum"], "pdb_waitSum": round(win["waitSum"], 2) if win else 0,
        }
    # مئيناتُ العميلِ منَ المولّدِ (الصفُّ التراكميُّ الأخير) — مقتصرةٌ على أصنافِ
    # نداءاتِ مجسّاتِ الأداءِ (الصفُّ الخامُّ يحوي ~7000 صنفٍ لِمساراتٍ ديناميكيّةٍ)
    client = None
    P_LABELS = {"rides_create", "session_exchange", "driver_offer_accept",
               "driver_offers_board", "driver_availability", "driver_location"}
    for d in iter_jsonl(f"{base}/load-events.jsonl.gz"):
        if d.get("event") == "latency_percentiles" and d.get("gen") == "genA":
            client = {k: v for k, v in d.items()
                      if k in P_LABELS or k in ("t", "sinceStartMs")}  # الأخيرُ يفوزُ
    return {
        "http": http, "pdb": pdb, "pagg": pagg, "loop": loop,
        "span_ms": last_at - first_at, "recon": recon,
        "unexpected": dict(unexpected), "client": client,
    }


def pgss_pair(raw_dir, a, b):
    """أعلى الاستعلاماتِ المشترَكةِ (مطابقةُ النصِّ الكاملِ لا أوّلِ 70 محرفًا):
    متوسطُ زمنِ التنفيذِ لكلِّ نداءٍ في الذراعين — لا يُدّعى منه اتجاهٌ دونَ اتجاه."""
    def load(w):
        rows = {}
        with open_maybe_gz(f"{raw_dir}/load01c2-c2ab-{w}-M-1500/pgss-full.csv.gz") as f:
            for row in csv.DictReader(io.StringIO(f.read())):
                try:
                    c, t = float(row["calls"]), float(row["total_ms"])
                except (KeyError, ValueError):
                    continue
                if c >= 1000:
                    rows[row["query"]] = (c, t)
        return rows
    da, db_ = load(a), load(b)
    common = set(da) & set(db_)
    top = sorted(common, key=lambda q: da[q][1], reverse=True)[:8]
    out = {}
    for q in top:
        ca, ta_ = da[q]
        cb, tb_ = db_[q]
        out[q[:90]] = {"callsA": ca, "callsB": cb,
                       "meanExecA_ms": ta_ / ca, "meanExecB_ms": tb_ / cb,
                       "meanBA": (tb_ / cb) / (ta_ / ca)}
    return out


def pool_path(wave_data, path):
    return wave_data["pdb"].get((GATEWAY_REQUEST_POOL, path))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default="/tmp/wave-artifact/raw")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    out = {"script": "analyze_http_wait.py", "raw_dir": args.raw_dir,
           "gateway_pool": GATEWAY_REQUEST_POOL, "expected_kinds": sorted(EXPECTED_KINDS),
           "inputs": {}, "per_pair": {}, "verify_waves": {}, "buckets": {}, "notes": []}

    D = {}
    for w in WAVES_M1500:
        D[w] = load_wave(args.raw_dir, w, 1500)
        out["inputs"][w] = {
            "load-trace.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-1500/load-trace.jsonl.gz"),
            "load-events.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-1500/load-events.jsonl.gz"),
        }
        if D[w]["unexpected"]:
            out["notes"].append(f"{w}: توليفاتٌ غيرُ متوقعةٍ {D[w]['unexpected']}")
    for w in VERIFY:
        vw = load_wave(args.raw_dir, w, 100)
        out["verify_waves"][w] = {
            "http_route": {r: {"n": v["n"], "mean_ms": v["sumMs"] / v["n"]}
                          for r, v in vw["http"].items() if v["n"] > 0},
            "client_percentiles": vw["client"],
            "span_s": vw["span_ms"] / 1000,
        }
        out["inputs"][w] = {
            "load-trace.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-100/load-trace.jsonl.gz"),
            "load-events.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-100/load-events.jsonl.gz"),
        }

    def class_totals(wave_data):
        t = {"http": 0, "drainer": 0, "background": 0, "http_wait_s": 0.0}
        for (pool, path), v in wave_data["pdb"].items():
            c = classify_path(path)
            if c is None:
                continue
            t[c] += v["n"]
            if c == "http":
                t["http_wait_s"] += v["waitSum"] / 1000
        return t

    for a, b in PAIRS:
        r = {"duration_s": {a: D[a]["span_ms"] / 1000, b: D[b]["span_ms"] / 1000}}
        r["http_route"] = {}
        for route in ROUTES:
            ea, eb = D[a]["http"].get(route), D[b]["http"].get(route)
            if ea and eb and ea["n"] > 0 and eb["n"] > 0:
                r["http_route"][route] = {
                    "nA": ea["n"], "nB": eb["n"],
                    "meanA_ms": ea["sumMs"] / ea["n"], "meanB_ms": eb["sumMs"] / eb["n"],
                    "meanBA": (eb["sumMs"] / eb["n"]) / (ea["sumMs"] / ea["n"])}
        r["pool_paths"] = {}
        for route in ROUTES[:2]:
            path = f"http:{route}"
            pa, pb = pool_path(D[a], path), pool_path(D[b], path)
            if pa and pb and pa["n"] > 0 and pb["n"] > 0:
                r["pool_paths"][path] = {
                    "nA": pa["n"], "nB": pb["n"],
                    "waitA_ms": pa["waitSum"] / pa["n"], "waitB_ms": pb["waitSum"] / pb["n"],
                    "waitBA": (pb["waitSum"] / pb["n"]) / (pa["waitSum"] / pa["n"]),
                    "runA_ms": pa["runSum"] / pa["n"], "runB_ms": pb["runSum"] / pb["n"],
                    "runBA": (pb["runSum"] / pb["n"]) / (pa["runSum"] / pa["n"])}
        ta, tb = class_totals(D[a]), class_totals(D[b])
        r["gateway_request_totals"] = {
            "httpAcq": {"A": ta["http"], "B": tb["http"], "BA": tb["http"] / ta["http"]},
            "drainerAcq": {"A": ta["drainer"], "B": tb["drainer"], "BA": tb["drainer"] / ta["drainer"]},
            "backgroundAcq": {"A": ta["background"], "B": tb["background"]},
            "totalAcq": {"A": ta["http"] + ta["drainer"] + ta["background"],
                        "B": tb["http"] + tb["drainer"] + tb["background"]},
            "httpWaitTotal_s": {"A": ta["http_wait_s"], "B": tb["http_wait_s"]},
        }
        tot_a = r["gateway_request_totals"]["totalAcq"]
        r["gateway_request_totals"]["totalAcq"]["BA"] = tot_a["B"] / tot_a["A"]
        wa = r["gateway_request_totals"]["httpWaitTotal_s"]
        r["gateway_request_totals"]["httpWaitTotal_s"]["BA"] = wa["B"] / wa["A"]
        # معدّلُ **الإنجاز** (لا الوصول): http.n يعدُّ الاكتمالاتِ على امتدادِ الرصدِ كلِّه
        def httpn(w):
            return sum(v["n"] for v in D[w]["http"].values())
        na, nb = httpn(a), httpn(b)
        r["http_completion_rate_per_s"] = {
            "A": na / (D[a]["span_ms"] / 1000), "B": nb / (D[b]["span_ms"] / 1000),
            "BA": (nb / (D[b]["span_ms"] / 1000)) / (na / (D[a]["span_ms"] / 1000))}
        r["loop"] = {
            "lagP95MedA": statistics.median(x[0] for x in D[a]["loop"] if x[0] is not None),
            "lagP95MedB": statistics.median(x[0] for x in D[b]["loop"] if x[0] is not None),
            "procCpuMedA": statistics.median(x[1] for x in D[a]["loop"] if x[1] is not None),
            "procCpuMedB": statistics.median(x[1] for x in D[b]["loop"] if x[1] is not None)}
        # مئيناتُ العميلِ (مقارنةُ العميل/الخادمِ على الموجةِ نفسِها)
        r["client_percentiles"] = {
            "A": D[a]["client"], "B": D[b]["client"]}
        r["pagg_reconciliation_A"] = D[a]["recon"]
        r["postgres_top_queries"] = pgss_pair(args.raw_dir, a, b)
        out["per_pair"][f"{a}_vs_{b}"] = r

    # شرائحُ بمقاديرِ صريحةٍ: الحدُّ الأدنى k يشملُ [k, k+999]
    # بناءُ النوافذِ يتطلّبُ ممرًّا زمنيًّا واحدًا — نعيدُ فتحَ الملفِ لكلِّ موجة
    def windows_for(w, conc=1500):
        rows = []
        last_at = None
        acc = {"hn": 0, "hw": 0.0, "dn": 0}
        for d in iter_jsonl(f"{args.raw_dir}/load01c2-c2ab-{w}-M-{conc}/load-trace.jsonl.gz"):
            if d.get("k") != "pdb" or d.get("pool") != GATEWAY_REQUEST_POOL:
                continue
            if last_at is not None and d["at"] != last_at:
                if acc["hn"] > 0:
                    rows.append(acc)
                acc = {"hn": 0, "hw": 0.0, "dn": 0}
            c = classify_path(d["path"])
            if c == "http":
                acc["hn"] += d["n"]
                acc["hw"] += d["waitSumMs"]
            elif c == "drainer":
                acc["dn"] += d["n"]
            last_at = d["at"]
        if acc["hn"] > 0:
            rows.append(acc)
        return rows

    A_pts, B_pts = [], []
    for w in WAVES_M1500:
        for x in windows_for(w):
            if x["hn"] > 100:
                (A_pts if w.startswith("A") else B_pts).append((x["hn"], x["dn"], x["hw"] / x["hn"]))

    def curve(pts, keyf):
        b = collections.defaultdict(list)
        for hn, dn, wt in pts:
            b[keyf(hn, dn)].append(wt)
        return {f"{k}–{k + 999}": {"n": len(v), "waitMed": statistics.median(v)}
                for k, v in sorted(b.items()) if len(v) >= 3}

    out["buckets"]["equal_http_path_acquisitions_per_window"] = {
        "A": curve(A_pts, lambda h, d: (h // 1000) * 1000),
        "B": curve(B_pts, lambda h, d: (h // 1000) * 1000)}
    out["buckets"]["equal_gateway_request_acquisitions_per_window"] = {
        "A": curve(A_pts, lambda h, d: ((h + d) // 1000) * 1000),
        "B": curve(B_pts, lambda h, d: ((h + d) // 1000) * 1000)}

    with open(args.out, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"ok — pairs: {len(out['per_pair'])} · notes: {out['notes'] or 'none'}")


if __name__ == "__main__":
    main()
