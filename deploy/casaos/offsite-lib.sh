# shellcheck shell=bash disable=SC2034  # ثوابتُ تستعملُها السكربتاتُ التي تستوردُ هذه المكتبة
# الغرض: ثوابتُ ودوالُّ مشتركةٌ لسكربتاتِ النسخةِ خارجَ الموقع (ADR 0297 · ADR 0298). يُستورَدُ ولا يُشغَّل.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-lib.sh (600، root) بجانبِ السكربتات.
# كلُّ مسارٍ قابلٌ للتجاوزِ بمتغيّرِ بيئةٍ كي تعملَ الاختباراتُ (tests/offsite-selftest.sh) في مجلّدٍ مؤقّت
# دونَ لمسِ /etc/wasla أو /opt/wasla أو حاوياتِ الإنتاج.

WASLA_ETC=${WASLA_ETC:-/etc/wasla}
WASLA_OPT=${WASLA_OPT:-/opt/wasla}
WASLA_BIN=${WASLA_BIN:-$WASLA_OPT/bin}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/wasla}
# مراحلُ ADR 0300 الثلاث — ملفٌّ لكلِّ مرحلة، ولا يُستنتَجُ أيٌّ منها من غيرِه:
#   أ) الربط:   $RCLONE_CONFIG_FILE (الرمز) + $OFFSITE_PENDING (المستلمُ والمجلّدُ ومعرّفُ الربط). لا رفعَ ولا تفعيل.
#   ب) أوّلُ رفع: $OFFSITE_FIRST_OK — سجلُّ رفعٍ يدويٍّ واحدٍ تحقّقَ (md5 + sha256)، مربوطٌ بمعرّفِ الربط.
#   ج) التفعيل: $OFFSITE_ENV — **وجودُه وحدَه** يجعلُ backup.sh يرفعُ ليلاً، ولا يكتبُه إلّا offsite-setup.sh --enable-nightly.
OFFSITE_ENV=${OFFSITE_ENV:-$WASLA_ETC/offsite.env}
OFFSITE_PENDING=${OFFSITE_PENDING:-$WASLA_ETC/offsite-pending.env}
OFFSITE_FIRST_OK=${OFFSITE_FIRST_OK:-$WASLA_ETC/offsite-first-ok}
OFFSITE_LOCK=${OFFSITE_LOCK:-$WASLA_ETC/.offsite.lock}
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

# kv_load FILE KEY… ⇒ يقرأُ ملفَّ حالةٍ KEY=VALUE **دونَ تنفيذه** (لا source): ملفٌّ عاديٌّ لا رابط، مالكُه المستخدمُ الحاليُّ
#   وصلاحيّتُه 600، وكلُّ سطرٍ مفتاحٌ مسموحٌ مرّةً واحدةً بقيمةٍ من محارفَ آمنة. ثمّ يُسنِدُ القيمَ إلى المتغيّراتِ نفسِها.
#   أيُّ مخالفة ⇒ 1 ولا يُسنَدُ شيء. (كان offsite.env يُنفَّذُ بـsource، فسطرٌ فيه $(…) كان يُنفَّذُ root.)
kv_load(){ local f=$1 line k v allowed seen=" "; shift; allowed=" $* "
  local -a ks=() vs=()
  [ -f "$f" ] && [ ! -L "$f" ] || { echo "state-reject not_regular ${f##*/}" >&2; return 1; }
  [ "$(stat -c '%u %a' "$f")" = "$(id -u) 600" ] || { echo "state-reject owner_or_mode ${f##*/}" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=([A-Za-z0-9._/:+-]*)$ ]] || { echo "state-reject bad_line ${f##*/}" >&2; return 1; }
    k=${BASH_REMATCH[1]}; v=${BASH_REMATCH[2]}
    [[ "$allowed" == *" $k "* ]] || { echo "state-reject unknown_key ${f##*/}" >&2; return 1; }
    [[ "$seen" == *" $k "* ]] && { echo "state-reject duplicate_key ${f##*/}" >&2; return 1; }
    seen+="$k "; ks+=("$k"); vs+=("$v")
  done < "$f"
  local i; for i in "${!ks[@]}"; do printf -v "${ks[$i]}" '%s' "${vs[$i]}"; done; }

