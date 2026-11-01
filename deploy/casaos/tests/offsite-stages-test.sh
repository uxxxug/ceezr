#!/usr/bin/env bash
# الغرض: اختبارٌ فعليٌّ لفصلِ مراحلِ النسخِ خارجَ الموقع (ADR 0300، WR-27): الربطُ ⇏ رفع، وأوّلُ رفعٍ ⇏ تفعيل،
#   والتفعيلُ يُرفَضُ قبلَ شروطِه، والرفعُ الليليُّ لا يحدثُ إلّا بعدَه. يُشغِّلُ السكربتاتِ الحقيقيّةَ نفسَها
#   (offsite-setup.sh وoffsite-backup.sh وbackup.sh وسكربتاتِ الحقيبة) بـage وssh-keygen وrclone حقيقيّة.
# المُحاكى وحدَه:
#   - «Drive»: rclone بديلٌ على «الخادم» (WASLA_BIN/rclone) يسجّلُ كلَّ أمرٍ فرعيٍّ ومساره (بلا أسرار)، ويتحقّقُ من الرمزِ
#     في rclone.conf، ويحوّلُ wasla-gdrive: إلى مجلّدٍ محلّيٍّ ويشغّلُ rclone الحقيقيّ عليه. ويحقنُ أعطالاً بـFAKE_FAIL.
#   - OAuth: tests/mock-oauth.py على 127.0.0.1، ويُحجَبُ أيُّ اتّصالٍ خارجيٍّ بـHTTPS_PROXY. rclone الحقيقيُّ على «اللابتوب».
#   - ssh: بديلٌ يشغّلُ الأمرَ محلّيّاً (ويبتلعُ stdin دونَ -n كالحقيقيّ). وقاعدةُ البيانات: pg-snapshot-dump.sh بديل.
#   لا root ولا Docker ولا شبكة. لا يلمسُ /etc/wasla ولا /opt/wasla. «اللابتوب» مجلّدُ مستخدمٍ فيه مسافة.
# الاستعمال: bash deploy/casaos/tests/offsite-stages-test.sh [OUT_DIR]   (يحتاجُ age وage-keygen وrclone وpython3 وcurl وflock)
# الناتج: سطرُ PASS/FAIL لكلِّ حالة، وملخّصٌ في OUT_DIR/stages-summary.txt. رمزُ الخروج 0 إن نجحَ كلُّ شيء.
set -uo pipefail; umask 077
SRC=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-$PWD/offsite-stages-out}; mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
for c in age age-keygen rclone python3 curl flock ssh-keygen sha256sum; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done
T=$(mktemp -d "${TMPDIR:-/tmp}/wasla-stages-XXXXXX"); chmod 700 "$T"
L=$T/logs; SUM=$OUT/stages-summary.txt; : > "$SUM"; P=0; F=0
say(){ printf '%s\n' "$*" | tee -a "$SUM"; }
ok(){ P=$((P+1)); say "PASS  $1"; }; bad(){ F=$((F+1)); say "FAIL  $1 -- ${2:-}"; }
# check NAME WANT_RC RC FILE [MUST_REGEX] [MUSTNOT_REGEX]
check(){ local n=$1 w=$2 r=$3 f=$4 m=${5:-} x=${6:-}
  if [ "$r" != "$w" ]; then bad "$n" "rc=$r want=$w: $(tail -3 "$f" | tr '\n' ' ' | cut -c1-300)"; return; fi
  if [ -n "$m" ] && ! grep -qE -- "$m" "$f"; then bad "$n" "missing /$m/: $(tail -3 "$f" | tr '\n' ' ' | cut -c1-300)"; return; fi
  if [ -n "$x" ] && grep -qE -- "$x" "$f"; then bad "$n" "unexpected /$x/"; return; fi
  ok "$n"; }
