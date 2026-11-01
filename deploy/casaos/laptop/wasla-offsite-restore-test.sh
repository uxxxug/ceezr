#!/usr/bin/env bash
# الغرض: اختبارُ استعادةٍ فعليٌّ من Google Drive (ADR 0297) يُشغَّلُ على لابتوبِ المالك.
#   الخادمُ يُنزِّلُ النسخةَ المشفّرةَ من Drive ← اللابتوبُ يفكُّها بالمفتاحِ الخاصّ ← الخادمُ يستعيدُها
#   في حاوياتٍ معزولةٍ ويقارنُها بالإنتاج ← تُحذَفُ الحاوياتُ والملفّاتُ المؤقّتة.
# الاستعمال: wasla-offsite-restore-test.sh            ⇒ أحدثُ نسخةٍ يوميّة
#            wasla-offsite-restore-test.sh --list     ⇒ قائمةُ النسخ
#            wasla-offsite-restore-test.sh weekly/wasla-<TS>.tar.age
# المفتاحُ الخاصُّ لا يغادرُ اللابتوب؛ والمفكوكُ يمرُّ عبرَ SSH المشفّرِ إلى الخادمِ الذي يملكُ البياناتِ أصلاً.
set -euo pipefail
KEY=${WASLA_AGE_KEY:-$HOME/.wasla/wasla-backup.agekey}; HOST=${WASLA_SSH_HOST:-wasla}
[ -f "$KEY" ] || { echo "المفتاحُ غيرُ موجود: $KEY"; exit 1; }
if [ "${1:-}" = --list ]; then ssh "$HOST" "sudo /opt/wasla/offsite-fetch.sh --list"; exit 0; fi
NAME=${1:-}
case "$NAME" in ""|daily/wasla-*.tar.age|weekly/wasla-*.tar.age|monthly/wasla-*.tar.age) ;; *) echo "اسمٌ غيرُ صالح"; exit 2;; esac
LOG=wasla-restore-test-$(date -u +%Y%m%dT%H%M%SZ).log
ssh "$HOST" "sudo /opt/wasla/offsite-fetch.sh $NAME" | age -d -i "$KEY" | ssh "$HOST" "sudo /opt/wasla/offsite-restore-drill.sh" 2>&1 | tee "$LOG"
grep -q '^offsite-drill-PASS' "$LOG" && echo "النتيجة: نجحَ اختبارُ الاستعادة (السجلّ: $LOG — بلا أسرار)" || { echo "النتيجة: فشل (السجلّ: $LOG)"; exit 1; }
