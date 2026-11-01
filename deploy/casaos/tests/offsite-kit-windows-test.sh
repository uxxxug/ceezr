#!/usr/bin/env bash
# الغرض: اختبارٌ فعليٌّ لحقيبةِ اللابتوب على Windows في Git Bash (ADR 0298 · 0299 · 0300)، كما يستعملُها المالك:
#   الحقيبةُ مفكوكةٌ من ZIP، ومجلّدُ المستخدمِ فيه مسافة، وage وrclone برامجُ Windows أصليّة، وssh وssh-keygen من Git.
#   الخادمُ مُحاكى: ssh بديلٌ يجيبُ كما يجيبُ الخادم (ويبتلعُ stdin كالحقيقيِّ دونَ -n)، وOAuth وهميّ (mock-oauth.py).
#   المراحلُ الثلاث (ADR 0300): الخادمُ البديلُ يحفظُ المرحلةَ في ملفّ (unlinked→linked→first-ok→enabled) كما يُبلِغُ عنها
#   offsite-setup.sh --status، ويرفضُ ما يرفضُه الحقيقيّ. منطقُ الخادمِ نفسُه مختبَرٌ في offsite-stages-test.sh على Linux.
#   لا Google ولا خادمَ حقيقيّ ولا cloudflared: هذه NOT TESTED هنا.
# ينتمي إلى: deploy/casaos/tests · يستدعيه .github/workflows/offsite-kit-windows.yml
# الاستعمال (Git Bash): bash offsite-kit-windows-test.sh KIT_DIR FIXTURES_DIR MOCK_OAUTH_PY
set -uo pipefail
KIT=$1; FX=$2; MOCK=$3; P=0; F=0
ok(){ P=$((P+1)); echo "PASS  $1"; }; bad(){ F=$((F+1)); echo "FAIL  $1 -- ${2:-}"; }
REAL_SSH=$(command -v ssh); REAL_KEYGEN=$(command -v ssh-keygen)
echo "# windows kit test $(date -u +%FT%TZ) $(uname -s) $(uname -r)"
echo "# bash=$BASH_VERSION ssh=$REAL_SSH ($("$REAL_SSH" -V 2>&1)) keygen=$REAL_KEYGEN age=$(age --version) rclone=$(rclone version | head -1)"
echo "# HOME=$HOME"
case "$HOME" in *' '*) ok "HOME contains a space (like C:/Users/Ahmed Ali)";; *) bad "HOME without space" "$HOME";; esac
OUT=$HOME/test-out; mkdir -p "$OUT" "$HOME/.wasla"

