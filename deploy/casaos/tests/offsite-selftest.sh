#!/usr/bin/env bash
# الغرض: اختبارٌ ذاتيٌّ قابلٌ للتكرارِ للنسخةِ خارجَ الموقع (ADR 0298) — إيجابيٌّ وسلبيّ، دونَ Google ودونَ الإنتاج.
# ينتمي إلى: deploy/casaos/tests — يُشغَّلُ على خادمِ CasaOS من نسخةٍ مؤقّتةٍ لمجلّدِ deploy/casaos (لا من /opt/wasla):
#   sudo bash deploy/casaos/tests/offsite-selftest.sh [OUT_DIR]
# العزل:
#   - قاعدةُ «إنتاجٍ» وهميّةٌ wasla-selftest-prod (--network none) بالصورةِ نفسِها لـwasla-db-1 (تُقرأُ صورتُها فقط).
#   - «Drive» بعيدٌ من نوعِ rclone local في مجلّدٍ مؤقّت؛ وخادمُ OAuth وهميّ (mock-oauth.py) على 127.0.0.1؛
#     وgoogleapis محجوبٌ بـHTTPS_PROXY=http://127.0.0.1:1 كي لا يخرجَ أيُّ طلبٍ إلى Google.
#   - «اللابتوب» = مجلّدٌ مؤقّتٌ ومفتاحُ age للاختبار، و`ssh` بديلٌ يشغّلُ الأمرَ محلّيّاً.
#   - لا يلمسُ /etc/wasla ولا /opt/wasla ولا /var/backups/wasla ولا أيَّ حاويةٍ أخرى. يحذفُ ما أنشأه بالاسم.
# الناتج: سطرٌ PASS/FAIL لكلِّ حالة، وملخّصٌ في OUT_DIR/selftest-summary.txt. رمزُ الخروج 0 إن نجحَ كلُّ شيء.
set -uo pipefail; umask 077
H=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$PWD/offsite-selftest-out}; mkdir -p "$OUT"
T=$(mktemp -d /var/tmp/wasla-selftest-XXXXXX); chmod 700 "$T"
L=$T/logs; mkdir -p "$L" "$T/root/etc/wasla" "$T/root/opt/wasla" "$T/backups" "$T/drive" "$T/fakebin" "$T/laptop/.wasla" "$T/ltmp"
PROD=wasla-selftest-prod; PASSN=0; FAILN=0; SUM=$OUT/selftest-summary.txt; : > "$SUM"
REAL_BIN=${SELFTEST_BIN:-/opt/wasla/bin}
export WASLA_ETC=$T/root/etc/wasla WASLA_OPT=$H WASLA_BIN=$REAL_BIN BACKUP_DIR=$T/backups CONFIG_ROOT=$T/root
export PROD_DB_CONTAINER=$PROD STORAGE_CONTAINER=wasla-selftest-nostorage STORAGE_DB_CONTAINER=wasla-selftest-nostorage-db
export DRILL_PREFIX=wasla-selftest-drill OFFSITE_LOG_TAG=wasla-offsite-selftest OFFSITE_RETRIES=1 OFFSITE_LL_RETRIES=2 DRIFT_INFO=1
export HOME=$T/laptop TMPDIR=$T/ltmp WASLA_REMOTE_PREFIX=$H WASLA_LOG_DIR=$L
export PATH=$T/fakebin:$REAL_BIN:$PATH
TOOL=(python3 "$H/offsite-tool.py")

say(){ printf '%s\n' "$*" | tee -a "$SUM"; }
ok(){ PASSN=$((PASSN+1)); say "PASS  $1"; }
bad(){ FAILN=$((FAILN+1)); say "FAIL  $1 -- ${2:-}"; }
# check NAME EXPECTED_RC ACTUAL_RC LOGFILE [مطلوبٌ في السجلّ] [ممنوعٌ في السجلّ]
check(){ local n=$1 e=$2 a=$3 f=$4 need=${5:-} forbid=${6:-}
  if [ "$a" != "$e" ]; then bad "$n" "rc=$a want=$e ($(tail -2 "$f" | tr '\n' ' ' | head -c 300))"; return; fi
  if [ -n "$need" ] && ! grep -qE -- "$need" "$f"; then bad "$n" "missing /$need/"; return; fi
  if [ -n "$forbid" ] && grep -qE -- "$forbid" "$f"; then bad "$n" "found forbidden /$forbid/"; return; fi
  ok "$n"; }
# لا بقايا: لا حاوياتِ تمرين، ولا مؤقّتاتٍ في مجلّدِ النسخ، ولا في مؤقّتِ اللابتوب.
leftovers(){ local n=$1 x
  x=$(docker ps -a --format '{{.Names}}' | grep -E "^($DRILL_PREFIX|wasla-selftest-sdrill)" || true)
  x+=$(find "$T/backups" -mindepth 1 \( -name '.drill-*' -o -name '.fetch-*' -o -name '.stage-*' -o -name '*.part' -o -name '.rclone-*' \) 2>/dev/null)
  x+=$(find "$T/ltmp" -mindepth 1 2>/dev/null)
  if [ -z "$x" ]; then ok "$n: no leftovers"; else bad "$n: leftovers" "$(echo "$x" | head -3 | tr '\n' ' ')"; fi; }
