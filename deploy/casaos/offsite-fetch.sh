#!/usr/bin/env bash
# الغرض: يُخرِجُ إلى stdout ملفّاً من نسخِ Google Drive كما هو (ADR 0297 · ADR 0298) — ليُتحقَّقَ منه ويُفَكَّ على اللابتوب.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-fetch.sh (700، root).
# الاستعمال: offsite-fetch.sh --list                 ⇒ الملفّاتُ في الطبقاتِ الثلاث (المسار والحجم وmd5)
#            offsite-fetch.sh latest                 ⇒ مسارُ أحدثِ نسخةٍ يوميّة (daily/wasla-TS.tar.age)
#            offsite-fetch.sh get TIER/wasla-TS.(tar.age|manifest|manifest.sig)
# get: يُنزِّلُ الملفَّ **كاملاً** إلى ملفٍّ مؤقّتٍ (مجلّد 700)، ويطابقُ md5 الذي يحفظُه Drive، وعندئذٍ فقط
#   يُخرِجُه، ثمّ يحذفُ المؤقّت. لا يُخرَجُ شيءٌ من تنزيلٍ ناقصٍ أو مختلف. لا يفكُّ شيئاً.
#   التحقّقُ من sha256 والتوقيعِ يجري على اللابتوب مقابلَ البيانِ الموقَّع (wasla-offsite-restore-test.sh).
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
[ -f "$OFFSITE_ENV" ] || { echo "fetch-fail no_config" >&2; exit 1; }
# shellcheck disable=SC1090
. "$OFFSITE_ENV"
RC=("$WASLA_BIN/rclone" --retries "${OFFSITE_RETRIES:-5}" -q); R="$RCLONE_REMOTE:$DRIVE_ROOT"
case "${1:-}" in
  --list)
    for t in daily weekly monthly; do "${RC[@]}" lsf "$R/$t" --files-only --format pst --separator ' ' | sed "s#^#$t/#"; done ;;
  latest)
    n=$("${RC[@]}" lsf "$R/daily" --files-only --include 'wasla-*.tar.age' | sort | tail -1)
    [ -n "$n" ] || { echo "fetch-fail no_remote_backup" >&2; exit 1; }
    echo "daily/$n" ;;
  get)
    P=${2:-}
    [[ "$P" =~ $NAME_RE ]] || { echo "fetch-fail bad_name" >&2; exit 2; }
    T=$(mktemp -d "${FETCH_TMP:-$BACKUP_DIR}/.fetch-XXXXXX"); trap 'rm -rf "$T"' EXIT
    want=$("${RC[@]}" md5sum "$R/$P" | cut -d' ' -f1)
    [[ "$want" =~ ^[0-9a-f]{32}$ ]] || { echo "fetch-fail no_remote_md5 $P" >&2; exit 1; }
    "${RC[@]}" cat "$R/$P" > "$T/f" || { echo "fetch-fail download $P" >&2; exit 1; }
    got=$(md5sum "$T/f" | cut -d' ' -f1)
    [ "$got" = "$want" ] || { echo "fetch-fail md5_mismatch $P" >&2; exit 1; }
    cat "$T/f"
    echo "fetch-ok $P bytes=$(stat -c %s "$T/f") drive_md5=match" >&2 ;;
  *) echo "الاستعمال: offsite-fetch.sh --list | latest | get TIER/NAME" >&2; exit 2 ;;
esac