# 1) الحقيبةُ كما فُكَّت من ZIP
cd "$KIT" || exit 1
sha256sum -c SHA256SUMS > "$OUT/sums.txt" 2>&1 && ok "kit: sha256sum -c SHA256SUMS ($(grep -c ': OK' "$OUT/sums.txt") OK)" || bad "kit sums" "$(cat "$OUT/sums.txt")"
grep -l $'\r' ./* >/dev/null 2>&1 && bad "kit: CRLF after extraction" || ok "kit: no CRLF after PowerShell Expand-Archive"
for f in *.sh; do bash -n "$f" || bad "bash -n $f"; done; ok "kit: bash -n on all scripts"

# 2) البصمة: ssh-keygen من Git، ثمّ ssh-keygen الأصليُّ في Windows إن وُجد
( . ./wasla-laptop-lib.sh && host_kit_ok ) && ok "host_kit_ok with Git ssh-keygen" || bad "host_kit_ok (Git)"
NATIVE=/c/Windows/System32/OpenSSH
if [ -x "$NATIVE/ssh-keygen.exe" ]; then
  ( PATH=$NATIVE:$PATH; . ./wasla-laptop-lib.sh && host_kit_ok ) && ok "host_kit_ok with native Windows ssh-keygen ($("$NATIVE/ssh.exe" -V 2>&1))" || bad "host_kit_ok (native Windows ssh-keygen)"
else echo "INFO  native Windows OpenSSH not present"; fi

# ssh بديل: يجيبُ كالخادم. دونَ -n يقرأُ stdin كلَّه أوّلاً (كالحقيقيّ).
FAKE=$HOME/fakebin; mkdir -p "$FAKE"; export FX OUT
cat > "$FAKE/ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "ssh $*" >> "$OUT/ssh-calls"
n=0; while [ $# -gt 0 ]; do case "$1" in -n) n=1; shift;; -o) printf '%s\n' "$2" >> "$OUT/ssh-opts"; shift 2;; -*) shift;; *) break;; esac; done
shift; cmd="$*"; IN=$OUT/ssh-stdin; if [ $n = 1 ]; then : > "$IN"; else cat > "$IN"; fi
case "$cmd" in
  true) exit 0;;
  *"offsite-setup.sh --signing-key") cat "$FX/signer.pub";;
  *"offsite-setup.sh --status")
    [ -n "${FAKE_OLD_SERVER:-}" ] && { echo "الاستعمال: offsite-setup.sh --signing-key | --install age1…"; exit 2; }
    st=$(cat "$OUT/stage" 2>/dev/null || echo unlinked); ft=none; [ "$st" = first-ok ] || [ "$st" = enabled ] && ft=$(cat "$FX/ts")
    printf 'stage=%s\r\nlinked=%s\r\nfirst_upload=%s\r\nnightly=%s\r\n' "$st" "$([ "$st" = unlinked ] && echo no || echo yes)" "$ft" "$([ "$st" = enabled ] && echo on || echo off)";;
  *"offsite-setup.sh --link age1"*) cp "$IN" "$OUT/received.conf"; [ "$(cat "$OUT/stage" 2>/dev/null)" = enabled ] || echo linked > "$OUT/stage"
    echo "link-ok (fake server) uploads=0";;
  *"offsite-backup.sh --first")
    case "$(cat "$OUT/stage" 2>/dev/null)" in linked|first-ok) echo first-ok > "$OUT/stage"; echo "first-ok ts=$(cat "$FX/ts") files=3 nightly=off";;
      *) echo "first-FAIL"; exit 1;; esac;;
  *"offsite-setup.sh --enable-nightly "*)
    [ "$(cat "$OUT/stage" 2>/dev/null)" = first-ok ] && [ "${cmd##* }" = "$(cat "$FX/ts")" ] || { echo "enable-FAIL"; exit 1; }
    echo enabled > "$OUT/stage"; echo "enable-ok (fake server)";;
  *"offsite-setup.sh --disable-nightly") echo first-ok > "$OUT/stage"; echo "disable-ok";;
  *"offsite-fetch.sh latest") cat "$FX/latest";;
  *"offsite-fetch.sh get "*) cat "$FX/drive/${cmd##* }";;
  *"offsite-restore-drill.sh --manifest-b64 "*)
    MB=${cmd#*--manifest-b64 }; MB=${MB%% *}; [ "$(printf '%s' "$MB" | base64 -d)" = "$(cat "$FX/drive/daily/"*.manifest)" ] || { echo "drill-FAIL manifest"; exit 1; }
    [ "$(sha256sum "$IN" | cut -d' ' -f1)" = "$(cat "$FX/plain.sha256")" ] && { echo "offsite-drill-PASS (fake server: decrypted bytes intact over the pipe)"; exit 0; }
    echo "drill-FAIL bytes"; exit 1;;
  *) echo "fake ssh: unknown $cmd" >&2; exit 9;;
esac
EOF
chmod 755 "$FAKE/ssh"; export PATH=$FAKE:$PATH
cp "$FX/agekey" "$HOME/.wasla/wasla-backup.agekey"
FP=$(. ./wasla-laptop-lib.sh; echo "$WASLA_HOST_FP")

# 4) لاحقةٌ خاطئة
: > "$OUT/ssh-calls"; printf 'AAAAAAAA\n' | bash ./wasla-offsite-connect.sh > "$OUT/connect-bad.txt" 2>&1; rc=$?
[ $rc = 1 ] && [ ! -s "$OUT/ssh-calls" ] && [ ! -e "$HOME/.wasla/known_hosts" ] && [ ! -e "$HOME/.wasla/allowed_signers" ] &&
  ok "connect: wrong suffix ⇒ stop, no ssh call, nothing pinned" || bad "connect wrong suffix" "rc=$rc $(tail -2 "$OUT/connect-bad.txt")"

# 5) ربطٌ كامل (المرحلة أ): لاحقةٌ صحيحة ⇒ مفتاحُ التوقيع ⇒ --status ⇒ OAuth (وهميّ) عبرَ rclone الأصليّ ⇒ --link عبرَ stdin
PY=$(command -v python || command -v python3); ML=$OUT/mock.log; : > "$ML"
MLW=$ML; command -v cygpath >/dev/null && MLW=$(cygpath -w "$ML")
"$PY" "$MOCK" 18080 ok "$MLW" & MOCK_PID=$!; sleep 2
export TMPDIR=$HOME/ltmp; mkdir -p "$TMPDIR"; : > "$OUT/ssh-calls"; : > "$OUT/ssh-opts"
CSEC=MOCK-SECRET-$RANDOM$RANDOM
printf '%s\n1-test.apps.googleusercontent.com\n%s\n' "${FP: -8}" "$CSEC" > "$OUT/in.txt"
WASLA_TEST_OAUTH_BASE=http://127.0.0.1:18080 bash ./wasla-offsite-connect.sh < "$OUT/in.txt" > "$OUT/connect.txt" 2>&1 & CON=$!
U=; for _ in $(seq 120); do U=$(grep -o 'http://127.0.0.1:53682/auth?state=[A-Za-z0-9_-]*' "$OUT/connect.txt" | head -1); [ -n "$U" ] && break; sleep 0.5; done
[ -n "$U" ] && curl -s --noproxy '*' -L -o /dev/null "$U"
wait "$CON"; rc=$?; rm -f "$OUT/in.txt"
[ $rc = 0 ] && grep -q 'link-ok (fake server)' "$OUT/connect.txt" && ok "connect: full run rc=0 (host pin → signer → status → native rclone OAuth → --link via stdin)" || bad "connect full" "rc=$rc url=${U:+yes} $(tail -4 "$OUT/connect.txt")"
grep -q -- '--link age1' "$OUT/ssh-calls" && ! grep -qE 'offsite-backup|--enable-nightly|--install' "$OUT/ssh-calls" && [ "$(cat "$OUT/stage")" = linked ] &&
  ok "stage A: connect only linked (no upload call, no enable call, no --install)" || bad "stage A calls" "$(tr '\n' ';' < "$OUT/ssh-calls")"
grep -q 'لم يُرفَعْ أيُّ ملفّ' "$OUT/connect.txt" && ok "stage A: owner told nothing was uploaded and nightly is off" || bad "stage A message"
[ "$(cat "$HOME/.wasla/known_hosts" 2>/dev/null)" = "$(. ./wasla-laptop-lib.sh; echo "$WASLA_HOST_ALIAS $WASLA_HOST_PUB")" ] && ok "known_hosts pinned under spaced HOME" || bad "known_hosts"
grep -qF "$(cat "$FX/signer.pub")" "$HOME/.wasla/allowed_signers" 2>/dev/null && ok "allowed_signers = server signing key" || bad "allowed_signers"
grep -q 'grant=authorization_code' "$ML" && ok "rclone (native Windows) exchanged the code with the token endpoint" || bad "code exchange" "$(cat "$ML")"
R=$OUT/received.conf
grep -q '^client_id = 1-test.apps.googleusercontent.com$' "$R" 2>/dev/null && grep -q '^scope = drive.file$' "$R" && grep -q '^token = .*MOCK-REFRESH' "$R" &&
  ok "server received rclone section via stdin (client_id, drive.file, refresh token)" || bad "received.conf" "$(sed 's/client_secret = .*/client_secret = <redacted>/' "$R" 2>&1 | head -5)"
