#!/usr/bin/env bash
# الغرض: **المرحلة ب — أوّلُ رفعٍ يدويٍّ واحد** (ADR 0300). يُشغَّلُ على لابتوبِ المالك بعدَ wasla-offsite-connect.sh.
#   يطلبُ من الخادمِ نسخةً واحدةً مشفّرةً موقَّعةً إلى Drive (offsite-backup.sh --first) بعدَ أن يكتبَ المالكُ UPLOAD.
#   **لا يفعّلُ الرفعَ الليليّ** — ذلك في wasla-offsite-enable-nightly.sh. فشلُ الرفعِ يتركُ الليليَّ غيرَ مفعَّل.
# المتطلّبات: ssh ومُضيفُ `wasla` بمفتاحِه المثبَّت (يُثبِّتُه wasla-offsite-connect.sh)، وwasla-laptop-lib.sh بجانبِه.
set -euo pipefail; umask 077
HOST=${WASLA_SSH_HOST:-wasla}; RP=${WASLA_REMOTE_PREFIX:-sudo /opt/wasla}
command -v ssh >/dev/null && command -v ssh-keygen >/dev/null || { echo "ينقصُ ssh أو ssh-keygen"; exit 1; }
# shellcheck source=wasla-laptop-lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wasla-laptop-lib.sh"
host_require || exit 1
remote_stage || exit 1
case "$STAGE" in
  unlinked) echo "الخادمُ غيرُ مربوطٍ بـDrive. شغّلْ wasla-offsite-connect.sh أوّلاً."; exit 1;;
  enabled)  echo "الرفعُ الليليُّ مفعَّلٌ مسبقاً؛ لا حاجةَ لأوّلِ رفع."; exit 1;;
esac
[ "$STAGE" = first-ok ] && echo "ملاحظة: يوجدُ أوّلُ رفعٍ ناجحٌ ($FIRST_TS). رفعٌ جديدٌ يحلُّ محلَّه سجلّاً (ولا يحذفُ القديمَ من Drive)."
confirm UPLOAD "سيُرفَعُ الآن إلى Google Drive ملفٌّ واحدٌ مشفّرٌ (مع بيانِه وتوقيعِه) لأحدثِ نسخةٍ محلّيّة. لن يُفعَّلَ الرفعُ الليلي." || exit 1
"${SSH[@]}" -n "$HOST" "$RP/offsite-backup.sh --first" || {
  echo "فشلَ أوّلُ رفع. حُذفَ ما رُفعَ في هذه المحاولة (أفضلُ جهد)، والرفعُ الليليُّ غيرُ مفعَّل."; exit 1; }
echo "تحقّقْ الآن من فكِّ النسخة (اختياريٌّ ومستحسَن): bash wasla-offsite-restore-test.sh"
echo "ثمّ، حين تقرّر، فعّلِ الرفعَ الليليّ: bash wasla-offsite-enable-nightly.sh"
