#!/usr/bin/env bash
# الغرض: نسخةٌ خارجَ الموقعِ مشفّرةٌ بـage وموقَّعةُ المصدر إلى Google Drive (ADR 0297 · ADR 0298 · WR-27).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-backup.sh (700، root)، ويستدعيه backup.sh
#   في آخرِه بـ«--nightly TS» — ولا يرفعُ في هذا الوضعِ إلّا إن وُجدَ /etc/wasla/offsite.env (المرحلة ج، ADR 0300).
#   offsite-backup.sh [--nightly] [TS]  ⇒ الرفعُ الليليّ: بلا offsite.env ⇒ offsite-skip no_config ولا شيءَ آخر.
#   offsite-backup.sh --first [TS]      ⇒ المرحلة ب: أوّلُ رفعٍ يدويٍّ واحدٍ بإعدادِ الربط (offsite-pending.env)،
#       يرفضُ إن كان الليليُّ مفعَّلاً، ويرفعُ إلى daily/ فقط (3 ملفّات؛ لا weekly/monthly ولا حذفَ بعيد)، وعند نجاحِه
#       وحدَه يكتبُ سجلَّ offsite-first-ok. **لا يكتبُ offsite.env أبداً**؛ التفعيلُ أمرٌ منفصل (offsite-setup.sh --enable-nightly).
#
# ما يحدث:
#   1) يجمعُ نسخةَ الطابعِ TS (قاعدةُ التطبيقِ وrowstats، والمخزنُ إن وُجد، والإعداد) مع MANIFEST.sha256،
#      ويُحزَمُ tar ويُشفَّرُ **في الأنبوبِ نفسِه** بـage إلى المفتاحِ العامِّ وحدَه.
#   2) بيانٌ خارجيٌّ wasla-TS.manifest (بلا بيانات: الاسم والطابع وsha256 للنصِّ المشفّرِ وحجمُه وsha256
#      لـMANIFEST الداخليّ والمستلم) يُوقَّعُ بمفتاحِ التوقيعِ الخاصِّ بالخادم (ssh-keygen -Y sign،
#      النطاق wasla-offsite-backup) ⇒ wasla-TS.manifest.sig. التوقيعُ يثبتُ المصدر؛ التشفيرُ يحمي السرّيّة.
#   3) يرفعُ النصَّ المشفّرَ أوّلاً ثمّ البيانَ والتوقيع إلى daily/، ويتحقّقُ من كلٍّ منها: md5 الذي يحسبُه
#      Drive ثمّ تنزيلٌ كاملٌ وsha256. وفي الجمعةِ (الرياض) نسخةٌ إلى weekly/، وفي أوّلِ الشهرِ إلى monthly/.
#   4) الاحتفاظ: daily 14 يوماً، weekly 8 أسابيع، monthly 12 شهراً (للملفّاتِ الثلاثةِ معاً). محلّيّاً آخرُ 3.
#   الفشل: أيُّ خطوةٍ تفشلُ تُسجِّلُ offsite-fail stage=<الخطوة>، وتُحذَفُ الملفّاتُ البعيدةُ التي رُفعت
#      في هذا التشغيلِ (أفضلُ جهد) والملفّاتُ المؤقّتة، ويخرجُ برمزٍ غيرِ صفريّ.
#
# المفتاحُ الخاصُّ لـage **ليس على الخادمِ أبداً**؛ لا يستطيعُ هذا الخادمُ فكَّ ما يرفعُه.
# الأسرار: رمزُ Drive في /etc/wasla/rclone.conf (600 root) ولا يُطبَع. السجلُّ: journalctl -t wasla-offsite.
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
MODE=nightly
case "${1:-}" in --first) MODE=first; shift;; --nightly) shift;; esac
[ $# -le 1 ] || { echo "الاستعمال: offsite-backup.sh [--nightly|--first] [TS]" >&2; exit 2; }
if [ "$MODE" = nightly ]; then
  [ -f "$OFFSITE_ENV" ] || { echo "offsite-skip no_config"; exit 0; }
  offsite_lock || exit 1
  offsite_cfg_load "$OFFSITE_ENV" || { olog "offsite-fail stage=config_rejected"; exit 1; }
else
  offsite_lock || exit 1
  [ ! -f "$OFFSITE_ENV" ] || { echo "first-FAIL nightly_already_enabled (الرفعُ الليليُّ مفعَّل؛ لا حاجةَ لأوّلِ رفع)"; exit 1; }
  [ -f "$RCLONE_CONFIG_FILE" ] && [ -f "$OFFSITE_PENDING" ] || { echo "first-FAIL not_linked (اربطْ Drive أوّلاً)"; exit 1; }
  offsite_cfg_load "$OFFSITE_PENDING" && [ -n "$LINK_ID" ] || { echo "first-FAIL link_record_invalid"; exit 1; }
  rm -f "$OFFSITE_FIRST_OK"   # لا يبقى سجلٌّ قديمٌ إن فشلَ هذا التشغيل
fi
D=$BACKUP_DIR; O=$D/offsite; install -d -m 700 "$O"
RC=("$WASLA_BIN/rclone" --retries "${OFFSITE_RETRIES:-5}" --low-level-retries "${OFFSITE_LL_RETRIES:-10}" -q)
R="$RCLONE_REMOTE:$DRIVE_ROOT"
ST=init; STAGE=""; UPLOADED=()
on_exit(){
  rc=$?
  if [ "$rc" != 0 ]; then
    olog "offsite-fail stage=$ST mode=$MODE rc=$rc"
    for u in "${UPLOADED[@]}"; do "${RC[@]}" --retries 1 deletefile "$u" >/dev/null 2>&1 || true; done
    rm -f "$O"/*.part
  fi
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  exit "$rc"
}
trap on_exit EXIT
# أخطاءُ rclone تُكتَبُ مختصرةً إلى stderr (اسمُ الخطوةِ يكفي للتشخيص) — ولا يطبعُ rclone الرمزَ أبداً.
rc_q(){ "${RC[@]}" "$@" 2> >(sed -E 's/(refresh_token|access_token|client_secret)[^ ,}]*/\1=<redacted>/g' >&2); }

ST=select
TS=${1:-$(ls -1 "$D"/waslah-*.dump 2>/dev/null | sed -nE 's#.*/waslah-(.*)\.dump$#\1#p' | sort | tail -1)}
[[ "$TS" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { olog "offsite-fail no_local_backup"; exit 1; }
[ -s "$SIGNING_KEY" ] || { ST=no_signing_key; exit 1; }
cd "$D"
files=(); for f in "waslah-$TS.dump" "waslah-$TS.dump.sha256" "waslah-$TS.rowstats" "storage-roles-$TS.sql" \
  "storage-db-$TS.dump" "storage-db-$TS.dump.sha256" "storage-db-$TS.rowstats" "storage-files-$TS.tar" \
  "storage-files-$TS.tar.sha256" "storage-files-$TS.sha256" "config-$TS.tgz"; do [ -f "$f" ] && files+=("$f"); done
ST=missing_local; [ -f "waslah-$TS.dump" ] && [ -f "waslah-$TS.dump.sha256" ] && [ -f "config-$TS.tgz" ] || exit 1
[ -f "waslah-$TS.rowstats" ] || olog "offsite-warn no_rowstats ts=$TS (تمرينُ الاستعادةِ سيكونُ INCONCLUSIVE)"
ST=source_integrity
for s in "waslah-$TS.dump.sha256" "storage-db-$TS.dump.sha256" "storage-files-$TS.tar.sha256"; do
  if [ -f "$s" ]; then sha_ok "${s%.sha256}"; fi; done

ST=encrypt
STAGE=$(mktemp -d "$O/.stage-XXXXXX")
sha256sum "${files[@]}" > "$STAGE/MANIFEST.sha256"
inner=$(sha256sum "$STAGE/MANIFEST.sha256" | cut -d' ' -f1)
NAME=wasla-$TS.tar.age; OUT=$O/$NAME; MAN=$O/wasla-$TS.manifest
tar -cf - -C "$D" "${files[@]}" -C "$STAGE" MANIFEST.sha256 | "$WASLA_BIN/age" -r "$AGE_RECIPIENT" -o "$OUT.part"
[ "$(head -c 21 "$OUT.part")" = "age-encryption.org/v1" ] || { ST=not_age_output; exit 1; }
mv "$OUT.part" "$OUT"
size=$(stat -c %s "$OUT"); sha=$(sha256sum "$OUT" | cut -d' ' -f1)

ST=sign
printf 'format=wasla-offsite-v1\nname=%s\nts=%s\ncreated_at=%s\nciphertext_bytes=%s\nciphertext_sha256=%s\ninner_manifest_sha256=%s\nage_recipient=%s\n' \
  "$NAME" "$TS" "$(date -u +%FT%TZ)" "$size" "$sha" "$inner" "$AGE_RECIPIENT" > "$MAN.part"
"${OFFSITE_TOOL[@]}" manifest-get "$MAN.part" name "$NAME" >/dev/null
rm -f "$MAN.part.sig"
ssh-keygen -q -Y sign -f "$SIGNING_KEY" -n "$SIG_NS" "$MAN.part" 2>/dev/null
mv "$MAN.part" "$MAN"; mv "$MAN.part.sig" "$MAN.sig"
ssh-keygen -Y check-novalidate -n "$SIG_NS" -s "$MAN.sig" < "$MAN" >/dev/null 2>&1

# رفعٌ ثمّ تحقّقٌ مزدوجٌ لكلِّ ملفّ: md5 الذي يحسبُه Drive، ثمّ تنزيلٌ كاملٌ وsha256.
put(){ # put LOCAL REMOTE_PATH
  local l=$1 r=$2 m s
  ST="upload:${r##*/}"; rc_q copyto "$l" "$r"; UPLOADED+=("$r")
  ST="verify_md5:${r##*/}"; m=$(rc_q md5sum "$r" | cut -d' ' -f1)
  [ "$m" = "$(md5sum "$l" | cut -d' ' -f1)" ]
  ST="verify_sha256:${r##*/}"; s=$(rc_q cat "$r" | sha256sum | cut -d' ' -f1)
  [ "$s" = "$(sha256sum "$l" | cut -d' ' -f1)" ]
}
put "$OUT" "$R/daily/$NAME"; put "$MAN" "$R/daily/wasla-$TS.manifest"; put "$MAN.sig" "$R/daily/wasla-$TS.manifest.sig"

tiers=daily
if [ "$MODE" = first ]; then
  # المرحلة ب: ملفّاتُ daily الثلاثةُ تحقّقت ⇒ سجلُّ أوّلِ رفعٍ مربوطٌ بهذا الربط. لا طبقاتٍ ولا حذفَ بعيد.
  ST=record
  printf 'FO_LINK_ID=%s\nFO_TS=%s\nFO_NAME=%s\nFO_BYTES=%s\nFO_SHA256=%s\nFO_RECIPIENT=%s\nFO_REMOTE=%s\nFO_ROOT=%s\nFO_AT=%s\n' \
    "$LINK_ID" "$TS" "$NAME" "$size" "$sha" "$AGE_RECIPIENT" "$RCLONE_REMOTE" "$DRIVE_ROOT" "$(date -u +%Y%m%dT%H%M%SZ)" |
    write_state "$OFFSITE_FIRST_OK"
  UPLOADED=()
  for old in $(ls -1t "$O"/wasla-*.tar.age | tail -n +4); do rm -f "$old" "${old%.tar.age}.manifest" "${old%.tar.age}.manifest.sig"; done
  ST="done"
  olog "offsite-first-ok name=$NAME bytes=$size sha256=${sha:0:16} signed=yes drive_md5=ok drive_sha256=ok tiers=daily nightly=off"
  echo "first-ok ts=$TS name=$NAME bytes=$size files=3 nightly=off"
  echo "للتفعيل لاحقاً (خطوةٌ منفصلة): offsite-setup.sh --enable-nightly $TS"
  exit 0
fi
ST=tiers
cp_tier(){ for x in "$NAME" "wasla-$TS.manifest" "wasla-$TS.manifest.sig"; do
  rc_q copyto "$R/daily/$x" "$R/$1/$x"; UPLOADED+=("$R/$1/$x"); done; }
dow=$(TZ=Asia/Riyadh date +%u); dom=$(TZ=Asia/Riyadh date +%d)
if [ "$dow" = 5 ]; then cp_tier weekly; tiers+=",weekly"; fi
if [ "$dom" = 01 ]; then cp_tier monthly; tiers+=",monthly"; fi
# وأوّلُ رفعٍ على الإطلاقِ يملأُ weekly/monthly كي لا يبقيا فارغَين حتّى الجمعةِ أو أوّلِ الشهر.
for t in weekly monthly; do
  case ",$tiers," in *",$t,"*) continue;; esac
  if [ -z "$(rc_q lsf "$R/$t" --files-only --include 'wasla-*.tar.age' 2>/dev/null | head -1)" ]; then
    cp_tier "$t"; tiers+=",$t(seed)"; fi; done
# النسخةُ اكتملت؛ لا يُحذَفُ ما رُفعَ إن فشلَ ما بعدَها.
UPLOADED=()

ST=retention
inc=(--include 'wasla-*.tar.age' --include 'wasla-*.manifest' --include 'wasla-*.manifest.sig')
rc_q delete "$R/daily" --min-age 15d "${inc[@]}"
rc_q delete "$R/weekly" --min-age 57d "${inc[@]}"
rc_q delete "$R/monthly" --min-age 366d "${inc[@]}"
for old in $(ls -1t "$O"/wasla-*.tar.age | tail -n +4); do rm -f "$old" "${old%.tar.age}.manifest" "${old%.tar.age}.manifest.sig"; done

ST=report
counts=$(for t in daily weekly monthly; do printf '%s=%s ' "$t" "$(rc_q lsf "$R/$t" --files-only --include 'wasla-*.tar.age' | wc -l)"; done)
printf '{"ts":"%s","name":"%s","bytes":%s,"sha256":"%s","tiers":"%s","signed":true,"at":"%s"}\n' \
  "$TS" "$NAME" "$size" "$sha" "$tiers" "$(date -u +%FT%TZ)" > "$O/last-ok.json"
ST="done"
olog "offsite-ok name=$NAME bytes=$size sha256=${sha:0:16} signed=yes drive_md5=ok drive_sha256=ok tiers=$tiers remote_counts: $counts"
