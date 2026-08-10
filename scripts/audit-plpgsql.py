#!/usr/bin/env python3
"""
تمشيط دوال plpgsql عن نمط «افحص ثم اكتب» بلا قفل.

الفكرة: أي دالة تقرأ حالةً من جدول ثم تبني عليها قرار كتابة، بلا واحدة من
وسائل التسلسل (FOR UPDATE / advisory lock / ON CONFLICT / قيد فريد)، هي
مرشّحة لسباق TOCTOU. المُمشّط يرشّح لا يحكم — كل مرشّح يُراجَع يدوياً.
"""
import os
import re
import subprocess
import sys

# الاتصال من البيئة لا مثبَّتاً، ليعمل على أي قاعدة (محلية أو مرحلية).
# الاستعمال: TEST_DATABASE_URL=postgres://... python3 scripts/audit-plpgsql.py
DB_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
if not DB_URL:
    sys.exit("عيّن TEST_DATABASE_URL أو DATABASE_URL")

PG = ["psql", DB_URL, "-At"]

SKIP_PREFIXES = ("st_", "_postgis", "postgis_", "addgeometry", "dropgeometry",
                 "updategeometry", "populate_geometry", "find_srid", "get_proj4")

READ = re.compile(r"\b(select|perform)\b", re.I)
WRITE = re.compile(r"\b(insert\s+into|update\s+\w+\s+set|delete\s+from)\b", re.I)
GUARD_FOR_UPDATE = re.compile(r"\bfor\s+(update|no\s+key\s+update|share)\b", re.I)
GUARD_ADVISORY = re.compile(r"pg_advisory(_xact)?_lock", re.I)
GUARD_ON_CONFLICT = re.compile(r"\bon\s+conflict\b", re.I)
GUARD_LOCK_TABLE = re.compile(r"\block\s+table\b", re.I)


def names():
    out = subprocess.run(PG + ["-c", """
        select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_language l on l.oid = p.prolang
        where n.nspname = 'public' and l.lanname = 'plpgsql'
        order by p.proname;"""], capture_output=True, text=True).stdout.split()
    seen, res = set(), []
    for n in out:
        if n in seen or n.startswith(SKIP_PREFIXES):
            continue
        seen.add(n)
        res.append(n)
    return res


def body(name):
    return subprocess.run(
        PG + ["-c", f"select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace "
                    f"where n.nspname='public' and p.proname='{name}' limit 1;"],
        capture_output=True, text=True).stdout


def classify(src):
    """يعيد (خطر, أسباب) — خطر: 'مرشّح' أو 'محمي' أو 'قراءة فقط'."""
    if not WRITE.search(src):
        return "قراءة فقط", []
    if not READ.search(src):
        return "كتابة فقط", []

    guards = []
    if GUARD_FOR_UPDATE.search(src):
        guards.append("FOR UPDATE")
    if GUARD_ADVISORY.search(src):
        guards.append("advisory lock")
    if GUARD_ON_CONFLICT.search(src):
        guards.append("ON CONFLICT")
    if GUARD_LOCK_TABLE.search(src):
        guards.append("LOCK TABLE")

    # الكتابة الشرطية داخل جملة واحدة (update ... where <شرط الحالة>) تتسلسل
    # ذاتياً لأن القفل الصفّي يؤخذ عند التقييم. نرصدها كوسيلة حماية.
    if re.search(r"update\s+\w+[\s\S]{0,400}?\bwhere\b[\s\S]{0,200}?\bstatus\b", src, re.I):
        guards.append("update شرطي على الحالة")

    if guards:
        return "محمي", guards
    return "مرشّح", []


def main():
    rows = []
    for n in names():
        src = body(n)
        verdict, guards = classify(src)
        rows.append((n, verdict, ", ".join(guards), len(src.splitlines())))

    order = {"مرشّح": 0, "محمي": 1, "كتابة فقط": 2, "قراءة فقط": 3}
    rows.sort(key=lambda r: (order[r[1]], r[0]))

    print(f"{'الدالة':<42} {'الحكم':<12} وسيلة التسلسل")
    print("-" * 92)
    for n, v, g, _ in rows:
        print(f"{n:<42} {v:<12} {g}")

    cands = [r[0] for r in rows if r[1] == "مرشّح"]
    print(f"\nالمجموع: {len(rows)} دالة · مرشّحون للمراجعة اليدوية: {len(cands)}")
    for c in cands:
        print(f"  - {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
