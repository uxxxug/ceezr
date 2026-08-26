#!/usr/bin/env python3
"""
يشتقّ أرقام الحِمل من ملف تركيبة معلنة، ولا يقبل أي رقم مكتوب بيد.

الاستخدام:
    python bench/capacity/derive.py bench/capacity/profile-v2.json
    python bench/capacity/derive.py bench/capacity/profile-v2.json --md > docs/capacity/capacity-profile-v2.md

الغرض: البند F0-02 في docs/ROADMAP-MASTER.md.
أي تغيير في الفرضيات يُعدّل ملف JSON فقط، ثم يُعاد التشغيل. لا تُحدَّث الأرقام يدوياً أبداً.
"""
import json
import sys
from collections import defaultdict

CLASSES = {
    "location_write": "كتابات موقع",
    "read_cacheable": "قراءات قابلة للتخزين المؤقت",
    "read_uncacheable": "قراءات غير قابلة للتخزين",
    "command_light": "أوامر خفيفة",
    "command_critical": "أوامر حرجة",
    "realtime_connection": "اتصالات آنية",
}


def derive(p):
    total_users = p["concurrent_users"]
    seg_users = {}
    by_class = defaultdict(float)
    per_segment = []
    conns = 0.0

    share_sum = round(sum(s["share"] for s in p["segments"]), 10)

    for s in p["segments"]:
        n = total_users * s["share"]
        seg_users[s["id"]] = n
        rows = []
        for r in s["requests"]:
            if r["class"] == "realtime_connection":
                conns += n
                rows.append((r["kind"], r["class"], None, 0.0))
                continue
            rps = n / r["period_seconds"]
            by_class[r["class"]] += rps
            rows.append((r["kind"], r["class"], r["period_seconds"], rps))
        per_segment.append((s, n, rows))

    # قانون ليتل: معدل الرحلات الجديدة يُشتقّ من عدد الرحلات النشطة ومتوسط مدتها
    active_trips = seg_users.get("driver_in_trip", 0.0)
    dur = p["trip"]["avg_total_duration_seconds"]
    trips_per_sec = active_trips / dur if dur else 0.0

    cacheable = by_class["read_cacheable"]
    offload = p["cache_offload_ratio_on_cacheable_reads"]
    total_rps = sum(v for k, v in by_class.items())
    origin_rps = total_rps - cacheable * offload

    # تحقّق الاتساق البنيوي
    checks = []
    checks.append((
        "مجموع نسب الشرائح = 100%",
        abs(share_sum - 1.0) < 1e-9,
        f"المجموع = {share_sum * 100:.4f}%",
    ))
    riders = seg_users.get("rider_in_trip", 0.0)
    drivers = seg_users.get("driver_in_trip", 0.0)
    expected_riders = drivers * p["trip"]["rider_sessions_per_trip"]
    checks.append((
        "جلسات الركاب في رحلة = جلسات السائقين في رحلة × الجلسات لكل رحلة",
        abs(riders - expected_riders) < 1e-6,
        f"ركاب {riders:,.0f} مقابل متوقَّع {expected_riders:,.0f}",
    ))
    checks.append((
        "لا رحلات نشطة بلا سائقين",
        not (riders > 0 and drivers == 0),
        f"سائقون في رحلة = {drivers:,.0f}",
    ))

    return {
        "total_users": total_users,
        "seg_users": seg_users,
        "per_segment": per_segment,
        "by_class": dict(by_class),
        "realtime_connections": conns,
        "active_trips": active_trips,
        "trip_duration": dur,
        "trips_per_sec": trips_per_sec,
        "total_rps": total_rps,
        "origin_rps": origin_rps,
        "offload": offload,
        "checks": checks,
    }


def fmt(x, nd=0):
    return f"{x:,.{nd}f}"


