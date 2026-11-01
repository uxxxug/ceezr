# shellcheck shell=bash disable=SC2034  # ثوابتُ تستعملُها السكربتاتُ التي تستوردُ هذه المكتبة
# الغرض: ثوابتُ ودوالُّ مشتركةٌ لسكربتاتِ النسخةِ خارجَ الموقع (ADR 0297 · ADR 0298). يُستورَدُ ولا يُشغَّل.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-lib.sh (600، root) بجانبِ السكربتات.
# كلُّ مسارٍ قابلٌ للتجاوزِ بمتغيّرِ بيئةٍ كي تعملَ الاختباراتُ (tests/offsite-selftest.sh) في مجلّدٍ مؤقّت
# دونَ لمسِ /etc/wasla أو /opt/wasla أو حاوياتِ الإنتاج.

WASLA_ETC=${WASLA_ETC:-/etc/wasla}
WASLA_OPT=${WASLA_OPT:-/opt/wasla}
WASLA_BIN=${WASLA_BIN:-$WASLA_OPT/bin}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/wasla}
OFFSITE_ENV=${OFFSITE_ENV:-$WASLA_ETC/offsite.env}
RCLONE_CONFIG_FILE=${RCLONE_CONFIG_FILE:-$WASLA_ETC/rclone.conf}
SIGNING_KEY=${SIGNING_KEY:-$WASLA_ETC/backup-signing.key}
PROD_DB_CONTAINER=${PROD_DB_CONTAINER:-wasla-db-1}
STORAGE_DRILL_CMD=${STORAGE_DRILL_CMD:-$WASLA_OPT/storage-restore-drill.sh}
CONFIG_ROOT=${CONFIG_ROOT:-/}
OFFSITE_HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OFFSITE_TOOL=(python3 "$OFFSITE_HERE/offsite-tool.py")
# هويّةُ التوقيعِ ونطاقُه في ssh-keygen -Y: النطاقُ يمنعُ إعادةَ استعمالِ توقيعٍ من سياقٍ آخر.
SIG_ID=wasla-backup
SIG_NS=wasla-offsite-backup
NAME_RE='^(daily|weekly|monthly)/wasla-[0-9]{8}T[0-9]{6}Z\.(tar\.age|manifest|manifest\.sig)$'
export RCLONE_CONFIG=$RCLONE_CONFIG_FILE

OFFSITE_LOG_TAG=${OFFSITE_LOG_TAG:-wasla-offsite}
olog(){ logger -t "$OFFSITE_LOG_TAG" -- "$*" 2>/dev/null || true; echo "$*"; }

# sha_ok FILE ⇒ يطابقُ sha256 للملفِّ بالقيمةِ في FILE.sha256 (الحقلُ الأوّلُ وحدَه). لا يعتمدُ على المسارِ المكتوبِ
# داخلَ ملفِّ .sha256 — فقد كتبَه backup.sh قديماً مطلقاً (/var/backups/wasla/…)، فكان `sha256sum -c` في التمرين
# يفحصُ ملفَّ الإنتاجِ لا النسخةَ المستعادة (عيبٌ وُجدَ في مراجعةِ ADR 0298).
sha_ok(){ local w; w=$(cut -d' ' -f1 "$1.sha256" 2>/dev/null) || return 1; [[ "$w" =~ ^[0-9a-f]{64}$ ]] && [ "$w" = "$(sha256sum "$1" | cut -d' ' -f1)" ]; }

# sql يحسبُ لكلِّ جدولٍ عاديٍّ ليسَ من امتداد: الاسمَ وعددَ الصفوفِ وبصمةَ المحتوى
# (md5 لتجميعٍ مرتَّبٍ من md5 كلِّ صفّ). يُشغَّلُ بـpsql -AtqX؛ و\gexec ينفّذُ الاستعلاماتِ المولَّدة.
# الإعداداتُ تثبّتُ تمثيلَ النصّ (المنطقةُ الزمنيّةُ والتاريخُ والأعدادُ العشريّة) على الجانبَين.
rowstats_sql(){ cat <<'SQL'
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SET IntervalStyle = 'postgres';
SET extra_float_digits = 3;
SET bytea_output = 'hex';
SELECT format('SELECT %L || E''\t'' || count(*) || E''\t'' || coalesce(md5(string_agg(md5(t::text), '''' ORDER BY md5(t::text))), ''-'') FROM %I.%I t',
              n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
ORDER BY n.nspname, c.relname
\gexec
SQL
}

# wait_pg CONTAINER ⇒ ينتظرُ حتّى ينتهيَ تهيئةُ صورةِ postgres (خادمُها المؤقّتُ يجيبُ pg_isready ثمّ يُطفأ).
wait_pg(){ local _; for _ in $(seq 180); do
    if docker logs "$1" 2>&1 | grep -qE 'init process complete|Skipping initialization' &&
       docker exec "$1" pg_isready -U postgres >/dev/null 2>&1; then return 0; fi; sleep 1; done; return 1; }

# rowstats_of CONTAINER DB ⇒ إحصاءُ قاعدةٍ ساكنة (المستعادة) على stdout.
rowstats_of(){ { rowstats_sql; } | docker exec -i "$1" psql -U postgres -d "$2" -AtqX -v ON_ERROR_STOP=1; }
