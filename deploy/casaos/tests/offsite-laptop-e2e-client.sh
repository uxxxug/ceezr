#!/usr/bin/env bash
# الغرض: طرفُ اللابتوبِ لاختبارٍ حقيقيٍّ عبرَ SSH حقيقيّ (ADR 0298 · ADR 0299)، مقابلَ البيئةِ الاصطناعيّةِ التي
#   يجهّزُها offsite-laptop-e2e-server.sh على الخادم. لا بياناتِ إنتاج، ولا Drive حقيقيّ.
# الاستعمال: bash offsite-laptop-e2e-client.sh UP_FILE WORKDIR AGE_KEY
#   AGE_KEY: مفتاحُ age الاختباريُّ الذي أُعطيَ مفتاحُه العامُّ لـ«up» (يُنسَخُ إلى لابتوبِ الحالةِ الصحيحة).
#   UP_FILE: مخرجاتُ «… e2e-server.sh up» (سطرا WASLA_REMOTE_PREFIX وSIGPUB). يحتاجُ مُضيفَ `wasla` في ~/.ssh/config.
# الحالات: مفتاحُ الخادم (إدخالٌ خاطئ، صحيح، حقيبةٌ معدَّلة، مفتاحُ خادمٍ منتحَل، known_hosts معدَّل)، ثمّ اختبارُ
#   الاستعادة، ثمّ خطواتُ «الاستعادةُ الحقيقيّة» أ وب-1 من OFFSITE-BACKUP.md حرفيّاً.
set -uo pipefail; umask 077
UP=$1; W=$2; AK=$3; H=$(cd "$(dirname "$0")/.." && pwd); LAP=$H/laptop
rm -rf "$W"; mkdir -p "$W"; P=0; F=0
ok(){ P=$((P+1)); echo "PASS  $1"; }; bad(){ F=$((F+1)); echo "FAIL  $1 -- ${2:-}"; }
export WASLA_REMOTE_PREFIX; WASLA_REMOTE_PREFIX=$(sed -n 's/^WASLA_REMOTE_PREFIX=//p' "$UP"); SIGPUB=$(sed -n 's/^SIGPUB=//p' "$UP")
FP=$(. "$LAP/wasla-laptop-lib.sh"; echo "$WASLA_HOST_FP")
# كلُّ حالةٍ في «لابتوبٍ» مستقلّ: ملفّاتُ ~/.wasla عبرَ متغيّراتِ السكربتات (ssh نفسُه يقرأُ ~/.ssh/config الحقيقيّ).
lap(){ local d=$W/$1; mkdir -p "$d"; export WASLA_AGE_KEY=$d/agekey WASLA_ALLOWED_SIGNERS=$d/allowed_signers \
  WASLA_KNOWN_HOSTS=$d/known_hosts WASLA_LOG_DIR=$d TMPDIR=$d/tmp; mkdir -p "$d/tmp"; }
echo "# e2e client $(date -u +%FT%TZ) $(ssh -V 2>&1 | cut -d, -f1) age=$(age --version) host_fp=$FP"

# 1) إدخالٌ خاطئٌ لآخرِ 8 أحرف
lap wrong; printf 'AAAAAAAA\n' | bash "$LAP/wasla-offsite-connect.sh" > "$W/wrong.log" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'لا تطابق' "$W/wrong.log" && [ ! -e "$WASLA_KNOWN_HOSTS" ] && [ ! -e "$WASLA_ALLOWED_SIGNERS" ] && [ ! -e "$WASLA_AGE_KEY" ] &&
  ok "wrong fingerprint suffix ⇒ stop; no known_hosts, no allowed_signers, no age key" || bad "wrong suffix" "rc=$rc $(tail -2 "$W/wrong.log")"
grep -qF "$FP" "$W/wrong.log" && bad "expected fingerprint leaked before input" || ok "expected fingerprint not shown before/after wrong input"