MOCK_PID=""; SAMPLER=""
cleanup(){ [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null; rm -f "$T/sampling"; [ -n "$SAMPLER" ] && wait "$SAMPLER" 2>/dev/null
  cp -r "$L" "$OUT/logs" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

# ---------------- «الخادم» ----------------
S=$T/srv/opt-wasla; ETC=$T/srv/etc-wasla; DRIVE=$T/srv/fake-drive; FB=$T/srv/fakebin
mkdir -p "$L" "$S" "$ETC" "$DRIVE" "$FB" "$S/bin" "$T/srv/backups" "$T/srv/root/etc/wasla" "$T/srv/root/opt/wasla"
cp -a "$SRC"/*.sh "$SRC/offsite-tool.py" "$S/"
# قاعدةٌ بديلة: dump عشوائيٌّ وrowstats بصيغتِها (المسارُ الحقيقيُّ مختبَرٌ في offsite-selftest.sh على postgis).
cat > "$S/pg-snapshot-dump.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail; head -c 200000 /dev/urandom > "$3"
printf '# rowstats snapshot\npublic.riders\t300\t%s\npublic.orders\t2000\t%s\n' "$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')" "$(sha256sum "$3" | cut -c1-32)" > "$4"
EOF
printf '#!/usr/bin/env bash\nexit 1\n' > "$FB/docker"; chmod 755 "$S/pg-snapshot-dump.sh" "$FB/docker"
printf 'X=1\n' > "$T/srv/root/etc/wasla/gateway.env"; printf 'Y=1\n' > "$T/srv/root/etc/wasla/db.env"; printf 'services: {}\n' > "$T/srv/root/opt/wasla/compose.yml"
ln -s "$(command -v age)" "$S/bin/age"
REAL_RCLONE=$(command -v rclone); SSHV=$(ssh -V 2>&1 | cut -d, -f1); : > "$T/empty.conf"
cat > "$S/bin/rclone" <<'EOF'
#!/usr/bin/env python3
# rclone بديل («Google Drive» محلّيّ). يسجّلُ: الأمرَ الفرعيَّ والمساراتِ البعيدة فقط.
import configparser, json, os, sys
a = sys.argv[1:]; cfg = os.environ.get("RCLONE_CONFIG", ""); VAL = {"--retries", "--low-level-retries", "--contimeout",
    "--timeout", "--include", "--format", "--separator", "--min-age", "--config"}
pos, rest, i = [], [], 0
while i < len(a):
    x = a[i]
    if x == "--config": cfg = a[i + 1]; i += 2; continue
    if x in VAL: rest += [x, a[i + 1]]; i += 2; continue
    if x.startswith("-"): rest.append(x); i += 1; continue
    pos.append(x); i += 1
sub = pos[0] if pos else ""
real = os.environ["FAKE_REAL_RCLONE"]
if sub == "version": os.execv(real, [real, "version"])
remotes = [p for p in pos[1:] if p.startswith("wasla-gdrive:")]
with open(os.environ["FAKE_RCLONE_LOG"], "a") as f: f.write(sub + " " + " ".join(remotes) + "\n")
ok = False
try:
    cp = configparser.RawConfigParser(interpolation=None); cp.read(cfg)
    s = cp["wasla-gdrive"]; tok = json.loads(s.get("token", ""))
    ok = s.get("type") == "drive" and s.get("scope") == "drive.file" and tok.get("refresh_token", "").startswith("MOCK-REFRESH")
except Exception:
    ok = False
if not ok or os.path.exists(os.environ["FAKE_REVOKED"]):
    sys.stderr.write("fake-drive: couldn't authenticate\n"); sys.exit(1)
for rule in filter(None, os.environ.get("FAKE_FAIL", "").split(",")):
    k, _, needle = rule.partition(":")
    if k == sub and (not needle or any(needle in r for r in remotes)):
        sys.stderr.write("fake-drive: injected failure %s\n" % rule); sys.exit(1)
if sub == "about":
    print(json.dumps({"total": 16106127360, "used": 1048576, "free": 16105078784})); sys.exit(0)
d = os.environ["FAKE_DRIVE"]
mapped = [d + "/" + p[len("wasla-gdrive:"):] if p.startswith("wasla-gdrive:") else p for p in pos[1:]]
os.execv(real, [real, sub] + mapped + rest + ["--config", os.environ["FAKE_EMPTY_CONF"]])
EOF
chmod 755 "$S/bin/rclone"
FLOG=$T/rclone-calls
export WASLA_ETC=$ETC WASLA_OPT=$S WASLA_BIN=$S/bin BACKUP_DIR=$T/srv/backups CONFIG_ROOT=$T/srv/root
export PROD_DB_CONTAINER=wasla-stages-fake STORAGE_CONTAINER=none STORAGE_DB_CONTAINER=none OFFSITE_LOG_TAG=wasla-offsite-stagestest
export OFFSITE_RETRIES=1 OFFSITE_LL_RETRIES=1 FAKE_REAL_RCLONE=$REAL_RCLONE FAKE_DRIVE=$DRIVE FAKE_RCLONE_LOG=$FLOG
export FAKE_REVOKED=$T/revoked FAKE_EMPTY_CONF=$T/empty.conf FAKE_FAIL=""
# ---------------- «اللابتوب» (مجلّدٌ فيه مسافة) ----------------
LH="$T/Owner Home"; KIT="$LH/Downloads/wasla kit"; mkdir -p "$KIT" "$LH/.wasla" "$LH/tmp dir"
cp "$SRC/laptop/"*.sh "$KIT/"
cat > "$FB/ssh" <<'EOF'
#!/usr/bin/env bash
[ -n "${SSH_CALL_LOG:-}" ] && echo "ssh $*" >> "$SSH_CALL_LOG"
n=0; while [ $# -gt 0 ]; do case "$1" in -n) n=1; shift;; -o) shift 2;; -*) shift;; *) break;; esac; done
shift; [ $n = 1 ] && exec bash -c "$*" < /dev/null
i=$(mktemp); cat > "$i"; bash -c "$*" < "$i"; r=$?; rm -f "$i"; exit $r
EOF
chmod 755 "$FB/ssh"
export PATH=$FB:$PATH
LAPTOP_ENV=(env "HOME=$LH" "TMPDIR=$LH/tmp dir" "WASLA_REMOTE_PREFIX=$S" "SSH_CALL_LOG=$T/ssh-calls" "WASLA_LOG_DIR=$L")
HKFP=$(sed -n "s/^WASLA_HOST_FP='\(.*\)'$/\1/p" "$KIT/wasla-laptop-lib.sh")
age-keygen -o "$LH/.wasla/wasla-backup.agekey" 2>/dev/null; PUB=$(age-keygen -y "$LH/.wasla/wasla-backup.agekey")

say "# offsite stages test (ADR 0300) $(date -u +%FT%TZ) $(uname -sr) bash=$BASH_VERSION age=$(age --version) $(rclone version | head -1) python=$(python3 -V 2>&1 | cut -d' ' -f2) ssh=$SSHV"
state(){ for f in offsite.env offsite-pending.env offsite-first-ok rclone.conf; do
  if [ -e "$ETC/$f" ]; then echo "$f $(sha256sum < "$ETC/$f" | cut -c1-16)"; else echo "$f absent"; fi; done; }
stage(){ bash "$S/offsite-setup.sh" --status | sed -n 's/^stage=//p'; }
nfiles(){ find "$DRIVE" -type f | wc -l | tr -d ' '; }
ncalls(){ grep -cE "^($1) " "$FLOG" 2>/dev/null || true; }
writes(){ grep -cE '^(copyto|copy|move|moveto|mkdir|delete|deletefile|purge|rmdir|rmdirs|sync) ' "$FLOG" 2>/dev/null || true; }
lastts(){ ls -1 "$BACKUP_DIR"/waslah-*.dump | sed -nE 's#.*/waslah-(.*)\.dump$#\1#p' | sort | tail -1; }

# ======================= 0) خطُّ الأساس: لا ربط =======================
bash "$S/offsite-setup.sh" --signing-key > "$L/signing" 2>&1; check "server signing key created (--signing-key)" 0 $? "$L/signing" '^ssh-ed25519 '
: > "$FLOG"; bash "$S/backup.sh" > "$L/backup0" 2>&1
check "baseline: backup.sh local-only before any link" 0 $? "$L/backup0" '^backup-ok' 'offsite-'
[ "$(stage)" = unlinked ] && [ ! -s "$FLOG" ] && ok "baseline: stage=unlinked, zero rclone calls" || bad "baseline" "stage=$(stage) calls=$(wc -l < "$FLOG")"
bash "$S/offsite-setup.sh" --enable-nightly "$(lastts)" > "$L/enable-unlinked" 2>&1
check "test 7: enable refused when not linked" 1 $? "$L/enable-unlinked" 'enable-FAIL not_linked'
bash "$S/offsite-backup.sh" --first > "$L/first-unlinked" 2>&1
check "first upload refused when not linked" 1 $? "$L/first-unlinked" 'first-FAIL not_linked'
[ ! -e "$ETC/offsite.env" ] && [ "$(nfiles)" = 0 ] && ok "baseline refusals left no offsite.env and no remote file" || bad "baseline refusals side effects"
bash "$S/offsite-setup.sh" --install "$PUB" < /dev/null > "$L/install" 2>&1
check "old --install refused (exit 2, no side effects)" 2 $? "$L/install" 'setup-FAIL --install' ; [ "$(state | grep -c absent)" = 4 ] || bad "--install side effects" "$(state)"

# ======================= A) الربطُ عبرَ حقيبةِ اللابتوب =======================
CSEC="CLIENT-SECRET-MARKER-$(head -c 9 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
printf '%s\n' "$CSEC" MOCK-REFRESH-TOKEN-SECRET-MARKER MOCK-ACCESS- AGE-SECRET-KEY- > "$T/markers"
touch "$T/sampling"
( while [ -f "$T/sampling" ]; do
    for p in /proc/[0-9]*; do
      { tr '\0' ' ' < "$p/cmdline"; echo; } 2>/dev/null | grep -F -f "$T/markers" | sed "s#^#argv pid=${p#/proc/} #"
      { tr '\0' '\n' < "$p/environ"; } 2>/dev/null | grep -F -f "$T/markers" | sed "s#^#environ pid=${p#/proc/} #"
    done >> "$T/argv-hits"; sleep 0.05; done ) &
SAMPLER=$!
bash -c 'sleep 1.5; true' "$CSEC"; sleep 0.3
grep -q '^argv' "$T/argv-hits" 2>/dev/null && ok "argv sampler positive control detects a marker in argv" || bad "argv sampler positive control"
: > "$T/argv-hits"
export HTTPS_PROXY=http://127.0.0.1:1 HTTP_PROXY=http://127.0.0.1:1 NO_PROXY=127.0.0.1,localhost https_proxy=http://127.0.0.1:1 no_proxy=127.0.0.1,localhost
python3 "$SRC/tests/mock-oauth.py" 18181 ok "$L/mock.log" & MOCK_PID=$!; sleep 1
connect(){ # connect LOGNAME INPUT…  (المدخلاتُ سطراً سطراً عبرَ fifo؛ والمتصفّحُ = curl إلى رابطِ rclone)
  local log=$L/$1 u=""; shift; rm -f "$T/in"; mkfifo "$T/in"
  "${LAPTOP_ENV[@]}" WASLA_TEST_OAUTH_BASE=http://127.0.0.1:18181 WASLA_OFFSITE_TEST_ENDPOINTS=1 \
    bash "$KIT/wasla-offsite-connect.sh" < "$T/in" > "$log" 2>&1 & local con=$!
  exec 7> "$T/in"; printf '%s\n' "$@" >&7; exec 7>&-
  for _ in $(seq 60); do u=$(grep -o 'http://127.0.0.1:53682/auth?state=[A-Za-z0-9_-]*' "$log" | head -1); [ -n "$u" ] && break
    kill -0 "$con" 2>/dev/null || break; sleep 0.5; done
  [ -n "$u" ] && curl -s --noproxy '*' -L -o /dev/null "$u"
  wait "$con"; }
: > "$FLOG"; : > "$T/ssh-calls"
connect connect1 "${HKFP: -8}" 1-test.apps.googleusercontent.com "$CSEC"; rc=$?
check "link: kit connect (host pin → signer → OAuth → --link) rc=0" 0 $rc "$L/connect1" 'link-ok' 'offsite-ok|first-ok|enable-ok'
[ ! -e "$ETC/offsite.env" ] && ok "test 1: link did not create offsite.env" || bad "test 1: offsite.env after link"
[ "$(nfiles)" = 0 ] && [ -z "$(find "$DRIVE" -mindepth 1)" ] && ok "test 3: link created no folder and no remote backup (fake Drive empty)" || bad "test 3" "$(find "$DRIVE" | head)"
[ "$(writes)" = 0 ] && [ "$(ncalls about)" = 1 ] && [ "$(wc -l < "$FLOG" | tr -d ' ')" = 1 ] &&
  ok "test 2: link made exactly one rclone call: about (read-only quota) — no upload/mkdir/copy" || bad "test 2" "$(tr '\n' ';' < "$FLOG")"
grep -q -- '--link age1' "$T/ssh-calls" && ! grep -qE 'offsite-backup|--enable-nightly|--install' "$T/ssh-calls" &&
  ok "link: kit sent only --status/--signing-key/--link (no backup, no enable)" || bad "link ssh calls" "$(tr '\n' ';' < "$T/ssh-calls")"
[ "$(stat -c %a "$ETC/rclone.conf")" = 600 ] && grep -qF -f <(echo MOCK-REFRESH-TOKEN-SECRET-MARKER) "$ETC/rclone.conf" &&
  ok "link: rclone.conf saved (600) with refresh token" || bad "rclone.conf after link" "$(stat -c %a "$ETC/rclone.conf" 2>&1)"
[ "$(stat -c %a "$ETC/offsite-pending.env")" = 600 ] && grep -qx "AGE_RECIPIENT=$PUB" "$ETC/offsite-pending.env" && grep -qE '^LINK_ID=[0-9a-f]{32}$' "$ETC/offsite-pending.env" &&
  ok "link: offsite-pending.env (600) holds recipient + LINK_ID only" || bad "pending after link"
[ "$(stage)" = linked ] && grep -q 'لم يُرفَعْ أيُّ ملفّ' "$L/connect1" && ok "link: stage=linked and owner told nothing was uploaded" || bad "stage after link" "$(stage)"
[ -z "$(find "$LH/tmp dir" -mindepth 1)" ] && ok "link: laptop temp config removed" || bad "laptop temp left"
grep -q 'grant=authorization_code' "$L/mock.log" && ok "link: OAuth code exchanged with (mock) token endpoint by real rclone" || bad "code exchange"
# ---- test 4: backup.sh بعدَ الربطِ محلّيٌّ فقط
: > "$FLOG"; bash "$S/backup.sh" > "$L/backup-linked" 2>&1
check "test 4: backup.sh after link stays local-only" 0 $? "$L/backup-linked" '^backup-ok' 'offsite-ok|offsite-fail|offsite-skip'
[ ! -s "$FLOG" ] && [ "$(nfiles)" = 0 ] && ok "test 4: zero rclone calls from nightly backup after link" || bad "test 4 calls" "$(tr '\n' ';' < "$FLOG")"
# ---- test 9 (محاكاةُ إعادةِ التشغيل): عمليّةٌ جديدةٌ ببيئةٍ نظيفةٍ (كـsystemd)، وقفلٌ متروك، ثمّ الحالةُ نفسُها.
S1=$(state); touch "$ETC/.offsite.lock"
for i in 1 2; do env -i PATH="$PATH" HOME=/nonexistent WASLA_ETC="$ETC" WASLA_OPT="$S" WASLA_BIN="$S/bin" BACKUP_DIR="$BACKUP_DIR" \
  CONFIG_ROOT="$CONFIG_ROOT" PROD_DB_CONTAINER=x STORAGE_CONTAINER=none STORAGE_DB_CONTAINER=none OFFSITE_LOG_TAG=wasla-offsite-stagestest \
  FAKE_REAL_RCLONE="$REAL_RCLONE" FAKE_DRIVE="$DRIVE" FAKE_RCLONE_LOG="$FLOG" FAKE_REVOKED="$FAKE_REVOKED" FAKE_EMPTY_CONF="$FAKE_EMPTY_CONF" \
  bash "$S/backup.sh" > "$L/restart-linked-$i" 2>&1 || bad "restart sim backup $i"; done
[ "$(state)" = "$S1" ] && [ "$(stage)" = linked ] && [ ! -s "$FLOG" ] && ok "test 9: restart sim (fresh env ×2, stale lock) ⇒ still linked, nothing uploaded" || bad "test 9 linked" "$(state)"
# ---- test 7: التفعيلُ قبلَ أوّلِ رفع
bash "$S/offsite-setup.sh" --enable-nightly "$(lastts)" > "$L/enable-nofirst" 2>&1
check "test 7: enable refused after link but before first upload" 1 $? "$L/enable-nofirst" 'enable-FAIL no_first_upload'
[ ! -e "$ETC/offsite.env" ] && ok "test 7: no offsite.env after refusal" || bad "offsite.env after refused enable"
"${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-enable-nightly.sh" < /dev/null > "$L/kit-enable-nofirst" 2>&1
check "kit enable refused at stage=linked (no prompt, no server call)" 1 $? "$L/kit-enable-nofirst" 'لا يمكنُ التفعيل' 'اكتبْ ENABLE'
# ---- test 10: إعادةُ الربط
: > "$FLOG"; : > "$T/ssh-calls"
connect connect-relink-cancel no; rc=$?
check "relink: without typing RELINK ⇒ cancelled" 1 $rc "$L/connect-relink-cancel" 'أُلغي' 'link-ok'
! grep -q -- '--link' "$T/ssh-calls" && [ "$(state)" = "$S1" ] && ok "relink cancel: no --link, state unchanged" || bad "relink cancel side effects"
OLDLID=$(sed -n 's/^LINK_ID=//p' "$ETC/offsite-pending.env")
connect connect-relink RELINK 1-test.apps.googleusercontent.com "$CSEC"; rc=$?
check "test 10: re-running link (RELINK) rc=0" 0 $rc "$L/connect-relink" 'link-ok'
[ "$(writes)" = 0 ] && [ "$(nfiles)" = 0 ] && [ ! -e "$ETC/offsite.env" ] && [ "$(stage)" = linked ] &&
  ok "test 10: relink ⇒ no upload, no folder, not enabled" || bad "test 10" "$(tr '\n' ';' < "$FLOG") $(stage)"
[ "$(sed -n 's/^LINK_ID=//p' "$ETC/offsite-pending.env")" != "$OLDLID" ] && ls "$ETC"/rclone.conf.bak-* >/dev/null 2>&1 &&
  ok "relink: new LINK_ID, previous rclone.conf kept as .bak" || bad "relink id/backup"
# ---- فشلُ التحقّقِ من الحساب: لا يتغيّرُ شيء
S2=$(state); : > "$FLOG"
FAKE_FAIL=about connect connect-about-fail RELINK 1-test.apps.googleusercontent.com "$CSEC"; rc=$?
check "link with failing account check ⇒ link-FAIL, rc=1" 1 $rc "$L/connect-about-fail" 'link-FAIL' 'link-ok'
[ "$(state)" = "$S2" ] && [ -z "$(find "$ETC" -name '.rclone-link-*')" ] && [ "$(writes)" = 0 ] &&
  ok "failed link keeps previous config, no candidate left, no writes" || bad "failed link side effects" "$(state)"
kill "$MOCK_PID"; wait "$MOCK_PID" 2>/dev/null; MOCK_PID=""
unset HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy no_proxy

# ======================= B) أوّلُ رفعٍ يدويّ =======================
: > "$FLOG"; : > "$T/ssh-calls"
printf 'no\n' | "${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-first-upload.sh" > "$L/kit-first-cancel" 2>&1
check "kit first-upload without typing UPLOAD ⇒ cancelled" 1 $? "$L/kit-first-cancel" 'أُلغي'
! grep -q 'offsite-backup' "$T/ssh-calls" && [ ! -s "$FLOG" ] && ok "first-upload cancel: no backup call, zero rclone calls" || bad "first cancel side effects"
# ---- test 6: فشلُ أوّلِ رفع (رفعُ التوقيع، ثمّ التحقّقُ من md5) ⇒ لا سجلّ، ولا تفعيل، ولا بقايا
for inj in copyto:manifest.sig md5sum:tar.age; do
  : > "$FLOG"; printf 'UPLOAD\n' | FAKE_FAIL=$inj "${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-first-upload.sh" > "$L/kit-first-fail-${inj%%:*}" 2>&1
  check "test 6: first upload with injected failure ($inj) ⇒ rc=1" 1 $? "$L/kit-first-fail-${inj%%:*}" 'offsite-fail stage=' 'first-ok'
  [ ! -e "$ETC/offsite-first-ok" ] && [ ! -e "$ETC/offsite.env" ] && [ "$(nfiles)" = 0 ] && [ "$(stage)" = linked ] &&
    ok "test 6: after failure ($inj): no first-ok, no offsite.env, uploads removed, stage=linked" || bad "test 6 side effects ($inj)" "$(stage) files=$(nfiles)"
done
bash "$S/offsite-setup.sh" --enable-nightly "$(lastts)" > "$L/enable-afterfail" 2>&1
check "test 6/7: enable refused after a failed first upload" 1 $? "$L/enable-afterfail" 'enable-FAIL no_first_upload'
mv "$ETC/backup-signing.key" "$T/sk"; bash "$S/offsite-backup.sh" --first > "$L/first-nosign" 2>&1
check "first upload without signing key ⇒ refuses (no unsigned upload)" 1 $? "$L/first-nosign" 'stage=no_signing_key'
mv "$T/sk" "$ETC/backup-signing.key"; [ "$(nfiles)" = 0 ] || bad "unsigned upload left files"
# قفلٌ مشغول ⇒ رفض
( flock "$ETC/.offsite.lock" sleep 3 ) & LK=$!; sleep 0.5
bash "$S/offsite-backup.sh" --first > "$L/first-busy" 2>&1; check "first upload while another offsite op holds the lock ⇒ refused" 1 $? "$L/first-busy" 'offsite-busy'
wait "$LK"
# ---- test 5: أوّلُ رفعٍ ناجح
: > "$FLOG"; : > "$T/ssh-calls"; TS1=$(lastts)
printf 'UPLOAD\r\n' | "${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-first-upload.sh" > "$L/kit-first" 2>&1
check "test 5: kit first-upload (UPLOAD, CRLF-tolerant) rc=0" 0 $? "$L/kit-first" "first-ok ts=$TS1 .*files=3 nightly=off"
grep -qE -- '^ssh .* -n .*offsite-backup.sh --first$' "$T/ssh-calls" && [ "$(grep -c offsite-backup "$T/ssh-calls")" = 1 ] &&
  ok "test 5: exactly one server call offsite-backup.sh --first (ssh -n)" || bad "first ssh calls" "$(tr '\n' ';' < "$T/ssh-calls")"
[ "$(ncalls copyto)" = 3 ] && [ "$(nfiles)" = 3 ] && [ "$(find "$DRIVE" -path '*/daily/*' -type f | wc -l | tr -d ' ')" = 3 ] &&
  [ -z "$(find "$DRIVE" -path '*/weekly*' -o -path '*/monthly*')" ] && [ "$(ncalls 'delete|deletefile|purge')" = 0 ] &&
  ok "test 5: exactly one backup = 3 files in daily/ (no weekly/monthly seeding, no remote delete)" || bad "test 5 uploads" "copyto=$(ncalls copyto) files=$(nfiles) $(find "$DRIVE" -type f | sed "s#$DRIVE/##" | tr '\n' ' ')"
[ ! -e "$ETC/offsite.env" ] && [ "$(stage)" = first-ok ] && ok "test 5: first upload did NOT enable nightly (no offsite.env, stage=first-ok)" || bad "test 5 enable" "$(stage)"
[ "$(stat -c %a "$ETC/offsite-first-ok")" = 600 ] && grep -qx "FO_TS=$TS1" "$ETC/offsite-first-ok" && ok "first-ok record (600) bound to TS $TS1" || bad "first-ok record"
: > "$FLOG"; bash "$S/backup.sh" > "$L/backup-firstok" 2>&1
check "test 8 (before enable): backup.sh after first upload still local-only" 0 $? "$L/backup-firstok" '^backup-ok' 'offsite-ok|offsite-fail'
[ ! -s "$FLOG" ] && ok "test 8 (before enable): zero rclone calls from nightly" || bad "nightly called rclone before enable" "$(tr '\n' ';' < "$FLOG")"
# ---- test 12: سلامةُ ما رُفعَ (توقيعٌ بمفتاحِ الخادمِ المثبَّتِ على اللابتوب، sha256، فكُّ age، فحصُ الأرشيف، rowstats)
DD=$(dirname "$(find "$DRIVE" -name "wasla-$TS1.tar.age")"); X=$T/verify; mkdir -p "$X"
integrity(){ # integrity DIR ⇒ 0 إن صحَّ كلُّ شيء
  local d=$1 m="$1/wasla-$TS1.manifest"
  ssh-keygen -Y verify -f "$LH/.wasla/allowed_signers" -I wasla-backup -n wasla-offsite-backup -s "$m.sig" < "$m" >/dev/null 2>&1 || { echo sig; return 1; }
  [ "$(sed -n 's/^ciphertext_sha256=//p' "$m")" = "$(sha256sum "$d/wasla-$TS1.tar.age" | cut -d' ' -f1)" ] || { echo sha; return 1; }
  [ "$(sed -n 's/^age_recipient=//p' "$m")" = "$PUB" ] || { echo recipient; return 1; }
  rm -rf "${X:?}"/*; age -d -i "$LH/.wasla/wasla-backup.agekey" -o "$X/p.tar" "$d/wasla-$TS1.tar.age" || { echo decrypt; return 1; }
  python3 "$SRC/offsite-tool.py" check-tar "$X/p.tar" "$TS1" >/dev/null || { echo check-tar; return 1; }
  python3 "$SRC/offsite-tool.py" extract "$X/p.tar" "$X/x" >/dev/null || { echo extract; return 1; }
  python3 "$SRC/offsite-tool.py" check-inner "$X/x" "$TS1" >/dev/null || { echo check-inner; return 1; }
  [ "$(sed -n 's/^inner_manifest_sha256=//p' "$m")" = "$(sha256sum "$X/x/MANIFEST.sha256" | cut -d' ' -f1)" ] || { echo inner; return 1; }
  (cd "$X/x" && sha256sum -c --quiet MANIFEST.sha256) || { echo inner-sums; return 1; }
  cmp -s "$X/x/waslah-$TS1.rowstats" "$BACKUP_DIR/waslah-$TS1.rowstats" && cmp -s "$X/x/waslah-$TS1.dump" "$BACKUP_DIR/waslah-$TS1.dump" || { echo rowstats; return 1; }; }
r=$(integrity "$DD") && ok "test 12: signature (pinned signer), ciphertext sha256, recipient, age -d, check-tar, check-inner, rowstats+dump identical" || bad "test 12 integrity" "$r"
cp -r "$DD" "$T/tamper1"; printf 'X' | dd of="$T/tamper1/wasla-$TS1.tar.age" bs=1 seek=200 conv=notrunc 2>/dev/null
r=$(integrity "$T/tamper1") ; [ "$r" = sha ] && ok "test 12: tampered ciphertext rejected (sha256)" || bad "tamper ciphertext" "$r"
cp -r "$DD" "$T/tamper2"; sed -i 's/^ciphertext_bytes=/ciphertext_bytes=1/' "$T/tamper2/wasla-$TS1.manifest"
r=$(integrity "$T/tamper2"); [ "$r" = sig ] && ok "test 12: edited manifest rejected (signature)" || bad "tamper manifest" "$r"
# ---- test 7: التفعيلُ يرفضُ طابعاً قديماً، وملفّاتٍ مفقودةً من Drive، وسجلّاً معبوثاً بصلاحيّاتِه
bash "$S/offsite-setup.sh" --enable-nightly 20200101T000000Z > "$L/enable-badts" 2>&1
check "test 7: enable refused with a TS that is not the verified first upload" 1 $? "$L/enable-badts" 'enable-FAIL ts_mismatch'
mv "$DD/wasla-$TS1.manifest.sig" "$T/sig.bak"; bash "$S/offsite-setup.sh" --enable-nightly "$TS1" > "$L/enable-missing" 2>&1
check "test 7: enable refused when the first upload is no longer complete on Drive" 1 $? "$L/enable-missing" 'first_upload_missing_on_drive'
mv "$T/sig.bak" "$DD/wasla-$TS1.manifest.sig"
cp "$DD/wasla-$TS1.tar.age" "$T/ct.bak"; head -c 100 "$T/ct.bak" > "$DD/wasla-$TS1.tar.age"; bash "$S/offsite-setup.sh" --enable-nightly "$TS1" > "$L/enable-size" 2>&1
check "test 7: enable refused when ciphertext size on Drive differs from the signed size" 1 $? "$L/enable-size" 'first_upload_missing_on_drive'
cp "$T/ct.bak" "$DD/wasla-$TS1.tar.age"
chmod 644 "$ETC/offsite-first-ok"; bash "$S/offsite-setup.sh" --enable-nightly "$TS1" > "$L/enable-644" 2>&1
check "test 7: enable refused when first-ok record is not 600" 1 $? "$L/enable-644" 'first_upload_record_invalid'
chmod 600 "$ETC/offsite-first-ok"
: > "$FLOG"; "${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-enable-nightly.sh" <<< 'enable' > "$L/kit-enable-cancel" 2>&1
check "kit enable: lowercase/other word ⇒ cancelled" 1 $? "$L/kit-enable-cancel" 'أُلغي' 'enable-ok'
[ ! -e "$ETC/offsite.env" ] && ok "every refused/cancelled enable left no offsite.env" || bad "offsite.env after refusals"
# ---- test 9 مرّةً أخرى: عندَ first-ok
S3=$(state); env -i PATH="$PATH" WASLA_ETC="$ETC" WASLA_OPT="$S" WASLA_BIN="$S/bin" BACKUP_DIR="$BACKUP_DIR" CONFIG_ROOT="$CONFIG_ROOT" \
  STORAGE_CONTAINER=none FAKE_REAL_RCLONE="$REAL_RCLONE" FAKE_DRIVE="$DRIVE" FAKE_RCLONE_LOG="$FLOG" FAKE_REVOKED="$FAKE_REVOKED" \
  FAKE_EMPTY_CONF="$FAKE_EMPTY_CONF" OFFSITE_LOG_TAG=wasla-offsite-stagestest bash "$S/backup.sh" > "$L/restart-firstok" 2>&1
[ "$(state)" = "$S3" ] && [ "$(stage)" = first-ok ] && [ "$(nfiles)" = 3 ] && ok "test 9: restart sim at first-ok ⇒ unchanged, still not enabled" || bad "test 9 first-ok"

# ======================= C) التفعيل =======================
: > "$T/ssh-calls"; : > "$FLOG"
"${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-enable-nightly.sh" <<< 'ENABLE' > "$L/kit-enable" 2>&1
check "kit enable (ENABLE) after verified first upload rc=0" 0 $? "$L/kit-enable" 'enable-ok'
grep -qE -- "^ssh .* -n .*offsite-setup.sh --enable-nightly $TS1\$" "$T/ssh-calls" && ok "enable: kit passed the first-upload TS reported by the server" || bad "enable ssh" "$(tr '\n' ';' < "$T/ssh-calls")"
[ "$(stat -c '%a %u' "$ETC/offsite.env")" = "600 $(id -u)" ] && [ ! -L "$ETC/offsite.env" ] &&
  [ "$(grep -c . "$ETC/offsite.env")" = 4 ] && grep -qx "AGE_RECIPIENT=$PUB" "$ETC/offsite.env" &&
  [ -z "$(find "$ETC" -name '.state-*')" ] && ok "enable: offsite.env regular file, 600, 4 strict keys, no temp left (atomic)" || bad "offsite.env after enable" "$(ls -la "$ETC")"
[ "$(writes)" = 0 ] && [ "$(nfiles)" = 3 ] && ok "enable itself uploaded nothing (read-only lsf check only)" || bad "enable writes" "$(tr '\n' ';' < "$FLOG")"
bash "$S/offsite-setup.sh" --enable-nightly "$TS1" > "$L/enable-again" 2>&1
check "enable is idempotent (already_enabled)" 0 $? "$L/enable-again" 'already_enabled'
bash "$S/offsite-backup.sh" --first > "$L/first-enabled" 2>&1
check "first upload refused once nightly is enabled" 1 $? "$L/first-enabled" 'nightly_already_enabled'
# ---- test 8: الآن فقط يرفعُ الليليّ
: > "$FLOG"; sleep 1; bash "$S/backup.sh" > "$L/backup-enabled" 2>&1
check "test 8: after explicit enable, backup.sh calls the upload" 0 $? "$L/backup-enabled" '^offsite-ok '
[ "$(ncalls copyto)" -ge 3 ] && [ "$(find "$DRIVE" -path '*/daily/*' -name '*.tar.age' | wc -l | tr -d ' ')" = 2 ] &&
  ok "test 8: nightly uploaded a second daily backup ($(ncalls copyto) copyto incl. tiers)" || bad "test 8 nightly" "$(ncalls copyto)"
# ---- test 9: بعدَ التفعيل
S4=$(state); rm -f "$ETC/.offsite.lock"
for i in 1 2; do env -i PATH="$PATH" WASLA_ETC="$ETC" WASLA_BIN="$S/bin" bash "$S/offsite-setup.sh" --status > "$L/restart-enabled-$i" 2>&1; done
[ "$(state)" = "$S4" ] && grep -qx 'stage=enabled' "$L/restart-enabled-2" && ok "test 9: restart sim after enable ⇒ still enabled, state files byte-identical" || bad "test 9 enabled"
# ---- إعادةُ الربطِ بعدَ التفعيل: لا تُعطِّلُ ولا تُفعِّلُ ولا ترفع
python3 "$SRC/tests/mock-oauth.py" 18181 ok "$L/mock2.log" & MOCK_PID=$!; sleep 1
export HTTPS_PROXY=http://127.0.0.1:1 NO_PROXY=127.0.0.1,localhost https_proxy=http://127.0.0.1:1 no_proxy=127.0.0.1,localhost
ENV_BEFORE=$(sha256sum < "$ETC/offsite.env"); : > "$FLOG"; NF=$(nfiles)
connect connect-relink-enabled RELINK 1-test.apps.googleusercontent.com "$CSEC"; rc=$?
check "relink while enabled rc=0" 0 $rc "$L/connect-relink-enabled" 'link-ok'
[ "$(sha256sum < "$ETC/offsite.env")" = "$ENV_BEFORE" ] && [ "$(writes)" = 0 ] && [ "$(nfiles)" = "$NF" ] && [ ! -e "$ETC/offsite-first-ok" ] &&
  ok "relink while enabled: offsite.env untouched, zero writes, first-ok invalidated" || bad "relink enabled side effects"
kill "$MOCK_PID"; wait "$MOCK_PID" 2>/dev/null; MOCK_PID=""; unset HTTPS_PROXY NO_PROXY https_proxy no_proxy
# ---- التعطيل
printf 'DISABLE\n' | "${LAPTOP_ENV[@]}" bash "$KIT/wasla-offsite-enable-nightly.sh" --disable > "$L/kit-disable" 2>&1
check "kit disable (DISABLE) rc=0" 0 $? "$L/kit-disable" 'disable-ok'
: > "$FLOG"; bash "$S/backup.sh" > "$L/backup-disabled" 2>&1
[ ! -e "$ETC/offsite.env" ] && [ ! -s "$FLOG" ] && ok "after disable: no offsite.env, nightly back to local-only" || bad "after disable"
bash "$S/offsite-setup.sh" --enable-nightly "$TS1" > "$L/enable-after-relink" 2>&1
check "after relink, enabling needs a new first upload" 1 $? "$L/enable-after-relink" 'no_first_upload'

# ======================= D) offsite.env مُدخَلٌ يدويّاً أو معبوث ⇒ رفضٌ دونَ تنفيذ =======================
LID=$(sed -n 's/^LINK_ID=//p' "$ETC/offsite-pending.env")
good="AGE_RECIPIENT=$PUB"$'\n'"RCLONE_REMOTE=wasla-gdrive"$'\n'"DRIVE_ROOT=WASLA-Backups"$'\n'"LINK_ID=$LID"
inject(){ # inject NAME CONTENT [MODE] [symlink]
  rm -f "$ETC/offsite.env" "$T/pwned"; if [ "${4:-}" = symlink ]; then printf '%s\n' "$2" > "$T/target.env"; chmod 600 "$T/target.env"; ln -s "$T/target.env" "$ETC/offsite.env"
  else printf '%s\n' "$2" > "$ETC/offsite.env"; chmod "${3:-600}" "$ETC/offsite.env"; fi
  : > "$FLOG"; bash "$S/offsite-backup.sh" --nightly "$TS1" > "$L/inject-$1" 2>&1; local rc=$?
  [ "$rc" = 1 ] && grep -q 'stage=config_rejected' "$L/inject-$1" && [ ! -e "$T/pwned" ] && [ ! -s "$FLOG" ] &&
    ok "malformed offsite.env ($1) ⇒ rejected, not executed, no rclone call" || bad "inject $1" "rc=$rc pwned=$([ -e "$T/pwned" ] && echo yes) $(tail -2 "$L/inject-$1")"; }
inject cmdsubst "$good"$'\n'"DRIVE_ROOT2=\$(touch $T/pwned)"
inject cmdsubst-value "AGE_RECIPIENT=$PUB"$'\n'"RCLONE_REMOTE=wasla-gdrive"$'\n'"DRIVE_ROOT=\$(touch $T/pwned)"
inject semicolon "AGE_RECIPIENT=$PUB; touch $T/pwned"$'\n'"RCLONE_REMOTE=wasla-gdrive"$'\n'"DRIVE_ROOT=WASLA-Backups"
inject unknown-key "$good"$'\n'"PATH=/tmp"
inject duplicate "$good"$'\n'"RCLONE_REMOTE=other"
inject bad-recipient "AGE_RECIPIENT=age1notakey"$'\n'"RCLONE_REMOTE=wasla-gdrive"$'\n'"DRIVE_ROOT=WASLA-Backups"
inject traversal "AGE_RECIPIENT=$PUB"$'\n'"RCLONE_REMOTE=wasla-gdrive"$'\n'"DRIVE_ROOT=../x"
inject mode644 "$good" 644
inject symlink "$good" 600 symlink
rm -f "$ETC/offsite.env"

# ======================= E) الأسرار =======================
rm -f "$T/sampling"; wait "$SAMPLER" 2>/dev/null; SAMPLER=""
if [ -s "$T/argv-hits" ]; then bad "test 11: no secret in any process argv/environ" "$(cut -c1-120 "$T/argv-hits" | head -3)"
else ok "test 11: no OAuth secret/token/age key in any process argv/environ during link/first/enable/nightly (sampled /proc every 50ms)"; fi
hits=$(grep -rlF -f "$T/markers" "$L" "$FLOG" "$T/ssh-calls" 2>/dev/null)
[ -z "$hits" ] && ok "test 11: no secret marker in any log, rclone call log or ssh call log" || bad "test 11 logs" "$hits"
hits=$(grep -rlE 'refresh_token|client_secret|access_token' "$L" "$FLOG" "$T/ssh-calls" 2>/dev/null)
[ -z "$hits" ] && ok "test 11: no token field names in logs" || bad "test 11 token names" "$hits"
hits=$(grep -rlF -f "$T/markers" "$LH/.wasla" "$LH/tmp dir" "$BACKUP_DIR" "$ETC" 2>/dev/null | grep -vxF -e "$LH/.wasla/wasla-backup.agekey" -e "$ETC/rclone.conf" | grep -v "^$ETC/rclone.conf.bak-")
grep -qF -f "$T/markers" "$LH/.wasla/wasla-backup.agekey" && grep -qF -f "$T/markers" "$ETC/rclone.conf" && [ -z "$hits" ] &&
  ok "test 11: secrets only in rclone.conf(+.bak) on the server and the age key file on the laptop" || bad "secret outside rclone.conf/agekey" "$hits"
for f in "$ETC"/*; do case "$(stat -c %a "$f")" in 600) ;; *) case "$f" in *.pub) ;; *) bad "server state mode" "$f $(stat -c %a "$f")";; esac;; esac; done
ok "server state files are 600 (except the public signing key)"

# ======================= F) فحصٌ ثابت: لا شيءَ يكتبُ offsite.env إلّا --enable-nightly =======================
# كلُّ سطرٍ يذكرُ OFFSITE_ENV مع عمليّةِ كتابة (>، write_state، mv، cp، install، tee، ln). المتوقَّعُ سطرٌ واحد.
w=$(grep -nE 'OFFSITE_ENV' "$SRC"/*.sh "$SRC"/laptop/*.sh | grep -E '(>|write_state|mv |cp |install |tee |ln ).*OFFSITE_ENV' | sed "s#^$SRC/##")
printf '%s\n' "$w" > "$L/static-writers"
[ "$(printf '%s\n' "$w" | grep -c .)" = 1 ] && printf '%s\n' "$w" | grep -q '^offsite-setup.sh:.*write_state "\$OFFSITE_ENV"' &&
  ok "static: exactly one writer of offsite.env — offsite-setup.sh --enable-nightly (write_state)" || bad "static writers of offsite.env" "$w"
say "# offsite stages test pass=$P fail=$F"
[ "$F" = 0 ]
