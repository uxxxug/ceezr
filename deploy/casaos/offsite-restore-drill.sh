#!/usr/bin/env bash
# الغرض: تمرينُ استعادةٍ فعليٌّ من نسخةِ Google Drive (ADR 0297 · WR-27).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-restore-drill.sh (700، root).
# الاستعمال (من اللابتوب حيثُ المفتاحُ الخاصُّ وحدَه؛ انظر deploy/casaos/OFFSITE-BACKUP.md):
#   ssh wasla 'sudo /opt/wasla/offsite-fetch.sh [NAME]' | age -d -i KEY | ssh wasla 'sudo /opt/wasla/offsite-restore-drill.sh'
#   يقرأُ tar المفكوكَ من stdin. لا يرى هذا الخادمُ المفتاحَ الخاصّ.
#
# ما يُتحقَّقُ منه:
#   1) MANIFEST.sha256 لكلِّ ملفّ، وsha256 الخاصّةُ بالتفريغات.
#   2) قاعدةُ التطبيق: pg_restore إلى حاويةِ postgis معزولةٍ (--network none) ثمّ مقارنةُ عددِ الجداولِ
#      والدوالِّ وعددِ الصفوفِ الدقيقِ لكلِّ جدولٍ مع الإنتاج (قراءةٌ فقط).
#   3) المخزن: storage-restore-drill.sh على المجلّدِ المستعاد (حاوياتٌ معزولة، sha256 لكلِّ كائن).
#   4) الإعداد: كلُّ ملفٍّ في config-*.tgz يُقارَنُ بـsha256 بنظيرِه الحيّ. لا تُطبَعُ قيمٌ أبداً.
# التنظيف: يحذفُ ما أنشأه وحدَه بالاسم، ويمسحُ المجلّدَ المؤقّت. لا prune.
set -euo pipefail; umask 077
ID=offsite-drill-$(date -u +%Y%m%dT%H%M%SZ | tr 'A-Z' 'a-z'); DB=wasla-$ID-db
W=$(mktemp -d /var/backups/wasla/.drill-XXXXXX)
cleanup(){ docker rm -f "$DB" >/dev/null 2>&1 || true; rm -rf "$W"; }; trap cleanup EXIT
tar -xf - -C "$W"
cd "$W"; [ -f MANIFEST.sha256 ] || { echo "offsite-drill-FAIL no_manifest"; exit 1; }
sha256sum -c --quiet MANIFEST.sha256 && echo "manifest-ok files=$(wc -l < MANIFEST.sha256)"
TS=$(ls -1 waslah-*.dump | sed -nE 's#waslah-(.*)\.dump$#\1#p'); sha256sum -c --quiet "waslah-$TS.dump.sha256"
fail=0

# --- قاعدةُ التطبيق ---
IMG=$(docker inspect -f '{{.Config.Image}}' wasla-db-1)
PW=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
docker run -d --name "$DB" --network none -e POSTGRES_PASSWORD="$PW" "$IMG" >/dev/null
for _ in $(seq 90); do docker exec "$DB" pg_isready -U postgres -d postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 3
# صورةُ postgis تُنشئُ امتداداتِها في القاعدةِ الافتراضيّة؛ فالاستعادةُ إلى قاعدةٍ نظيفةٍ من template0.
docker exec "$DB" createdb -U postgres -T template0 waslah
# الأدوارُ التي تملكُ كائناتٍ في الإنتاجِ تُنشأُ فارغةً بلا كلماتِ مرور، كي تُستعادَ الصلاحيّاتُ كما هي.
docker exec wasla-db-1 psql -U postgres -Atc "select rolname from pg_roles where rolname !~ '^pg_' and rolname<>'postgres'" |
  while read -r r; do docker exec "$DB" psql -q -U postgres -c "create role \"$r\"" >/dev/null 2>&1 || true; done
docker exec -i "$DB" pg_restore -U postgres -d waslah --exit-on-error < "waslah-$TS.dump"
Q="select count(*) from pg_tables where schemaname='public' and tablename<>'spatial_ref_sys'"
QF="select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'"
# عددُ الصفوفِ الدقيقُ لكلِّ جدولٍ (لا n_live_tup التقديريّ).
QR="select string_agg(t, ',' order by t) from (select tablename||'='||(xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text as t from pg_tables where schemaname='public' and tablename<>'spatial_ref_sys') x"
lt=$(docker exec wasla-db-1 psql -U postgres -d waslah -Atc "$Q"); rt=$(docker exec "$DB" psql -U postgres -d waslah -Atc "$Q")
lf=$(docker exec wasla-db-1 psql -U postgres -d waslah -Atc "$QF"); rf=$(docker exec "$DB" psql -U postgres -d waslah -Atc "$QF")
lr=$(docker exec wasla-db-1 psql -U postgres -d waslah -Atc "$QR"); rr=$(docker exec "$DB" psql -U postgres -d waslah -Atc "$QR")
diffs=$(diff <(tr ',' '\n' <<<"$lr") <(tr ',' '\n' <<<"$rr") | grep -c '^[<>]' || true)
rows=$(tr ',' '\n' <<<"$rr" | awk -F= '{s+=$2} END {print s+0}')
echo "app-db backup=$TS tables live=$lt restored=$rt funcs live=$lf restored=$rf rows_restored=$rows tables_with_row_diff=$((diffs/2))"
echo "  (اختلافُ الصفوفِ طبيعيٌّ في الجداولِ التي تكتبُ إليها المهامُّ الدوريّةُ بعدَ وقتِ النسخة)"
tr ',' '\n' <<<"$rr" | grep -E '^(users|drivers|cities|orders|driver_documents)=' | tr '\n' ' '; echo
[ "$lt" = "$rt" ] && [ "$lf" = "$rf" ] || { echo "app-db-FAIL schema_mismatch"; fail=1; }
docker rm -f "$DB" >/dev/null

# --- المخزن ---
if [ -f "storage-db-$TS.dump" ]; then
  BACKUP_DIR="$W" /opt/wasla/storage-restore-drill.sh "$TS" | tail -2 || fail=1
else echo "storage=absent_in_backup"; fi

# --- الإعداد ---
tar -tzf "config-$TS.tgz" > cfg.list; same=0; changed=0
while IFS= read -r p; do
  a=$(tar -xOzf "config-$TS.tgz" "$p" | sha256sum | cut -d' ' -f1); b=$(sha256sum "/$p" 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$a" = "$b" ]; then same=$((same+1)); else changed=$((changed+1)); echo "  config-changed-since-backup: $p"; fi
done < cfg.list
echo "config files=$(wc -l < cfg.list) equal_to_live=$same changed=$changed"
grep -q 'etc/wasla/gateway.env' cfg.list && grep -q 'etc/wasla/db.env' cfg.list && grep -q 'opt/wasla/compose.yml' cfg.list ||
  { echo "config-FAIL missing_essential"; fail=1; }

[ "$fail" = 0 ] && echo "offsite-drill-PASS backup=$TS" || { echo "offsite-drill-FAIL backup=$TS"; exit 1; }
