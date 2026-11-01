#!/usr/bin/env bash
# الغرض: يُخرِجُ إلى stdout نسخةً مشفّرةً كما هي في Google Drive (ADR 0297) — لتُفَكَّ على اللابتوب.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-fetch.sh (700، root).
# الاستعمال: offsite-fetch.sh            ⇒ أحدثُ نسخةٍ في daily/
#            offsite-fetch.sh --list     ⇒ قائمةُ النسخِ في الطبقاتِ الثلاث (الاسم والحجم وmd5)
#            offsite-fetch.sh TIER/NAME  ⇒ نسخةٌ بعينِها، مثل weekly/wasla-20261101T033424Z.tar.age
# لا يفكُّ شيئاً، والملفُّ المُخرَجُ مشفّر؛ ويتحقّقُ أنّ ما أُخرِجَ يساوي md5 الذي يحفظُه Drive.
set -euo pipefail; umask 077
. /etc/wasla/offsite.env; export RCLONE_CONFIG=/etc/wasla/rclone.conf
RC=(/opt/wasla/bin/rclone --retries 5 -q); R="$RCLONE_REMOTE:$DRIVE_ROOT"
if [ "${1:-}" = --list ]; then
  for t in daily weekly monthly; do "${RC[@]}" lsf "$R/$t" --files-only --format pst --separator ' ' | sed "s#^#$t/#"; done; exit 0; fi
P=${1:-daily/$("${RC[@]}" lsf "$R/daily" --files-only --include 'wasla-*.tar.age' | sort | tail -1)}
case "$P" in daily/wasla-*.tar.age|weekly/wasla-*.tar.age|monthly/wasla-*.tar.age) ;; *) echo "bad name" >&2; exit 2;; esac
want=$("${RC[@]}" md5sum "$R/$P" | cut -d' ' -f1)
T=$(mktemp); trap 'rm -f "$T"' EXIT
"${RC[@]}" cat "$R/$P" | tee "$T"
got=$(md5sum "$T" | cut -d' ' -f1)
[ "$got" = "$want" ] && echo "fetch-ok $P drive_md5=match" >&2 || { echo "fetch-FAIL $P md5_mismatch" >&2; exit 1; }
