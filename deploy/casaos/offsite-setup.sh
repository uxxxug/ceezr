#!/usr/bin/env bash
# الغرض: ضبطٌ لمرّةٍ واحدةٍ للنسخةِ خارجَ الموقع (ADR 0297): مفتاحُ age العامّ + ربطُ Google Drive.
# ينتمي إلى: deploy/casaos — يُثبَّتُ في /opt/wasla/offsite-setup.sh (700، root).
# يُشغَّلُ من اللابتوب عبرَ deploy/casaos/laptop/wasla-offsite-connect.sh، ولا يُشغَّلُ يدويّاً عادةً:
#   printf '%s\n%s\n%s\n' CLIENT_ID CLIENT_SECRET AUTHORIZE_OUTPUT | ssh wasla 'sudo /opt/wasla/offsite-setup.sh age1...'
#   السطرُ الثالث: ما يطبعُه `rclone authorize drive <blob>` بينَ «--->» و«<---End paste»
#   (كتلةٌ base64 لخريطةٍ فيها token، أو JSON الرمزِ نفسُه).
# النطاق drive.file: لا يرى rclone إلّا ما أنشأه هو في Drive، والملفّاتُ ملكٌ لحسابِ المالك.
# الأسرار: تُقرأُ من stdin وتُكتبُ في /etc/wasla/rclone.conf (600 root) فقط. لا تُطبَعُ ولا تُسجَّل.
set -euo pipefail; umask 077
PUB=${1:?"الاستعمال: offsite-setup.sh age1<المفتاح العامّ>"}
[[ "$PUB" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || { echo "setup-FAIL مفتاحٌ عامٌّ غيرُ صالح (يبدأ بـage1 وطولُه 62)"; exit 2; }
IFS= read -r CID; IFS= read -r CSEC; IFS= read -r RAW
[[ "$CID" =~ \.apps\.googleusercontent\.com$ ]] || { echo "setup-FAIL client_id لا ينتهي بـ.apps.googleusercontent.com"; exit 2; }
[ -n "$CSEC" ] || { echo "setup-FAIL client_secret فارغ"; exit 2; }
TOKEN=$(python3 - "$RAW" <<'PY'
import base64, json, sys
raw = sys.argv[1].strip()
if raw.startswith("{"):
    tok = raw
else:
    m = json.loads(base64.b64decode(raw + "=" * (-len(raw) % 4)))
    tok = m["token"]
assert json.loads(tok).get("refresh_token")
print(tok)
PY
) || { echo "setup-FAIL لم أجد refresh_token في ناتجِ rclone authorize"; exit 2; }
BIN=/opt/wasla/bin; export RCLONE_CONFIG=/etc/wasla/rclone.conf
[ -f "$RCLONE_CONFIG" ] && cp -a "$RCLONE_CONFIG" "$RCLONE_CONFIG.bak-$(date -u +%Y%m%dT%H%M%SZ)"
"$BIN/rclone" config create wasla-gdrive drive client_id="$CID" client_secret="$CSEC" scope=drive.file \
  token="$TOKEN" config_is_local=false --non-interactive >/dev/null 2>&1 || { echo "setup-FAIL rclone config create"; exit 1; }
unset TOKEN CSEC RAW; chmod 600 "$RCLONE_CONFIG"
printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=wasla-gdrive\nDRIVE_ROOT=WASLA-Backups\n' "$PUB" > /etc/wasla/offsite.env
chmod 600 /etc/wasla/offsite.env
"$BIN/rclone" -q mkdir wasla-gdrive:WASLA-Backups
user=$("$BIN/rclone" about wasla-gdrive: --json 2>/dev/null |
  python3 -c 'import json,sys;d=json.load(sys.stdin);print("free_gb=%.1f"%((d.get("free") or 0)/1e9))' 2>/dev/null || echo "free=unknown")
logger -t wasla-offsite -- "setup-ok remote=wasla-gdrive folder=WASLA-Backups"
echo "setup-ok remote=wasla-gdrive folder=WASLA-Backups $user"
echo "أوّلُ نسخةٍ مشفّرةٍ الآن:"; /opt/wasla/offsite-backup.sh
