#!/usr/bin/env python3
"""offsite-tool.py — فحوصٌ صارمةٌ للنسخةِ خارجَ الموقع (ADR 0298). مكتبةُ بايثون القياسيّةُ وحدَها.

ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-tool.py (600، root) ويستدعيه
offsite-backup.sh وoffsite-setup.sh وoffsite-restore-drill.sh وstorage-restore-drill.sh.

الأوامر (رمزُ الخروج 0 = سليم، 1 = مرفوض، 2 = استعمالٌ خاطئ). لا يطبعُ أيَّ قيمةٍ سرّيّة:
  check-tar ARCHIVE TS            أرشيفُ النسخةِ المفكوك: قائمةُ أسماءٍ مسموحةٌ حصراً، ملفّاتٌ عاديّةٌ فقط،
                                  لا روابطَ ولا مسارات ../ ولا تكرار ولا ملفّاتٍ زائدة، والمخزنُ كلُّه أو لا شيء.
  extract ARCHIVE DIR             فكٌّ بعدَ check-tar، بمرشّحِ tarfile 'data'.
  check-inner DIR TS              MANIFEST.sha256 يذكرُ كلَّ ملفٍّ مفكوكٍ ولا غيرَه.
  check-storage-tar TAR           أرشيفُ بايتاتِ المخزن: ملفّاتٌ ومجلّداتٌ تحتَ ./ فقط.
  check-config TGZ                أرشيفُ الإعداد: المسموحُ حصراً، والأساسيُّ موجود.
  manifest-get FILE KEY [NAME]    يتحقّقُ من صيغةِ البيانِ الموقَّعِ كلِّها ثمّ يطبعُ قيمةَ KEY.
  rclone-section OUT [--allow-test-endpoints]
                                  يقرأُ قسمَ [wasla-gdrive] من stdin، يتحقّقُ منه، ويكتبُه ذرّيّاً بصلاحيّة 600.
  compare-rowstats EXPECTED GOT   تطابقٌ تامٌّ لكلِّ جدول (العددُ والبصمة)، وإلّا 1.
  drift ARCHIVED LIVE             معلوماتيّ: كم جدولاً تغيّرَ في الإنتاجِ منذُ النسخة. يخرجُ 0 دائماً.
"""
import configparser
import hashlib
import json
import os
import re
import sys
import tarfile
import tempfile

TS_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z$")
STORAGE_GROUP = ("storage-roles-{ts}.sql", "storage-db-{ts}.dump", "storage-db-{ts}.dump.sha256",
                 "storage-files-{ts}.tar", "storage-files-{ts}.tar.sha256", "storage-files-{ts}.sha256")
REQUIRED = ("waslah-{ts}.dump", "waslah-{ts}.dump.sha256", "config-{ts}.tgz", "MANIFEST.sha256")
OPTIONAL = ("waslah-{ts}.rowstats", "storage-db-{ts}.rowstats")
CONFIG_ALLOWED = {"etc/wasla/" + f for f in ("db.env", "gateway.env", "shim.env", "redis.conf", "signal.env",
                                              "public.env", "ingress.env", "storage.env", "storage-client.env")}
CONFIG_ALLOWED |= {"opt/wasla/.env", "opt/wasla/compose.yml", "opt/wasla/haproxy.cfg"}
CONFIG_ESSENTIAL = {"etc/wasla/gateway.env", "etc/wasla/db.env", "opt/wasla/compose.yml"}
MANIFEST_KEYS = ("format", "name", "ts", "created_at", "ciphertext_bytes", "ciphertext_sha256",
                 "inner_manifest_sha256", "age_recipient")
MANIFEST_RE = {
    "format": re.compile(r"^wasla-offsite-v1$"),
    "name": re.compile(r"^wasla-[0-9]{8}T[0-9]{6}Z\.tar\.age$"),
    "ts": TS_RE,
    "created_at": re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"),
    "ciphertext_bytes": re.compile(r"^[1-9][0-9]{0,14}$"),
    "ciphertext_sha256": re.compile(r"^[0-9a-f]{64}$"),
    "inner_manifest_sha256": re.compile(r"^[0-9a-f]{64}$"),
    "age_recipient": re.compile(r"^age1[02-9ac-hj-np-z]{58}$"),
}


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def _members(path, mode="r:"):
    try:
        with tarfile.open(path, mode) as t:
            return t.getmembers()
    except (tarfile.TarError, OSError, EOFError) as e:
        die("tar-reject unreadable (%s)" % type(e).__name__)


