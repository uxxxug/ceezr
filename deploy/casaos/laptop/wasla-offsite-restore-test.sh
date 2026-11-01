#!/usr/bin/env bash
# الغرض: اختبارُ استعادةٍ فعليٌّ من Google Drive (ADR 0297 · ADR 0298) يُشغَّلُ على لابتوبِ المالك.
# الاستعمال: wasla-offsite-restore-test.sh                     ⇒ أحدثُ نسخةٍ يوميّة
#            wasla-offsite-restore-test.sh --list              ⇒ قائمةُ النسخ
#            wasla-offsite-restore-test.sh weekly/wasla-<TS>.tar.age
# الترتيب — لا يصلُ إلى الخادمِ شيءٌ مفكوكٌ قبلَ نجاحِ كلِّ ما قبلَه:
#   1) يُنزِّلُ البيانَ وتوقيعَه، ويتحقّقُ من التوقيعِ بمفتاحِ الخادمِ المثبَّتِ في ~/.wasla/allowed_signers،
#      ومن الاسمِ والصيغة، وأنّ المستلمَ هو مفتاحُك.
#   2) يُنزِّلُ النصَّ المشفّرَ كاملاً إلى ملفٍّ مؤقّتٍ (700)، ويطابقُ حجمَه وsha256 بالموقَّع، وترويسةَ age.
#   3) فكٌّ كاملٌ تجريبيٌّ إلى /dev/null (مفتاحٌ خاطئٌ أو عبثٌ ⇒ يتوقّفُ هنا).
#   4) يفكُّ ثانيةً **في الأنبوب** إلى تمرينِ الاستعادةِ على الخادم (لا نصَّ مفكوكاً على قرصِ اللابتوب)، والخادمُ
#      يتحقّقُ من التوقيعِ ثانيةً ويفحصُ الأرشيفَ قبلَ أيِّ استعادة.
# النتيجة: PASS أو FAIL أو INCONCLUSIVE، والسجلُّ wasla-restore-test-*.log بلا أسرار.
set -euo pipefail; umask 077
KEY=${WASLA_AGE_KEY:-$HOME/.wasla/wasla-backup.agekey}; HOST=${WASLA_SSH_HOST:-wasla}
ALLOWED=${WASLA_ALLOWED_SIGNERS:-$HOME/.wasla/allowed_signers}; RP=${WASLA_REMOTE_PREFIX:-sudo /opt/wasla}
NAME_RE='^(daily|weekly|monthly)/wasla-[0-9]{8}T[0-9]{6}Z\.tar\.age$'
LOG=${WASLA_LOG_DIR:-.}/wasla-restore-test-$(date -u +%Y%m%dT%H%M%SZ).log
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
stop(){ say "النتيجة: FAIL — $1 (لم يُستعَدْ شيء)"; exit 1; }
sha(){ if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
for c in age age-keygen ssh ssh-keygen base64; do command -v "$c" >/dev/null || { echo "ينقصُ الأمر: $c"; exit 1; }; done
# shellcheck source=wasla-laptop-lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wasla-laptop-lib.sh"
host_require || exit 1   # ADR 0299: لا اتصالَ إلّا بمفتاحِ الخادمِ المثبَّت
[ -f "$KEY" ] || { echo "المفتاحُ غيرُ موجود: $KEY"; exit 1; }
[ -s "$ALLOWED" ] || { echo "مفتاحُ توقيعِ الخادمِ غيرُ مثبَّت: $ALLOWED (شغّلْ wasla-offsite-connect.sh)"; exit 1; }
if [ "${1:-}" = --list ]; then "${SSH[@]}" -n "$HOST" "$RP/offsite-fetch.sh --list"; exit 0; fi
NAME=${1:-$("${SSH[@]}" -n "$HOST" "$RP/offsite-fetch.sh latest" | tr -d '\r')}
[[ "$NAME" =~ $NAME_RE ]] || { echo "اسمٌ غيرُ صالح"; exit 2; }
BASE=${NAME%.tar.age}; FILE=${NAME##*/}
T=$(mktemp -d "${TMPDIR:-/tmp}/wasla-restore-XXXXXX"); chmod 700 "$T"; trap 'rm -rf "$T"' EXIT
say "اختبارُ استعادة: $NAME"

# 1) المصدر
"${SSH[@]}" -n "$HOST" "$RP/offsite-fetch.sh get $BASE.manifest" > "$T/m" || stop "تعذّرَ تنزيلُ البيان"
"${SSH[@]}" -n "$HOST" "$RP/offsite-fetch.sh get $BASE.manifest.sig" > "$T/m.sig" || stop "تعذّرَ تنزيلُ التوقيع"
ssh-keygen -Y verify -f "$ALLOWED" -I wasla-backup -n wasla-offsite-backup -s "$T/m.sig" < "$T/m" >/dev/null 2>&1 ||
  stop "التوقيعُ غيرُ صالح: البيانُ ليس من خادمِك أو عُدِّل"
get(){ v=$(grep -E "^$1=" "$T/m" | head -1); v=${v#*=}; printf '%s' "${v%$'\r'}"; }
[ "$(get format)" = wasla-offsite-v1 ] || stop "صيغةُ البيانِ غيرُ معروفة"
[ "$(get name)" = "$FILE" ] || stop "البيانُ لنسخةٍ أخرى (استبدال)"
[ "$(get age_recipient)" = "$(age-keygen -y "$KEY")" ] || stop "النسخةُ مشفّرةٌ لمفتاحٍ غيرِ مفتاحِك"
say "provenance-ok (توقيعُ الخادمِ صالح)"

# 2) النصُّ المشفّر
"${SSH[@]}" -n "$HOST" "$RP/offsite-fetch.sh get $NAME" > "$T/c" || stop "تعذّرَ تنزيلُ النسخة"
[ "$(wc -c < "$T/c" | tr -d ' ')" = "$(get ciphertext_bytes)" ] || stop "الحجمُ لا يطابقُ الموقَّع (تنزيلٌ ناقصٌ أو عبث)"
[ "$(sha "$T/c")" = "$(get ciphertext_sha256)" ] || stop "sha256 لا يطابقُ الموقَّع"
[ "$(head -c 21 "$T/c")" = "age-encryption.org/v1" ] || stop "ليس ملفَّ age"
say "ciphertext-ok bytes=$(get ciphertext_bytes) sha256=match"

# 3) فكٌّ تجريبيّ
age -d -i "$KEY" "$T/c" > /dev/null 2>"$T/age.err" || stop "تعذّرَ الفكّ: $(head -c 200 "$T/age.err")"
say "decrypt-ok"

# 4) الاستعادة
MB=$(base64 < "$T/m" | tr -d '\n\r'); SB=$(base64 < "$T/m.sig" | tr -d '\n\r')
set +e
age -d -i "$KEY" "$T/c" | "${SSH[@]}" "$HOST" "$RP/offsite-restore-drill.sh --manifest-b64 $MB --sig-b64 $SB" 2>&1 | tee -a "$LOG"
rc=${PIPESTATUS[1]}; set -e
case "$rc" in
  0) say "النتيجة: PASS — استُعيدت النسخةُ وطابقت لقطةَ النسخِ تماماً (السجلّ: $LOG — بلا أسرار)";;
  3) say "النتيجة: INCONCLUSIVE — استُعيدت لكن لا يمكنُ إثباتُ التطابق (السجلّ: $LOG)"; exit 3;;
  *) say "النتيجة: FAIL (السجلّ: $LOG)"; exit 1;;
esac
