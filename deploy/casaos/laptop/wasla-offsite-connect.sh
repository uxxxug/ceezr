#!/usr/bin/env bash
# الغرض: يُشغَّلُ مرّةً واحدةً على لابتوبِ المالك (ADR 0297) — يُنشئُ مفتاحَ age (إن غاب)، ويربطُ Google Drive
#   بعميلِ OAuth خاصٍّ بالمالك، ويضبطُ الخادمَ ويرفعُ أوّلَ نسخةٍ مشفّرة.
# المتطلّبات: age وrclone وssh مع مُضيفٍ اسمُه `wasla` في ~/.ssh/config (انظر deploy/casaos/OFFSITE-BACKUP.md).
# ما يخرجُ من اللابتوب: المفتاحُ العامُّ وclient_id/secret ورمزُ Drive، عبرَ SSH المشفّرِ إلى الخادمِ وحدَه.
# ما لا يخرجُ أبداً: المفتاحُ الخاصُّ لـage (يبقى في $KEY).
set -euo pipefail; umask 077
KEY=${WASLA_AGE_KEY:-$HOME/.wasla/wasla-backup.agekey}; HOST=${WASLA_SSH_HOST:-wasla}
for c in age age-keygen rclone ssh base64; do command -v "$c" >/dev/null || { echo "ينقصُ الأمر: $c"; exit 1; }; done
if [ ! -f "$KEY" ]; then
  mkdir -p "$(dirname "$KEY")"; chmod 700 "$(dirname "$KEY")"; age-keygen -o "$KEY" 2>/dev/null; chmod 600 "$KEY"
  echo "أُنشئَ المفتاحُ الخاصّ: $KEY"
  echo "مهمّ: إن ضاعَ هذا الملفُّ فلا يمكنُ فكُّ أيِّ نسخة. احفظْ نسخةً منه خارجَ الإنترنت (مدير كلمات المرور أو USB)، لا في Drive."
fi
PUB=$(age-keygen -y "$KEY"); echo "المفتاحُ العامّ (ليس سرّاً): $PUB"
ssh -o BatchMode=yes "$HOST" true || { echo "تعذّرَ الاتصالُ بـ$HOST عبرَ SSH"; exit 1; }
read -rp "Google OAuth Client ID: " CID
read -rsp "Google OAuth Client secret (لن يظهر): " CSEC; echo
BLOB=$(printf '{"client_id":"%s","client_secret":"%s","scope":"drive.file"}' "$CID" "$CSEC" | base64 | tr -d '=\n')
echo "سيفتحُ المتصفّح: سجّلْ دخولَك بحسابِ Google الذي تريدُ النسخَ فيه ووافق."
OUT=$(rclone authorize drive "$BLOB")
RAW=$(printf '%s\n' "$OUT" | awk '/--->$/{f=1;next} /^<---End paste/{f=0} f' | tr -d '\r' | head -1)
[ -n "$RAW" ] || { echo "لم يُرجِعْ rclone authorize رمزاً"; exit 1; }
printf '%s\n%s\n%s\n' "$CID" "$CSEC" "$RAW" | ssh "$HOST" "sudo /opt/wasla/offsite-setup.sh $PUB"
unset CSEC RAW OUT BLOB
echo "تمّ. للتحقّقِ الفعليّ من الاستعادة: bash wasla-offsite-restore-test.sh"