# 2) إدخالٌ صحيح ⇒ تثبيتٌ ثمّ اتصالٌ ثمّ مفتاحُ التوقيع؛ نتوقّفُ عندَ Client ID غيرِ صالحٍ (لا OAuth، لا Drive).
lap good; cp "$AK" "$WASLA_AGE_KEY"; chmod 600 "$WASLA_AGE_KEY"
printf '%s\nnot-a-client-id\n' "${FP: -8}" | bash "$LAP/wasla-offsite-connect.sh" > "$W/good.log" 2>&1; rc=$?
[ $rc = 2 ] && grep -q 'تطابق. ثُبِّتَ مفتاحُ الخادم' "$W/good.log" && [ "$(stat -c %a "$WASLA_KNOWN_HOSTS")" = 600 ] &&
  [ "$(cut -d' ' -f1 "$WASLA_KNOWN_HOSTS")" = wasla-casaos ] && ok "correct suffix ⇒ host key pinned (600), real SSH connects with StrictHostKeyChecking=yes" || bad "correct suffix" "rc=$rc $(tail -3 "$W/good.log")"
grep -qF "$SIGPUB" "$WASLA_ALLOWED_SIGNERS" 2>/dev/null && ok "backup signing key pinned only after host key, equals server's" || bad "signer pin" "$(cat "$WASLA_ALLOWED_SIGNERS" 2>&1)"
awk '/ثُبِّتَ مفتاحُ الخادم/{h=NR} /ثُبِّتَ مفتاحُ توقيعِ الخادم/{s=NR} END{exit !(h && s && h<s)}' "$W/good.log" && ok "order: host key pinned before signing key" || bad "order"
GOOD=$W/good
printf '%s\nnot-a-client-id\n' "${FP: -8}" | bash "$LAP/wasla-offsite-connect.sh" > "$W/good2.log" 2>&1
grep -q 'مثبَّتٌ سابقاً' "$W/good2.log" && ok "second run: already pinned, no prompt needed" || bad "second run" "$(head -3 "$W/good2.log")"

# 3) اختبارُ الاستعادة بالمفتاحِ المثبَّت
lap good; bash "$LAP/wasla-offsite-restore-test.sh" > "$W/rt.log" 2>&1; rc=$?
[ $rc = 0 ] && grep -q 'النتيجة: PASS' "$W/rt.log" && ok "restore-test over pinned real SSH ⇒ PASS" || bad "restore-test" "rc=$rc $(tail -2 "$W/rt.log")"