# offsite_cfg_load FILE ⇒ إعدادُ الرفع (offsite.env أو offsite-pending.env): المستلمُ والوجهةُ صالحان.
#   CRED_FP (ADR 0301): بصمةُ اعتمادِ Drive الذي رُبطَ (cred_fp)، ويُنسَخُ إلى offsite.env عندَ التفعيل.
offsite_cfg_load(){ AGE_RECIPIENT=""; RCLONE_REMOTE=""; DRIVE_ROOT=""; LINK_ID=""; LINKED_AT=""; CRED_FP=""
  kv_load "$1" AGE_RECIPIENT RCLONE_REMOTE DRIVE_ROOT LINK_ID LINKED_AT CRED_FP || return 1
  [[ "$AGE_RECIPIENT" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] && [[ "$RCLONE_REMOTE" =~ ^[A-Za-z0-9_-]+$ ]] &&
    [[ "$DRIVE_ROOT" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$DRIVE_ROOT" != *..* ]] &&
    { [ -z "$LINK_ID" ] || [[ "$LINK_ID" =~ ^[0-9a-f]{32}$ ]]; } &&
    { [ -z "$CRED_FP" ] || [[ "$CRED_FP" =~ ^[0-9a-f]{64}$ ]]; } || { echo "state-reject bad_value ${1##*/}" >&2; return 1; }; }

# cred_fp [FILE [REMOTE]] ⇒ بصمةُ اعتمادِ القسمِ REMOTE (افتراضيّاً $RCLONE_REMOTE) في rclone.conf (ADR 0301): sha256 لمفاتيحِه
#   (عدا token) ولـrefresh_token. ليست سرّاً (تجزئةٌ لرمزٍ عالي العشوائيّة)، ولا تتغيّرُ بتجديدِ access_token؛ وأيُّ حسابٍ أو
#   عميلٍ أو وجهةٍ أخرى ⇒ بصمةٌ أخرى. (إن أصدرَ Google يوماً refresh_token جديداً فالليليُّ يتوقّفُ: credential_changed.)
cred_fp(){ "${OFFSITE_TOOL[@]}" cred-fp "${1:-$RCLONE_CONFIG_FILE}" "${2:-$RCLONE_REMOTE}"; }

# first_ok_load ⇒ سجلُّ أوّلِ رفعٍ ناجح (المرحلة ب). FO_MANIFEST_SHA256: بصمةُ البيانِ الموقَّعِ كما رُفعَ بالضبط.
first_ok_load(){ FO_LINK_ID=""; FO_TS=""; FO_NAME=""; FO_BYTES=""; FO_SHA256=""; FO_MANIFEST_SHA256=""; FO_RECIPIENT=""
  FO_REMOTE=""; FO_ROOT=""; FO_CRED_FP=""; FO_AT=""
  kv_load "$OFFSITE_FIRST_OK" FO_LINK_ID FO_TS FO_NAME FO_BYTES FO_SHA256 FO_MANIFEST_SHA256 FO_RECIPIENT FO_REMOTE FO_ROOT FO_CRED_FP FO_AT || return 1
  [[ "$FO_LINK_ID" =~ ^[0-9a-f]{32}$ ]] && [[ "$FO_TS" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [ "$FO_NAME" = "wasla-$FO_TS.tar.age" ] &&
    [[ "$FO_BYTES" =~ ^[1-9][0-9]*$ ]] && [[ "$FO_SHA256" =~ ^[0-9a-f]{64}$ ]] && [[ "$FO_MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]] &&
    [[ "$FO_CRED_FP" =~ ^[0-9a-f]{64}$ ]]; }

# write_state FILE ⇒ يكتبُ stdin إلى FILE ذرّيّاً (مؤقّتٌ 600 في المجلّدِ نفسِه، fsync، ثمّ mv). لا ملفَّ نصفَ مكتوب.
write_state(){ local f=$1 tmp; tmp=$(mktemp "$(dirname "$f")/.state-XXXXXX") || return 1
  chmod 600 "$tmp" && cat > "$tmp" && sync "$tmp" 2>/dev/null; mv -f "$tmp" "$f" || { rm -f "$tmp"; return 1; }; }

# offsite_lock ⇒ قفلٌ واحدٌ لكلِّ عمليّاتِ المراحل (الربطُ وأوّلُ رفعٍ والتفعيلُ والرفعُ الليليّ) على الواصف 9.
offsite_lock(){ exec 9> "$OFFSITE_LOCK" && flock -n 9 || { echo "offsite-busy عمليّةٌ أخرى للنسخِ خارجَ الموقعِ جارية" >&2; return 1; }; }