def report_md(p, d):
    o = []
    o.append(f"# نموذج الحِمل `{p['profile']}`")
    o.append("")
    o.append("> **مُولَّد آلياً.** لا يُحرَّر هذا الملف بيد.")
    o.append(f"> المصدر: `bench/capacity/profile-v2.json` · المُولِّد: `bench/capacity/derive.py`")
    o.append(f"> الحالة: `{p['status']}` — فرضيات معلنة، **لم تُقَس**.")
    o.append("")
    o.append(f"يحلّ محلّ: `{p['supersedes']}` · التاريخ: {p['date']}")
    o.append("")
    for n in p["notes"]:
        o.append(f"- {n}")
    o.append("")
    o.append("## 1. تحقّق الاتساق البنيوي")
    o.append("")
    o.append("| الفحص | النتيجة | التفصيل |")
    o.append("|---|---|---|")
    for name, ok, detail in d["checks"]:
        o.append(f"| {name} | {'✅ سليم' if ok else '❌ فاشل'} | {detail} |")
    o.append("")
    o.append("## 2. توزيع المستخدمين")
    o.append("")
    o.append(f"إجمالي المستخدمين المتزامنين: **{fmt(d['total_users'])}**")
    o.append("")
    o.append("| الشريحة | النسبة | العدد |")
    o.append("|---|---|---|")
    for s, n, _ in d["per_segment"]:
        o.append(f"| {s['name']} | {s['share'] * 100:.0f}% | {fmt(n)} |")
    o.append("")
    o.append("## 3. الحِمل المشتقّ حسب الصنف (طلب/ثانية)")
    o.append("")
    o.append("| الصنف | طلب/ثانية |")
    o.append("|---|---|")
    for k, v in sorted(d["by_class"].items(), key=lambda kv: -kv[1]):
        o.append(f"| {CLASSES.get(k, k)} | {fmt(v)} |")
    o.append(f"| **الإجمالي** | **{fmt(d['total_rps'])}** |")
    o.append("")
    o.append("## 4. الأرقام الحاكمة")
    o.append("")
    o.append("| المقياس | القيمة | كيف اشتُقّ |")
    o.append("|---|---|---|")
    o.append(f"| كتابات الموقع | {fmt(d['by_class'].get('location_write', 0))} / ثانية | مجموع نبضات السائقين بالمعدل التكيّفي |")
    o.append(f"| إجمالي الطلبات | {fmt(d['total_rps'])} / ثانية | مجموع كل الأصناف |")
    o.append(f"| ما يصل إلى الأصل | {fmt(d['origin_rps'])} / ثانية | الإجمالي ناقص {d['offload'] * 100:.0f}% من القراءات القابلة للتخزين |")
    o.append(f"| اتصالات آنية متزامنة | {fmt(d['realtime_connections'])} | الرحلات النشطة فقط — لا اتصال لكل مستخدم |")
    o.append(f"| رحلات نشطة في اللحظة | {fmt(d['active_trips'])} | = عدد السائقين في رحلة |")
    o.append(f"| رحلات جديدة | {fmt(d['trips_per_sec'], 1)} / ثانية | قانون ليتل: {fmt(d['active_trips'])} ÷ {d['trip_duration']}s |")
    o.append(f"| رحلات في اليوم | {fmt(d['trips_per_sec'] * 86400)} | المعدل × 86,400 |")
    o.append("")
    o.append("## 5. التفصيل لكل شريحة")
    o.append("")
    o.append("| الشريحة | العدد | الطلب | الصنف | كل (ثانية) | طلب/ثانية |")
    o.append("|---|---|---|---|---|---|")
    for s, n, rows in d["per_segment"]:
        for kind, cls, per, rps in rows:
            per_s = "اتصال دائم" if per is None else fmt(per)
            o.append(f"| {s['name']} | {fmt(n)} | `{kind}` | {CLASSES.get(cls, cls)} | {per_s} | {fmt(rps)} |")
    o.append("")
    o.append("## 6. تحذير إلزامي")
    o.append("")
    o.append("كل رقم أعلاه **مشتقّ من فرضيات معلنة ولم يُقَس**. درجته في سلّم الأدلة (القسم 1.4 من الخارطة) هي **مُعلَن** — ليست «مَقيس» ولا «مُثبَت».")
    o.append("لا يُقتبَس أي رقم من هذا الملف كإنجاز، ولا يُستخدم لتحديد حجم أجهزة قبل قياس فعلي في المرحلة F10.")
    return "\n".join(o) + "\n"


def report_text(p, d):
    o = [f"نموذج الحِمل: {p['profile']}  ({p['status']})", ""]
    o.append("تحقّق الاتساق:")
    for name, ok, detail in d["checks"]:
        o.append(f"  [{'سليم' if ok else 'فاشل'}] {name} — {detail}")
    o.append("")
    o.append("الحِمل حسب الصنف (طلب/ثانية):")
    for k, v in sorted(d["by_class"].items(), key=lambda kv: -kv[1]):
        o.append(f"  {CLASSES.get(k, k):35} {fmt(v):>12}")
    o.append(f"  {'الإجمالي':35} {fmt(d['total_rps']):>12}")
    o.append(f"  {'إلى الأصل بعد الإزاحة':35} {fmt(d['origin_rps']):>12}")
    o.append("")
    o.append(f"اتصالات آنية:      {fmt(d['realtime_connections'])}")
    o.append(f"رحلات نشطة:        {fmt(d['active_trips'])}")
    o.append(f"رحلات جديدة/ثانية: {fmt(d['trips_per_sec'], 1)}")
    o.append(f"رحلات/يوم:         {fmt(d['trips_per_sec'] * 86400)}")
    return "\n".join(o)


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "bench/capacity/profile-v2.json"
    with open(path, encoding="utf-8") as f:
        prof = json.load(f)
    res = derive(prof)
    if "--md" in sys.argv:
        sys.stdout.write(report_md(prof, res))
    else:
        print(report_text(prof, res))
    if not all(ok for _, ok, _ in res["checks"]):
        sys.exit(1)
