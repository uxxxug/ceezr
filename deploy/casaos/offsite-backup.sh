#!/usr/bin/env bash
# الغرض: نسخةٌ خارجَ الموقعِ مشفّرةٌ بـage إلى Google Drive (ADR 0297 · WR-27).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-backup.sh (700، root)، ويستدعيه backup.sh
#   في آخرِه إن وُجدَ /etc/wasla/offsite.env. ويمكنُ تشغيلُه يدويّاً: offsite-backup.sh [TS].
#
# ما يحدث:
#   1) يجمعُ نسخةَ الطابعِ TS كلَّها (قاعدةُ التطبيق، أدوارُ المخزنِ وقاعدتُه وبايتاتُه وبيانُها، والإعداد)
#      مع MANIFEST.sha256، ويُحزَمُ tar ويُشفَّرُ **في الأنبوبِ نفسِه** بـage إلى المفتاحِ العامِّ وحدَه.
#      فلا يُكتَبُ أرشيفٌ مجمَّعٌ غيرُ مشفّر، ولا يُرفَعُ إلّا ملفٌّ يبدأُ بترويسةِ age.
#   2) يرفعُه إلى daily/، وفي يومِ الجمعةِ (بتوقيتِ الرياض) نسخةٌ إلى weekly/، وفي أوّلِ الشهرِ إلى monthly/.
#      النسخُ داخلَ Drive نفسِه (server-side copy).
#   3) يتحقّقُ بعدَ الرفع: md5 الذي يحسبُه Drive يساوي md5 المحلّيّ، ثمّ يُنزِّلُ الملفَّ كاملاً
#      ويقارنُ sha256. أيُّ اختلافٍ ⇒ فشل.
#   4) الاحتفاظ: daily 14 يوماً، weekly 8 أسابيع، monthly 12 شهراً. الحذفُ يذهبُ إلى سلّةِ Drive
#      (تُفرَّغُ وحدَها بعدَ 30 يوماً). ومحلّيّاً تبقى آخرُ 3 ملفّاتٍ مشفّرة.
#
# المفتاحُ الخاصُّ لـage **ليس على الخادمِ أبداً**؛ لا يستطيعُ هذا الخادمُ فكَّ ما يرفعُه.
# الأسرار: رمزُ Drive في /etc/wasla/rclone.conf (600 root) ولا يُطبَع. السجلُّ: journalctl -t wasla-offsite.
set -euo pipefail; umask 077
ENV=/etc/wasla/offsite.env; [ -f "$ENV" ] || { echo "offsite-skip no_config"; exit 0; }
# shellcheck disable=SC1090
. "$ENV"
: "${AGE_RECIPIENT:?}" "${RCLONE_REMOTE:?}" "${DRIVE_ROOT:?}"
BIN=/opt/wasla/bin; D=/var/backups/wasla; O=$D/offsite; install -d -m 700 "$O"
export RCLONE_CONFIG=/etc/wasla/rclone.conf
RC=("$BIN/rclone" --retries 5 --low-level-retries 10 -q)
log(){ logger -t wasla-offsite -- "$*"; echo "$*"; }

TS=${1:-$(ls -1 "$D"/waslah-*.dump 2>/dev/null | sed -nE 's#.*/waslah-(.*)\.dump$#\1#p' | sort | tail -1)}
[ -n "$TS" ] || { log "offsite-fail no_local_backup"; exit 1; }
cd "$D"
files=(); for f in "waslah-$TS.dump" "waslah-$TS.dump.sha256" "storage-roles-$TS.sql" "storage-db-$TS.dump" \
  "storage-db-$TS.dump.sha256" "storage-files-$TS.tar" "storage-files-$TS.tar.sha256" "storage-files-$TS.sha256" \
  "config-$TS.tgz"; do [ -f "$f" ] && files+=("$f"); done
