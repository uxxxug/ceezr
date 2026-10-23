import re, subprocess, sys

src = open("/home/user/workspace/ceezr/packages/infrastructure/dispatch/dispatch-adapters.ts", encoding="utf-8").read()
plain = re.search(r"const CANDIDATES_NEARBY_SQL = `([\s\S]*?)`;", src).group(1)
aged = re.search(r"const CANDIDATES_NEARBY_SQL_WITH_MAX_AGE = `([\s\S]*?)`;", src).group(1)

def psql(q):
    r = subprocess.run(
        ["/home/user/workspace/pglocal/pkgs/xclient/usr/lib/postgresql/18/bin/psql",
         "-h", "/tmp", "-p", "55432", "-U", "postgres", "-d", "ceezr", "-tAc", q],
        capture_output=True, text=True,
        env={"LD_LIBRARY_PATH": "/home/user/workspace/pglocal/pkgs/xlibs/usr/lib/x86_64-linux-gnu", "PATH": "/usr/bin:/bin"})
    return r.stdout.strip()

city = psql("select id from cities where code='JED'")
now = psql("select now()::text")

out_dir = "/home/user/workspace/ceezr/docs/evidence/archive/SOAK-20261023-CANDIDATES-EXPLAIN"
import datetime
def sub(sql_text, mapping):
    for k, v in mapping.items():
        sql_text = sql_text.replace(k, v)
    return sql_text

m_plain = {"$1": f"'{city}'", "$2": "39.19", "$3": "21.55", "$4": "10000", "$5": "39.19", "$6": "21.55", "$7": "50"}
m_aged = {"$1": f"'{city}'", "$2": "39.19", "$3": "21.55", "$4": "10000", "$5": f"'{now}'", "$6": "120",
          "$7": "39.19", "$8": "21.55", "$9": "50"}

for name, sql_text, mapping in [
    ("explain-analyze-7200-unsafe-plain.txt", plain, m_plain),
    ("explain-analyze-7200-unsafe-with-max-age.txt", aged, m_aged),
]:
    q = "explain (analyze, buffers) " + sub(sql_text, mapping) + ";"
    r = subprocess.run(
        ["/home/user/workspace/pglocal/pkgs/xclient/usr/lib/postgresql/18/bin/psql",
         "-h", "/tmp", "-p", "55432", "-U", "postgres", "-d", "ceezr"],
        input=q, capture_output=True, text=True,
        env={"LD_LIBRARY_PATH": "/home/user/workspace/pglocal/pkgs/xlibs/usr/lib/x86_64-linux-gnu", "PATH": "/usr/bin:/bin"})
    open(f"{out_dir}/{name}", "w", encoding="utf-8").write(
        f"-- EXPLAIN (ANALYZE, BUFFERS) — النص الحقيقي من المحوّل عبر الاستبدال الحرفي للوسائط\n"
        f"-- بذر المختبر: 7,200 سائقًا / 30 متاحًا (نهاية الموجة) — تنفيذ فعلي لا تقدير\n"
        f"-- التاريخ: {datetime.datetime.now().isoformat()}\n\n" + r.stdout + r.stderr)
    print(name, "written")
