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
# الاستعادةُ مُتمرَّنٌ عليها بـstorage-restore-drill.sh في حاوياتٍ معزولة.
set -euo pipefail; umask 077
D=/var/backups/wasla; install -d -m 700 "$D"
TS=$(date -u +%Y%m%dT%H%M%SZ); F=$D/waslah-$TS.dump
docker exec wasla-db-1 pg_dump -U postgres -d waslah -Fc -Z 6 > "$F.part"
docker exec -i wasla-db-1 pg_restore -l < "$F.part" > /dev/null
mv "$F.part" "$F"; sha256sum "$F" > "$F.sha256"

storage_note="storage=absent"
if [ "$(docker inspect -f '{{.State.Running}}' wasla-storage-1 2>/dev/null)" = "true" ]; then
  SD=$D/storage-db-$TS.dump; SF=$D/storage-files-$TS.tar; SM=$D/storage-files-$TS.sha256
  # الأدوارُ (anon/authenticated/service_role/supabase_storage_admin…) خارجَ pg_dump، والاستعادةُ
  # إلى عنقودٍ جديدٍ تفشلُ بدونِها.
  docker exec wasla-storage-db-1 pg_dumpall -U postgres --roles-only > "$D/storage-roles-$TS.sql"
  docker exec wasla-storage-db-1 pg_dump -U postgres -d storage -Fc -Z 6 > "$SD.part"
  docker exec -i wasla-storage-db-1 pg_restore -l < "$SD.part" > /dev/null
  mv "$SD.part" "$SD"; sha256sum "$SD" > "$SD.sha256"
  docker exec wasla-storage-1 tar -C /var/lib/storage -cf - . > "$SF.part"
  tar -tf "$SF.part" > /dev/null
  docker exec wasla-storage-1 sh -c 'cd /var/lib/storage && find . -type f -exec sha256sum {} + | sort -k2' > "$SM"
  mv "$SF.part" "$SF"; sha256sum "$SF" > "$SF.sha256"
  storage_note="storage_files=$(wc -l < "$SM") storage_tar=$(stat -c %s "$SF")"
fi

cfg=(); for f in db.env gateway.env shim.env redis.conf signal.env public.env storage.env storage-client.env; do
  [ -f "/etc/wasla/$f" ] && cfg+=("etc/wasla/$f"); done
for f in .env compose.yml haproxy.cfg; do [ -f "/opt/wasla/$f" ] && cfg+=("opt/wasla/$f"); done
tar -C / -czf "$D/config-$TS.tgz" "${cfg[@]}"

find "$D" -name 'waslah-*.dump*' -mtime +14 -delete; find "$D" -name 'config-*.tgz' -mtime +14 -delete
find "$D" -name 'storage-*' -mtime +14 -delete; find "$D" -name 'pre-migrate-*' -mtime +30 -delete
echo "backup-ok $F $(stat -c %s "$F") bytes $storage_note"
