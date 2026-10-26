#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""اختبارٌ ذاتيٌّ لتحليلِ الدورةِ على بياناتٍ مصغرةٍ معروفةِ النتائجِ يدويًّا.

يبني موجاتٍ تركيبيةً بحقولٍ قليلةٍ ثم يطابقُ حساباتِ المحللِ معَ القيمِ المحسوبةِ
يدويًّا: إسنادُ النوافذِ، المتوسطُ الشرطيُّ، حدودُ المعايرةِ، اتجاهُ فروقِ الأزواجِ
‏(B−A)، مقياسُ الكلفةِ، معاملُ الذراعِ في OLS، وقواعدُ الحالاتِ الثلاث.
نجاحُه شرطُ تشغيلِ المقعدِ (يُستدعى من مقعدِ الدورةِ قبلَ أيِّ موجة).
"""
import json
import math
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "probe_analyze", os.path.join(HERE, "probe-analyze.py"))
PA = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(PA)

T0 = 1_000_000  # ms — ‏1970-01-01T00:16:40.000Z
RIDES_NAME = "http:POST /v1/rides"
OTHER_NAME = "http:GET /v1/rides/x"
RIDES_ROUTE = "POST /v1/rides"
OTHER_ROUTE = "GET /v1/rides/x"
GATEWAY_POOL = "ceezr:gatewayRequest"


def iso(ms):
    import datetime
    return datetime.datetime.fromtimestamp(ms / 1000.0, datetime.timezone.utc).isoformat().replace("+00:00", ".000Z") if ms % 1000 == 0 else \
        datetime.datetime.fromtimestamp(ms / 1000.0, datetime.timezone.utc).isoformat()


def make_wave(base_dir, name, injection_sec=30, drain_sec=10,
              rides_arr_totals=None, other_arr_totals=None,
              rides_waits=None, other_waits=None,
              pdb_rides_mean=None, pdb_drainer_runsum=None, other_arr_alt=None):
    """بناءُ موجةٍ تركيبيةٍ. القوائمُ مفهرسةٌ بالنافذةِ (j=0..n-1)."""
    d = os.path.join(base_dir, name)
    os.makedirs(d, exist_ok=True)
    drain0 = T0 + injection_sec * 1000
    end0 = drain0 + drain_sec * 1000
    with open(os.path.join(d, "miniapp-load-events.jsonl"), "w") as f:
        f.write(json.dumps({"event": "phase.start", "t": iso(T0), "name": "wave", "sec": injection_sec, "conc": 1}) + "\n")
        f.write(json.dumps({"event": "phase.drain_start", "t": iso(drain0), "name": "wave"}) + "\n")
        f.write(json.dumps({"event": "phase.end", "t": iso(end0), "name": "wave", "drainMs": drain_sec * 1000}) + "\n")

    nw = injection_sec // 5
    rows = []
    # arr1s: لكلِ نافذةٍ j: الطلباتُ موزعةٌ على الثواني (المجموعُ المعطى)
    for j in range(nw):
        tot = rides_arr_totals[j] if rides_arr_totals else 0
        per = tot // 5
        rem = tot - per * 5
        for s in range(5):
            n = per + (1 if s < rem else 0)
            if n:
                rows.append({"k": "arr1s", "at": T0 + (j * 5 + s) * 1000,
                             "name": RIDES_NAME, "n": n})
        tot = other_arr_totals[j] if other_arr_totals else 0
        if other_arr_alt is not None:
            tot = other_arr_alt[j]
        per = tot // 5
        rem = tot - per * 5
        for s in range(5):
            n = per + (1 if s < rem else 0)
            if n:
                rows.append({"k": "arr1s", "at": T0 + (j * 5 + s) * 1000,
                             "name": OTHER_NAME, "n": n})
    # pseat: ‏rides_waits[j] = قائمةُ انتظاراتِ المقعدِ في النافذةِ j
    if rides_waits:
        for j, ws in enumerate(rides_waits):
            for i, w in enumerate(ws):
                rows.append({"k": "pseat", "path": "http:POST /v1/rides",
                             "pool": GATEWAY_POOL, "kind": "query",
                             "requestId": f"r{j}-{i}", "waitMs": w, "runMs": 1,
                             "waitStartAt": T0 + j * 5000 + 100, "waitEndAt": 0})
    if other_waits:
        for j, ws in enumerate(other_waits):
            for i, w in enumerate(ws):
                rows.append({"k": "pseat", "path": "http:GET /v1/rides/x",
                             "pool": GATEWAY_POOL, "kind": "query",
                             "requestId": f"o{j}-{i}", "waitMs": w, "runMs": 1,
                             "waitStartAt": T0 + j * 5000 + 100, "waitEndAt": 0})
    # pdb: نافذةُ تفريغٍ j تغطي [T0+5000j, T0+5000(j+1)) — at = نهايتُها
    if pdb_rides_mean:
        for j, m in enumerate(pdb_rides_mean):
            rows.append({"k": "pdb", "at": T0 + (j + 1) * 5000,
                         "path": "http:POST /v1/rides", "pool": GATEWAY_POOL,
                         "kind": "query", "n": 2, "waitSumMs": 2 * m,
                         "runSumMs": 10, "waitP50Ms": m})
    if pdb_drainer_runsum:
        for j, r in enumerate(pdb_drainer_runsum):
            rows.append({"k": "pdb", "at": T0 + (j + 1) * 5000,
                         "path": "drainer:replies", "pool": GATEWAY_POOL,
                         "kind": "query", "n": 3, "waitSumMs": 30,
                         "runSumMs": r})
    with open(os.path.join(d, "load-trace.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    return d


def approx(a, b, eps=1e-9):
    return a is not None and b is not None and abs(a - b) <= eps


def main():
    tmp = tempfile.mkdtemp(prefix="probe-selftest-")
    ok = 0

    # ---------- 1) النوافذُ والإسنادُ والمتوسطُ الشرطيُّ ----------
    # 6 نوافذِ حقنٍ (30ث) + نافذتا تفريغٍ. انتظاراتُ rides في النافذةِ j: ‏[100+10j, 200+10j]
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
    # متوسطُ النوافذِ: ‏(150+160+170+180+190+200)/6 = 175
    assert approx(m, 175.0), m
    assert n == 6
    m_other, n_other = wave.conditional_mean("injection", "other")
    assert approx(m_other, 50.0) and n_other == 1
    # مقعدٌ في طورِ التفريغِ لا يدخلُ في متوسطِ الحقنِ (إسنادُ waitStartAt)
    print("1) النوافذُ والإسنادُ والمتوسطُ الشرطيُّ: ✓")
    ok += 1

    # ---------- 2) حدودُ المعايرةِ ----------
    st = PA.Strata.calibrate(wave)
    rates = sorted([10 / 5, 12 / 5, 14 / 5, 16 / 5, 18 / 5, 20 / 5])  # 2.0..4.0
    assert approx(st.boundaries["rides"][0], rates[1])   # floor((6-1)/3)=1 → 2.4
    assert approx(st.boundaries["rides"][1], rates[3])   # floor(2*5/3)=3 → 3.2
    assert st.boundaries["other"] == (PA.MIN, PA.MAX)    # معدلٌ ثابتٌ → تُدمجُ
    print("2) حدودُ المعايرةِ: ✓")
    ok += 1

    # ---------- 3) بوابةُ A/A ----------
    w2 = make_wave(tmp, "w2", rides_arr_totals=[10, 12, 14, 16, 18, 20],
                   other_arr_totals=[5] * 6,
                   rides_waits=[[105 + 10 * j, 205 + 10 * j] for j in range(6)],
                   other_waits=[[55]] + [[]] * 5)
    res_aa = PA.mode_aa(w1, w2, os.path.join(tmp, "aa.json"))
    assert approx(res_aa["metrics"]["rides_conditional_mean"]["A_minus_A_ms"], 5.0)
    assert res_aa["verdict"] == "إعادةُ_إنتاجٍ_ضمنَ_±δ"
    print("3) بوابةُ A/A: ✓")
    ok += 1

    # ---------- 4) مقياسُ الكلفةِ (pdb) ----------
    def cost_wave(name, means):
        return make_wave(tmp, name, rides_arr_totals=[10] * 6, other_arr_totals=[5] * 6,
                         pdb_rides_mean=means, pdb_drainer_runsum=[1000] * 6)
    on1 = cost_wave("on1", [180.0] * 6)
    off1 = cost_wave("off1", [170.0] * 6)
    off2 = cost_wave("off2", [170.0] * 6)
    on2 = cost_wave("on2", [180.0] * 6)
    res_cost = PA.mode_cost(on1, off1, off2, on2, os.path.join(tmp, "cost.json"))
    assert approx(res_cost["d1_ms"], 10.0) and approx(res_cost["d2_ms"], 10.0)
    assert res_cost["verdict"] == "كلفةٌ_محدودةٌ_بـ±δ"
    # سيناريو التلوّثِ: كلا الفرقينِ 20 > δ
    on3 = cost_wave("on3", [190.0] * 6)
    res_cost2 = PA.mode_cost(on3, off1, off2, on3, os.path.join(tmp, "cost2.json"))
    assert res_cost2["verdict"] == "الأداةُ_ملوّثةٌ_للقياس"
    print("4) مقياسُ الكلفةِ: ✓")
    ok += 1

    # ---------- 5) موجاتُ الحكمِ: اتجاهُ الأزواجِ وH2 ----------
    # 8 موجاتٍ: كلُّ نوافذِها في الشريحةِ t1 (معدلُ وصولٍ 2.8/ث)
    # A: متوسطُ نافذةٍ 200 (‏150+250)، ‏B: ‏212 (‏162+262) → كلُّ فرقِ زوجٍ = 12
    def ab_wave(name, is_b, extra_wait=0.0):
        waits = [[150 + extra_wait, 250 + extra_wait] for _ in range(6)]
        if is_b:
            waits = [[162, 262] for _ in range(6)]
        return make_wave(tmp, name, rides_arr_totals=[14] * 6, other_arr_totals=[5] * 6,
                         rides_waits=waits)
    a1, b1 = ab_wave("a1", False), ab_wave("b1", True)
    b2, a2 = ab_wave("b2", True), ab_wave("a2", False)
    a3, b3 = ab_wave("a3", False), ab_wave("b3", True)
    b4, a4 = ab_wave("b4", True), ab_wave("a4", False)
    # ملفُّ الحدودِ من w1 (معايرةٌ مجمّدةٌ)
    strata_path = os.path.join(tmp, "strata.json")
    PA.mode_strata(w1, strata_path)
    res_ab = PA.mode_ab([a1, b1, b2, a2, a3, b3, b4, a4],
                        os.path.join(tmp, "ab.json"), strata_path)
    h1 = res_ab["h1"]["rides|injection|t1"]
    assert h1["pairs"] == [12.0, 12.0, 12.0, 12.0], h1["pairs"]
    assert approx(h1["point_ms"], 12.0)
    assert approx(h1["mass_of_requests"], 1.0)
    # فاصلٌ منهارٌ [12,12] داخلَ ±15 → محدودٌ بـ±δ
    assert h1["rule"].startswith("محسوم_بأنّ_الأثر_على_المتوسطِ_الشرطيِّ_محدودٌ_بـ±δ"), h1["rule"]
    # اتجاهُ الزوجِ: A ثمّ B — الفرقُ B−A موجبٌ
    print("5) اتجاهُ الأزواجِ (B−A) وقاعدةُ الحالاتِ: ✓")
    ok += 1

    # ---------- 6) H2: معاملُ الذراعِ في OLS ----------
    # بياناتٌ بلا ضجيجٍ: wait = 100 + 2*drainerSec + 1*arrRate + 10*arm
    # arrRate للنافذةِ j: rides 14 + other (5 أو 9) → ‏(19 أو 23)/5
    def h2_wave(name, is_b):
        rides_means, drainers = [], []
        for j in range(6):
            arr_rate = (14 + (5 + 4 * (j % 2))) / 5.0
            dsec = float(j)
            w = 100 + 2 * dsec + arr_rate + (10.0 if is_b else 0.0)
            rides_means.append(w)
            drainers.append(1000.0 * j)
        return make_wave(tmp, name, rides_arr_totals=[14] * 6,
                         other_arr_alt=[5 + 4 * (j % 2) for j in range(6)],
                         pdb_rides_mean=rides_means, pdb_drainer_runsum=drainers)
    ha1, hb1 = h2_wave("ha1", False), h2_wave("hb1", True)
    hb2, ha2 = h2_wave("hb2", True), h2_wave("ha2", False)
    ha3, hb3 = h2_wave("ha3", False), h2_wave("hb3", True)
    hb4, ha4 = h2_wave("hb4", True), h2_wave("ha4", False)
    res_h2 = PA.mode_ab([ha1, hb1, hb2, ha2, ha3, hb3, hb4, ha4],
                        os.path.join(tmp, "ab-h2.json"), strata_path)
    pt = res_h2["h2"]["point_ms"]
    assert pt is not None and approx(pt, 10.0, 1e-6), pt
    lo, hi = res_h2["h2"]["ci_ms"]
    assert lo is not None and approx(lo, 10.0, 1e-6) and approx(hi, 10.0, 1e-6)
    assert res_h2["h2"]["rule"].startswith("محسوم_بأنّ_الأثر_على_المتوسطِ_الشرطيِّ_محدودٌ_بـ±δ")
    print("6) معاملُ الذراعِ في OLS ‏(H2): ✓")
    ok += 1

    # ---------- 7) الحدودُ المحميةُ لا تتغيرُ ----------
    assert PA.DELTA_MS == 15.0 and PA.BOOTSTRAP_B == 2000
    print("7) الثوابتُ المسجّلةُ (δ=15، ‏B=2000): ✓")
    ok += 1

    shutil.rmtree(tmp, ignore_errors=True)
    print(f"نجحَ الاختبارُ الذاتيُّ: {ok}/7")
    return 0


if __name__ == "__main__":
    sys.exit(main())