for need in "waslah-$TS.dump" "config-$TS.tgz"; do [ -f "$need" ] || { log "offsite-fail missing=$need"; exit 1; }; done
# سلامةُ المصدرِ قبلَ التشفير.
for s in "waslah-$TS.dump.sha256" "storage-db-$TS.dump.sha256" "storage-files-$TS.tar.sha256"; do
  [ -f "$s" ] && sha256sum -c --quiet "$s"; done

STAGE=$(mktemp -d "$O/.stage-XXXXXX"); trap 'rm -rf "$STAGE"' EXIT
sha256sum "${files[@]}" > "$STAGE/MANIFEST.sha256"
NAME=wasla-$TS.tar.age; OUT=$O/$NAME
tar -cf - -C "$D" "${files[@]}" -C "$STAGE" MANIFEST.sha256 | "$BIN/age" -r "$AGE_RECIPIENT" -o "$OUT.part"
[ "$(head -c 21 "$OUT.part")" = "age-encryption.org/v1" ] || { log "offsite-fail not_age_output"; exit 1; }
mv "$OUT.part" "$OUT"
size=$(stat -c %s "$OUT"); md5=$(md5sum "$OUT" | cut -d' ' -f1); sha=$(sha256sum "$OUT" | cut -d' ' -f1)

R="$RCLONE_REMOTE:$DRIVE_ROOT"
"${RC[@]}" copyto "$OUT" "$R/daily/$NAME"
rmd5=$("${RC[@]}" md5sum "$R/daily/$NAME" | cut -d' ' -f1)
[ "$rmd5" = "$md5" ] || { log "offsite-fail md5_mismatch name=$NAME"; exit 1; }
rsha=$("${RC[@]}" cat "$R/daily/$NAME" | sha256sum | cut -d' ' -f1)
[ "$rsha" = "$sha" ] || { log "offsite-fail sha256_mismatch name=$NAME"; exit 1; }

tiers=daily
dow=$(TZ=Asia/Riyadh date +%u); dom=$(TZ=Asia/Riyadh date +%d)
if [ "$dow" = 5 ]; then "${RC[@]}" copyto "$R/daily/$NAME" "$R/weekly/$NAME"; tiers+=",weekly"; fi
if [ "$dom" = 01 ]; then "${RC[@]}" copyto "$R/daily/$NAME" "$R/monthly/$NAME"; tiers+=",monthly"; fi
# وأوّلُ رفعٍ على الإطلاقِ يملأُ weekly/monthly كي لا يبقيا فارغَين حتّى الجمعةِ أو أوّلِ الشهر.
for t in weekly monthly; do
  if [ -z "$("${RC[@]}" lsf "$R/$t" --files-only 2>/dev/null | head -1)" ]; then
    "${RC[@]}" copyto "$R/daily/$NAME" "$R/$t/$NAME"; tiers+=",$t(seed)"; fi; done

"${RC[@]}" delete "$R/daily" --min-age 15d --include 'wasla-*.tar.age'
"${RC[@]}" delete "$R/weekly" --min-age 57d --include 'wasla-*.tar.age'
"${RC[@]}" delete "$R/monthly" --min-age 366d --include 'wasla-*.tar.age'
ls -1t "$O"/wasla-*.tar.age | tail -n +4 | xargs -r rm -f

counts=$(for t in daily weekly monthly; do printf '%s=%s ' "$t" "$("${RC[@]}" lsf "$R/$t" --files-only --include 'wasla-*.tar.age' | wc -l)"; done)
printf '{"ts":"%s","name":"%s","bytes":%s,"sha256":"%s","md5":"%s","tiers":"%s","at":"%s"}\n' \
  "$TS" "$NAME" "$size" "$sha" "$md5" "$tiers" "$(date -u +%FT%TZ)" > "$O/last-ok.json"
log "offsite-ok name=$NAME bytes=$size sha256=${sha:0:16} drive_md5=ok drive_sha256=ok tiers=$tiers remote_counts: $counts"
