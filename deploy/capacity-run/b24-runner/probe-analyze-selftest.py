#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لتحليلِ الدورةِ على بياناتٍ مصغرةٍ معروفةِ النتائجِ يدويًّا.

يبني موجاتٍ تركيبيةً بحقولٍ قليلةٍ ثم يطابقُ حساباتِ المحللِ معَ القيمِ المحسوبةِ
يدويًّا: إسنادُ النوافذِ، المتوسطُ الشرطيُّ، حدودُ المعايرةِ (وتطابقُها)، اتجاهُ فروقِ
الأزواجِ (B−A)، نقصُ الأزواجِ، مقياسُ الكلفةِ، معاملُ الذراعِ في OLS، أصفارُ الدرينرِ،
عدمَ ازدواجِ دلاءِ الثواني، والنداءِ الفعليِّ عبرَ الواجهةِ كما يستدعيه المقعدُ.
نجاحُه شرطُ تشغيلِ المقعدِ (يُستدعى من مقعدِ الدورةِ قبلَ أيِّ موجة).
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "probe_analyze", os.path.join(HERE, "probe-analyze.py"))
PA = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PA)

T0 = 1_000_000  # ms — ‏1970-01-01T00:16:40.000Z
RIDES_PATH = "http:POST /v1/rides"
OTHER_PATH = "http:GET /v1/rides/x"
RIDES_ROUTE = "POST /v1/rides"
OTHER_ROUTE = "GET /v1/rides/x"
GATEWAY_POOL = "ceezr:gatewayRequest"
AA_PASS = "إعادةُ_إنتاجٍ_ضمنَ_±δ"
COST_PASS = "كلفةٌ_محدودةٌ_بـ±δ"


