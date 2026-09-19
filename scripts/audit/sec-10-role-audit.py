#!/usr/bin/env python3
"""
SEC-10 — قياسُ الحالةِ الفعليةِ على قاعدةِ الإنتاجِ (استعلاماتٌ للقراءة فقط)
يقيسُ: مالكو الدوالِّ · security definer · rolbypassrls · relforcerowsecurity · السياسات
"""
import psycopg2
import json
import sys

import os
CONN = os.environ.get("CEZR_AUDIT_DB_URL", "")
if not CONN:
    print("error: set CEZR_AUDIT_DB_URL env var", file=sys.stderr)
    sys.exit(1)

def main():
    conn = psycopg2.connect(CONN)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()

    results = {}

    # 1 — الأدوارُ: rolbypassrls و rolname
    cur.execute("""
        select rolname, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb
        from pg_roles
        where rolname in ('postgres', 'service_role', 'anon', 'authenticated', 'public')
           or rolname like 'service%'
        order by rolname
    """)
    results["roles"] = [
        {"rolname": r[0], "rolbypassrls": r[1], "rolsuper": r[2], "rolcreaterole": r[3], "rolcreatedb": r[4]}
        for r in cur.fetchall()
    ]

    # 2 — مالكو الدوالِّ الحرجةِ و security definer
    cur.execute("""
        select p.proname, r.rolname as owner, p.prosecdef as security_definer,
               l.lanname as language
        from pg_proc p
        join pg_roles r on p.proowner = r.oid
        join pg_language l on p.prolang = l.oid
        where p.proname in (
            'claim_ride', 'activate_subscription', 'expire_stale_offers',
            'start_trial', 'record_attendance', 'create_payment',
            'confirm_payment', 'sos_surface_state', 'completed_ride_summary',
            'tracking_link_lifetime', 'submit_rating', 'cancel_order'
        )
        order by p.proname
    """)
    results["critical_functions"] = [
        {"proname": r[0], "owner": r[1], "security_definer": r[2], "language": r[3]}
        for r in cur.fetchall()
    ]

    # 3 — relforcerowsecurity على جداول public
    cur.execute("""
        select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on c.relnamespace = n.oid
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname not in ('spatial_ref_sys')
        order by c.relname
    """)
    rows = cur.fetchall()
    results["tables_rls"] = {
        "total": len(rows),
        "rls_enabled": sum(1 for r in rows if r[1]),
        "force_enabled": sum(1 for r in rows if r[2]),
        "tables_without_rls": [r[0] for r in rows if not r[1]],
        "tables_with_force": [r[0] for r in rows if r[2]],
    }

    # 4 — السياساتُ القائمةُ
    cur.execute("""
        select schemaname, tablename, policyname, cmd, roles, qual
        from pg_policies
        where schemaname = 'public'
        order by tablename, policyname
    """)
    results["policies"] = [
        {"table": r[1], "policy": r[2], "cmd": r[3], "roles": r[4], "qual": r[5]}
        for r in cur.fetchall()
    ]

    # 5 — المنحُ (grants) على جدول orders كمثال
    cur.execute("""
        select grantee, privilege_type
        from information_schema.role_table_grants
        where table_name = 'orders'
          and table_schema = 'public'
        order by grantee, privilege_type
    """)
    results["orders_grants"] = [
        {"grantee": r[0], "privilege": r[1]}
        for r in cur.fetchall()
    ]

    # 6 — عدد الدوالِّ security definer
    cur.execute("""
        select count(*)
        from pg_proc p
        join pg_namespace n on p.pronamespace = n.oid
        where n.nspname = 'public' and p.prosecdef = true
    """)
    results["security_definer_count"] = cur.fetchone()[0]

    # 7 — مالكو الجداول
    cur.execute("""
        select c.relname, r.rolname as owner
        from pg_class c
        join pg_namespace n on c.relnamespace = n.oid
        join pg_roles r on c.relowner = r.oid
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname in ('orders', 'order_offers', 'drivers', 'users', 'riders', 'audit_log')
        order by c.relname
    """)
    results["table_owners"] = [
        {"table": r[0], "owner": r[1]}
        for r in cur.fetchall()
    ]

    cur.close()
    conn.close()

    print(json.dumps(results, indent=2, ensure_ascii=False, default=str))

if __name__ == "__main__":
    main()
