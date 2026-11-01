#!/usr/bin/env bash
# الغرض: تمرينُ استعادةٍ فعليٌّ من نسخةِ Google Drive (ADR 0297 · ADR 0298 · WR-27).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-restore-drill.sh (700، root).
# الاستعمال: يستدعيه wasla-offsite-restore-test.sh من اللابتوب (حيثُ المفتاحُ الخاصُّ وحدَه):
#   age -d … | ssh wasla 'sudo /opt/wasla/offsite-restore-drill.sh --manifest-b64 B64 --sig-b64 B64'
#   stdin: tar المفكوك. البيانُ وتوقيعُه بـbase64 (ليسا سرّاً). لا يرى هذا الخادمُ المفتاحَ الخاصّ.
#
# الترتيب (لا تبدأُ الاستعادةُ قبلَ نجاحِ كلِّ ما قبلَها؛ وأيُّ فشلٍ يُنهي دونَ حاويات):
#   1) التوقيع: البيانُ موقَّعٌ بمفتاحِ التوقيعِ العامِّ لهذا الخادم (ssh-keygen -Y verify)، وصيغتُه سليمة.
#   2) الاستلام: stdin إلى ملفٍّ مؤقّتٍ (700) ثمّ check-tar: أسماءٌ مسموحةٌ حصراً لطابعِ البيان، ملفّاتٌ عاديّة،
#      لا روابطَ ولا ../ ولا زوائد. ثمّ الفكّ بمرشّحِ data.
#   3) السلامة: sha256 لـMANIFEST.sha256 = القيمةُ الموقَّعة؛ والبيانُ يذكرُ كلَّ ملفٍّ ولا غيرَه؛ وsha256sum -c --strict.
#      والإعدادُ وأرشيفُ المخزنِ يُفحَصان (check-config · check-storage-tar).
#   4) قاعدةُ التطبيق: pg_restore إلى حاويةِ postgis معزولةٍ (--network none)، ثمّ rowstats للمستعادِ
#      تُقارَنُ **مقارنةً تامّة** بـwaslah-TS.rowstats المأخوذِ من لقطةِ النسخِ نفسِها. أيُّ اختلاف ⇒ FAIL.
#      غيابُ rowstats ⇒ INCONCLUSIVE (لا PASS).
#   5) المخزن: storage-restore-drill.sh (rowstats لقاعدتِه + sha256 لكلِّ ملفّ؛ المقارنةُ بالحيِّ معلوماتيّة).
#   6) معلوماتيّ لا يؤثّرُ في النتيجة: كم جدولاً وملفَّ إعدادٍ تغيّرَ في الإنتاجِ منذُ النسخة (قراءةٌ فقط).
# الخروج: 0 PASS · 1 FAIL · 3 INCONCLUSIVE. التنظيف: يحذفُ ما أنشأه وحدَه بالاسم ويمسحُ المؤقّت. لا prune.
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
ID=${DRILL_PREFIX:-wasla-offsite-drill}-$(date -u +%Y%m%dT%H%M%SZ | tr 'A-Z' 'a-z')-$$; DB=$ID-db
W=""; started=0
cleanup(){ rc=$?; [ "$started" = 1 ] && docker rm -f "$DB" >/dev/null 2>&1; [ -n "$W" ] && rm -rf "$W"; exit "$rc"; }
trap cleanup EXIT
trap 'echo "offsite-drill-FAIL stage=unexpected line=$LINENO"' ERR
fail(){ echo "offsite-drill-FAIL stage=$1${2:+ $2}"; exit 1; }
MB=""; SB=""
while [ $# -gt 0 ]; do case "$1" in
  --manifest-b64) MB=${2:-}; shift 2;; --sig-b64) SB=${2:-}; shift 2;; *) fail usage;; esac; done
[ -n "$MB" ] && [ -n "$SB" ] || fail usage "no_manifest_or_signature"
W=$(mktemp -d "$BACKUP_DIR/.drill-XXXXXX")

# --- 1) التوقيع ---
printf '%s' "$MB" | base64 -d > "$W/manifest" 2>/dev/null || fail provenance bad_base64
printf '%s' "$SB" | base64 -d > "$W/manifest.sig" 2>/dev/null || fail provenance bad_base64
[ -s "$SIGNING_KEY.pub" ] || fail provenance no_signing_pubkey
printf '%s namespaces="%s" %s\n' "$SIG_ID" "$SIG_NS" "$(cat "$SIGNING_KEY.pub")" > "$W/allowed_signers"
ssh-keygen -Y verify -f "$W/allowed_signers" -I "$SIG_ID" -n "$SIG_NS" -s "$W/manifest.sig" < "$W/manifest" >/dev/null 2>&1 ||
  fail provenance signature_invalid
TS=$("${OFFSITE_TOOL[@]}" manifest-get "$W/manifest" ts) || fail provenance manifest_invalid
INNER=$("${OFFSITE_TOOL[@]}" manifest-get "$W/manifest" inner_manifest_sha256)
echo "provenance-ok signer=$SIG_ID backup=$TS"

# --- 2) الاستلام والفحصُ قبلَ الفكّ ---
cat > "$W/in.tar"
[ -s "$W/in.tar" ] || fail receive empty_input
"${OFFSITE_TOOL[@]}" check-tar "$W/in.tar" "$TS" || fail archive_check
install -d -m 700 "$W/x"
"${OFFSITE_TOOL[@]}" extract "$W/in.tar" "$W/x" || fail extract
rm -f "$W/in.tar"
cd "$W/x"

