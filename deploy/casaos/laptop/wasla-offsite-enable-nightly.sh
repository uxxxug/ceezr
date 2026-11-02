#!/usr/bin/env bash
# الغرض: **المرحلة ج — تفعيلُ الرفعِ الليليّ** (ADR 0300). يُشغَّلُ على لابتوبِ المالك بعدَ نجاحِ أوّلِ رفع.
#   يرفضُ ما لم يُبلِغِ الخادمُ عن أوّلِ رفعٍ ناجحٍ لهذا الربط، ثمّ يطلبُ أن يكتبَ المالكُ ENABLE، فيستدعي
#   offsite-setup.sh --enable-nightly <طابعُ أوّلِ رفع> (الخادمُ يعيدُ التحقّقَ بنفسِه). للإيقاف: --disable.
set -euo pipefail; umask 077
HOST=${WASLA_SSH_HOST:-wasla}; RP=${WASLA_REMOTE_PREFIX:-sudo /opt/wasla}
command -v ssh >/dev/null && command -v ssh-keygen >/dev/null || { echo "ينقصُ ssh أو ssh-keygen"; exit 1; }
# shellcheck source=wasla-laptop-lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/wasla-laptop-lib.sh"
host_require || exit 1
remote_stage || exit 1
if [ "${1:-}" = --disable ]; then
  [ "$STAGE" = enabled ] || { echo "الرفعُ الليليُّ غيرُ مفعَّلٍ أصلاً."; exit 0; }
  confirm DISABLE "سيتوقّفُ الرفعُ الليليُّ إلى Drive (النسخُ المحلّيُّ مستمرّ، والربطُ والنسخُ في Drive باقية)." || exit 1
  "${SSH[@]}" -n "$HOST" "$RP/offsite-setup.sh --disable-nightly"; exit
fi
case "$STAGE" in
  enabled)  echo "الرفعُ الليليُّ مفعَّلٌ مسبقاً."; exit 0;;
  first-ok) ;;
  *) echo "لا يمكنُ التفعيل: لا يوجدُ أوّلُ رفعٍ ناجحٌ لهذا الربط (stage=$STAGE). شغّلْ wasla-offsite-first-upload.sh أوّلاً."; exit 1;;
esac
[[ "$FIRST_TS" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "طابعُ أوّلِ رفعٍ غيرُ صالحٍ من الخادم"; exit 1; }
confirm ENABLE "أوّلُ رفعٍ ناجح: $FIRST_TS. بعدَ التفعيلِ ترفعُ النسخةُ الليليّةُ (03:30) كلَّ ليلةٍ نسخةً مشفّرةً إلى Drive." || exit 1
"${SSH[@]}" -n "$HOST" "$RP/offsite-setup.sh --enable-nightly $FIRST_TS"