def _safe_name(n):
    return not (n.startswith("/") or "\\" in n or any(p in ("..", "") for p in n.split("/")) or "\0" in n)


def check_tar(path, ts):
    if not TS_RE.match(ts):
        die("tar-reject bad_ts")
    allowed = {p.format(ts=ts) for p in REQUIRED + OPTIONAL + STORAGE_GROUP}
    seen = set()
    for m in _members(path):
        n = m.name
        if not _safe_name(n) or "/" in n:
            die("tar-reject path_not_allowed")
        if not m.isreg():
            die("tar-reject non_regular_member type=%s" % m.type.decode(errors="replace"))
        if m.mode & 0o7000:
            die("tar-reject special_mode")
        if n not in allowed:
            die("tar-reject unexpected_member")
        if n in seen:
            die("tar-reject duplicate_member")
        seen.add(n)
    missing = [p.format(ts=ts) for p in REQUIRED if p.format(ts=ts) not in seen]
    if missing:
        die("tar-reject missing=%s" % ",".join(missing))
    group = [p.format(ts=ts) in seen for p in STORAGE_GROUP]
    if any(group) and not all(group):
        die("tar-reject storage_group_incomplete")
    if ("storage-db-%s.rowstats" % ts) in seen and not all(group):
        die("tar-reject storage_rowstats_without_storage")
    print("tar-ok members=%d storage=%s" % (len(seen), "yes" if all(group) else "absent"))


def extract(path, dest):
    with tarfile.open(path, "r:") as t:
        kw = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
        t.extractall(dest, **kw)


def check_inner(d, ts):
    present = {f for f in os.listdir(d) if f != "MANIFEST.sha256"}
    listed = set()
    with open(os.path.join(d, "MANIFEST.sha256")) as fh:
        for line in fh:
            m = re.match(r"^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$", line.rstrip("\n"))
            if not m:
                die("inner-reject bad_manifest_line")
            listed.add(m.group(2))
    if listed != present:
        die("inner-reject manifest_set_mismatch listed=%d present=%d" % (len(listed), len(present)))
    print("inner-ok files=%d" % len(listed))


def check_storage_tar(path):
    n = 0
    for m in _members(path):
        nm = m.name
        if nm in (".", "./"):
            continue
        if not nm.startswith("./") or not _safe_name(nm[2:].rstrip("/")):
            die("storage-tar-reject path_not_allowed")
        if not (m.isreg() or m.isdir()):
            die("storage-tar-reject non_regular_member")
        if m.mode & 0o7000:
            die("storage-tar-reject special_mode")
        n += m.isreg()
    print("storage-tar-ok files=%d" % n)


def check_config(path):
    seen = set()
    for m in _members(path, "r:gz"):
        if not m.isreg() or m.name not in CONFIG_ALLOWED or m.name in seen:
            die("config-reject member_not_allowed")
        seen.add(m.name)
    if not CONFIG_ESSENTIAL <= seen:
        die("config-reject missing_essential")
    print("config-ok files=%d" % len(seen))


def parse_manifest(path, want_name=None):
    try:
        raw = open(path, "rb").read()
    except OSError:
        die("manifest-reject unreadable")
    if len(raw) > 4096:
        die("manifest-reject too_large")
    kv = {}
    for line in raw.decode("ascii", "strict").splitlines():
        k, sep, v = line.partition("=")
        if not sep or k in kv or k not in MANIFEST_RE:
            die("manifest-reject bad_line")
        kv[k] = v
    for k in MANIFEST_KEYS:
        if k not in kv or not MANIFEST_RE[k].match(kv[k]):
            die("manifest-reject field=%s" % k)
    if kv["name"] != "wasla-%s.tar.age" % kv["ts"]:
        die("manifest-reject name_ts_mismatch")
    if want_name is not None and kv["name"] != want_name:
        die("manifest-reject name_mismatch")
    return kv


