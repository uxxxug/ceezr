#!/usr/bin/env bash
# الغرض: محاكاةٌ على الطوبولوجيا الحقيقيّةِ ببياناتِ الإنتاج **دونَ أن يغادرَ شيءٌ الخادم** (ADR 0298).
# ينتمي إلى: deploy/casaos/tests — يُشغَّلُ على خادمِ CasaOS من نسخةٍ مؤقّتةٍ لـdeploy/casaos:
#   sudo bash deploy/casaos/tests/offsite-prod-readonly-sim.sh [OUT_DIR]
# ما يحدث: backup.sh الجديدُ على قاعدةِ الإنتاجِ والمخزنِ الحقيقيَّين (قراءةٌ فقط: لقطةُ pg_dump، tar، pg_dumpall --roles-only)
#   إلى مجلّدٍ مؤقّت ⇒ offsite-backup.sh إلى «Drive» محلّيٍّ (rclone local) بمفتاحِ age ومفتاحِ توقيعٍ مؤقّتَين ⇒
#   wasla-offsite-restore-test.sh («اللابتوب» = مجلّدٌ مؤقّتٌ على الخادمِ نفسِه، و`ssh` بديلٌ محلّيّ) ⇒ تمرينٌ في
#   حاوياتٍ معزولة. لا كتابةَ إلى الإنتاج، ولا إلى /etc/wasla أو /opt/wasla أو /var/backups/wasla، ولا شبكةَ خارجيّة.
# الأسرار: config-*.tgz يحوي إعدادَ الإنتاج؛ يبقى في المجلّدِ المؤقّت (700 root) ويُحذَفُ في النهاية. لا يُطبَعُ شيءٌ منه.
set -uo pipefail; umask 077
H=$(cd "$(dirname "$0")/.." && pwd); OUT=${1:-$PWD/offsite-prod-sim-out}; mkdir -p "$OUT"
T=$(mktemp -d /var/tmp/wasla-selftest-prod-XXXXXX); chmod 700 "$T"
mkdir -p "$T/etc" "$T/backups" "$T/drive" "$T/fakebin" "$T/laptop/.wasla" "$T/ltmp" "$T/logs"
cleanup(){ docker ps -a --format '{{.Names}}' | grep -E '^wasla-selftest-(pdrill|sdrill)' | xargs -r docker rm -f >/dev/null 2>&1
  docker network ls --format '{{.Name}}' | grep -E '^wasla-selftest-sdrill' | xargs -r docker network rm >/dev/null 2>&1
  docker volume ls --format '{{.Name}}' | grep -E '^wasla-selftest-sdrill' | xargs -r docker volume rm >/dev/null 2>&1
  cp -a "$T/logs" "$OUT/" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
export WASLA_ETC=$T/etc WASLA_OPT=$H WASLA_BIN=${SELFTEST_BIN:-/opt/wasla/bin} BACKUP_DIR=$T/backups CONFIG_ROOT=/
export PROD_DB_CONTAINER=wasla-db-1 STORAGE_CONTAINER=wasla-storage-1 STORAGE_DB_CONTAINER=wasla-storage-db-1
export DRILL_PREFIX=wasla-selftest-pdrill STORAGE_DRILL_PREFIX=selftest-sdrill OFFSITE_LOG_TAG=wasla-offsite-selftest
export HOME=$T/laptop TMPDIR=$T/ltmp WASLA_REMOTE_PREFIX=$H WASLA_LOG_DIR=$T/logs PATH=$T/fakebin:$WASLA_BIN:$PATH
printf '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case "$1" in -o) shift 2;; -*) shift;; *) break;; esac; done\nshift; exec bash -c "$*"\n' > "$T/fakebin/ssh"; chmod 755 "$T/fakebin/ssh"
install -m 600 /etc/wasla/storage.env "$T/etc/storage.env"
age-keygen -o "$T/laptop/.wasla/wasla-backup.agekey" 2>/dev/null
PUB=$(age-keygen -y "$T/laptop/.wasla/wasla-backup.agekey")
SIG=$(bash "$H/offsite-setup.sh" --signing-key)
printf 'wasla-backup namespaces="wasla-offsite-backup" %s\n' "$SIG" > "$T/laptop/.wasla/allowed_signers"
printf '[testdrive]\ntype = local\n' > "$T/etc/rclone.conf"; chmod 600 "$T/etc/rclone.conf"
printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=testdrive\nDRIVE_ROOT=%s\n' "$PUB" "$T/drive" > "$T/etc/offsite.env"
s=$(date +%s); bash "$H/backup.sh" > "$T/logs/backup" 2>&1; brc=$?; b=$(( $(date +%s) - s ))
echo "backup rc=$brc seconds=$b"; grep -E '^(backup-ok|offsite-ok|offsite-fail)' "$T/logs/backup" | sed -E "s#$T#<tmp>#g"
TS=$(ls -1 "$T/backups"/waslah-*.dump | sed -nE 's#.*/waslah-(.*)\.dump$#\1#p' | tail -1)
echo "rowstats tables app=$(grep -vc '^#' "$T/backups/waslah-$TS.rowstats") storage=$(grep -vc '^#' "$T/backups/storage-db-$TS.rowstats" 2>/dev/null)"
ls "$T/drive/daily" "$T/drive/weekly" "$T/drive/monthly" | sed -E "s#$T#<tmp>#g"
s=$(date +%s); bash "$H/laptop/wasla-offsite-restore-test.sh" > "$T/logs/restore" 2>&1; rrc=$?; r=$(( $(date +%s) - s ))
echo "restore-test rc=$rrc seconds=$r"; sed -E "s#$T#<tmp>#g" "$T/logs/restore"
echo "leftover containers: $(docker ps -a --format '{{.Names}}' | grep -cE '^wasla-selftest-(pdrill|sdrill)')"
[ "$brc" = 0 ] && [ "$rrc" = 0 ]