[ -z "$(find "$TMPDIR" -mindepth 1 2>/dev/null)" ] && ok "laptop temp rclone config removed" || bad "temp left" "$(find "$TMPDIR" -mindepth 1)"
grep -E '^ssh .*(true|--signing-key)$' "$OUT/ssh-calls" | grep -vq -- ' -n ' && bad "a no-input ssh call lacks -n" "$(cat "$OUT/ssh-calls")" || ok "no-input ssh calls use -n"
grep -qxF "UserKnownHostsFile=\"$HOME/.wasla/known_hosts\"" "$OUT/ssh-opts" && ok "ssh got the spaced known_hosts path quoted (ssh splits unquoted values at spaces)" || bad "ssh opts" "$(grep -i known "$OUT/ssh-opts" | head -2)"
grep -rqF "$CSEC" "$OUT"/connect*.txt "$HOME/.wasla" 2>/dev/null && bad "client secret leaked to logs/.wasla" || ok "client secret not in logs or ~/.wasla"
kill "$MOCK_PID" 2>/dev/null

# 5ب) المراحلُ ب وج من الحقيبة (مجلّدٌ فيه مسافة، ومدخلاتٌ قد تنتهي بـCRLF)
: > "$OUT/ssh-calls"; bash ./wasla-offsite-enable-nightly.sh < /dev/null > "$OUT/enable-early.txt" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'لا يمكنُ التفعيل' "$OUT/enable-early.txt" && ! grep -q -- '--enable-nightly' "$OUT/ssh-calls" &&
  ok "stage C refused before first upload (no enable call)" || bad "enable early" "rc=$rc $(tail -2 "$OUT/enable-early.txt")"