def rclone_section(out, allow_test):
    data = sys.stdin.read(65536)
    cp = configparser.RawConfigParser(strict=True, interpolation=None)
    try:
        cp.read_string(data)
    except configparser.Error:
        die("section-reject unparsable")
    if cp.sections() != ["wasla-gdrive"]:
        die("section-reject sections")
    s = dict(cp["wasla-gdrive"])
    allowed = {"type", "client_id", "client_secret", "scope", "token", "team_drive", "root_folder_id"}
    if allow_test:
        allowed |= {"auth_url", "token_url"}
    if set(s) - allowed:
        die("section-reject unknown_key")
    if s.get("type") != "drive" or s.get("scope") != "drive.file":
        die("section-reject type_or_scope")
    if not re.match(r"^[0-9A-Za-z.-]+\.apps\.googleusercontent\.com$", s.get("client_id", "")):
        die("section-reject client_id")
    if not s.get("client_secret") or re.search(r"\s", s["client_secret"]):
        die("section-reject client_secret")
    if s.get("team_drive") or s.get("root_folder_id"):
        die("section-reject drive_target")
    for k in ("auth_url", "token_url"):
        if k in s and not re.match(r"^http://127\.0\.0\.1:[0-9]+/", s[k]):
            die("section-reject test_endpoint")
    try:
        tok = json.loads(s.get("token", ""))
    except ValueError:
        die("section-reject token_not_json")
    if not isinstance(tok, dict) or not tok.get("refresh_token"):
        die("section-reject no_refresh_token")
    body = "[wasla-gdrive]\n" + "".join("%s = %s\n" % (k, s[k]) for k in sorted(s)) + "\n"
    d = os.path.dirname(os.path.abspath(out))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".rclone-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as fh:
            fh.write(body)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, out)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    print("section-ok keys=%d" % len(s))


def read_rowstats(path):
    rows = {}
    try:
        fh = open(path)
    except OSError:
        die("rowstats-reject unreadable")
    with fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) != 3 or not parts[1].isdigit() or parts[0] in rows:
                die("rowstats-reject bad_line")
            rows[parts[0]] = (int(parts[1]), parts[2])
    return rows


def compare_rowstats(exp_p, got_p):
    exp, got = read_rowstats(exp_p), read_rowstats(got_p)
    missing = sorted(set(exp) - set(got))
    extra = sorted(set(got) - set(exp))
    cnt = sorted(t for t in set(exp) & set(got) if exp[t][0] != got[t][0])
    content = sorted(t for t in set(exp) & set(got) if exp[t][0] == got[t][0] and exp[t][1] != got[t][1])
    rows = sum(v[0] for v in exp.values())
    ok = not (missing or extra or cnt or content) and len(exp) > 0
    print("rowstats tables_expected=%d tables_restored=%d rows_expected=%d count_mismatch=%d "
          "content_mismatch=%d missing=%d extra=%d result=%s"
          % (len(exp), len(got), rows, len(cnt), len(content), len(missing), len(extra), "MATCH" if ok else "MISMATCH"))
    for label, lst in (("count_mismatch", cnt), ("content_mismatch", content), ("missing", missing), ("extra", extra)):
        for t in lst[:20]:
            print("  %s table=%s" % (label, t))
    sys.exit(0 if ok else 1)


def drift(arch_p, live_p):
    a, b = read_rowstats(arch_p), read_rowstats(live_p)
    changed = sorted(t for t in set(a) | set(b) if a.get(t) != b.get(t))
    print("drift-info tables_changed_since_backup=%d (معلوماتيّ؛ لا يؤثّرُ في النتيجة)" % len(changed))
    for t in changed[:20]:
        ra, rb = a.get(t, (None,))[0], b.get(t, (None,))[0]
        print("  changed table=%s rows_backup=%s rows_live=%s" % (t, ra, rb))


def main(a):
    if not a:
        die(__doc__, 2)
    cmd, args = a[0], a[1:]
    if cmd == "check-tar" and len(args) == 2:
        check_tar(*args)
    elif cmd == "extract" and len(args) == 2:
        extract(*args)
    elif cmd == "check-inner" and len(args) == 2:
        check_inner(*args)
    elif cmd == "check-storage-tar" and len(args) == 1:
        check_storage_tar(*args)
    elif cmd == "check-config" and len(args) == 1:
        check_config(*args)
    elif cmd == "manifest-get" and len(args) in (2, 3):
        kv = parse_manifest(args[0], args[2] if len(args) == 3 else None)
        if args[1] not in kv:
            die("manifest-reject unknown_key", 2)
        print(kv[args[1]])
    elif cmd == "rclone-section" and len(args) in (1, 2):
        rclone_section(args[0], args[1:] == ["--allow-test-endpoints"])
    elif cmd == "compare-rowstats" and len(args) == 2:
        compare_rowstats(*args)
    elif cmd == "drift" and len(args) == 2:
        drift(*args)
    elif cmd == "sha256" and len(args) == 1:
        h = hashlib.sha256()
        with open(args[0], "rb") as fh:
            for b in iter(lambda: fh.read(1 << 20), b""):
                h.update(b)
        print(h.hexdigest())
    else:
        die(__doc__, 2)


if __name__ == "__main__":
    main(sys.argv[1:])
