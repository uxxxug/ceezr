#!/usr/bin/env bash
# الغرض: يجهّزُ على الخادمِ بيئةً **اصطناعيّةً** (لا بياناتِ إنتاج) ليُجرِّبَ لابتوبٌ حقيقيٌّ عبرَ SSH حقيقيٍّ
#   wasla-offsite-restore-test.sh من طرفِه (ADR 0298). يُشغَّلُ على الخادم:
#   sudo bash offsite-laptop-e2e-server.sh up DIR AGE_PUB   ⇒ يطبعُ سطرَي WASLA_REMOTE_PREFIX ومفتاحِ التوقيعِ العامّ
#   sudo bash offsite-laptop-e2e-server.sh down DIR         ⇒ يحذفُ كلَّ ما أنشأه
# العزل: قاعدةٌ وهميّةٌ wasla-selftest-e2e-prod (--network none)، و«Drive» محلّيّ، ومفتاحُ توقيعٍ مؤقّت، كلُّها تحتَ DIR.
set -euo pipefail; umask 077
H=$(cd "$(dirname "$0")/.." && pwd); MODE=$1; D=$2; PROD=wasla-selftest-e2e-prod
if [ "$MODE" = down ]; then
  docker ps -a --format '{{.Names}}' | grep -E '^(wasla-selftest-e2e)' | xargs -r docker rm -f >/dev/null; rm -rf "$D"; echo down-ok; exit 0; fi
PUB=$3; mkdir -p "$D"/{etc,backups,drive,root/etc/wasla,root/opt/wasla}; chmod 700 "$D"
ENVS="WASLA_ETC=$D/etc BACKUP_DIR=$D/backups CONFIG_ROOT=$D/root PROD_DB_CONTAINER=$PROD STORAGE_CONTAINER=none STORAGE_DB_CONTAINER=none DRILL_PREFIX=wasla-selftest-e2e-drill OFFSITE_LOG_TAG=wasla-offsite-selftest"
# shellcheck disable=SC2086,SC2163  # تقسيمٌ مقصودٌ إلى أزواجِ NAME=VALUE
export $ENVS
. "$H/offsite-lib.sh"
printf 'POSTGRES_PASSWORD=%s\n' "$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)" > "$D/prod.env"
docker run -d --name "$PROD" --network none --env-file "$D/prod.env" "$(docker inspect -f '{{.Config.Image}}' wasla-db-1)" >/dev/null
wait_pg "$PROD"
docker exec "$PROD" createdb -U postgres -T template0 waslah
docker exec -i "$PROD" psql -U postgres -d waslah -qX -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE riders (id serial PRIMARY KEY, name text, at timestamptz DEFAULT now());
INSERT INTO riders (name) SELECT 'راكب ' || g FROM generate_series(1, 300) g;
SQL
printf 'X=1\n' > "$D/root/etc/wasla/gateway.env"; printf 'Y=1\n' > "$D/root/etc/wasla/db.env"; printf 'services: {}\n' > "$D/root/opt/wasla/compose.yml"
SIG=$(bash "$H/offsite-setup.sh" --signing-key)
printf '[testdrive]\ntype = local\n' > "$D/etc/rclone.conf"; chmod 600 "$D/etc/rclone.conf"
printf 'AGE_RECIPIENT=%s\nRCLONE_REMOTE=testdrive\nDRIVE_ROOT=%s\n' "$PUB" "$D/drive" > "$D/etc/offsite.env"
bash "$H/backup.sh" | grep -E '^(backup-ok|offsite-ok)' | sed -E "s#$D#<dir>#g" >&2
echo "WASLA_REMOTE_PREFIX=sudo env $ENVS $H"
echo "SIGPUB=$SIG"