: > "$OUT/ssh-calls"; printf 'upload\n' | bash ./wasla-offsite-first-upload.sh > "$OUT/first-cancel.txt" 2>&1; rc=$?
[ $rc = 1 ] && ! grep -q 'offsite-backup' "$OUT/ssh-calls" && [ "$(cat "$OUT/stage")" = linked ] &&
  ok "stage B: wrong confirmation word ⇒ cancelled, no upload call" || bad "first cancel" "rc=$rc"
: > "$OUT/ssh-calls"; printf 'UPLOAD\r\n' | bash ./wasla-offsite-first-upload.sh > "$OUT/first.txt" 2>&1; rc=$?
[ $rc = 0 ] && grep -q 'first-ok' "$OUT/first.txt" && [ "$(grep -c 'offsite-backup.sh --first' "$OUT/ssh-calls")" = 1 ] &&
  grep -E 'offsite-backup.sh --first$' "$OUT/ssh-calls" | grep -q -- ' -n ' && ! grep -q -- '--enable-nightly' "$OUT/ssh-calls" && [ "$(cat "$OUT/stage")" = first-ok ] &&
  ok "stage B: UPLOAD (CRLF) ⇒ exactly one --first call (ssh -n), nightly not enabled" || bad "first" "rc=$rc $(tail -2 "$OUT/first.txt")"
: > "$OUT/ssh-calls"; printf 'ENABLE\r\n' | bash ./wasla-offsite-enable-nightly.sh > "$OUT/enable.txt" 2>&1; rc=$?
[ $rc = 0 ] && grep -q 'enable-ok' "$OUT/enable.txt" && grep -qE -- "--enable-nightly $(cat "$FX/ts")\$" "$OUT/ssh-calls" && [ "$(cat "$OUT/stage")" = enabled ] &&
  ok "stage C: ENABLE ⇒ --enable-nightly with the server-reported TS (CR stripped)" || bad "enable" "rc=$rc $(tail -2 "$OUT/enable.txt") $(tr '\n' ';' < "$OUT/ssh-calls")"
