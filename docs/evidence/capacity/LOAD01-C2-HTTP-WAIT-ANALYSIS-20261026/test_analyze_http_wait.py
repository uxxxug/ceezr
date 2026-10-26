#!/usr/bin/env python3
"""اختباراتُ analyze_http_wait.py — عيّناتٌ تركيبيّةٌ كاملة، وفحوصُ الفشلِ الصريح.

تشغيل: python3 test_analyze_http_wait.py
تُبنى عيّناتٌ تركيبيّةٌ لموجاتِ التحليلِ العشرِ (الأزواجُ الثماني + موجتا التحقّق)
في مجلدٍ مؤقّتٍ، ثم يُنادى السكربتُ عبرَ العمليةِ الفرعيّةِ وتُفحصُ:
نجاحُ التشغيلِ وحساباتُه، وترشيحُ المجمّعِ، وحدودُ الشرائحِ، وفشلُه الصريحُ
عندَ فقدِ التوقيتِ أو عبثٍ بمطابقةِ pdb↔pagg.
"""
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "analyze_http_wait.py")
POOL = "ceezr:gatewayRequest"
OTHER_POOL = "ceezr:gatewayDispatch"
AT0 = 1_700_000_000_000  # قيمُ at وهميّةٌ متزايدةٌ


def write_wave(raw, wave, conc, trace_lines, client_row=None):
    d = os.path.join(raw, f"load01c2-c2ab-{wave}-M-{conc}")
    os.makedirs(d, exist_ok=True)
    with gzip.open(os.path.join(d, "load-trace.jsonl.gz"), "wt") as f:
        for row in trace_lines:
            f.write(json.dumps(row) + "\n")
    with gzip.open(os.path.join(d, "load-events.jsonl.gz"), "wt") as f:
        if client_row is not None:
            f.write(json.dumps(client_row) + "\n")
    with gzip.open(os.path.join(d, "pgss-full.csv.gz"), "wt") as f:
        f.write("calls,total_ms,mean_ms,stddev_ms,max_ms,rows,query\n")
        f.write('2000,6000,3,0,10,2000,"select synthetic_probe()"\n')


