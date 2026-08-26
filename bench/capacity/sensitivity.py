#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
تحليل حسّاسية: كيف تتغيّر الأرقام الحاكمة بتغيّر نسبة «في رحلة نشطة»؟

يُستخدَم لإسناد القرار DEC-09. النسبة تُطبَّق على الراكب والسائق معاً (لأن جلسات
الركاب في رحلة = السائقون في رحلة، وهو فحص بنيوي في derive.py)، وتُعاد الموازنة
من شريحة «خامد داخل التطبيق».

الاستخدام:  python bench/capacity/sensitivity.py
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from derive import derive  # noqa: E402

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "profile-v2.json")
SHARES = [0.03, 0.045, 0.06, 0.08, 0.10]


def variant(base, t):
    p = copy.deepcopy(base)
    seg = {s["id"]: s for s in p["segments"]}
    t0 = seg["driver_in_trip"]["share"]
    seg["rider_in_trip"]["share"] = t
    seg["driver_in_trip"]["share"] = t
    # تُعاد الموازنة من الشريحة الخامدة حتى يبقى المجموع 100%
    seg["idle"]["share"] = round(seg["idle"]["share"] + 2 * (t0 - t), 10)
    p["profile"] = f"v2-trip-{t*100:g}pct"
    return p


def main():
    base = json.load(open(BASE, encoding="utf-8"))
    rows = []
    for t in SHARES:
        p = variant(base, t)
        d = derive(p)
        bad = [n for n, ok, _ in d["checks"] if not ok]
        if bad:
            print("فحص فاشل في", p["profile"], bad)
            sys.exit(1)
        rows.append({
            "share": t,
            "active_trips": d["active_trips"],
            "conns": d["realtime_connections"],
            "loc": d["by_class"].get("location_write", 0),
            "uncached": d["by_class"].get("read_uncacheable", 0),
            "total": d["total_rps"],
            "origin": d["origin_rps"],
            "trips_s": d["trips_per_sec"],
            "trips_d": d["trips_per_sec"] * 86400,
        })

    hdr = ["نسبة في رحلة", "رحلات نشطة", "اتصالات آنية", "كتابات موقع/ث",
           "قراءات غير مخزَّنة/ث", "إجمالي/ث", "إلى الأصل/ث", "رحلات/ث", "رحلات/يوم"]
    print("| " + " | ".join(hdr) + " |")
    print("|" + "---|" * len(hdr))
    for r in rows:
        print("| {:.1f}% | {:,.0f} | {:,.0f} | {:,.0f} | {:,.0f} | {:,.0f} | {:,.0f} | {:.1f} | {:,.0f} |".format(
            r["share"] * 100, r["active_trips"], r["conns"], r["loc"],
            r["uncached"], r["total"], r["origin"], r["trips_s"], r["trips_d"]))

    b = next(r for r in rows if abs(r["share"] - 0.06) < 1e-9)
    print("\nمرونة الأرقام حول الخط الأساسي 6% (نسبةً إلى قيمته):")
    print("| نسبة في رحلة | اتصالات آنية | كتابات موقع | إجمالي الطلبات |")
    print("|---|---|---|---|")
    for r in rows:
        print("| {:.1f}% | ×{:.2f} | ×{:.2f} | ×{:.2f} |".format(
            r["share"] * 100, r["conns"] / b["conns"], r["loc"] / b["loc"],
            r["total"] / b["total"]))


if __name__ == "__main__":
    main()