cleanup(){ [ -f "$T/sampling" ] && rm -f "$T/sampling"; [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  docker rm -f "$PROD" >/dev/null 2>&1; docker ps -a --format '{{.Names}}' | grep -E "^$DRILL_PREFIX" | xargs -r docker rm -f >/dev/null 2>&1
  cp -a "$L" "$OUT/logs" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# ssh بديل: يتجاهلُ الخياراتِ والمضيف ويشغّلُ الأمرَ محلّيّاً (نحن root أصلاً).
cat > "$T/fakebin/ssh" <<'EOF'
#!/usr/bin/env bash
[ -n "${SSH_CALL_LOG:-}" ] && echo "ssh $*" >> "$SSH_CALL_LOG"
# كـssh الحقيقيّ: دونَ -n يقرأُ stdin كلَّه (فيبتلعُ ما بعدَه من مدخلاتِ المالك)؛ مع -n لا يقرأُ شيئاً.
n=0; while [ $# -gt 0 ]; do case "$1" in -n) n=1; shift;; -o) shift 2;; -*) shift;; *) break;; esac; done
shift; [ $n = 1 ] && exec bash -c "$*" < /dev/null
i=$(mktemp); cat > "$i"; [ -n "${SSH_STDIN_COPY:-}" ] && cp "$i" "$SSH_STDIN_COPY"; bash -c "$*" < "$i"; r=$?; rm -f "$i"; exit $r
EOF
chmod 755 "$T/fakebin/ssh"

say "# offsite selftest $(date -u +%FT%TZ) host=$(hostname -s) rclone=$("$REAL_BIN/rclone" version | head -1 | cut -d' ' -f2) age=$("$REAL_BIN/age" --version) python=$(python3 -V | cut -d' ' -f2) ssh=$(/usr/bin/ssh -V 2>&1 | cut -d' ' -f1)"

# ======================= A) فحوصُ الأداةِ على أرشيفاتٍ مصنوعة =======================
TS0=20000101T000000Z
python3 - "$T/u" "$TS0" <<'PY'
import io, os, sys, tarfile
d, ts = sys.argv[1], sys.argv[2]; os.makedirs(d)
base = ["waslah-%s.dump", "waslah-%s.dump.sha256", "config-%s.tgz", "MANIFEST.sha256"]
st = ["storage-roles-%s.sql", "storage-db-%s.dump", "storage-db-%s.dump.sha256", "storage-files-%s.tar",
      "storage-files-%s.tar.sha256", "storage-files-%s.sha256"]
def mk(name, members):
    with tarfile.open(os.path.join(d, name), "w") as t:
        for m in members:
            if isinstance(m, tarfile.TarInfo): t.addfile(m, io.BytesIO(b"x" * m.size) if m.isreg() else None); continue
            ti = tarfile.TarInfo(m); ti.size = 1; t.addfile(ti, io.BytesIO(b"x"))
good = [b % ts if "%s" in b else b for b in base]
mk("good.tar", good)
mk("good-rowstats.tar", good + ["waslah-%s.rowstats" % ts])
mk("good-storage.tar", good + [s % ts for s in st] + ["storage-db-%s.rowstats" % ts])
mk("traversal.tar", good + ["../evil"])
mk("traversal-deep.tar", good + ["a/../../evil"])
mk("absolute.tar", good + ["/tmp/evil"])
mk("subdir.tar", good + ["sub/waslah-%s.dump" % ts])
sl = tarfile.TarInfo("waslah-%s.rowstats" % ts); sl.type = tarfile.SYMTYPE; sl.linkname = "/etc/shadow"
mk("symlink.tar", good + [sl])
hl = tarfile.TarInfo("waslah-%s.rowstats" % ts); hl.type = tarfile.LNKTYPE; hl.linkname = "waslah-%s.dump" % ts
mk("hardlink.tar", good + [hl])
fi = tarfile.TarInfo("waslah-%s.rowstats" % ts); fi.type = tarfile.FIFOTYPE
mk("fifo.tar", good + [fi])
su = tarfile.TarInfo("waslah-%s.rowstats" % ts); su.size = 1; su.mode = 0o4755
mk("setuid.tar", good + [su])
mk("extra.tar", good + ["notes.txt"])
mk("dup.tar", good + ["waslah-%s.dump" % ts])
mk("missing.tar", good[1:])
mk("othertts.tar", [b % "20000101T000001Z" if "%s" in b else b for b in base])
mk("storage-partial.tar", good + [st[1] % ts, st[2] % ts])
open(os.path.join(d, "notatar.tar"), "wb").write(b"age-encryption.org/v1\n-> X25519 garbage\n")
# أرشيفُ بايتاتِ المخزن
def smk(name, members):
    with tarfile.open(os.path.join(d, name), "w") as t:
        for m in members:
            t.addfile(m, io.BytesIO(b"x" * m.size) if m.isreg() else None)
def reg(n): ti = tarfile.TarInfo(n); ti.size = 1; return ti
def dr(n): ti = tarfile.TarInfo(n); ti.type = tarfile.DIRTYPE; return ti
smk("st-good.tar", [dr("."), dr("./stub"), dr("./stub/wasla"), reg("./stub/wasla/a.pdf")])
s2 = tarfile.TarInfo("./stub/link"); s2.type = tarfile.SYMTYPE; s2.linkname = "/etc"
smk("st-symlink.tar", [dr("."), s2])
smk("st-traversal.tar", [dr("."), reg("./../../evil")])
smk("st-abs.tar", [reg("/etc/evil")])
# أرشيفُ الإعداد
import gzip
def cmk(name, names):
    with tarfile.open(os.path.join(d, name), "w:gz") as t:
        for n in names: ti = tarfile.TarInfo(n); ti.size = 1; t.addfile(ti, io.BytesIO(b"x"))
ess = ["etc/wasla/gateway.env", "etc/wasla/db.env", "opt/wasla/compose.yml"]
cmk("cfg-good.tgz", ess + ["etc/wasla/redis.conf"])
cmk("cfg-extra.tgz", ess + ["etc/passwd"])
cmk("cfg-missing.tgz", ess[1:])
cmk("cfg-traversal.tgz", ess + ["etc/wasla/../../root/.ssh/authorized_keys"])
PY
U=$T/u
for c in good good-rowstats good-storage; do "${TOOL[@]}" check-tar "$U/$c.tar" "$TS0" > "$L/u.$c" 2>&1; check "tool check-tar accepts $c" 0 $? "$L/u.$c" '^tar-ok'; done
for c in traversal traversal-deep absolute subdir symlink hardlink fifo setuid extra dup missing othertts storage-partial notatar; do
  "${TOOL[@]}" check-tar "$U/$c.tar" "$TS0" > "$L/u.$c" 2>&1; check "tool check-tar rejects $c" 1 $? "$L/u.$c" 'tar-reject'; done
"${TOOL[@]}" check-storage-tar "$U/st-good.tar" > "$L/u.st" 2>&1; check "tool check-storage-tar accepts good" 0 $? "$L/u.st" 'storage-tar-ok files=1'
for c in st-symlink st-traversal st-abs; do "${TOOL[@]}" check-storage-tar "$U/$c.tar" > "$L/u.$c" 2>&1; check "tool check-storage-tar rejects ${c#st-}" 1 $? "$L/u.$c" 'storage-tar-reject'; done
"${TOOL[@]}" check-config "$U/cfg-good.tgz" > "$L/u.cfg" 2>&1; check "tool check-config accepts good" 0 $? "$L/u.cfg" 'config-ok files=4'
for c in cfg-extra cfg-missing cfg-traversal; do "${TOOL[@]}" check-config "$U/$c.tgz" > "$L/u.$c" 2>&1; check "tool check-config rejects ${c#cfg-}" 1 $? "$L/u.$c" 'config-reject'; done
# التفريغُ بمرشّحِ data لا يكتبُ خارجَ الهدفِ حتّى لو تُجوِزَ check-tar (دفاعٌ ثانٍ).
mkdir -p "$U/xt"; "${TOOL[@]}" extract "$U/traversal.tar" "$U/xt" > "$L/u.xt" 2>&1; rc=$?
if [ "$rc" != 0 ] && [ ! -e "$U/evil" ]; then ok "tool extract (filter=data) refuses traversal even without check-tar"; else bad "tool extract traversal" "rc=$rc"; fi
# البيان
mf(){ printf 'format=wasla-offsite-v1\nname=wasla-%s.tar.age\nts=%s\ncreated_at=2000-01-01T00:00:00Z\nciphertext_bytes=10\nciphertext_sha256=%s\ninner_manifest_sha256=%s\nage_recipient=age1%s\n' \
  "$1" "$1" "$(printf a%.0s {1..64})" "$(printf b%.0s {1..64})" "$(printf q%.0s {1..58})"; }
mf "$TS0" > "$U/m.good"; "${TOOL[@]}" manifest-get "$U/m.good" ts > "$L/u.m" 2>&1; check "tool manifest accepts good" 0 $? "$L/u.m" "^$TS0\$"
{ mf "$TS0"; echo "extra=1"; } > "$U/m.extra"; mf "$TS0" | sed 's/^format=.*/format=v2/' > "$U/m.fmt"
mf "$TS0" | sed "s/^name=.*/name=wasla-20000101T000009Z.tar.age/" > "$U/m.name"; mf "$TS0" | grep -v ^ciphertext_sha256 > "$U/m.miss"
mf "$TS0" | sed 's/^ciphertext_bytes=.*/ciphertext_bytes=1;rm -rf \//' > "$U/m.inj"
for c in extra fmt name miss inj; do "${TOOL[@]}" manifest-get "$U/m.$c" ts > "$L/u.m$c" 2>&1; check "tool manifest rejects $c" 1 $? "$L/u.m$c" 'manifest-reject'; done
# قسمُ rclone
TOKJ='{"access_token":"A","token_type":"Bearer","refresh_token":"R","expiry":"2000-01-01T00:00:00Z"}'
sec(){ printf '[wasla-gdrive]\ntype = drive\nclient_id = 1-abc.apps.googleusercontent.com\nclient_secret = S\nscope = %s\ntoken = %s\n%s' "${1:-drive.file}" "${2:-$TOKJ}" "${3:-}"; }
sec | "${TOOL[@]}" rclone-section "$U/rc.good" > "$L/u.rc" 2>&1; rc=$?
[ "$rc" = 0 ] && [ "$(stat -c %a "$U/rc.good")" = 600 ] && ok "tool rclone-section accepts good, mode 600" || bad "tool rclone-section good" "rc=$rc"
sec drive > "$U/s.scope"; sec drive.file '{"access_token":"A"}' > "$U/s.norefresh"; sec drive.file "$TOKJ" 'auth_url = http://127.0.0.1:9/auth
' > "$U/s.endpoint"; sec drive.file "$TOKJ" 'service_account_file = /etc/shadow
' > "$U/s.unknown"; sec drive.file "$TOKJ" 'auth_url = https://evil.example/auth
' > "$U/s.evil"; sec | sed 's/1-abc.apps.googleusercontent.com/evil.com/' > "$U/s.cid"; { sec; printf '[other]\ntype = local\n'; } > "$U/s.two"
for c in scope norefresh endpoint unknown cid two; do "${TOOL[@]}" rclone-section "$U/rc.$c" < "$U/s.$c" > "$L/u.s$c" 2>&1
  r=$?; [ "$r" = 1 ] && [ ! -e "$U/rc.$c" ] && ok "tool rclone-section rejects $c (nothing written)" || bad "tool rclone-section $c" "rc=$r"; done
"${TOOL[@]}" rclone-section "$U/rc.evil" --allow-test-endpoints < "$U/s.evil" > "$L/u.sevil" 2>&1; check "tool rclone-section rejects non-loopback endpoint even in test mode" 1 $? "$L/u.sevil" 'test_endpoint'
"${TOOL[@]}" rclone-section "$U/rc.ep" --allow-test-endpoints < "$U/s.endpoint" > "$L/u.sep" 2>&1; check "tool rclone-section accepts loopback endpoint only with explicit test flag" 0 $? "$L/u.sep" 'section-ok'
# مقارنةُ rowstats
printf '# h\npublic.a\t3\tx\npublic.b\t0\t-\n' > "$U/r1"; cp "$U/r1" "$U/r2"
printf '# h\npublic.a\t4\tx\npublic.b\t0\t-\n' > "$U/r3"; printf '# h\npublic.a\t3\ty\npublic.b\t0\t-\n' > "$U/r4"; printf '# h\npublic.a\t3\tx\n' > "$U/r5"; printf '# h\n' > "$U/r6"
"${TOOL[@]}" compare-rowstats "$U/r1" "$U/r2" > "$L/u.r" 2>&1; check "tool compare-rowstats match" 0 $? "$L/u.r" 'result=MATCH'
"${TOOL[@]}" compare-rowstats "$U/r1" "$U/r3" > "$L/u.r3" 2>&1; check "tool compare-rowstats count mismatch" 1 $? "$L/u.r3" 'count_mismatch table=public.a'
"${TOOL[@]}" compare-rowstats "$U/r1" "$U/r4" > "$L/u.r4" 2>&1; check "tool compare-rowstats content mismatch (same count)" 1 $? "$L/u.r4" 'content_mismatch table=public.a'
"${TOOL[@]}" compare-rowstats "$U/r1" "$U/r5" > "$L/u.r5" 2>&1; check "tool compare-rowstats missing table" 1 $? "$L/u.r5" 'missing table=public.b'
"${TOOL[@]}" compare-rowstats "$U/r6" "$U/r6" > "$L/u.r6" 2>&1; check "tool compare-rowstats empty expected is not a match" 1 $? "$L/u.r6" 'MISMATCH'

# ======================= B) قاعدةُ «إنتاجٍ» وهميّةٌ ولقطةٌ متّسقة =======================
IMG=$(docker inspect -f '{{.Config.Image}}' wasla-db-1)
printf 'POSTGRES_PASSWORD=%s\n' "$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)" > "$T/prod.env"
docker run -d --name "$PROD" --network none --env-file "$T/prod.env" "$IMG" >/dev/null
. "$H/offsite-lib.sh"; wait_pg "$PROD" || bad "fake prod start"
P(){ docker exec -i "$PROD" psql -U postgres -d waslah -AtqX -v ON_ERROR_STOP=1 "$@"; }
docker exec "$PROD" createdb -U postgres -T template0 waslah
P > "$L/seed" 2>&1 <<'SQL'
CREATE EXTENSION postgis;
CREATE SCHEMA ops;
CREATE TABLE users (id bigserial PRIMARY KEY, name text, phone text, created_at timestamptz DEFAULT now(), score float8, avatar bytea, meta jsonb);
CREATE TABLE orders (id bigserial PRIMARY KEY, user_id bigint REFERENCES users, status text, price numeric(10,2), at timestamptz, pickup geography(Point,4326));
CREATE TABLE audit_empty (id int);
CREATE TABLE ops.jobs (id serial PRIMARY KEY, kind text, run_at timestamp, every interval);
INSERT INTO users (name, phone, score, avatar, meta)
  SELECT 'مستخدم ' || g, '+9665' || lpad(g::text, 8, '0'), g / 7.0, decode(md5(g::text), 'hex'), jsonb_build_object('g', g, 'tags', ARRAY['a', 'ب'])
  FROM generate_series(1, 500) g;
INSERT INTO orders (user_id, status, price, at, pickup)
  SELECT 1 + g % 500, (ARRAY['new','accepted','done'])[1 + g % 3], g * 1.25, now() - g * interval '1 minute',
         ST_SetSRID(ST_MakePoint(39.1 + g / 10000.0, 21.5), 4326)::geography FROM generate_series(1, 2000) g;
INSERT INTO ops.jobs (kind, run_at, every) SELECT 'k' || g, '2026-01-01'::timestamp + g * interval '1 hour', interval '15 minutes' FROM generate_series(1, 91) g;
SQL
check "fake prod seeded (postgis + 4 tables, 2 schemas)" 0 $? "$L/seed"
printf 'X=1\n' > "$T/root/etc/wasla/gateway.env"; printf 'POSTGRES_PASSWORD=not-a-real-secret\n' > "$T/root/etc/wasla/db.env"
printf 'services: {}\n' > "$T/root/opt/wasla/compose.yml"; printf 'TAG=x\n' > "$T/root/opt/wasla/.env"

# كتابةٌ بينَ pg_dump وrowstats: 37 صفّاً جديداً + حذف + تعديل. rowstats يجبُ أن تبقى على اللقطة.
export PG_SNAPSHOT_TEST_HOOK="docker exec $PROD psql -U postgres -d waslah -qc \"INSERT INTO orders (user_id,status,price,at) SELECT 1,'race',1,now() FROM generate_series(1,37); DELETE FROM orders WHERE id=5; UPDATE users SET name='changed' WHERE id=9;\""
bash "$H/backup.sh" > "$L/backup1" 2>&1; check "backup.sh with concurrent writes during snapshot" 0 $? "$L/backup1" '^backup-ok'
unset PG_SNAPSHOT_TEST_HOOK
TS1=$(ls -1 "$T/backups"/waslah-*.dump | sed -nE 's#.*/waslah-(.*)\.dump$#\1#p' | tail -1)
rs_orders=$(grep -P '^public\.orders\t' "$T/backups/waslah-$TS1.rowstats" | cut -f2)
live_orders=$(P -c 'select count(*) from orders')
if [ "$rs_orders" = 2000 ] && [ "$live_orders" = 2036 ]; then ok "snapshot rowstats = pg_dump snapshot (orders 2000) while live moved on (2036)"; else bad "snapshot consistency" "rowstats=$rs_orders live=$live_orders"; fi
if ! grep -q spatial_ref_sys "$T/backups/waslah-$TS1.rowstats" && [ "$(grep -vc '^#' "$T/backups/waslah-$TS1.rowstats")" = 4 ]; then ok "rowstats excludes extension tables (spatial_ref_sys), 4 tables"; else bad "rowstats table set" "$(grep -v '^#' "$T/backups/waslah-$TS1.rowstats" | cut -f1 | tr '\n' ' ')"; fi
if grep -q "/" "$T/backups/waslah-$TS1.dump.sha256"; then bad "sha256 file uses relative name"; else ok "dump .sha256 uses a relative name (no absolute production path)"; fi

# ======================= C) OAuth والأسرارُ وفشلُ الاتصال =======================
CSEC="CLIENT-SECRET-MARKER-$(head -c 9 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
printf '%s\n' "$CSEC" MOCK-REFRESH-TOKEN-SECRET-MARKER MOCK-ACCESS- > "$T/markers"
touch "$T/sampling"
( while [ -f "$T/sampling" ]; do
    for p in /proc/[0-9]*; do
      { tr '\0' ' ' < "$p/cmdline"; echo; } 2>/dev/null | grep -F -f "$T/markers" | sed "s#^#argv pid=${p#/proc/} #"
      { tr '\0' '\n' < "$p/environ"; } 2>/dev/null | grep -F -f "$T/markers" | sed "s#^#environ pid=${p#/proc/} #"
    done >> "$T/argv-hits"; sleep 0.05; done ) &
SAMPLER=$!
# مراقبةٌ إيجابيّة: عمليّةٌ تحملُ العلامةَ في argv يجبُ أن تُلتقَط — وإلّا فالمراقِبُ أعمى.
bash -c 'sleep 1.5; true' "$CSEC" ; sleep 0.3
if grep -q '^argv' "$T/argv-hits"; then ok "argv sampler positive control detects a marker in argv"; else bad "argv sampler positive control" "sampler saw nothing"; fi
: > "$T/argv-hits"
export HTTPS_PROXY=http://127.0.0.1:1 HTTP_PROXY=http://127.0.0.1:1 NO_PROXY=127.0.0.1,localhost https_proxy=http://127.0.0.1:1 no_proxy=127.0.0.1,localhost
python3 "$H/tests/mock-oauth.py" 18080 ok "$L/mock.log" & MOCK_PID=$!; sleep 1
"$REAL_BIN/age-keygen" -o "$T/laptop/.wasla/wasla-backup.agekey" 2>/dev/null
# ADR 0299: إدخالٌ خاطئٌ لآخرِ 8 أحرفٍ من بصمةِ الخادم ⇒ توقّفٌ قبلَ أيِّ اتصالٍ وأيِّ تثبيت.
printf 'AAAAAAAA\n' > "$T/hk-bad"; : > "$T/ssh-calls"
SSH_CALL_LOG="$T/ssh-calls" bash "$H/laptop/wasla-offsite-connect.sh" < "$T/hk-bad" > "$L/connect-hk-bad" 2>&1; rc=$?
check "connect: wrong host-key fingerprint suffix ⇒ refuses before any SSH" 1 $rc "$L/connect-hk-bad" 'لا تطابق' 'ثُبِّتَ مفتاحُ'
[ ! -s "$T/ssh-calls" ] && [ ! -e "$T/laptop/.wasla/known_hosts" ] && [ ! -e "$T/laptop/.wasla/allowed_signers" ] &&
  ok "connect: wrong suffix ⇒ no ssh call, no known_hosts, no allowed_signers" || bad "connect: wrong suffix side effects" "$(cat "$T/ssh-calls")"
# الحقيبةُ معدَّلة: مفتاحٌ مضمَّنٌ لا يطابقُ بصمتَه ⇒ توقّفٌ قبلَ السؤال.
mkdir -p "$T/kit-bad"; cp "$H/laptop/"*.sh "$T/kit-bad/"
sed -i "s#^WASLA_HOST_PUB=.*#WASLA_HOST_PUB='$(ssh-keygen -q -t ed25519 -N '' -f "$T/kit-bad/k" <<<y >/dev/null 2>&1; cut -d' ' -f1,2 "$T/kit-bad/k.pub")'#" "$T/kit-bad/wasla-laptop-lib.sh"
SSH_CALL_LOG="$T/ssh-calls" bash "$T/kit-bad/wasla-offsite-connect.sh" < "$T/hk-bad" > "$L/connect-kit-bad" 2>&1; rc=$?
check "connect: tampered kit host key ⇒ refuses before prompt/SSH" 1 $rc "$L/connect-kit-bad" 'الحقيبةُ تالفةٌ أو معدَّلة' 'آخرُ 8 أحرف'
SSH_CALL_LOG="$T/ssh-calls" bash "$H/laptop/wasla-offsite-restore-test.sh" --list > "$L/rt-nohost" 2>&1; rc=$?
check "restore-test: host key not pinned ⇒ refuses" 1 $rc "$L/rt-nohost" 'مفتاحُ الخادمِ غيرُ مثبَّت'
[ ! -s "$T/ssh-calls" ] && ok "host-key negatives made no ssh call" || bad "host-key negatives ssh calls" "$(cat "$T/ssh-calls")"
HKFP=$(sed -n "s/^WASLA_HOST_FP='\(.*\)'$/\1/p" "$H/laptop/wasla-laptop-lib.sh")
mkfifo "$T/in"
WASLA_TEST_OAUTH_BASE=http://127.0.0.1:18080 WASLA_OFFSITE_TEST_ENDPOINTS=1 SSH_STDIN_COPY="$T/link-section" \
  bash "$H/laptop/wasla-offsite-connect.sh" < "$T/in" > "$L/connect" 2>&1 & CON=$!
exec 7> "$T/in"; printf '%s\n1-test.apps.googleusercontent.com\n%s\n' "${HKFP: -8}" "$CSEC" >&7; exec 7>&-
for _ in $(seq 60); do U=$(grep -o 'http://127.0.0.1:53682/auth?state=[A-Za-z0-9_-]*' "$L/connect" | head -1); [ -n "$U" ] && break; sleep 0.5; done
[ -n "${U:-}" ] && curl -s --noproxy '*' -L -o /dev/null "$U"
wait "$CON"; rc=$?
check "connect: OAuth via temp config + reconnect, then link fails cleanly when Drive is unreachable (ADR 0300)" 1 $rc "$L/connect" 'link-FAIL'
grep -q 'grant=authorization_code' "$L/mock.log" && ok "connect: authorization code exchanged with (mock) token endpoint" || bad "connect: code exchange" "$(cat "$L/mock.log")"
[ -s "$T/laptop/.wasla/allowed_signers" ] && grep -q '^wasla-backup namespaces="wasla-offsite-backup" ssh-ed25519 ' "$T/laptop/.wasla/allowed_signers" &&
  ok "connect: server signing key pinned in laptop allowed_signers" || bad "connect: allowed_signers"
[ "$(stat -c %a "$T/laptop/.wasla/known_hosts" 2>/dev/null)" = 600 ] && grep -q '^wasla-casaos ssh-ed25519 ' "$T/laptop/.wasla/known_hosts" &&
  grep -q 'تطابق. ثُبِّتَ مفتاحُ الخادم' "$L/connect" && ok "connect: host key verified by owner suffix, pinned in ~/.wasla/known_hosts (600) before signer" || bad "connect: known_hosts"
[ "$(stat -c %a "$WASLA_ETC/backup-signing.key")" = 600 ] && ok "server signing key mode 600" || bad "signing key mode"
[ ! -e "$WASLA_ETC/rclone.conf" ] && [ ! -e "$WASLA_ETC/offsite-pending.env" ] && [ -z "$(find "$WASLA_ETC" -name '.rclone-link-*')" ] &&
  ok "failed link (account check) saved no rclone.conf, no link record, no candidate" || bad "failed link side effects" "$(ls -A "$WASLA_ETC")"
[ ! -e "$WASLA_ETC/offsite.env" ] && ok "failed link left no offsite.env (nightly stays offsite-skip)" || bad "offsite.env written on failure"
# لحالاتِ تحديثِ الرمزِ التالية: القسمُ نفسُه الذي استلمَه الخادمُ عبرَ stdin، بالمتحقِّقِ نفسِه.
python3 "$H/offsite-tool.py" rclone-section "$WASLA_ETC/rclone.conf" --allow-test-endpoints < "$T/link-section" && rm -f "$T/link-section"
[ "$(stat -c %a "$WASLA_ETC/rclone.conf" 2>/dev/null)" = 600 ] && grep -q MOCK-REFRESH "$WASLA_ETC/rclone.conf" && ok "received section validated into rclone.conf (600)" || bad "section → rclone.conf"
[ -z "$(find "$T/ltmp" -mindepth 1)" ] && ok "connect: laptop temp config removed" || bad "connect: laptop temp left"
# تحديثُ الرمز: انتهاءُ access_token ⇒ rclone يحدّثُه من token_url ويحفظُه، والملفُّ يبقى 600.
expire(){ python3 - "$WASLA_ETC/rclone.conf" <<'PY'
import json, re, sys
p = sys.argv[1]; s = open(p).read()
m = re.search(r"^token = (.*)$", s, re.M); t = json.loads(m.group(1)); t["expiry"] = "2000-01-01T00:00:00Z"
open(p, "w").write(s.replace(m.group(0), "token = " + json.dumps(t)))
PY
}
expire; printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=wasla-gdrive\nDRIVE_ROOT=WASLA-Backups\n' "$("$REAL_BIN/age-keygen" -y "$T/laptop/.wasla/wasla-backup.agekey")" > "$WASLA_ETC/offsite.env"
bash "$H/offsite-backup.sh" "$TS1" > "$L/oauth-refresh" 2>&1; rc=$?
check "backup with expired access token: refresh ok, Drive unreachable ⇒ fail at upload" 1 $rc "$L/oauth-refresh" 'offsite-fail stage=upload:wasla-'
grep -q 'grant=refresh_token' "$L/mock.log" && grep -q 'MOCK-ACCESS-2' "$WASLA_ETC/rclone.conf" && ok "refreshed token persisted by rclone" || bad "token refresh persisted"
[ "$(stat -c %a "$WASLA_ETC/rclone.conf")" = 600 ] && ok "rclone.conf still 600 after rclone rewrote it" || bad "rclone.conf mode after refresh" "$(stat -c %a "$WASLA_ETC/rclone.conf")"
leftovers "oauth-refresh"
kill "$MOCK_PID"; wait "$MOCK_PID" 2>/dev/null; python3 "$H/tests/mock-oauth.py" 18080 invalid "$L/mock.log" & MOCK_PID=$!; sleep 1
expire; bash "$H/offsite-backup.sh" "$TS1" > "$L/oauth-invalid" 2>&1; rc=$?
check "backup with revoked/expired refresh token (invalid_grant) ⇒ fail at upload" 1 $rc "$L/oauth-invalid" 'offsite-fail stage=upload:'
leftovers "oauth-invalid"
sed -i '/^token = /d' "$WASLA_ETC/rclone.conf"
bash "$H/offsite-backup.sh" "$TS1" > "$L/oauth-missing" 2>&1; rc=$?
check "backup with missing token ⇒ fail at upload, no prompt" 1 $rc "$L/oauth-missing" 'offsite-fail stage=upload:'
leftovers "oauth-missing"
bash "$H/offsite-fetch.sh" latest > "$L/fetch-noconn" 2>&1; rc=$?; [ "$rc" != 0 ] && ok "fetch fails cleanly when Drive is unreachable" || bad "fetch no conn" "rc=$rc"
kill "$MOCK_PID"; wait "$MOCK_PID" 2>/dev/null; MOCK_PID=""
unset HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy no_proxy
rm -f "$T/sampling"; wait "$SAMPLER" 2>/dev/null
if [ -s "$T/argv-hits" ]; then bad "no secret in any process argv/environ during connect+install+refresh" "$(cut -c1-120 "$T/argv-hits" | head -3)"
else ok "no secret in any process argv/environ during connect+install+refresh (sampled /proc every 50ms)"; fi

# ======================= D) Drive محلّيّ: نسخةٌ وتحقّقٌ واستعادةٌ وحالاتٌ سلبيّة =======================
printf '[testdrive]\ntype = local\n' > "$WASLA_ETC/rclone.conf"; chmod 600 "$WASLA_ETC/rclone.conf"
PUB=$("$REAL_BIN/age-keygen" -y "$T/laptop/.wasla/wasla-backup.agekey")
printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=testdrive\nDRIVE_ROOT=%s\n' "$PUB" "$T/drive" > "$WASLA_ETC/offsite.env"
bash "$H/offsite-backup.sh" "$TS1" > "$L/offsite1" 2>&1
check "offsite-backup: encrypt + sign + upload + md5/sha256 verify" 0 $? "$L/offsite1" 'offsite-ok .*signed=yes drive_md5=ok drive_sha256=ok'
n=$(ls "$T/drive/daily" | wc -l); [ "$n" = 3 ] && ok "remote daily has ciphertext + manifest + signature" || bad "remote daily files" "$n"
grep -q 'rows\|waslah\|orders' "$T/drive/daily/wasla-$TS1.manifest" && bad "outer manifest leaks data" || ok "outer manifest holds no data (names/hashes only)"
leftovers "offsite-backup"
# إنتاجٌ تغيّرَ بعدَ النسخ (فوقَ ما تغيّرَ أثناءها).
P -c "INSERT INTO users (name) SELECT 'after' FROM generate_series(1,11); UPDATE orders SET status='x' WHERE id<4;" >/dev/null
RT=(bash "$H/laptop/wasla-offsite-restore-test.sh")
"${RT[@]}" > "$L/rt-good" 2>&1
check "restore-test: good backup ⇒ PASS (exact rowstats match with snapshot)" 0 $? "$L/rt-good" 'offsite-drill-PASS' 'offsite-drill-FAIL'
grep -q 'result=MATCH' "$L/rt-good" && grep -qE 'drift-info tables_changed_since_backup=[1-9]' "$L/rt-good" &&
  ok "production changed after backup: still PASS, drift reported as information only" || bad "drift info" "$(grep drift "$L/rt-good")"
leftovers "restore good"

D1=$T/drive/daily; C1=$D1/wasla-$TS1.tar.age; M1=$D1/wasla-$TS1.manifest
cp -a "$D1" "$T/drive.good"
restore_good(){ rm -rf "$D1"; cp -a "$T/drive.good" "$D1"; }
neg(){ # neg NAME RC NEED [FORBID]  (يشغّلُ اختبارَ الاستعادةِ ويتحقّقُ من عدمِ البدءِ بالاستعادة)
  "${RT[@]}" ${RTARG:-} > "$L/rt-$1" 2>&1; local rc=$?
  check "restore-test negative: $1" "$2" "$rc" "$L/rt-$1" "$3" "${4:-offsite-drill-PASS}"; leftovers "$1"; restore_good; }
python3 - "$C1" <<'PY'
import sys; p = sys.argv[1]; b = bytearray(open(p, "rb").read()); b[len(b) // 2] ^= 1; open(p, "wb").write(b)
PY
neg tampered-ciphertext 1 'sha256 لا يطابقُ' 'integrity-ok'
truncate -s $(( $(stat -c %s "$C1") / 2 )) "$C1"; neg truncated-download 1 'الحجمُ لا يطابقُ' 'integrity-ok'
"$REAL_BIN/age-keygen" -o "$T/wrong.agekey" 2>/dev/null
WASLA_AGE_KEY=$T/wrong.agekey neg wrong-key 1 'مشفّرةٌ لمفتاحٍ غيرِ مفتاحِك' 'integrity-ok'
sed -i 's/^created_at=.*/created_at=2001-01-01T00:00:00Z/' "$M1"; neg manifest-modified 1 'التوقيعُ غيرُ صالح' 'integrity-ok'
rm -f "$M1.sig"; neg signature-missing 1 'تعذّرَ تنزيلُ التوقيع' 'integrity-ok'
ssh-keygen -q -t ed25519 -N '' -f "$T/attacker.key" </dev/null >/dev/null
rm -f "$M1.sig"; ssh-keygen -q -Y sign -f "$T/attacker.key" -n wasla-offsite-backup "$M1" 2>/dev/null; neg signature-by-other-key 1 'التوقيعُ غيرُ صالح' 'integrity-ok'
rm -f "$M1.sig"; ssh-keygen -q -Y sign -f "$WASLA_ETC/backup-signing.key" -n other-namespace "$M1" 2>/dev/null; neg signature-wrong-namespace 1 'التوقيعُ غيرُ صالح' 'integrity-ok'
# استبدال: بيانٌ موقَّعٌ صحيحٌ لنسخةٍ قديمةٍ يُوضَعُ باسمِ نسخةٍ أحدث.
TSX=20991231T235959Z; for e in tar.age manifest manifest.sig; do cp "$D1/wasla-$TS1.$e" "$D1/wasla-$TSX.$e"; done
RTARG=daily/wasla-$TSX.tar.age neg replay-renamed 1 'البيانُ لنسخةٍ أخرى' 'integrity-ok'; unset RTARG
leftovers "after provenance negatives"

# نسخٌ مزوّرةٌ موقَّعةٌ بمفتاحِ الخادم (= محاكاةُ خادمٍ مخترَق/موقِّعٍ مخدوع) — تختبرُ الدفاعاتِ التالية للتوقيع.
forge(){ # forge TS PLAINFILE|- [raw]  ⇒ يكتبُ إلى D1 نصّاً مشفّراً (أو الملفَّ كما هو إن raw) وبياناً موقَّعاً
  local ts=$1 src=$2 c=$D1/wasla-$1.tar.age m=$D1/wasla-$1.manifest inner=${INNER_OVERRIDE:-}
  if [ "${3:-}" = raw ]; then cp "$src" "$c"; else "$REAL_BIN/age" -r "$PUB" -o "$c" "$src"; fi
  [ -n "$inner" ] || inner=$(tar -xOf "$src" MANIFEST.sha256 2>/dev/null | sha256sum | cut -d' ' -f1)
  printf 'format=wasla-offsite-v1\nname=wasla-%s.tar.age\nts=%s\ncreated_at=2000-01-01T00:00:00Z\nciphertext_bytes=%s\nciphertext_sha256=%s\ninner_manifest_sha256=%s\nage_recipient=%s\n' \
    "$ts" "$ts" "$(stat -c %s "$c")" "$(sha256sum "$c" | cut -d' ' -f1)" "$inner" "$PUB" > "$m"
  rm -f "$m.sig"; ssh-keygen -q -Y sign -f "$WASLA_ETC/backup-signing.key" -n wasla-offsite-backup "$m" 2>/dev/null; }
# نسخةٌ صالحةُ البنيةِ من ملفّاتِ TS1 بطابعٍ جديد، تُعدَّلُ لكلِّ حالة.
mkset(){ local ts=$1 d=$T/set-$1; rm -rf "$d"; mkdir -p "$d"
  for f in waslah-TS1.dump waslah-TS1.rowstats config-TS1.tgz; do cp "$T/backups/${f/TS1/$TS1}" "$d/${f/TS1/$ts}"; done
  (cd "$d" && sha256sum "waslah-$ts.dump" > "waslah-$ts.dump.sha256"); echo "$d"; }
# shellcheck disable=SC2046,SC2010  # أسماءُ ملفّاتِ اختبارٍ ثابتةٌ بلا مسافات
seal(){ local d=$1; (cd "$d" && rm -f MANIFEST.sha256 && sha256sum $(ls | grep -v '^MANIFEST') > "$T/MANIFEST.tmp" && mv "$T/MANIFEST.tmp" MANIFEST.sha256 && tar -cf "$T/plain.tar" *); }
i=10
nf(){ i=$((i+1)); printf '20000102T0000%02dZ' "$i"; }
# فكٌّ فاشلٌ رغمَ صحّةِ التوقيعِ والـsha256: نصٌّ مشفّرٌ معطوبٌ «موقَّع».
ts=$(nf); d=$(mkset "$ts"); seal "$d"; "$REAL_BIN/age" -r "$PUB" -o "$T/c.age" "$T/plain.tar"
python3 -c "import sys;p=sys.argv[1];b=bytearray(open(p,'rb').read());b[-40]^=1;open(p,'wb').write(b)" "$T/c.age"
INNER_OVERRIDE=$(sha256sum "$d/MANIFEST.sha256" | cut -d' ' -f1) forge "$ts" "$T/c.age" raw
RTARG=daily/wasla-$ts.tar.age neg decrypt-authentication-failure 1 'تعذّرَ الفكّ' 'integrity-ok'
ts=$(nf); d=$(mkset "$ts"); seal "$d"; INNER_OVERRIDE=$(printf a%.0s {1..64}) forge "$ts" "$T/plain.tar" raw
RTARG=daily/wasla-$ts.tar.age neg not-age-file 1 'ليس ملفَّ age' 'integrity-ok'
# أرشيفاتٌ خبيثة: تصلُ إلى الخادم ويجبُ أن تُرفضَ قبلَ أيِّ فكٍّ أو استعادة.
evil(){ local ts=$1 kind=$2 d; d=$(mkset "$ts"); seal "$d"
  python3 - "$T/plain.tar" "$kind" "$ts" <<'PY'
import io, sys, tarfile
p, kind, ts = sys.argv[1:]
with tarfile.open(p, "a") as t:
    if kind == "traversal":
        ti = tarfile.TarInfo("../../../../tmp/wasla-selftest-evil"); ti.size = 4; t.addfile(ti, io.BytesIO(b"evil"))
    elif kind == "symlink":
        ti = tarfile.TarInfo("storage-db-%s.rowstats" % ts); ti.type = tarfile.SYMTYPE; ti.linkname = "/etc/shadow"; t.addfile(ti)
    elif kind == "hardlink":
        ti = tarfile.TarInfo("storage-roles-%s.sql" % ts); ti.type = tarfile.LNKTYPE; ti.linkname = "/etc/shadow"; t.addfile(ti)
    elif kind == "extra":
        ti = tarfile.TarInfo("run-me.sh"); ti.size = 4; t.addfile(ti, io.BytesIO(b"id\n"))
PY
  forge "$ts" "$T/plain.tar"; }
for k in traversal symlink hardlink extra; do ts=$(nf); evil "$ts" "$k"
  RTARG=daily/wasla-$ts.tar.age neg "archive-$k" 1 'offsite-drill-FAIL stage=archive_check' 'app-db|integrity-ok'; done
[ ! -e /tmp/wasla-selftest-evil ] && ok "traversal payload never written outside the drill dir" || { bad "traversal payload written"; rm -f /tmp/wasla-selftest-evil; }
# عدمُ تطابقِ البيانات: rowstats داخلَ الأرشيفِ لا تطابقُ التفريغ.
ts=$(nf); d=$(mkset "$ts"); awk -F'\t' 'BEGIN{OFS="\t"} $1=="public.users"{$2=$2+1} {print}' "$d/waslah-$ts.rowstats" > "$T/x" && mv "$T/x" "$d/waslah-$ts.rowstats"
seal "$d"; forge "$ts" "$T/plain.tar"; RTARG=daily/wasla-$ts.tar.age neg rowcount-mismatch 1 'count_mismatch table=public.users'
ts=$(nf); d=$(mkset "$ts"); awk -F'\t' 'BEGIN{OFS="\t"} $1=="public.orders"{$3="00000000000000000000000000000000"} {print}' "$d/waslah-$ts.rowstats" > "$T/x" && mv "$T/x" "$d/waslah-$ts.rowstats"
seal "$d"; forge "$ts" "$T/plain.tar"; RTARG=daily/wasla-$ts.tar.age neg content-mismatch-same-count 1 'content_mismatch table=public.orders'
ts=$(nf); d=$(mkset "$ts"); rm -f "$d/waslah-$ts.rowstats"; seal "$d"; forge "$ts" "$T/plain.tar"
RTARG=daily/wasla-$ts.tar.age neg rowstats-missing-is-inconclusive 3 'offsite-drill-INCONCLUSIVE'
ts=$(nf); d=$(mkset "$ts"); seal "$d"; INNER_OVERRIDE=$(printf c%.0s {1..64}) forge "$ts" "$T/plain.tar"
RTARG=daily/wasla-$ts.tar.age neg inner-manifest-not-signed-value 1 'inner_manifest_not_signed_value' 'app-db'
ts=$(nf); d=$(mkset "$ts"); seal "$d"; printf 'x' >> "$d/waslah-$ts.dump"; (cd "$d" && tar -cf "$T/plain.tar" *); forge "$ts" "$T/plain.tar"
RTARG=daily/wasla-$ts.tar.age neg dump-changed-after-manifest 1 'stage=integrity' 'app-db'
# التمرينُ مباشرةً: مدخلٌ ليس tar، ومدخلٌ فارغ، وبلا توقيع.
MB=$(base64 -w0 < "$M1"); SB=$(base64 -w0 < "$M1.sig")
head -c 5000 /dev/urandom | bash "$H/offsite-restore-drill.sh" --manifest-b64 "$MB" --sig-b64 "$SB" > "$L/drill-garbage" 2>&1
check "drill direct: non-tar stdin rejected before restore" 1 $? "$L/drill-garbage" 'stage=archive_check' 'app-db'
bash "$H/offsite-restore-drill.sh" --manifest-b64 "$MB" --sig-b64 "$SB" < /dev/null > "$L/drill-empty" 2>&1
check "drill direct: empty stdin rejected" 1 $? "$L/drill-empty" 'stage=receive'
bash "$H/offsite-restore-drill.sh" < /dev/null > "$L/drill-nosig" 2>&1
check "drill direct: no manifest/signature ⇒ refuses" 1 $? "$L/drill-nosig" 'stage=usage'
leftovers "drill direct"

# ======================= E) امتلاءُ المساحة (quota) =======================
unshare -m bash -c "
  mkdir -p '$T/q' && mount -t tmpfs -o size=16k tmpfs '$T/q' || exit 9
  printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=testdrive\nDRIVE_ROOT=%s\n' '$PUB' '$T/q' > '$WASLA_ETC/offsite.env'
  bash '$H/offsite-backup.sh' '$TS1'; rc=\$?
  echo remote_files=\$(find '$T/q' -type f | wc -l)
  exit \$rc" > "$L/quota" 2>&1; rc=$?
printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=testdrive\nDRIVE_ROOT=%s\n' "$PUB" "$T/drive" > "$WASLA_ETC/offsite.env"
check "quota exceeded on remote ⇒ fail at upload, partial remote removed" 1 $rc "$L/quota" 'offsite-fail stage=upload:.*' 
grep -q '^remote_files=0' "$L/quota" && ok "quota: no partial file left on remote" || bad "quota remote leftovers" "$(grep remote_files "$L/quota")"
leftovers "quota"
# مفتاحُ توقيعٍ مفقود ⇒ لا رفعَ أصلاً.
mv "$WASLA_ETC/backup-signing.key" "$T/sk"; bash "$H/offsite-backup.sh" "$TS1" > "$L/nosign" 2>&1
check "no signing key ⇒ refuses to upload unsigned backup" 1 $? "$L/nosign" 'stage=no_signing_key'; mv "$T/sk" "$WASLA_ETC/backup-signing.key"

# ======================= F) الأسرارُ في السجلّات =======================
journalctl -t wasla-offsite-selftest --since "-2h" --no-pager > "$L/journal" 2>/dev/null || true
if grep -rlF -f "$T/markers" "$L" > "$T/hits" 2>/dev/null && [ -s "$T/hits" ]; then
  bad "no secret marker in any log/output/journal" "$(tr '\n' ' ' < "$T/hits")"; else ok "no secret marker in any log/output/journal ($(ls "$L" | wc -l) files)"; fi
# أسماءُ الحقولِ تُفحَصُ في سجلّاتِ التشغيلِ وحدَها (سجلّاتُ فحوصِ الأداةِ تذكرُ أسماءَ الحقولِ المرفوضةِ عمداً، وسجلُّ الخادمِ الوهميِّ يذكرُ نوعَ المنحة).
(cd "$L" && grep -lE 'refresh_token|client_secret' connect oauth-* offsite1 rt-* journal quota nosign 2>/dev/null) > "$T/hits2"; if [ -s "$T/hits2" ]; then bad "no token field names in logs" "$(tr '\n' ' ' < "$T/hits2")"; else ok "no token/secret field names in logs"; fi

say "# selftest pass=$PASSN fail=$FAILN"
[ "$FAILN" = 0 ]
