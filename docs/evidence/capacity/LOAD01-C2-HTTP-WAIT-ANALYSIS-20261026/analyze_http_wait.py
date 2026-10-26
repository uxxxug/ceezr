#!/usr/bin/env python3
"""تحليلُ انتظارِ مقعدِ gatewayRequest في مسارِ HTTP — موجاتُ قياسِ C2 المقترنة.

استخدام: python3 analyze_http_wait.py --raw-dir DIR --out FILE
يقرأُ موجاتِ -M-1500 الثمانيَ (الأزواجُ الأربعةُ) وموجتَي التحقّقِ -M-100،
ويُخرجُ JSON يُوثّقُ: بصماتِ كلِّ المدخلاتِ، عدَّ pdb المصفّى (مجمّعُ
gatewayRequest وحدَه، kind=query وحدَه)، **المطابقةَ المُلزِمةَ** معَ pagg
(اتحادُ مفاتيحِ الطرفينِ، العددُ ومجموعا الانتظارِ والاحتجازِ، بتسامحٍ مشتقٍّ
منَ التقريبِ)، مئيناتِ العميلِ منَ المولّدِ، ومقارنةَ postgres.

يفشلُ بصوتٍ عالٍ (خروجٌ غيرُ صفريٍّ) عندَ: فقدِ التوقيتِ، أو توليفةِ مجمّع/نوعٍ
غيرِ متوقعةٍ، أو فشلِ المطابقةِ معَ pagg.

تصنيفُ المساراتِ داخلَ gatewayRequest: http:* · drainer:* · (background) —
وredispatch:immediate على gatewayDispatch **خارجُ** هذا المجمّعِ فلا يُعدُّ
معَ الدرينر. ملاحظةُ الأنواع: ‏`tx` حجزٌ مستقلٌّ، و`txQuery` داخلُ المعاملةِ
لا يحجزُ مقعدًا جديدًا؛ البياناتُ المقيسةُ لا تحوي إلا `query`.
"""
import argparse
import collections
import csv
import gzip
import hashlib
import io
import json
import statistics

GATEWAY_REQUEST_POOL = "ceezr:gatewayRequest"
# kind المقبولُ في العدِّ: query (استعلامٌ مستقلٌّ يحجزُ مقعدًا). tx حجزٌ مستقلٌّ
# أيضًا لكنّه لا يظهرُ في هذه الموجات؛ txQuery داخلُ المعاملةِ فلا يُعدُّ.
EXPECTED_KINDS = {"query"}

WAVES_M1500 = ["A1-i80", "B1-i81", "B2-i82", "A2-i83", "A3-i84", "B3-i85", "B4-i86", "A4-i87"]
PAIRS = [("A1-i80", "B1-i81"), ("A2-i83", "B2-i82"), ("A3-i84", "B3-i85"), ("A4-i87", "B4-i86")]
VERIFY = ["S1-i90", "S2-i90"]  # m5-100 وصفيٌّ فقط
ROUTES = ["POST /v1/rides", "POST /v1/session/telegram", "GET /v1/driver/offers"]

# أصنافُ نداءاتِ المولّدِ ذاتِ الصلةِ بمجسّاتِ الأداءِ (الصفُّ الخامُّ يحوي
# ~7000 صنفٍ لمساراتٍ ديناميكيّةٍ فلا تُخزَّنُ كلُّها)
P_LABELS = {"rides_create", "session_exchange", "driver_offer_accept",
            "driver_offers_board", "driver_availability", "driver_location"}


class AnalysisError(SystemExit):
    """فشلٌ صريحٌ: لا يُختلقُ قيمةٌ ولا يُتجاوَزُ خللٌ."""


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


def classify_path(path):
    if path.startswith("http:"):
        return "http"
    if path.startswith("drainer:"):
        return "drainer"
    if path == "(background)":
        return "background"
    return None


def recon_tolerance(n_rows):
    """تسامحُ المطابقةِ مشتقٌّ منَ التقريبِ: كلُّ صفٍّ مجمّعٌ بتقريبِ 0.01
    (pdb وpagg معًا) فأقصى انحرافٍ تراكميٍّ ≈ 0.02·عددُ الصفوف + هامشٌ صغير."""
    return 0.02 * max(1, n_rows) + 0.05