# 4) حقيبةٌ معدَّلةٌ جزئيّاً: مفتاحٌ لا يطابقُ بصمتَه ⇒ توقّفٌ قبلَ السؤال
K=$W/kit-partial; mkdir -p "$K"; cp "$LAP"/*.sh "$K/"; ssh-keygen -q -t ed25519 -N '' -f "$W/fake" >/dev/null
FAKEPUB=$(cut -d' ' -f1,2 "$W/fake.pub"); FAKEFP=$(ssh-keygen -lf "$W/fake.pub" | cut -d' ' -f2)
sed -i "s#^WASLA_HOST_PUB=.*#WASLA_HOST_PUB='$FAKEPUB'#" "$K/wasla-laptop-lib.sh"
lap partial; printf '%s\n' "${FP: -8}" | bash "$K/wasla-offsite-connect.sh" > "$W/partial.log" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'الحقيبةُ تالفةٌ أو معدَّلة' "$W/partial.log" && ! grep -q 'آخرُ 8 أحرف' "$W/partial.log" && [ ! -e "$WASLA_KNOWN_HOSTS" ] &&
  ok "partially tampered kit ⇒ stop before prompt" || bad "partial kit" "rc=$rc $(tail -2 "$W/partial.log")"

# 5) انتحال: حقيبةٌ بمرجعٍ آخرَ متّسق (أو خادمٌ آخر). حتّى لو طابقَ الإدخالُ ذلك المرجع، الخادمُ الحقيقيُّ يُرفَض.
sed -i "s#^WASLA_HOST_FP=.*#WASLA_HOST_FP='$FAKEFP'#" "$K/wasla-laptop-lib.sh"
lap spoof; printf '%s\n' "${FAKEFP: -8}" | bash "$K/wasla-offsite-connect.sh" > "$W/spoof.log" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'Host key verification failed' "$W/spoof.log" && [ ! -e "$WASLA_ALLOWED_SIGNERS" ] &&
  ok "host key ≠ pinned reference ⇒ real ssh refuses (Host key verification failed), no signing key pinned" || bad "spoof" "rc=$rc $(tail -3 "$W/spoof.log")"

# 6) known_hosts معدَّلٌ يدويّاً ⇒ اختبارُ الاستعادةِ يرفضُ دونَ اتصال
lap tamperkh; printf 'wasla-casaos %s\n' "$FAKEPUB" > "$WASLA_KNOWN_HOSTS"; cp "$GOOD/agekey" "$GOOD/allowed_signers" "$W/tamperkh/" 2>/dev/null
bash "$LAP/wasla-offsite-restore-test.sh" --list > "$W/tamperkh.log" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'لا يطابقُ مفتاحَ الخادمِ' "$W/tamperkh.log" && ok "edited known_hosts ⇒ restore-test refuses" || bad "tampered known_hosts" "rc=$rc $(tail -2 "$W/tamperkh.log")"
lap nokh; bash "$LAP/wasla-offsite-restore-test.sh" --list > "$W/nokh.log" 2>&1; rc=$?
[ $rc = 1 ] && grep -q 'غيرُ مثبَّت' "$W/nokh.log" && ok "no known_hosts ⇒ restore-test refuses" || bad "no known_hosts" "rc=$rc"

# 7) «الاستعادةُ الحقيقيّة» أ وب-1 حرفيّاً (التنزيلُ بالمتصفّحِ مستبدَلٌ بـoffsite-fetch.sh: البايتاتُ نفسُها).
lap good; . "$LAP/wasla-laptop-lib.sh"; R=$W/dr; mkdir -p "$R"; cd "$R" || exit 1
NAME=$("${SSH[@]}" -n wasla "$WASLA_REMOTE_PREFIX/offsite-fetch.sh latest" | tr -d '\r'); B=${NAME%.tar.age}; TS=${B##*wasla-}
for x in tar.age manifest manifest.sig; do "${SSH[@]}" -n wasla "$WASLA_REMOTE_PREFIX/offsite-fetch.sh get $B.$x" > "wasla-$TS.$x" 2>/dev/null; done
ssh-keygen -Y verify -f "$GOOD/allowed_signers" -I wasla-backup -n wasla-offsite-backup -s "wasla-$TS.manifest.sig" < "wasla-$TS.manifest" > v.out 2>&1
grep -q 'Good "wasla-offsite-backup" signature' v.out && ok "DR A2: signature verify prints Good signature" || bad "DR A2" "$(cat v.out)"
[ "$(sha256sum "wasla-$TS.tar.age" | cut -d' ' -f1)" = "$(sed -n 's/^ciphertext_sha256=//p' "wasla-$TS.manifest")" ] && ok "DR A3: ciphertext sha256 = manifest" || bad "DR A3"
age -d -i "$GOOD/agekey" -o wasla.tar "wasla-$TS.tar.age" && ok "DR A4: age -d" || bad "DR A4"
mkdir restore; tar -tvf wasla.tar > list.txt; ! awk '{print $NF}' list.txt | grep -qE '^/|\.\.|/' && ! grep -q '^[lh]' list.txt && ok "DR B1: tar -tvf flat names, no links ($(wc -l < list.txt) members)" || bad "DR B1 list" "$(head -3 list.txt)"
(cd restore && tar -xf ../wasla.tar && sha256sum -c --strict MANIFEST.sha256 > ../c.out 2>&1) && ok "DR B1: sha256sum -c --strict ($(grep -c ': OK' c.out) OK)" || bad "DR B1 check" "$(tail -2 c.out)"
[ "$(sha256sum restore/MANIFEST.sha256 | cut -d' ' -f1)" = "$(sed -n 's/^inner_manifest_sha256=//p' "wasla-$TS.manifest")" ] && ok "DR B1: MANIFEST sha256 = inner_manifest_sha256" || bad "DR B1 inner"
tar -tzf restore/config-*.tgz > cfg.txt && ok "DR B2: config tgz lists $(wc -l < cfg.txt) files" || bad "DR B2"
cd "$W" && rm -rf "$R"
grep -l 'AGE-SECRET-KEY' "$W"/*.log "$W"/*/*.log 2>/dev/null | grep -q . && bad "secret in logs" || ok "no age secret in any log"
echo "# e2e client pass=$P fail=$F"; [ "$F" = 0 ]