: > "$OUT/ssh-calls"; printf 'UPLOAD\n' | bash ./wasla-offsite-first-upload.sh > "$OUT/first-enabled.txt" 2>&1; rc=$?
[ $rc = 1 ] && ! grep -q 'offsite-backup' "$OUT/ssh-calls" && ok "stage B refused once enabled" || bad "first when enabled" "rc=$rc"
: > "$OUT/ssh-calls"; printf 'no\n' | bash ./wasla-offsite-connect.sh > "$OUT/relink-cancel.txt" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'أُلغي' "$OUT/relink-cancel.txt" && ! grep -q -- '--link' "$OUT/ssh-calls" && ! grep -q 'Client ID' "$OUT/relink-cancel.txt" &&
  ok "relink without RELINK ⇒ cancelled before OAuth, no --link" || bad "relink cancel" "rc=$rc $(tail -2 "$OUT/relink-cancel.txt")"
printf 'DISABLE\n' | bash ./wasla-offsite-enable-nightly.sh --disable > "$OUT/disable.txt" 2>&1; rc=$?
[ $rc = 0 ] && grep -q 'disable-ok' "$OUT/disable.txt" && ok "disable (DISABLE) ⇒ --disable-nightly" || bad "disable" "rc=$rc"
: > "$OUT/ssh-calls"; FAKE_OLD_SERVER=1 bash ./wasla-offsite-connect.sh < /dev/null > "$OUT/old-server.txt" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'ADR 0300' "$OUT/old-server.txt" && ! grep -qE -- '--link|--install' "$OUT/ssh-calls" && ! grep -q 'Client ID' "$OUT/old-server.txt" &&
  ok "old server (no --status) ⇒ connect stops before OAuth, nothing sent" || bad "old server" "rc=$rc $(tail -2 "$OUT/old-server.txt")"
export FAKE_OLD_SERVER=; echo enabled > "$OUT/stage"

# 6) اختبارُ الاستعادة: تحقّقُ التوقيعِ وsha256 وفكُّ age الأصليّ، والأنبوبُ الثنائيّ إلى «الخادم»
export WASLA_LOG_DIR=$OUT; bash ./wasla-offsite-restore-test.sh > "$OUT/rt.txt" 2>&1; rc=$?
[ $rc = 0 ] && grep -q 'provenance-ok' "$OUT/rt.txt" && grep -q 'decrypt-ok' "$OUT/rt.txt" && grep -q 'offsite-drill-PASS' "$OUT/rt.txt" && grep -q 'النتيجة: PASS' "$OUT/rt.txt" &&
  ok "restore-test: signature (Linux-signed) verified, sha256, native age -d, binary pipe intact ⇒ PASS" || bad "restore-test" "rc=$rc $(tail -4 "$OUT/rt.txt")"
# نصٌّ مشفّرٌ معدَّل ⇒ رفض
cp -r "$FX" "$HOME/fx-bad"; f=$(ls "$HOME/fx-bad/drive/daily/"*.tar.age); printf 'X' | dd of="$f" bs=1 seek=100 conv=notrunc 2>/dev/null
FX=$HOME/fx-bad bash ./wasla-offsite-restore-test.sh > "$OUT/rt-bad.txt" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'sha256 لا يطابقُ الموقَّع' "$OUT/rt-bad.txt" && ok "restore-test: tampered ciphertext ⇒ FAIL before decrypt" || bad "tampered" "rc=$rc $(tail -2 "$OUT/rt-bad.txt")"
# known_hosts معدَّل ⇒ رفضٌ دونَ اتصال
cp "$HOME/.wasla/known_hosts" "$OUT/kh.bak"; echo "wasla-casaos ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBadKeyBadKeyBadKeyBadKeyBadKeyBadKeyBadKeyBa" > "$HOME/.wasla/known_hosts"
: > "$OUT/ssh-calls"; bash ./wasla-offsite-restore-test.sh > "$OUT/rt-kh.txt" 2>&1; rc=$?
[ $rc = 1 ] && [ ! -s "$OUT/ssh-calls" ] && ok "restore-test: edited known_hosts ⇒ refuse, no ssh" || bad "edited known_hosts" "rc=$rc"
cp "$OUT/kh.bak" "$HOME/.wasla/known_hosts"
grep -rl 'AGE-SECRET-KEY' "$OUT" >/dev/null 2>&1 && bad "age secret in logs" || ok "no age secret in logs"
echo "# windows kit test pass=$P fail=$F"; [ "$F" = 0 ]
