#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لـgap2-analyze.py على موجاتٍ صناعيّةٍ بصيغِ الأداةِ الحقيقيّة (RUN2).
يُشغَّلُ قبلَ أيِّ موجةٍ في المقعد؛ أيُّ إخفاقٍ = لا موجة. يرثُ مولّدَ موجاتِ gap-analyze-selftest.py
ويضيفُ حقولَ RUN2 وسطورَ gen_env/gen_loop/loop1s/sched."""
import contextlib
import importlib.util
import io
import json
import os
import random
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, fn):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, fn))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


g2 = _load("g2", "gap2-analyze.py")
st1 = _load("st1", "gap-analyze-selftest.py")
T0, INJ_MS, DRAIN_MS = st1.T0, st1.INJ_MS, st1.DRAIN_MS


def _rw(path, fn):
    with open(path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    rows = fn(rows)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def make_wave2(root, name, seed=1, n=2600, queue_extra=0.0, drop_new_client=0, drop_new_server=0,
               gen_env_rows=1, gen_loop_gap=False, no_loop1s=False, corrupt_trace=False, **kw):
    d = st1.make_wave(root, name, n=n, seed=seed, gz=False, **kw)
    rng = random.Random(seed + 1000)
    i_c = [0]

    def client(rows):
        out = []
        for r in rows:
            if r.get("event") == "http_call":
                k = i_c[0]
                i_c[0] += 1
                inflight = 100 + (k % 400)
                extra = queue_extra if inflight > 256 else 0.0
                r["invokeMs"] = round(0.2 + rng.random() * 0.1, 3)
                r["inflightAtInvoke"] = inflight
                r["headersOverdueMs"] = round(rng.random() * 3, 3)
                r["ttfbMs"] = round(r["ttfbMs"] + extra, 2)
                r["elapsedMs"] = round(r["elapsedMs"] + extra, 2)
                if k < drop_new_client:
                    r["invokeMs"] = None
            out.append(r)
        for _ in range(gen_env_rows):
            out.append({"event": "gen_env", "pid": 11, "bunVersion": "1.4.3", "maxHttpRequestsEnv": None})
        for s in range(0, INJ_MS + DRAIN_MS, 1000):
            if gen_loop_gap and 30_000 <= s < 60_000:
                continue
            out.append({"event": "gen_loop", "at": T0 + s + 500, "lagP99Ms": 1 + rng.random(),
                        "mainThreadRunqWaitPct": 20 + rng.random() * 5, "mainThreadCpuPct": 40, "eluAvailable": False, "elu": None})
        return out

    i_s = [0]

    def server(rows):
        out = []
        for r in rows:
            if r.get("k") == "httpgap" and r.get("route") == "POST /v1/rides":
                k = i_s[0]
                i_s[0] += 1
                r["requestLeadMs"] = round(0.05 + rng.random() * 0.05, 3)
                r["inflightAtEntry"] = 1 + k % 30
                r["connSeq"] = 1 if k % 5 == 0 else 2 + k % 3
                r["loopOverdueAtEntryMs"] = round(rng.random() * 2, 3)
                if k < drop_new_server:
                    r["requestLeadMs"] = None
            out.append(r)
        if not no_loop1s:
            for s in range(0, INJ_MS + DRAIN_MS, 1000):
                out.append({"k": "loop1s", "at": T0 + s + 300, "lagP99Ms": 2 + rng.random(),
                            "mainThreadRunqWaitPct": 50, "mainThreadCpuPct": 60, "eluAvailable": False, "elu": None})
        return out

    _rw(os.path.join(d, "load-events.jsonl"), client)
    _rw(os.path.join(d, "load-trace.jsonl"), server)
    if corrupt_trace:
        with open(os.path.join(d, "load-trace.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"k":"httpgap", broken\n')
    with open(os.path.join(d, "sched-samples.jsonl"), "w", encoding="utf-8") as f:
        for s in range(0, INJ_MS, 1000):
            f.write(json.dumps({"k": "sched", "t": T0 + s, "procs_running": 8, "psi_some_pct": 50 + rng.random(),
                                "gateway": {"run_pct_1core": 80, "runq_wait_pct_1core": 60 + rng.random()},
                                "generator": {"run_pct_1core": 40, "runq_wait_pct_1core": 60 + rng.random()},
                                "postgres": {"run_pct_1core": 190, "runq_wait_pct_1core": 200}}) + "\n")
    return d


HW = {"cpu_model": "AMD EPYC 9V45 96-Core Processor", "arch": "x86_64", "nproc": 4, "cpuset_effective": "0-3",
      "seat_cpu_max": "max 100000", "kernel": "7.0.0-1017-azure", "os_release": "Ubuntu 26.04", "image_os": "ubuntu26",
      "image_version": "20261020.1", "cpu_flags_md5": "abc", "bun_version": "1.4.3"}


def write_hw(d, tag, **over):
    p = os.path.join(d, f"hw-{tag}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump({**HW, **over, "phase": tag}, f)
    return p


def check(cond, msg):
    if not cond:
        raise SystemExit(f"SELFTEST_FAIL: {msg}")
    print(f"ok  {msg}")


def quiet(fn, *a):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a)


def main():
    with tempfile.TemporaryDirectory() as root:
        # 1) موجةٌ سليمةٌ بكاملِ حقولِ RUN2
        v = g2.Wave2(make_wave2(root, "ok")).validity2()
        check(v["valid"] and v["run2"]["rides_2xx_linked"] == 2600, f"موجةٌ سليمةٌ صالحة ({v['reasons']})")
        # 2) الموروثُ ما زالَ يُبطِل: فقدُ ربطٍ، تكرارٌ، بلا معرّف، سطرٌ مكسور
        check(not g2.Wave2(make_wave2(root, "drop", drop_gap=5)).validity2()["valid"], "نداءٌ بلا httpgap يُبطل (موروث)")
        check(not g2.Wave2(make_wave2(root, "dup", dup_call=3)).validity2()["valid"], "معرّفٌ مكرّرٌ يُبطل (موروث)")
        check(not g2.Wave2(make_wave2(root, "noid", noid_gap=2)).validity2()["valid"], "httpgap بلا معرّفٍ يُبطل (موروث)")
        check(not g2.Wave2(make_wave2(root, "corrupt", corrupt_trace=True)).validity2()["valid"], "سطرُ أثرٍ مكسورٌ يُبطل")
        # 3) اكتمالُ حقولِ RUN2
        r = g2.Wave2(make_wave2(root, "nc", drop_new_client=1)).validity2()
        check(not r["valid"] and r["run2"]["missing_new_fields"]["invokeMs"] == 1, "invokeMs ناقصٌ في طلبٍ واحدٍ يُبطل")
        r = g2.Wave2(make_wave2(root, "ns", drop_new_server=2)).validity2()
        check(not r["valid"] and r["run2"]["missing_new_fields"]["requestLeadMs"] == 2, "requestLeadMs ناقصٌ يُبطل")
        check(not g2.Wave2(make_wave2(root, "env0", gen_env_rows=0)).validity2()["valid"], "غيابُ gen_env يُبطل")
        check(not g2.Wave2(make_wave2(root, "env2", gen_env_rows=2)).validity2()["valid"], "gen_env مكرّرٌ (مولّدان؟) يُبطل")
        check(not g2.Wave2(make_wave2(root, "gl", gen_loop_gap=True)).validity2()["valid"], "ثغرةُ gen_loop في الحقنِ تُبطل")
        check(not g2.Wave2(make_wave2(root, "nl", no_loop1s=True)).validity2()["valid"], "غيابُ loop1s يُبطل")
        # 4) بصمةُ العتاد
        a = make_wave2(root, "hwa")
        p = [write_hw(a, "pre"), write_hw(a, "post")]
        check(g2.hw_compare(p)["identical"], "بصمتانِ متطابقتانِ ⇒ متطابق")
        check(not g2.hw_compare(p + [write_hw(a, "x", cpu_model="Intel Xeon 8370C")])["identical"], "طرازُ معالجٍ مختلفٌ ⇒ غيرُ متطابق")
        check(not g2.hw_compare(p + [write_hw(a, "y", seat_cpu_max="200000 100000")])["identical"], "حصّةُ CPU مختلفةٌ ⇒ غيرُ متطابق")
        check(not g2.hw_compare(p + [write_hw(a, "z", cpu_model="")])["identical"], "مفتاحٌ فارغٌ في غيرِ المرجعِ يُعدُّ اختلافًا")
        check(not g2.hw_compare([write_hw(a, "e", nproc=None)])["identical"], "مفتاحُ هويّةٍ غائبٌ في المرجعِ ⇒ غيرُ متطابق")
        bad = os.path.join(a, "hw-broken.json")
        with open(bad, "w") as f:
            f.write("{")
        check(not g2.hw_compare(p + [bad])["identical"], "بصمةٌ غيرُ مقروءةٍ ⇒ غيرُ متطابق")
        r = g2.hw_compare(p + [write_hw(a, "d", steal_ticks=99, cpu_stat="nr_throttled 5")])
        check(r["identical"], "الخنقُ وsteal وصفيّانِ لا يُبطلان")
        # 5) aa2
        w1 = make_wave2(root, "aa1", seed=7)
        w2 = make_wave2(root, "aa2", seed=8)
        for w in (w1, w2):
            write_hw(w, "pre")
            write_hw(w, "post")
        r = quiet(g2.mode_aa2, w1, w2, os.path.join(root, "aa.json"))
        check(r["pass"] and r["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ", f"A/A متطابقٌ وعتادٌ متطابقٌ ⇒ يُجاز ({r['verdict']})")
        w3 = make_wave2(root, "aa3", seed=7)
        w4 = make_wave2(root, "aa4", seed=8, extra_residual=30.0)
        for w in (w3, w4):
            write_hw(w, "pre")
            write_hw(w, "post")
        r = quiet(g2.mode_aa2, w3, w4, os.path.join(root, "aab.json"))
        check(not r["pass"] and r["verdict"] == "قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة", "A/A بفرقِ ttfb > δ ⇒ توقف")
        w5 = make_wave2(root, "aa5", seed=7)
        w6 = make_wave2(root, "aa6", seed=8)
        write_hw(w5, "pre")
        write_hw(w6, "pre", cpu_model="Intel Xeon 8370C")
        r = quiet(g2.mode_aa2, w5, w6, os.path.join(root, "aac.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_اختلافُ_العتاد", "عتادٌ مختلفٌ ⇒ غيرُ صالحةٍ للمقارنة لا تفسيرٌ سببيّ")
        w7 = make_wave2(root, "aa7", seed=7)
        w8 = make_wave2(root, "aa8", seed=8, drop_new_server=1)
        write_hw(w7, "pre")
        write_hw(w8, "pre")
        r = quiet(g2.mode_aa2, w7, w8, os.path.join(root, "aad.json"))
        check(not r["pass"] and r["verdict"] == "غيرُ_صالحةٍ_للمقارنة_صلاحيةُ_RUN2", "حقولُ RUN2 ناقصةٌ ⇒ غيرُ صالحة")
        # 6) الوصفيّ: طابورُ ما فوقَ 256 يظهرُ في U_head للطبقةِ الصحيحةِ وحدَها
        wq = make_wave2(root, "q", queue_extra=25.0)
        d = quiet(g2.mode_describe, os.path.join(root, "desc.json"), [wq, make_wave2(root, "q0")])
        s = d["waves"][0]["strata"]["inflightAtInvoke"]
        lo, hi = s["<=256"]["U_head"]["mean"], s[">256"]["U_head"]["mean"]
        check(hi - lo > 20 and d["descriptive_only"], f"طبقةُ >256 تحملُ الزيادةَ في U_head ({lo} → {hi})")
        check(abs(s["<=256"]["srv_to_head"]["mean"] - s[">256"]["srv_to_head"]["mean"]) < 1,
              "مددُ الخادمِ لا تتغيّرُ بينَ الطبقتين (الزيادةُ خارجَ الخادم)")
        check(d["second_minus_first_cond_mean"]["U_head"] < -5, "فرقُ الموجتينِ في U_head يُعرضُ وصفيًّا")
        check(g2.spearman([1, 2, 3, 4], [2, 4, 6, 8]) == 1.0 and g2.spearman([1, 2], [1, 2]) is None, "سبيرمان")
        check(d["waves"][0]["window_spearman"]["inflightAtInvoke_mean"]["U_head"] is not None, "ارتباطاتُ النوافذِ تُحسب")
    print("GAP2_ANALYZER_SELFTEST_OK")


if __name__ == "__main__":
    main()
