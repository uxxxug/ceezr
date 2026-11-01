#!/usr/bin/env bash
# الغرض: نسخٌ احتياطيٌّ ليليٌّ لـWASLA على CasaOS مع التحقّقِ منه. احتفاظٌ 14 يومًا.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/backup.sh (700، root) ويُشغِّلُه wasla-backup.timer.
#
# ما يُنسَخ:
#   1) قاعدةُ التطبيقِ `waslah` (pg_dump -Fc)، ويُتحقَّقُ منها بـpg_restore -l.
#   2) مخزنُ الوثائقِ (ADR 0294) إن كانت حاويتُه قائمة:
#      أ) أدوارُه (pg_dumpall --roles-only) وقاعدتُه الوصفيّةُ `storage` (pg_dump -Fc) — **أوّلاً**،
#      ب) ثمّ البايتاتُ (tar لـ/var/lib/storage) وبيانُ sha256 لكلِّ ملف.
#      الترتيبُ مقصود: كائنٌ يُرفَعُ بينَ الخطوتين يظهرُ ملفًّا بلا صفٍّ (يتيمٌ لا يضرّ)،
#      ولا يظهرُ أبدًا صفٌّ بلا ملفّ — وهو العطبُ الذي يُفقِدُ وثيقةَ سائق.
#   3) ملفّاتُ الإعداد: /etc/wasla/* القائمةُ منها، و/opt/wasla/{.env,compose.yml,haproxy.cfg}.
#      فيها أسرار، فالمجلّدُ 700 والملفّاتُ 600 (umask 077) ولا تُطبَعُ قيمُها.
#   4) لكلِّ قاعدةٍ ملفُّ rowstats (ADR 0298): عددُ صفوفِ كلِّ جدولٍ وبصمةُ محتواه من **لقطةِ pg_dump نفسِها**
#      (pg-snapshot-dump.sh)، فيُقارَنُ بها المستعادُ مقارنةً تامّة.
# الاستعادةُ مُتمرَّنٌ عليها بـstorage-restore-drill.sh في حاوياتٍ معزولة.
# وخارجَ الموقع: offsite-backup.sh (age ← Google Drive)، وتمرينُه offsite-restore-drill.sh.
# المساراتُ والحاوياتُ قابلةٌ للتجاوزِ ببيئةِ offsite-lib.sh للاختبارِ وحدَه؛ القيمُ الافتراضيّةُ هي الإنتاج.
set -euo pipefail; umask 077
H=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=offsite-lib.sh
. "$H/offsite-lib.sh"
STORAGE_CONTAINER=${STORAGE_CONTAINER:-wasla-storage-1}; STORAGE_DB_CONTAINER=${STORAGE_DB_CONTAINER:-wasla-storage-db-1}
D=$BACKUP_DIR; install -d -m 700 "$D"
TS=$(date -u +%Y%m%dT%H%M%SZ); F=$D/waslah-$TS.dump
"$H/pg-snapshot-dump.sh" "$PROD_DB_CONTAINER" waslah "$F" "$D/waslah-$TS.rowstats" > /dev/null
(cd "$D" && sha256sum "${F##*/}") > "$F.sha256"

storage_note="storage=absent"
if [ "$(docker inspect -f '{{.State.Running}}' "$STORAGE_CONTAINER" 2>/dev/null)" = "true" ]; then
  SD=$D/storage-db-$TS.dump; SF=$D/storage-files-$TS.tar; SM=$D/storage-files-$TS.sha256
  # الأدوارُ (anon/authenticated/service_role/supabase_storage_admin…) خارجَ pg_dump، والاستعادةُ
  # إلى عنقودٍ جديدٍ تفشلُ بدونِها.
  docker exec "$STORAGE_DB_CONTAINER" pg_dumpall -U postgres --roles-only > "$D/storage-roles-$TS.sql"
  "$H/pg-snapshot-dump.sh" "$STORAGE_DB_CONTAINER" storage "$SD" "$D/storage-db-$TS.rowstats" > /dev/null
  (cd "$D" && sha256sum "${SD##*/}") > "$SD.sha256"
  docker exec "$STORAGE_CONTAINER" tar -C /var/lib/storage -cf - . > "$SF.part"
  tar -tf "$SF.part" > /dev/null
  docker exec "$STORAGE_CONTAINER" sh -c 'cd /var/lib/storage && find . -type f -exec sha256sum {} + | sort -k2' > "$SM"
  mv "$SF.part" "$SF"; (cd "$D" && sha256sum "${SF##*/}") > "$SF.sha256"
  storage_note="storage_files=$(wc -l < "$SM") storage_tar=$(stat -c %s "$SF")"
fi

cfg=(); for f in db.env gateway.env shim.env redis.conf signal.env public.env ingress.env storage.env storage-client.env; do
  [ -f "$CONFIG_ROOT/etc/wasla/$f" ] && cfg+=("etc/wasla/$f"); done
for f in .env compose.yml haproxy.cfg; do [ -f "$CONFIG_ROOT/opt/wasla/$f" ] && cfg+=("opt/wasla/$f"); done
tar -C "$CONFIG_ROOT" -czf "$D/config-$TS.tgz" "${cfg[@]}"

find "$D" -name 'waslah-*.dump*' -mtime +14 -delete; find "$D" -name 'waslah-*.rowstats' -mtime +14 -delete; find "$D" -name 'config-*.tgz' -mtime +14 -delete
find "$D" -name 'storage-*' -mtime +14 -delete; find "$D" -name 'pre-migrate-*' -mtime +30 -delete
echo "backup-ok $F $(stat -c %s "$F") bytes $storage_note"
# نسخةٌ مشفّرةٌ خارجَ الموقع (ADR 0297) إن ضُبطت. فشلُها يُفشِلُ الخدمةَ بعدَ اكتمالِ النسخةِ المحلّيّة.
if [ -f "$OFFSITE_ENV" ] && [ -x "$H/offsite-backup.sh" ]; then "$H/offsite-backup.sh" "$TS"; fi
