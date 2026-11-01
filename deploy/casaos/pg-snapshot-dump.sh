#!/usr/bin/env bash
# الغرض: pg_dump وإحصاءُ صفوفِه من **اللقطةِ نفسِها** (ADR 0298 §1) — فيُقارَنُ المستعادُ بما كانت عليه
#   القاعدةُ لحظةَ النسخ، لا بالإنتاجِ الذي تغيّرَ بعدَها.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/pg-snapshot-dump.sh (700، root)، ويستدعيه backup.sh.
# الاستعمال: pg-snapshot-dump.sh CONTAINER DB OUT.dump OUT.rowstats
# الطريقة: جلسةُ psql مفتوحة (coproc) تبدأُ معاملةً REPEATABLE READ READ ONLY وتصدّرُ لقطتَها
#   (pg_export_snapshot)، فيأخذُ pg_dump --snapshot اللقطةَ نفسَها، ثمّ تحسبُ الجلسةُ نفسُها — والمعاملةُ
#   ما زالت مفتوحة — لكلِّ جدولٍ عددَ صفوفِه وبصمةَ محتواه. ثمّ COMMIT. الكتابةُ المتزامنةُ لا تؤثّر.
# الفشل: أيُّ خطأٍ يحذفُ الملفّاتِ الجزئيّةَ ويُنهي الجلسة، ورمزُ الخروجِ غيرُ صفريّ.
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
C=${1:?container}; DB=${2:?db}; OUT=${3:?out.dump}; STATS=${4:?out.rowstats}
P_PID=""
cleanup(){ rc=$?; [ -n "$P_PID" ] && kill "$P_PID" 2>/dev/null; [ "$rc" = 0 ] || rm -f "$OUT.part" "$STATS.part"; }
trap cleanup EXIT
coproc PSQL { docker exec -i "$C" psql -U postgres -d "$DB" -AtqX -v ON_ERROR_STOP=1 2>&1; }
P_PID=$PSQL_PID
send(){ printf '%s\n' "$@" >&"${PSQL[1]}"; }
send "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" "SELECT pg_export_snapshot();"
IFS= read -r -t 30 SNAP <&"${PSQL[0]}" || { echo "snapshot-fail no_reply" >&2; exit 1; }
[[ "$SNAP" =~ ^[0-9A-F]+-[0-9A-F]+-[0-9]+$ ]] || { echo "snapshot-fail bad_reply" >&2; exit 1; }
docker exec "$C" pg_dump -U postgres -d "$DB" -Fc -Z 6 --snapshot="$SNAP" > "$OUT.part"
docker exec -i "$C" pg_restore -l < "$OUT.part" > /dev/null
# للاختبارِ وحدَه (tests/offsite-selftest.sh): كتابةٌ إلى القاعدةِ بينَ pg_dump وrowstats لإثباتِ أنّهما من اللقطةِ نفسِها.
if [ -n "${PG_SNAPSHOT_TEST_HOOK:-}" ]; then bash -c "$PG_SNAPSHOT_TEST_HOOK"; fi
{ printf '# wasla-rowstats-v1 db=%s\n' "$DB"; } > "$STATS.part"
# ملاحظة: لا أنبوبَ هنا — bash يغلقُ واصفاتِ coproc في الأصدافِ الفرعيّة.
rowstats_sql >&"${PSQL[1]}"
send "SELECT 'WASLA-ROWSTATS-END';"
n=0
while IFS= read -r -t 600 l <&"${PSQL[0]}"; do
  [ "$l" = WASLA-ROWSTATS-END ] && { n=-1; break; }
  [[ "$l" == *$'\t'*$'\t'* ]] || { echo "rowstats-fail unexpected_output" >&2; exit 1; }
  printf '%s\n' "$l" >> "$STATS.part"; n=$((n+1))
done
[ "$n" = -1 ] || { echo "rowstats-fail truncated" >&2; exit 1; }
send "COMMIT;" '\q'; wait "$P_PID" 2>/dev/null || true; P_PID=""
mv "$OUT.part" "$OUT"; mv "$STATS.part" "$STATS"
echo "snapshot-dump-ok db=$DB tables=$(grep -vc '^#' "$STATS")"
