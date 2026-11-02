#!/usr/bin/env bash
# الغرض: ضبطُ النسخةِ خارجَ الموقعِ على ثلاثِ مراحلَ منفصلة (ADR 0300، يحلُّ محلَّ «--install» في ADR 0297/0298).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-setup.sh (700، root). تستدعيه سكربتاتُ حقيبةِ اللابتوب.
#   offsite-setup.sh --signing-key
#       يُنشئُ مفتاحَ التوقيعِ ed25519 للخادمِ إن غاب ($SIGNING_KEY، 600 root) ويطبعُ **العامَّ** وحدَه.
#   offsite-setup.sh --link age1…  < قسمُ rclone.conf                                   (المرحلة أ: الربطُ فقط)
#       يقرأُ قسمَ [wasla-gdrive] من **stdin** ويتحقّقُ منه، ثمّ يتحقّقُ من المصادقةِ بأمرِ قراءةٍ وحيد
#       (`rclone about`: حصّةُ الحساب) على ملفٍّ مرشَّح، وعندئذٍ فقط يستبدلُ $RCLONE_CONFIG_FILE ويكتبُ $OFFSITE_PENDING
#       بمعرّفِ ربطٍ جديد وبصمةِ الاعتماد (CRED_FP)، ويُبطِلُ أيَّ سجلِّ «أوّلِ رفعٍ» سابق. **لا يكتبُ offsite.env، ولا يرفعُ،
#       ولا ينشئُ مجلّداً في Drive.** ويُرفَضُ كلّيّاً ما دامَ الرفعُ الليليُّ مفعَّلاً (ADR 0301): لا يُقرأُ stdin ولا يتغيّرُ ملفّ؛
#       فاستبدالُ الاعتمادِ كان سيُحوِّلُ الرفعَ الليليَّ إلى الحسابِ الجديدِ دونَ موافقة. الترتيب: --disable-nightly ثمّ --link.
#   offsite-backup.sh --first                                                          (المرحلة ب: في سكربتِها)
#   offsite-setup.sh --enable-nightly TS                                               (المرحلة ج: التفعيل)
#       يرفضُ ما لم يوجدْ ربطٌ وسجلُّ أوّلِ رفعٍ ناجحٍ لهذا الربطِ والاعتمادِ نفسَيهما بالطابعِ TS نفسِه. ثمّ تحقّقٌ للقراءةِ
#       فقط من المجموعةِ الثلاثيّةِ في Drive (ADR 0301): الأسماءُ الثلاثةُ وحدَها، وsha256 للأرشيفِ كاملاً = FO_SHA256،
#       وsha256 للبيانِ = FO_MANIFEST_SHA256، وتوقيعُه صالحٌ بمفتاحِ الخادم (ssh-keygen -Y verify، الهويّةُ والنطاق)،
#       وحقولُه (الاسم، الطابع، الحجم، sha256، المستلم) تطابقُ السجلَّ والربط. ثمّ يكتبُ $OFFSITE_ENV ذرّيّاً (600).
#       وجودُه وحدَه يُشغِّلُ الرفعَ الليليّ.
#   offsite-setup.sh --disable-nightly   ⇒ يحذفُ $OFFSITE_ENV (النسخُ المحلّيُّ مستمرّ، والربطُ باقٍ).
#   offsite-setup.sh --status            ⇒ سطورُ key=value بلا أسرار: stage=unlinked|linked|first-ok|enabled.
# الأسرار: لا تمرُّ في argv أيِّ عمليّة، ولا تُطبَعُ ولا تُسجَّل. لا مرحلةَ تنفّذُ ما بعدَها ضمنيّاً.
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
install -d -m 700 "$WASLA_ETC"
RCQ=("$WASLA_BIN/rclone" -q --retries 1 --low-level-retries 2 --contimeout 20s --timeout 60s)

