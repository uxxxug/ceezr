#!/usr/bin/env bash
# الغرض: ضبطٌ لمرّةٍ واحدةٍ للنسخةِ خارجَ الموقع (ADR 0297 · ADR 0298).
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-setup.sh (700، root).
# يُشغَّلُ من اللابتوب عبرَ wasla-offsite-connect.sh (حقيبةُ اللابتوب)، ولا يُشغَّلُ يدويّاً عادةً:
#   offsite-setup.sh --signing-key
#       يُنشئُ مفتاحَ التوقيعِ ed25519 للخادمِ إن غاب ($SIGNING_KEY، 600 root) ويطبعُ **العامَّ** وحدَه،
#       فيثبّتُه اللابتوبُ في ~/.wasla/allowed_signers. لا يُنسَخُ المفتاحُ الخاصُّ في أيِّ نسخةٍ أو أرشيف.
#   offsite-setup.sh --install age1… [--no-first-backup]  < قسمُ rclone.conf
#       يقرأُ قسمَ [wasla-gdrive] (client_id وclient_secret والرمز) من **stdin** — لا من سطرِ الأوامر —
#       ويتحقّقُ منه ويكتبُه ذرّيّاً في $RCLONE_CONFIG_FILE (600)، ثمّ offsite.env، ثمّ أوّلُ نسخة.
# الأسرار: لا تمرُّ في argv أيِّ عملية (لا `rclone config create`، ولا وسائطَ لبايثون)، ولا تُطبَعُ ولا تُسجَّل.
set -euo pipefail; umask 077
# shellcheck source=offsite-lib.sh
. "$(cd "$(dirname "$0")" && pwd)/offsite-lib.sh"
install -d -m 700 "$WASLA_ETC"
case "${1:-}" in
  --signing-key)
    if [ ! -s "$SIGNING_KEY" ]; then
      ssh-keygen -q -t ed25519 -N '' -C "$SIG_ID@$(hostname -s)" -f "$SIGNING_KEY" </dev/null >/dev/null
      chmod 600 "$SIGNING_KEY"; chmod 644 "$SIGNING_KEY.pub"; logger -t "$OFFSITE_LOG_TAG" -- "setup signing-key-created" 2>/dev/null || true
    fi
    # سطرٌ واحدٌ فقط: «ssh-ed25519 AAAA…» (بلا تعليق) — يقرؤه wasla-offsite-connect.sh.
    ssh-keygen -y -f "$SIGNING_KEY" | cut -d' ' -f1,2 ;;
  --install)
    PUB=${2:?"الاستعمال: offsite-setup.sh --install age1<المفتاح العامّ>"}
    [[ "$PUB" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "setup-FAIL مفتاحٌ عامٌّ غيرُ صالح (يبدأ بـage1 وطولُه 62)"; exit 2; }
    [ -s "$SIGNING_KEY" ] || { echo "setup-FAIL شغّلْ --signing-key أوّلاً"; exit 2; }
    [ -f "$RCLONE_CONFIG_FILE" ] && cp -a "$RCLONE_CONFIG_FILE" "$RCLONE_CONFIG_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    flag=(); [ "${WASLA_OFFSITE_TEST_ENDPOINTS:-}" = 1 ] && flag=(--allow-test-endpoints)
    "${OFFSITE_TOOL[@]}" rclone-section "$RCLONE_CONFIG_FILE" "${flag[@]}" || { echo "setup-FAIL قسمُ rclone مرفوض"; exit 2; }
    printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=wasla-gdrive\nDRIVE_ROOT=%s\n' "$PUB" "${DRIVE_ROOT:-WASLA-Backups}" > "$OFFSITE_ENV.part"
    chmod 600 "$OFFSITE_ENV.part"
    "$WASLA_BIN/rclone" -q --retries 1 --low-level-retries 2 --contimeout 20s --timeout 60s mkdir "wasla-gdrive:${DRIVE_ROOT:-WASLA-Backups}" 2>/dev/null ||
      { rm -f "$OFFSITE_ENV.part"; echo "setup-FAIL تعذّرَ الوصولُ إلى Drive بالرمزِ الجديد"; exit 1; }
    mv "$OFFSITE_ENV.part" "$OFFSITE_ENV"; chmod 600 "$RCLONE_CONFIG_FILE"
    olog "setup-ok remote=wasla-gdrive folder=${DRIVE_ROOT:-WASLA-Backups}"
    [ "${3:-}" = --no-first-backup ] && exit 0
    echo "أوّلُ نسخةٍ مشفّرةٍ الآن:"; "$(dirname "$0")/offsite-backup.sh" ;;
  *) echo "الاستعمال: offsite-setup.sh --signing-key | --install age1… [--no-first-backup]  < rclone-section"; exit 2 ;;
esac