def load_wave(raw_dir, wave, conc):
    base = f"{raw_dir}/load01c2-c2ab-{wave}-M-{conc}"
    tr = f"{base}/load-trace.jsonl.gz"
    http = {}
    pdb = {}          # (pool, path, kind) -> {waitSum, runSum, n}
    pagg = {}
    pdb_rows = collections.Counter()   # صفوفُ pdb لكلِّ مفتاح (للتسامح)
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
            key = (d["pool"], d["path"], d["kind"])
            if d["pool"] != GATEWAY_REQUEST_POOL:
                continue  # مجموعاتٌ أخرى (gatewayDispatch) خارجُ هذا العدِّ
            if d["kind"] not in EXPECTED_KINDS:
                unexpected[("pdb-kind", d["kind"])] += 1
                continue
            if classify_path(d["path"]) is None:
                unexpected[("pdb-path", d["path"])] += 1
                continue
            p = pdb.setdefault(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
            p["waitSum"] += d["waitSumMs"]
            p["runSum"] += d["runSumMs"]
            p["n"] += d["n"]
            pdb_rows[key] += 1
        elif k == "pagg":
            key = (d["pool"], d["path"], d["kind"])
            p = pagg.setdefault(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
            p["waitSum"] += d["waitSumMs"]
            p["runSum"] += d["runSumMs"]
            p["n"] += d["n"]
        elif k == "loop":
            loop.append((d.get("lagP95Ms"), d.get("processCpuPct")))
    if first_at is None or last_at is None or last_at <= first_at:
        raise AnalysisError(f"فقدُ التوقيتِ في {tr}: لا يُختلقُ مدًّى — فشلٌ صريح")
    if unexpected:
        # فحصٌ مُلزِم: لا تمرُّ ملاحظةٌ غيرُ متوقعةٍ بصمتٍ حتى لو لم يكشفها pagg
        raise AnalysisError(f"{tr}: ملاحظاتٌ غيرُ متوقعةٍ: {dict(unexpected)}")
    # — المطابقةُ المُلزِمةُ pdb ↔ pagg (اتحادُ مفاتيحِ gatewayRequest):
    # العددُ ومجموعا الانتظارِ والاحتجازِ، بتسامحٍ مشتقٍّ منَ التقريبِ.
    mismatch = []
    keys = {k for k in set(pdb) | set(pagg) if k[0] == GATEWAY_REQUEST_POOL}
    for key in keys:
        a = pdb.get(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
        b = pagg.get(key, {"waitSum": 0.0, "runSum": 0.0, "n": 0})
        tol = recon_tolerance(pdb_rows.get(key, 0))
        if a["n"] != b["n"] or abs(a["waitSum"] - b["waitSum"]) > tol or abs(a["runSum"] - b["runSum"]) > tol:
            mismatch.append({"key": list(key), "pdb": a, "pagg": b, "tol": round(tol, 3)})
    if mismatch:
        raise AnalysisError(f"فشلُ مطابقةِ pdb↔pagg في {tr}: {mismatch[:5]}")
    # مئيناتُ العميلِ منَ المولّدِ (الصفُّ التراكميُّ الأخير)
    client = None
    for d in iter_jsonl(f"{base}/load-events.jsonl.gz"):
        if d.get("event") == "latency_percentiles" and d.get("gen") == "genA":
            client = {kk: v for kk, v in d.items() if kk in P_LABELS or kk in ("t", "sinceStartMs")}
    return {
        "http": http, "pdb": pdb, "loop": loop,
        "span_ms": last_at - first_at, "client": client,
    }


def pgss_pair(raw_dir, a, b):
    """أعلى الاستعلاماتِ المشترَكةِ (مطابقةُ النصِّ الكاملِ — المفتاحُ بصمةُ
    النصِّ لا مقطعٌ منه فلا يُكتبُ فوقَ آخر): متوسطُ زمنِ التنفيذِ لكلِّ نداءٍ."""
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
        out[hashlib.sha1(q.encode()).hexdigest()[:12]] = {
            "queryPrefix": q[:90], "callsA": ca, "callsB": cb,
            "meanExecA_ms": ta_ / ca, "meanExecB_ms": tb_ / cb,
            "meanBA": (tb_ / cb) / (ta_ / ca)}
    return out


def class_totals(pdb):
    t = {"http": 0, "drainer": 0, "background": 0, "http_wait_s": 0.0}
    for (pool, path, kind), v in pdb.items():
        c = classify_path(path)
        t[c] += v["n"]
        if c == "http":
            t["http_wait_s"] += v["waitSum"] / 1000
    return t


def windows_for(raw_dir, w, conc=1500):
    """نوافذُ 5ث منَ الممرِّ الزمنيِّ نفسِه، بالترشيحِ نفسِه (المجمّعُ والنوع)."""
    rows = []
    last_at = None
    acc = {"hn": 0, "hw": 0.0, "dn": 0, "bg": 0}
    for d in iter_jsonl(f"{raw_dir}/load01c2-c2ab-{w}-M-{conc}/load-trace.jsonl.gz"):
        if d.get("k") != "pdb":
            continue
        if d["pool"] != GATEWAY_REQUEST_POOL or d["kind"] not in EXPECTED_KINDS:
            continue
        if classify_path(d["path"]) is None:
            continue
        if last_at is not None and d["at"] != last_at:
            if acc["hn"] > 0:
                rows.append(acc)
            acc = {"hn": 0, "hw": 0.0, "dn": 0, "bg": 0}
        c = classify_path(d["path"])
        if c == "http":
            acc["hn"] += d["n"]
            acc["hw"] += d["waitSumMs"]
        elif c == "drainer":
            acc["dn"] += d["n"]
        else:
            acc["bg"] += d["n"]
        last_at = d["at"]
    if acc["hn"] > 0:
        rows.append(acc)
    return rows


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
            "pgss-full.csv.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-1500/pgss-full.csv.gz")}
    for w in VERIFY:
        vw = load_wave(args.raw_dir, w, 100)
        out["verify_waves"][w] = {
            "http_route": {r: {"n": v["n"], "mean_ms": v["sumMs"] / v["n"]}
                          for r, v in vw["http"].items() if v["n"] > 0},
            "client_percentiles": vw["client"],
            "span_s": vw["span_ms"] / 1000}
        out["inputs"][w] = {
            "load-trace.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-100/load-trace.jsonl.gz"),
            "load-events.jsonl.gz": sha256_file(f"{args.raw_dir}/load01c2-c2ab-{w}-M-100/load-events.jsonl.gz")}

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
            pa = D[a]["pdb"].get((GATEWAY_REQUEST_POOL, path, "query"))
            pb = D[b]["pdb"].get((GATEWAY_REQUEST_POOL, path, "query"))
            if pa and pb and pa["n"] > 0 and pb["n"] > 0:
                r["pool_paths"][path] = {
                    "nA": pa["n"], "nB": pb["n"],
                    "waitA_ms": pa["waitSum"] / pa["n"], "waitB_ms": pb["waitSum"] / pb["n"],
                    "waitBA": (pb["waitSum"] / pb["n"]) / (pa["waitSum"] / pa["n"]),
                    "runA_ms": pa["runSum"] / pa["n"], "runB_ms": pb["runSum"] / pb["n"],
                    "runBA": (pb["runSum"] / pb["n"]) / (pa["runSum"] / pa["n"])}
        ta, tb = class_totals(D[a]["pdb"]), class_totals(D[b]["pdb"])
        gt = {
            "httpAcq": {"A": ta["http"], "B": tb["http"], "BA": tb["http"] / ta["http"]},
            "drainerAcq": {"A": ta["drainer"], "B": tb["drainer"], "BA": tb["drainer"] / ta["drainer"]},
            "backgroundAcq": {"A": ta["background"], "B": tb["background"]},
            "totalAcq": {"A": ta["http"] + ta["drainer"] + ta["background"],
                         "B": tb["http"] + tb["drainer"] + tb["background"]},
            "httpWaitTotal_s": {"A": ta["http_wait_s"], "B": tb["http_wait_s"]}}
        gt["totalAcq"]["BA"] = gt["totalAcq"]["B"] / gt["totalAcq"]["A"]
        gt["httpWaitTotal_s"]["BA"] = gt["httpWaitTotal_s"]["B"] / gt["httpWaitTotal_s"]["A"]
        r["gateway_request_totals"] = gt
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
        r["client_percentiles"] = {"A": D[a]["client"], "B": D[b]["client"]}
        r["postgres_top_queries"] = pgss_pair(args.raw_dir, a, b)
        out["per_pair"][f"{a}_vs_{b}"] = r

    # شرائحُ صريحةٌ: الحدُّ الأدنى k يشملُ [k, k+999]
    A_pts, B_pts = [], []
    for w in WAVES_M1500:
        for x in windows_for(args.raw_dir, w):
            if x["hn"] > 100:
                (A_pts if w.startswith("A") else B_pts).append(
                    (x["hn"], x["dn"] + x["bg"], x["hw"] / x["hn"]))

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