def iso(ms):
    import datetime
    return datetime.datetime.fromtimestamp(
        ms / 1000.0, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def make_wave(base_dir, name, t0=T0, injection_sec=30, drain_sec=10,
              rides_arr_totals=None, other_arr_totals=None, other_arr_alt=None,
              rides_waits=None, other_waits=None,
              pdb_rides_mean=None, pdb_drainer_runsum=None):
    """بناءُ موجةٍ تركيبيةٍ. القوائمُ مفهرسةٌ بالنافذةِ (j=0..n-1). الطلباتُ على دلاءِ
    ثوانٍ صحيحةٍ (at مضاعفُ 1000) كما يُصدرُهُ المنتجُ فعلًا (حقلُ cls لا بادئةُ اسم)."""
    d = os.path.join(base_dir, name)
    os.makedirs(d, exist_ok=True)
    drain0 = t0 + injection_sec * 1000
    end0 = drain0 + drain_sec * 1000
    with open(os.path.join(d, "miniapp-load-events.jsonl"), "w") as f:
        f.write(json.dumps({"event": "phase.start", "t": iso(t0), "name": "wave", "sec": injection_sec, "conc": 1}) + "\n")
        f.write(json.dumps({"event": "phase.drain_start", "t": iso(drain0), "name": "wave"}) + "\n")
        f.write(json.dumps({"event": "phase.end", "t": iso(end0), "name": "wave", "drainMs": drain_sec * 1000}) + "\n")

    def emit_arr(f, j, tot, route):
        if tot is None:
            return
        per = tot // 5
        rem = tot - per * 5
        for s in range(5):
            n = per + (1 if s < rem else 0)
            if n:
                sec = int((t0 + j * 5000 + s * 1000) // 1000) * 1000
                f.write(json.dumps({"k": "arr1s", "at": sec, "cls": "http",
                                    "name": route, "n": n}) + "\n")

    rows = []
    with open(os.path.join(d, "load-trace.jsonl"), "w") as f:
        nw = injection_sec // 5
        for j in range(nw):
            emit_arr(f, j, rides_arr_totals[j] if rides_arr_totals else 0, RIDES_ROUTE)
            tot = other_arr_totals[j] if other_arr_totals else 0
            if other_arr_alt is not None:
                tot = other_arr_alt[j]
            emit_arr(f, j, tot, OTHER_ROUTE)
        if rides_waits:
            for j, ws in enumerate(rides_waits):
                for i, w in enumerate(ws):
                    f.write(json.dumps({"k": "pseat", "path": RIDES_PATH,
                                         "pool": GATEWAY_POOL, "kind": "query",
                                         "requestId": f"r{j}-{i}", "waitMs": w, "runMs": 1,
                                         "waitStartAt": t0 + j * 5000 + 100, "waitEndAt": 0}) + "\n")
        if other_waits:
            for j, ws in enumerate(other_waits):
                for i, w in enumerate(ws):
                    f.write(json.dumps({"k": "pseat", "path": OTHER_PATH,
                                         "pool": GATEWAY_POOL, "kind": "query",
                                         "requestId": f"o{j}-{i}", "waitMs": w, "runMs": 1,
                                         "waitStartAt": t0 + j * 5000 + 100, "waitEndAt": 0}) + "\n")
        if pdb_rides_mean:
            for j, m in enumerate(pdb_rides_mean):
                f.write(json.dumps({"k": "pdb", "at": t0 + (j + 1) * 5000,
                                     "path": RIDES_PATH, "pool": GATEWAY_POOL,
                                     "kind": "query", "n": 2, "waitSumMs": 2 * m,
                                     "runSumMs": 10, "waitP50Ms": m}) + "\n")
        if pdb_drainer_runsum:
            for j, r in enumerate(pdb_drainer_runsum):
                if r is None:
                    continue  # نافذةٌ مغطّاةٌ (صفوفُ rides) بلا درينر = صفرٌ معلنٌ
                f.write(json.dumps({"k": "pdb", "at": t0 + (j + 1) * 5000,
                                     "path": "drainer:replies", "pool": GATEWAY_POOL,
                                     "kind": "query", "n": 3, "waitSumMs": 30,
                                     "runSumMs": r}) + "\n")
    return d


def approx(a, b, eps=1e-9):
    return a is not None and b is not None and abs(a - b) <= eps


def main():
    tmp = tempfile.mkdtemp(prefix="probe-selftest-")
    ok = 0

    # ---------- 1) النوافذُ والإسنادُ والمتوسطُ الشرطيُّ ----------
    w1 = make_wave(tmp, "w1", rides_arr_totals=[10, 12, 14, 16, 18, 20],
                   other_arr_totals=[5] * 6,
                   rides_waits=[[100 + 10 * j, 200 + 10 * j] for j in range(6)],
                   other_waits=[[50]] + [[]] * 5)
    wave = PA.Wave(w1)
    assert wave.t0 == T0 and wave.drain0 == T0 + 30000 and wave.end0 == T0 + 40000
    wins = wave.windows("injection")
    assert len(wins) == 6 and wins[0] == (T0, T0 + 5000)
    assert len(wave.windows("drain")) == 2
    m, n = wave.conditional_mean("injection", "rides")
    assert approx(m, 175.0), m   # (150+160+170+180+190+200)/6
    assert n == 6
    m_other, n_other = wave.conditional_mean("injection", "other")
    assert approx(m_other, 50.0) and n_other == 1
    print("1) النوافذُ والإسنادُ والمتوسطُ الشرطيُّ: ✓")
    ok += 1

    # ---------- 2) عدمُ ازدواجِ دلاءِ الثواني (بدايةٌ غيرُ محاذاةٍ) ----------
    w1b = make_wave(tmp, "w1b", t0=T0 + 500, rides_arr_totals=[9, 0, 0, 0, 0, 0],
                    other_arr_totals=[0] * 6)
    wave_b = PA.Wave(w1b)
    # الطلباتُ التسعةُ على دلاءِ 1000–1004 (تأريضُ المنتجِ: دلوُ ‏.500 = ‏1000)؛
    # النافذةُ الأولى تغطي دلاءَ 1001–1005 فتأخذُ 7، والدلوُ الحدوديُّ 1000 (قبلَ بدءِ
    # الطورِ جزئيًّا) مستبعَدٌ بالإسنادِ المعلنِ (بدايةُ الدلوِ) — لا ازدواجَ ولا فقدَ داخلَ الأطوار:
    w0 = wave_b.arr_window_total(*wave_b.windows("injection")[0], "rides")
    w1v = wave_b.arr_window_total(*wave_b.windows("injection")[1], "rides")
    allw = sum(wave_b.arr_window_total(ws, we, "rides") for ws, we in wave_b.windows("injection"))
    assert w0 == 7 and w1v == 0 and allw == 7, (w0, w1v, allw)
    # وكلُّ دلوٍ داخلَ الأطوارِ يُحسبُ مرةً واحدةً: مجموعُ النوافذِ = جملُ الدلاءِ المغطاةِ
    covered = sum(n for (at, name), n in wave_b.arr.items()
                 if at >= math.ceil((T0 + 500) / 1000.0) * 1000)
    assert allw == covered
    print("2) عدمُ ازدواجِ دلاءِ الثواني (بدايةٌ ‏.500): ✓")
    ok += 1

    # ---------- 3) حدودُ المعايرةِ (وتطابقُها) ----------
    st = PA.Strata.calibrate(wave)
    rates = sorted([10 / 5, 12 / 5, 14 / 5, 16 / 5, 18 / 5, 20 / 5])  # 2.0..4.0
    assert approx(st.boundaries["rides"][0], rates[1])   # floor((6-1)/3)=1 → 2.4
    assert approx(st.boundaries["rides"][1], rates[3])  # floor(2*5/3)=3 → 3.2
    assert approx(st.boundaries["other"][0], 1.0) and approx(st.boundaries["other"][1], 1.0)
    # التطابقُ يُدمجُ في شريحتينِ لا يُلغي: [0,0,0,0,10,20] → t1 = ‏r ≥ 0 (الكل)، ‏t0/t2 فارغتان
    wz = make_wave(tmp, "wz", rides_arr_totals=[0, 0, 0, 0, 10, 20],
                   other_arr_totals=[0] * 6,
                   rides_waits=[[100, 100]] * 6)
    stz = PA.Strata.calibrate(PA.Wave(wz))
    assert approx(stz.boundaries["rides"][0], 0.0) and approx(stz.boundaries["rides"][1], 0.0)
    mz0, nz0 = PA.Wave(wz).conditional_mean("injection", "rides", PA.Stratum(stz, 0))
    mz1, nz1 = PA.Wave(wz).conditional_mean("injection", "rides", PA.Stratum(stz, 1))
    assert mz0 is None and nz0 == 0          # ‏r < 0 فارغة
    assert approx(mz1, 100.0) and nz1 == 6    # ‏r ≥ 0 = الكلُّ (دمجٌ لا إلغاء)
    print("3) حدودُ المعايرةِ ودمجُ المتطابقِ: ✓")
    ok += 1

    # ---------- 4) بوابةُ A/A ----------
    w2 = make_wave(tmp, "w2", rides_arr_totals=[10, 12, 14, 16, 18, 20],
                   other_arr_totals=[5] * 6,
                   rides_waits=[[105 + 10 * j, 205 + 10 * j] for j in range(6)],
                   other_waits=[[55]] + [[]] * 5)
    res_aa = PA.mode_aa(w1, w2, os.path.join(tmp, "aa.json"))
    assert approx(res_aa["metrics"]["rides_conditional_mean"]["A_minus_A_ms"], 5.0)
    assert res_aa["verdict"] == AA_PASS
    print("4) بوابةُ A/A: ✓")
    ok += 1

    # ---------- 5) مقياسُ الكلفةِ (pdb) ----------
    def cost_wave(name, means):
        return make_wave(tmp, name, rides_arr_totals=[10] * 6, other_arr_totals=[5] * 6,
                         pdb_rides_mean=means, pdb_drainer_runsum=[1000] * 6)
    on1 = cost_wave("on1", [180.0] * 6)
    off1 = cost_wave("off1", [170.0] * 6)
    off2 = cost_wave("off2", [170.0] * 6)
    on2 = cost_wave("on2", [180.0] * 6)
    res_cost = PA.mode_cost(on1, off1, off2, on2, os.path.join(tmp, "cost.json"))
    assert approx(res_cost["d1_ms"], 10.0) and approx(res_cost["d2_ms"], 10.0)
    assert res_cost["verdict"] == COST_PASS
    on3 = cost_wave("on3", [190.0] * 6)
    res_cost2 = PA.mode_cost(on3, off1, off2, on3, os.path.join(tmp, "cost2.json"))
    assert res_cost2["verdict"] == "الأداةُ_ملوّثةٌ_للقياس"
    print("5) مقياسُ الكلفةِ: ✓")
    ok += 1

    # ---------- 6) موجاتُ الحكمِ: اتجاهُ الأزواجِ والكتلةُ ونقصُ الأزواجِ ----------
    def ab_wave(name, is_b, arr_tot=14):
        waits = [[162, 262] for _ in range(6)] if is_b else [[150, 250] for _ in range(6)]
        return make_wave(tmp, name, rides_arr_totals=[arr_tot] * 6, other_arr_totals=[5] * 6,
                         rides_waits=waits)
    a1, b1 = ab_wave("a1", False), ab_wave("b1", True)
    b2, a2 = ab_wave("b2", True), ab_wave("a2", False)
    a3, b3 = ab_wave("a3", False), ab_wave("b3", True)
    b4, a4 = ab_wave("b4", True), ab_wave("a4", False)
    strata_path = os.path.join(tmp, "strata.json")
    PA.mode_strata(w1, strata_path)
    res_ab = PA.mode_ab([a1, b1, b2, a2, a3, b3, b4, a4],
                        os.path.join(tmp, "ab.json"), strata_path)
    h1 = res_ab["h1"]["rides|injection|t1"]
    assert h1["pairs"] == [12.0, 12.0, 12.0, 12.0], h1["pairs"]
    assert approx(h1["point_ms"], 12.0)
    # الكتلةُ: مقامُها جملُ طلباتِ http — rides ‏84 من 114 لكلِّ موجةِ A
    assert approx(h1["mass_of_requests"], 4 * 84 / (4 * 114))
    assert h1["rule"].startswith("محسوم_بأنّ_الأثر_على_المتوسطِ_الشرطيِّ_محدودٌ_بـ±δ")
    # شريحةٌ دونَ العتبةِ لا يُعرضُ حكمُها (صنفُ other = ‏30/114 ≈ 26%… نجعلها دونَها):
    h1_other = res_ab["h1"]["other|injection|t1"]
    assert h1_other["reported"] is True  # ‏26% ≥ 5% — تُعرض
    # نقصُ الأزواجِ: A2 بلا بياناتٍ في الشريحةِ (معدلُ وصولٍ في شريحةٍ أخرى) ⇒ غيرُ قابلٍ للحسم
    a2x = make_wave(tmp, "a2x", rides_arr_totals=[4] * 6, other_arr_totals=[5] * 6,
                    rides_waits=[[150, 250]] * 6)  # معدلٌ 0.8 < 2.4 ⇒ ‏t0
    res_ab2 = PA.mode_ab([a1, b1, b2, a2x, a3, b3, b4, a4],
                         os.path.join(tmp, "ab2.json"), strata_path)
    h1x = res_ab2["h1"]["rides|injection|t1"]
    assert h1x["pair_count"] == 3
    assert h1x["rule"] == "غيرُ_قابلٍ_للحسم_نقصُ_الأزواجِ", h1x["rule"]
    print("6) اتجاهُ الأزواجِ والكتلةُ ونقصُ الأزواجِ: ✓")
    ok += 1

    # ---------- 7) H2: معاملُ الذراعِ وأصفارُ الدرينر ----------
    # wait = 100 + 2*drainerSec + 1*arrRate + 10*arm — بلا ضجيجٍ؛ الدرينرُ في j≥3 صفرٌ معلنٌ
    def h2_wave(name, is_b, drainer_present):
        rides_means, drainers = [], []
        for j in range(6):
            arr_rate = (14 + (5 + 4 * (j % 2))) / 5.0
            dsec = float(j) if (j < drainer_present) else 0.0
            w = 100 + 2 * dsec + arr_rate + (10.0 if is_b else 0.0)
            rides_means.append(w)
            drainers.append(1000.0 * j if j < drainer_present else None)
        return make_wave(tmp, name, rides_arr_totals=[14] * 6,
                         other_arr_alt=[5 + 4 * (j % 2) for j in range(6)],
                         pdb_rides_mean=rides_means, pdb_drainer_runsum=drainers)
    ha1, hb1 = h2_wave("ha1", False, 6), h2_wave("hb1", True, 6)
    hb2, ha2 = h2_wave("hb2", True, 6), h2_wave("ha2", False, 6)
    ha3, hb3 = h2_wave("ha3", False, 6), h2_wave("hb3", True, 6)
    hb4, ha4 = h2_wave("hb4", True, 6), h2_wave("ha4", False, 6)
    res_h2 = PA.mode_ab([ha1, hb1, hb2, ha2, ha3, hb3, hb4, ha4],
                        os.path.join(tmp, "ab-h2.json"), strata_path)
    pt = res_h2["h2"]["point_ms"]
    assert pt is not None and approx(pt, 10.0, 1e-6), pt
    lo, hi = res_h2["h2"]["ci_ms"]
    assert lo is not None and approx(lo, 10.0, 1e-6) and approx(hi, 10.0, 1e-6)
    assert res_h2["h2"]["rule"].startswith("محسوم_بأنّ_الأثر_على_المتوسطِ_الشرطيِّ_محدودٌ_بـ±δ")
    # صفرٌ معلنٌ: نوافذُ درينرٍ ناقصةٌ في موجةٍ يغطيها الرصدُ ⇒ صفرٌ لا حذفٌ
    hz_a = h2_wave("hz_a", False, 3)   # درينرٌ في j<3 فقط؛ ‏j≥3 صفرٌ معلنٌ
    hz_b = h2_wave("hz_b", True, 3)
    res_h2z = PA.mode_ab([hz_a, hz_b, hz_b, hz_a, hz_a, hz_b, hz_b, hz_a],
                         os.path.join(tmp, "ab-h2z.json"), strata_path)
    assert res_h2z["h2"]["drainer_zero_windows"] == 8 * 3  # 8 موجات × 3 نوافذَ بلا درينر (j≥3) صفرٌ معلنٌ
    assert approx(res_h2z["h2"]["point_ms"], 10.0, 1e-6)
    print("7) معاملُ الذراعِ في OLS وأصفارُ الدرينر: ✓")
    ok += 1

    # ---------- 8) النداءُ الفعليُّ كما يستدعيه المقعدُ (الواجهةُ لا الدوالُ) ----------
    out_cli = os.path.join(tmp, "ab-cli.json")
    rc = subprocess.run(
        [sys.executable, os.path.join(HERE, "probe-analyze.py"), "ab",
         ha1, hb1, hb2, ha2, ha3, hb3, hb4, ha4, strata_path, out_cli],
        capture_output=True, text=True)
    assert rc.returncode == 0, rc.stderr[-500:]
    d_cli = json.load(open(out_cli))
    assert approx(d_cli["h2"]["point_ms"], 10.0, 1e-6)
    assert isinstance(d_cli["h1"], dict) and "rides|injection|t1" in d_cli["h1"]
    # ترتيبُ الوسائطِ هو المختبرُ هنا (strata ثمّ المخرج) — لو انعكسَ لقرأ المخرجَ معايرةً
    rc_aa = subprocess.run(
        [sys.executable, os.path.join(HERE, "probe-analyze.py"), "aa", w1, w2,
         os.path.join(tmp, "aa-cli.json")], capture_output=True, text=True)
    assert rc_aa.returncode == 0
    assert json.load(open(os.path.join(tmp, "aa-cli.json")))["verdict"] == AA_PASS
    print("8) النداءُ الفعليُّ عبرَ الواجهةِ: ✓")
    ok += 1

    # ---------- 9) سلاسلُ البواباتِ كما يطابقُها المقعدُ + الثوابتُ ----------
    seat = os.path.join(HERE, "seat-load01-c2-http-wait-probe.sh")
    if os.path.exists(seat):
        seat_src = open(seat, encoding="utf-8").read()
        assert AA_PASS in seat_src and COST_PASS in seat_src, "سلاسلُ البواباتِ في المقعدِ لا تطابقُ المحللَ"
    assert PA.DELTA_MS == 15.0 and PA.BOOTSTRAP_B == 2000
    print("9) سلاسلُ البواباتِ والثوابتُ المسجّلةُ (δ=15، ‏B=2000): ✓")
    ok += 1

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"نجحَ الاختبارُ الذاتيُّ: {ok}/9")
    return 0


if __name__ == "__main__":
    sys.exit(main())