status(){ local stage=unlinked linked=no first=none nightly=off
  if [ -f "$RCLONE_CONFIG_FILE" ] && [ -f "$OFFSITE_PENDING" ] && offsite_cfg_load "$OFFSITE_PENDING" 2>/dev/null; then
    linked=yes; stage=linked
    if [ -f "$OFFSITE_FIRST_OK" ] && first_ok_load 2>/dev/null && [ "$FO_LINK_ID" = "$LINK_ID" ]; then first="$FO_TS"; stage="first-ok"; fi
  fi
  [ -f "$OFFSITE_ENV" ] && { nightly=on; stage=enabled; }
  printf 'stage=%s\nlinked=%s\nfirst_upload=%s\nnightly=%s\n' "$stage" "$linked" "$first" "$nightly"; }

case "${1:-}" in
  --signing-key)
    if [ ! -s "$SIGNING_KEY" ]; then
      ssh-keygen -q -t ed25519 -N '' -C "$SIG_ID@$(hostname -s)" -f "$SIGNING_KEY" </dev/null >/dev/null
      chmod 600 "$SIGNING_KEY"; chmod 644 "$SIGNING_KEY.pub"; logger -t "$OFFSITE_LOG_TAG" -- "setup signing-key-created" 2>/dev/null || true
    fi
    # سطرٌ واحدٌ فقط: «ssh-ed25519 AAAA…» (بلا تعليق) — يقرؤه wasla-offsite-connect.sh.
    ssh-keygen -y -f "$SIGNING_KEY" | cut -d' ' -f1,2 ;;

  --status) status ;;

  --link)
    PUB=${2:?"الاستعمال: offsite-setup.sh --link age1<المفتاح العامّ>  < rclone-section"}
    [ $# = 2 ] || { echo "link-FAIL وسائطُ زائدة"; exit 2; }
    [[ "$PUB" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "link-FAIL مفتاحٌ عامٌّ غيرُ صالح (يبدأ بـage1 وطولُه 62)"; exit 2; }
    [ -s "$SIGNING_KEY" ] || { echo "link-FAIL شغّلْ --signing-key أوّلاً"; exit 2; }
    offsite_lock || exit 1
    # ADR 0301: لا إعادةَ ربطٍ تحتَ رفعٍ ليليٍّ مفعَّل — يُفحَصُ تحتَ القفلِ وقبلَ قراءةِ أيِّ اعتماد.
    if [ -e "$OFFSITE_ENV" ] || [ -L "$OFFSITE_ENV" ]; then
      echo "link-FAIL nightly_enabled الرفعُ الليليُّ مفعَّل؛ إعادةُ الربطِ كانت ستغيّرُ حسابَ وجهتِه. لم يتغيّرْ شيء."
      echo "  عطّلْه أوّلاً (--disable-nightly)، ثمّ اربطْ، ثمّ أوّلُ رفعٍ جديد، ثمّ --enable-nightly."; exit 1; fi
    flag=(); [ "${WASLA_OFFSITE_TEST_ENDPOINTS:-}" = 1 ] && flag=(--allow-test-endpoints)
    CAND=$(mktemp "$WASLA_ETC/.rclone-link-XXXXXX"); trap 'rm -f "$CAND"' EXIT
    "${OFFSITE_TOOL[@]}" rclone-section "$CAND" "${flag[@]}" || { echo "link-FAIL قسمُ rclone مرفوض"; exit 2; }
    # التحقّقُ من المصادقةِ والوصولِ إلى الحساب: about يقرأُ الحصّةَ فقط — لا يكتبُ ولا ينشئُ مجلّداً.
    "${RCQ[@]}" --config "$CAND" about --json wasla-gdrive: > /dev/null 2>&1 ||
      { echo "link-FAIL تعذّرَ التحقّقُ من الحسابِ بالرمزِ الجديد (لم يتغيّرْ شيءٌ على الخادم)"; exit 1; }
    chmod 600 "$CAND"
    FP=$(cred_fp "$CAND" wasla-gdrive) && [[ "$FP" =~ ^[0-9a-f]{64}$ ]] || { echo "link-FAIL تعذّرَ حسابُ بصمةِ الاعتماد (لم يتغيّرْ شيء)"; exit 1; }
    [ -f "$RCLONE_CONFIG_FILE" ] && cp -a "$RCLONE_CONFIG_FILE" "$RCLONE_CONFIG_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    mv -f "$CAND" "$RCLONE_CONFIG_FILE"; trap - EXIT
    LID=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
    printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=wasla-gdrive\nDRIVE_ROOT=%s\nLINK_ID=%s\nLINKED_AT=%s\nCRED_FP=%s\n' \
      "$PUB" "${DRIVE_ROOT:-WASLA-Backups}" "$LID" "$(date -u +%Y%m%dT%H%M%SZ)" "$FP" | write_state "$OFFSITE_PENDING"
    rm -f "$OFFSITE_FIRST_OK"   # ربطٌ جديد ⇒ أوّلُ رفعٍ جديدٌ قبلَ أيِّ تفعيل
    olog "setup link-ok remote=wasla-gdrive folder=${DRIVE_ROOT:-WASLA-Backups} uploads=0"
    echo "الحساب مربوطٌ فقط: لم يُرفَعْ شيء، والرفعُ الليليُّ غيرُ مفعَّل."
    status ;;

  --enable-nightly)
    WANT=${2:-}; [[ "$WANT" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] && [ $# = 2 ] ||
      { echo "enable-FAIL الاستعمال: offsite-setup.sh --enable-nightly <طابعُ أوّلِ رفع>"; exit 2; }
    offsite_lock || exit 1
    [ -f "$RCLONE_CONFIG_FILE" ] || { echo "enable-FAIL not_linked"; exit 1; }
    offsite_cfg_load "$OFFSITE_PENDING" || { echo "enable-FAIL not_linked"; exit 1; }
    [ -n "$LINK_ID" ] && [ -n "$CRED_FP" ] || { echo "enable-FAIL not_linked"; exit 1; }
    [ "$(cred_fp 2>/dev/null)" = "$CRED_FP" ] || { echo "enable-FAIL credential_changed (اعتمادُ Drive ليس الذي رُبط؛ أعِدِ الربط)"; exit 1; }
    [ -f "$OFFSITE_FIRST_OK" ] || { echo "enable-FAIL no_first_upload شغّلْ أوّلَ رفعٍ يدويٍّ أوّلاً"; exit 1; }
    first_ok_load || { echo "enable-FAIL first_upload_record_invalid"; exit 1; }
    [ "$FO_LINK_ID" = "$LINK_ID" ] && [ "$FO_RECIPIENT" = "$AGE_RECIPIENT" ] && [ "$FO_REMOTE" = "$RCLONE_REMOTE" ] &&
      [ "$FO_ROOT" = "$DRIVE_ROOT" ] && [ "$FO_CRED_FP" = "$CRED_FP" ] || { echo "enable-FAIL first_upload_for_other_link"; exit 1; }
    [ "$FO_TS" = "$WANT" ] || { echo "enable-FAIL ts_mismatch (آخرُ أوّلِ رفعٍ ناجح: $FO_TS)"; exit 1; }
    [ -s "$SIGNING_KEY" ] || { echo "enable-FAIL no_signing_key"; exit 1; }
    # ADR 0301: تحقّقٌ كاملٌ للقراءةِ فقط من المجموعةِ الثلاثيّة كما هي الآن في Drive، قبلَ أيِّ كتابة.
    R="$RCLONE_REMOTE:$DRIVE_ROOT/daily"; MN="wasla-$FO_TS.manifest"
    got=$("${RCQ[@]}" lsf "$R" --files-only --format ps --separator ' ' --include "wasla-$FO_TS.*" 2>/dev/null | sort) ||
      { echo "enable-FAIL drive_unreachable"; exit 1; }
    want=$(printf '%s\n' "$MN" "$MN.sig" "$FO_NAME")
    [ "$(printf '%s\n' "$got" | cut -d' ' -f1)" = "$want" ] && printf '%s\n' "$got" | grep -qxF "$FO_NAME $FO_BYTES" ||
      { echo "enable-FAIL first_upload_missing_on_drive"; exit 1; }
    # 1) الأرشيفُ المشفّر: تنزيلٌ كاملٌ إلى sha256 (لا يُحفَظُ على القرص).
    csha=$("${RCQ[@]}" cat "$R/$FO_NAME" 2>/dev/null | sha256sum | cut -d' ' -f1) || { echo "enable-FAIL drive_unreachable"; exit 1; }
    [ "$csha" = "$FO_SHA256" ] || { echo "enable-FAIL ciphertext_mismatch (الأرشيفُ في Drive ليس الذي رُفعَ وتحقّق)"; exit 1; }
    # 2) البيانُ وتوقيعُه: إلى مجلّدٍ مؤقّتٍ 700، بحدٍّ أقصى للحجم.
    V=$(mktemp -d "$WASLA_ETC/.enable-verify-XXXXXX"); trap 'rm -rf "$V"' EXIT
    "${RCQ[@]}" cat "$R/$MN" 2>/dev/null | head -c 8193 > "$V/m" && "${RCQ[@]}" cat "$R/$MN.sig" 2>/dev/null | head -c 8193 > "$V/s" ||
      { echo "enable-FAIL drive_unreachable"; exit 1; }
    [ "$(stat -c %s "$V/m")" -le 4096 ] && [ "$(stat -c %s "$V/s")" -le 8192 ] || { echo "enable-FAIL manifest_mismatch too_large"; exit 1; }
    [ "$(sha256sum < "$V/m" | cut -d' ' -f1)" = "$FO_MANIFEST_SHA256" ] ||
      { echo "enable-FAIL manifest_mismatch (البيانُ في Drive ليس الذي وُقِّعَ عندَ أوّلِ رفع)"; exit 1; }
    printf '%s namespaces="%s" %s\n' "$SIG_ID" "$SIG_NS" "$(ssh-keygen -y -f "$SIGNING_KEY" | cut -d' ' -f1,2)" > "$V/allowed"
    ssh-keygen -Y verify -f "$V/allowed" -I "$SIG_ID" -n "$SIG_NS" -s "$V/s" < "$V/m" >/dev/null 2>&1 ||
      { echo "enable-FAIL manifest_signature_invalid"; exit 1; }
    mf(){ "${OFFSITE_TOOL[@]}" manifest-get "$V/m" "$1" "$FO_NAME" 2>/dev/null; }
    [ "$(mf ts)" = "$FO_TS" ] && [ "$(mf ciphertext_bytes)" = "$FO_BYTES" ] && [ "$(mf ciphertext_sha256)" = "$FO_SHA256" ] &&
      [ "$(mf age_recipient)" = "$AGE_RECIPIENT" ] || { echo "enable-FAIL manifest_mismatch (حقولُ البيانِ لا تطابقُ السجلَّ والربط)"; exit 1; }
    rm -rf "$V"; trap - EXIT
    BODY=$(printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=%s\nDRIVE_ROOT=%s\nLINK_ID=%s\nCRED_FP=%s\n' "$AGE_RECIPIENT" "$RCLONE_REMOTE" "$DRIVE_ROOT" "$LINK_ID" "$CRED_FP")
    if [ -f "$OFFSITE_ENV" ]; then
      [ "$(cat "$OFFSITE_ENV")" = "$BODY" ] && { echo "enable-ok already_enabled"; status; exit 0; }
      echo "enable-FAIL enabled_with_other_config (عطّلْه بـ--disable-nightly أوّلاً)"; exit 1
    fi
    printf '%s\n' "$BODY" | write_state "$OFFSITE_ENV"
    offsite_cfg_load "$OFFSITE_ENV" || { rm -f "$OFFSITE_ENV"; echo "enable-FAIL written_file_invalid"; exit 1; }
    olog "setup nightly-enabled first_upload=$FO_TS"
    echo "enable-ok الرفعُ الليليُّ مفعَّلٌ من الليلةِ القادمة (backup.sh)"; status ;;

  --disable-nightly)
    offsite_lock || exit 1
    if [ -f "$OFFSITE_ENV" ]; then rm -f "$OFFSITE_ENV"; olog "setup nightly-disabled"; fi
    echo "disable-ok"; status ;;

  --install)
    echo "setup-FAIL --install أُزيل (ADR 0300): الربطُ وأوّلُ رفعٍ والتفعيلُ مراحلُ منفصلة. لم يتغيّرْ شيء."
    echo "  --link age1…  ثمّ  offsite-backup.sh --first  ثمّ  --enable-nightly TS"; exit 2 ;;

  *) echo "الاستعمال: offsite-setup.sh --signing-key | --status | --link age1… < rclone-section | --enable-nightly TS | --disable-nightly"; exit 2 ;;
esac
