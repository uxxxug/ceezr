#!/usr/bin/env bash
# الغرض: تمرينُ استعادةِ مخزنِ الوثائقِ (ADR 0294 · WR-21) من نسخةِ backup.sh إلى حاوياتٍ معزولة،
#   ثمّ مقارنةُ كلِّ كائنٍ بالإنتاجِ عبرَ واجهةِ المخزنِ نفسِها (sha256 للمحتوى المُنزَّل).
#   شرطٌ قبلَ DRIVER_DOCUMENT_UPLOADS=enabled: «إذا لم تكن استعادةُ ملفّاتِ Storage مثبتة،
#   فلا تفتحْ رفعَ الوثائق».
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/storage-restore-drill.sh (700، root).
# الاستعمال: storage-restore-drill.sh [TS]   (بلا TS = أحدثُ نسخة)
#
# العزل: شبكةٌ `--internal` خاصّةٌ بالتمرين، وقاعدةٌ ومجلّدٌ باسمٍ يحملُ الطابعَ الزمنيّ، ولا منفذ.
#   لا تُلمَسُ حاوياتُ الإنتاجِ إلّا قراءةً (`docker exec … node -e fetch` على 127.0.0.1).
# التنظيف: يحذفُ ما أنشأه هو وحدَه بالاسم (حاويتان، شبكة، مجلّد) — لا prune.
# الأسرار: مفاتيحُ المخزنِ تُقرأُ من /etc/wasla/storage.env إلى env-file الحاويةِ ولا تُطبَع.
set -euo pipefail; umask 077
D=/var/backups/wasla
TS=${1:-$(ls -1 "$D"/storage-db-*.dump 2>/dev/null | sed -nE 's#.*/storage-db-(.*)\.dump$#\1#p' | sort | tail -1)}
[ -n "$TS" ] || { echo "drill-fail no_storage_backup"; exit 1; }
SD=$D/storage-db-$TS.dump; SF=$D/storage-files-$TS.tar; SM=$D/storage-files-$TS.sha256
for f in "$SD" "$SF"; do sha256sum -c --quiet "$f.sha256"; done

ID=drill-$(date -u +%Y%m%dT%H%M%SZ | tr 'A-Z' 'a-z'); NET=wasla-$ID; VOL=wasla-$ID-files
DB=wasla-$ID-db; API=wasla-$ID-storage; TMP=$(mktemp -d); trap cleanup EXIT
cleanup(){ docker rm -f "$API" "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
PW=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
grep -vE '^(POSTGRES_PASSWORD|DATABASE_URL)=' /etc/wasla/storage.env > "$TMP/env"
printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgres://postgres:%s@%s:5432/storage\n' "$PW" "$PW" "$DB" >> "$TMP/env"
IMG=$(docker inspect -f '{{.Config.Image}}' wasla-storage-1)

docker network create --internal "$NET" >/dev/null
docker volume create "$VOL" >/dev/null
docker run -d --name "$DB" --network "$NET" --env-file "$TMP/env" -e POSTGRES_DB=storage postgres:17-alpine >/dev/null
for _ in $(seq 60); do docker exec "$DB" pg_isready -U postgres -d storage >/dev/null 2>&1 && break; sleep 1; done; sleep 2
# الأدوارُ أوّلاً (`postgres` قائمٌ فيُتجاهَلُ خطؤه وحدَه)، ثمّ القاعدةُ بمُلّاكِها.
grep -vE '^(CREATE|ALTER) ROLE postgres( |;)' "$D/storage-roles-$TS.sql" | docker exec -i "$DB" psql -q -U postgres -d storage -v ON_ERROR_STOP=1 >/dev/null
docker exec -i "$DB" pg_restore -U postgres -d storage --exit-on-error < "$SD"
# البايتات: يُفَكُّ الأرشيفُ داخلَ صورةِ المخزنِ نفسِها في المجلّدِ الجديد.
docker run --rm -i --network none -v "$VOL:/var/lib/storage" --entrypoint sh "$IMG" -c 'tar -C /var/lib/storage -xf -' < "$SF"
docker run --rm --network none -v "$VOL:/var/lib/storage:ro" --entrypoint sh "$IMG" \
  -c 'cd /var/lib/storage && find . -type f -exec sha256sum {} + | sort -k2' > "$TMP/restored.sha256"
if cmp -s "$SM" "$TMP/restored.sha256"; then files_ok=yes; else files_ok=no; fi

docker run -d --name "$API" --network "$NET" --env-file "$TMP/env" -v "$VOL:/var/lib/storage" \
  -e DB_INSTALL_ROLES=true -e DATABASE_MAX_CONNECTIONS=3 -e STORAGE_BACKEND=file \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e FILE_SIZE_LIMIT=5242880 -e TENANT_ID=wasla \
  -e REGION=local -e GLOBAL_S3_BUCKET=wasla -e ENABLE_IMAGE_TRANSFORMATION=false "$IMG" >/dev/null
for _ in $(seq 60); do
  docker exec "$API" node -e "fetch('http://127.0.0.1:5000/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break; sleep 1; done

# قائمةُ الكائناتِ من القاعدةِ المستعادة، ثمّ تنزيلُ كلٍّ منها من الطرفين ومقارنةُ sha256.
docker exec "$DB" psql -U postgres -d storage -Atc \
  "select bucket_id || '/' || name from storage.objects order by 1" > "$TMP/objects"
HASH='const [p]=process.argv.slice(1);fetch("http://127.0.0.1:5000/object/"+p.split("/").map(encodeURIComponent).join("/"),{headers:{authorization:"Bearer "+process.env.SERVICE_KEY}}).then(async r=>{if(!r.ok){console.log("HTTP"+r.status);return}const b=new Uint8Array(await r.arrayBuffer());console.log(require("crypto").createHash("sha256").update(b).digest("hex"))}).catch(()=>console.log("ERR"))'
total=0; same=0; diff=0
while IFS= read -r obj; do
  [ -n "$obj" ] || continue; total=$((total+1))
  a=$(docker exec wasla-storage-1 node -e "$HASH" "$obj"); b=$(docker exec "$API" node -e "$HASH" "$obj")
  if [ "$a" = "$b" ] && [ "${#a}" = 64 ]; then same=$((same+1)); else diff=$((diff+1)); echo "mismatch object#$total prod=${a:0:12} drill=${b:0:12}"; fi
done < "$TMP/objects"
rows=$(docker exec "$DB" psql -U postgres -d storage -Atc "select count(*) from storage.objects")
buckets=$(docker exec "$DB" psql -U postgres -d storage -Atc "select string_agg(id||':'||public::text||':'||coalesce(file_size_limit::text,'-'), ',') from storage.buckets")
echo "drill backup=$TS files_manifest_equal=$files_ok object_rows=$rows compared=$total equal=$same different=$diff buckets=$buckets"
[ "$files_ok" = yes ] && [ "$diff" = 0 ] && [ "$same" = "$total" ] || { echo "drill-FAIL"; exit 1; }
echo "drill-PASS"