def build_fixtures(raw, *, tamper_pagg=False, drop_at=False, unexpected_kind=False):
    """موجةٌ واحدةٌ كافيةٌ البنيةِ لكلِّ اسمٍ، وبياناتٌ حقيقيّةُ الشكلِ في زوجٍ واحد.

    الزوجُ ذو المعطيات: A1-i80 وB1-i81 — والأسماءُ الباقيةُ حاملةٌ أدنى بنيةٍ صالحةٍ
    (صفُّ at واحدٌ + pdb/pagg متطابقانِ) فلا تفشلُ فحوصُ المطابقةِ.
    """
    at = AT0

    def win(http_n, http_wait, drain_n, at):
        rows = []
        for path, n, wsum, rsum in [
            ("http:POST /v1/rides", http_n, http_wait, 6.0),
            ("http:POST /v1/session/telegram", http_n // 2, http_wait // 2, 4.0),
            ("drainer:job:bot:contact", drain_n, 30.0, 20.0),
        ]:
            rows.append({"k": "pdb", "at": at, "pool": POOL, "path": path, "kind": "query",
                         "n": n, "waitSumMs": wsum, "runSumMs": rsum,
                         "waitP50Ms": 1, "waitP95Ms": 2, "runP50Ms": 5, "runP95Ms": 7})
        # صفٌّ على مجمّعٍ آخر: لا يُحسَبُ في gatewayRequest إطلاقًا
        rows.append({"k": "pdb", "at": at, "pool": OTHER_POOL, "path": "redispatch:immediate",
                     "kind": "query", "n": 777, "waitSumMs": 5.0, "runSumMs": 1.0,
                     "waitP50Ms": 1, "waitP95Ms": 2, "runP50Ms": 5, "runP95Ms": 7})
        return rows

    def pagg_from(rows):
        # pagg: نفسُ مفاتيحِ gatewayRequest بنفسِ المجاميعِ (أو عبثٌ اختياريٌّ)
        agg = {}
        for r in rows:
            if r["k"] != "pdb" or r["pool"] != POOL:
                continue
            key = (r["pool"], r["path"], r["kind"])
            a = agg.setdefault(key, {"n": 0, "waitSumMs": 0.0, "runSumMs": 0.0})
            a["n"] += r["n"]
            a["waitSumMs"] += r["waitSumMs"]
            a["runSumMs"] += r["runSumMs"]
        out = []
        for (pool, path, kind), a in agg.items():
            out.append({"k": "pagg", "at": AT0 + 99, "pool": pool, "path": path,
                        "kind": kind, **a})
        if tamper_pagg and out:
            out[0]["n"] += 13  # عبثٌ: فشلُ المطابقةِ واجبٌ
        return out

    for w in ["A1-i80", "B1-i81", "B2-i82", "A2-i83", "A3-i84", "B3-i85", "B4-i86", "A4-i87"]:
        if w in ("A1-i80", "B1-i81"):
            http_n, wait, drain = (2000, 30000.0, 700) if w.startswith("A") else (2000, 42000.0, 500)
            if unexpected_kind:
                # صفٌّ بنوعٍ غيرِ متوقعٍ **بلا نظيرٍ في pagg** — يجبُ أن يُفشلَ الفحصُ المُلزِم
                pass
            # ثلاثُ نوافذَ متطابقةِ البنيةِ (لِتُكوِّنَ شريحةً بكتلةٍ كافيةٍ للفحصِ)
            rows = win(http_n, wait, drain, AT0) + win(http_n, wait, drain, AT0 + 5) + win(http_n, wait, drain, AT0 + 10)
            trace = rows + pagg_from(rows) + [
                {"k": "http", "at": AT0, "route": "POST /v1/rides", "n": 100, "sumMs": 15000.0,
                 "p50Ms": 150, "p95Ms": 400, "maxMs": 900, "errors": 0},
                {"k": "loop", "at": AT0, "lagP50Ms": 1, "lagP95Ms": 3, "processCpuPct": 80},
            ]
            if unexpected_kind:
                trace = [{"k": "pdb", "at": AT0, "pool": POOL, "path": "http:POST /v1/rides",
                          "kind": "txQuery", "n": 5, "waitSumMs": 1.0, "runSumMs": 1.0}] + trace
            if drop_at:
                for r in trace:
                    r.pop("at", None)
            client = {"event": "latency_percentiles", "gen": "genA",
                      "rides_create": {"n": 100, "p50": 150, "p95": 400, "p99": 800, "max": 900},
                      "t": "synthetic"}
        else:
            rows = win(10, 100.0, 10, AT0)
            trace = rows + pagg_from(rows) + [
                {"k": "http", "at": AT0, "route": "POST /v1/rides", "n": 10, "sumMs": 1500.0,
                 "p50Ms": 150, "p95Ms": 400, "maxMs": 900, "errors": 0},
                {"k": "loop", "at": AT0, "lagP50Ms": 1, "lagP95Ms": 3, "processCpuPct": 80}]
            client = None
        write_wave(raw, w, 1500, trace, client)

    for w in ["S1-i90", "S2-i90"]:
        rows = win(10, 100.0, 10, AT0)
        trace = rows + pagg_from(rows)
        write_wave(raw, w, 100, trace)


def run(raw, out):
    return subprocess.run([sys.executable, SCRIPT, "--raw-dir", raw, "--out", out],
                          capture_output=True, text=True)


def expect(cond, label):
    if not cond:
        print(f"✗ {label}")
        sys.exit(1)
    print(f"✓ {label}")


def main():
    tmp = tempfile.mkdtemp()
    try:
        raw = os.path.join(tmp, "raw")
        # 1) التشغيلُ السليمُ وحساباتُه
        build_fixtures(raw)
        out = os.path.join(tmp, "analysis.json")
        res = run(raw, out)
        expect(res.returncode == 0, "التشغيلُ السليمُ ينجحُ (خروجٌ صفريٌّ)")
        d = json.load(open(out))
        v = d["per_pair"]["A1-i80_vs_B1-i81"]
        # ترشيحُ المجمّعِ: حجوزاتُ gatewayDispatch (777) غيرُ محسوبةٍ
        gt = v["gateway_request_totals"]
        expect(gt["drainerAcq"]["A"] == 2100, "حجوزاتُ المجمّعِ الآخرِ مستبعدةٌ منَ العدِّ")
        # متوسطُ الانتظار: A=30s/2000=15ms · B=42s/2000=21ms
        pp = v["pool_paths"]["http:POST /v1/rides"]
        expect(abs(pp["waitA_ms"] - 15.0) < 0.01 and abs(pp["waitB_ms"] - 21.0) < 0.01,
               "متوسطُ الانتظارِ لكلِّ حجزٍ محسوبٌ صحيحًا")
        expect(abs(pp["waitBA"] - 1.4) < 0.001, "نسبةُ B/A للانتظارِ صحيحةٌ")
        # حدودُ الشرائحِ: نافذةُ hn=3000 (rides 2000 + session 1000) تقعُ في [3000, 3999]
        b = d["buckets"]["equal_http_path_acquisitions_per_window"]["A"]
        expect("3000–3999" in b and b["3000–3999"]["n"] == 3, "حدُّ الشريحةِ [k, k+999] صحيحٌ")
        expect("2000–2999" not in b and "1000–1999" not in b, "لا شريحةَ لِhn=3000 تحتَ 3000")
        # مئيناتُ العميلِ مفلترةٌ لأصنافِ المجسّاتِ
        cl = v["client_percentiles"]["A"]
        expect(cl.get("rides_create", {}).get("p95") == 400 and len(cl) == 2,
               "مئيناتُ العميلِ مفلترةٌ (rides_create + t)")
        # مطابقةُ pgss بمفتاحِ بصمةِ النصِّ
        pg = v["postgres_top_queries"]
        expect(len(pg) == 1 and "queryPrefix" in next(iter(pg.values())),
               "مفتاحُ postgres بصمةُ النصِّ الكاملِ")

        # 2) فشلُ المطابقةِ عندَ العبثِ بـ pagg
        raw2 = os.path.join(tmp, "raw-tamper")
        build_fixtures(raw2, tamper_pagg=True)
        res2 = run(raw2, os.path.join(tmp, "analysis2.json"))
        expect(res2.returncode != 0 and "pagg" in (res2.stderr + res2.stdout),
               "العبثُ بمطابقةِ pdb↔pagg يُفشلُ السكربتَ صراحةً")

        # 3) فشلُ نوعٍ غيرِ متوقعٍ بلا نظيرٍ في pagg (الفحصُ المُلزِمُ لا يعتمدُ على pagg)
        raw4 = os.path.join(tmp, "raw-unexpected")
        build_fixtures(raw4, unexpected_kind=True)
        res4 = run(raw4, os.path.join(tmp, "analysis4.json"))
        expect(res4.returncode != 0 and "غيرُ متوقعة" in (res4.stderr + res4.stdout),
               "نوعٌ غيرُ متوقعٍ بلا نظيرٍ في pagg يُفشلُ السكربتَ صراحةً")

        # 4) فشلُ فقدِ التوقيتِ
        raw3 = os.path.join(tmp, "raw-noat")
        build_fixtures(raw3, drop_at=True)
        res3 = run(raw3, os.path.join(tmp, "analysis3.json"))
        expect(res3.returncode != 0 and "التوقيت" in (res3.stderr + res3.stdout),
               "فقدُ التوقيتِ يُفشلُ السكربتَ صراحةً")
    finally:
        shutil.rmtree(tmp)
    print("كلُّ الاختباراتِ ناجحةٌ")


if __name__ == "__main__":
    main()