# --- 3) السلامة ---
[ "$(sha256sum MANIFEST.sha256 | cut -d' ' -f1)" = "$INNER" ] || fail integrity inner_manifest_not_signed_value
"${OFFSITE_TOOL[@]}" check-inner . "$TS" || fail integrity
sha256sum -c --quiet --strict MANIFEST.sha256 || fail integrity manifest_sha256
sha_ok "waslah-$TS.dump" || fail integrity dump_sha256
"${OFFSITE_TOOL[@]}" check-config "config-$TS.tgz" || fail config_check
has_storage=0; [ -f "storage-db-$TS.dump" ] && has_storage=1
if [ "$has_storage" = 1 ]; then
  sha_ok "storage-db-$TS.dump" && sha_ok "storage-files-$TS.tar" || fail integrity storage_sha256
  "${OFFSITE_TOOL[@]}" check-storage-tar "storage-files-$TS.tar" || fail storage_archive_check
fi
echo "integrity-ok files=$(wc -l < MANIFEST.sha256) storage=$([ "$has_storage" = 1 ] && echo yes || echo absent)"

# --- 4) قاعدةُ التطبيق ---
result=PASS
IMG=$(docker inspect -f '{{.Config.Image}}' "$PROD_DB_CONTAINER")
PW=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')
started=1
printf 'POSTGRES_PASSWORD=%s\n' "$PW" > "$W/db.env"
docker run -d --name "$DB" --network none --env-file "$W/db.env" "$IMG" >/dev/null
wait_pg "$DB" || fail app_db_start
# صورةُ postgis تُنشئُ امتداداتِها في القاعدةِ الافتراضيّة؛ فالاستعادةُ إلى قاعدةٍ نظيفةٍ من template0.
docker exec "$DB" createdb -U postgres -T template0 waslah
# الأدوارُ التي تملكُ كائناتٍ في الإنتاجِ تُنشأُ فارغةً بلا كلماتِ مرور، كي تُستعادَ الصلاحيّاتُ كما هي.
docker exec "$PROD_DB_CONTAINER" psql -U postgres -Atc "select rolname from pg_roles where rolname !~ '^pg_' and rolname<>'postgres'" |
  while read -r r; do docker exec "$DB" psql -q -U postgres -c "create role \"$r\"" >/dev/null 2>&1 || true; done
docker exec -i "$DB" pg_restore -U postgres -d waslah --exit-on-error < "waslah-$TS.dump" || fail app_db_restore
rowstats_of "$DB" waslah > "$W/restored.rowstats" || fail app_db_rowstats
if [ -f "waslah-$TS.rowstats" ]; then
  "${OFFSITE_TOOL[@]}" compare-rowstats "waslah-$TS.rowstats" "$W/restored.rowstats" || fail app_db_compare "restored_differs_from_backup_snapshot"
else
  echo "app-db rowstats=absent_in_backup ⇒ لا يمكنُ إثباتُ التطابق"; result=INCONCLUSIVE
fi
QF="select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where nspname='public'"
echo "app-db backup=$TS funcs_restored=$(docker exec "$DB" psql -U postgres -d waslah -Atc "$QF") funcs_live=$(docker exec "$PROD_DB_CONTAINER" psql -U postgres -d waslah -Atc "$QF") (معلوماتيّ)"
if [ -f "waslah-$TS.rowstats" ] && [ "${DRIFT_INFO:-1}" = 1 ]; then
  rowstats_of "$PROD_DB_CONTAINER" waslah > "$W/live.rowstats" 2>/dev/null &&
    "${OFFSITE_TOOL[@]}" drift "waslah-$TS.rowstats" "$W/live.rowstats" || echo "drift-info unavailable"
fi
docker rm -f "$DB" >/dev/null; started=0

# --- 5) المخزن ---
if [ "$has_storage" = 1 ]; then
  set +e; BACKUP_DIR="$W/x" STORAGE_LIVE_COMPARE=info "$STORAGE_DRILL_CMD" "$TS" > "$W/storage.out" 2>&1; src=$?; set -e
  tail -3 "$W/storage.out"
  case "$src" in 0) ;; 3) [ "$result" = PASS ] && result=INCONCLUSIVE ;; *) fail storage_drill ;; esac
else echo "storage=absent_in_backup"; fi

# --- 6) الإعداد (معلوماتيّ) ---
tar -tzf "config-$TS.tgz" > "$W/cfg.list"; same=0; changed=0
while IFS= read -r p; do
  a=$(tar -xOzf "config-$TS.tgz" "$p" | sha256sum | cut -d' ' -f1); b=$(sha256sum "$CONFIG_ROOT/$p" 2>/dev/null | cut -d' ' -f1 || true)
  if [ "$a" = "$b" ]; then same=$((same+1)); else changed=$((changed+1)); echo "  config-changed-since-backup: $p"; fi
done < "$W/cfg.list"
echo "config files=$(wc -l < "$W/cfg.list") equal_to_live=$same changed=$changed (معلوماتيّ)"

if [ "$result" = PASS ]; then echo "offsite-drill-PASS backup=$TS"; exit 0; fi
echo "offsite-drill-INCONCLUSIVE backup=$TS"; exit 3
