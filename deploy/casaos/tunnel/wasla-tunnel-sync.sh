#!/usr/bin/env bash
# الغرض: يقرأُ رابطَ النفقِ السريعِ الحاليَّ من cloudflared، فإن خالفَ MINIAPP_URL:
#   1) يكتبُ /etc/wasla/public.env (600)،
#   2) يُعيدُ إنشاءَ gateway-1 ثمّ gateway-2 واحدةً بعدَ أخرى (لا تخلو الخدمةُ من نسخةٍ جاهزة).
#      gateway-1 أوّلاً لأنّها العامل: /ready في كلِّ نسخةٍ يقرأُ نبضاتِ العاملِ من القاعدة،
#      ومهامُّه المدنيّةُ تُحسَبُ عندَ إقلاعِه وحدَه (`container.jobs()`)،
#   3) يضبطُ webhookَ البوتين على <الرابط>/webhook/telegram/{rider,driver} بالسرِّ نفسِه.
# وفي كلِّ دورةٍ يقارنُ getWebhookInfo بالمتوقَّعِ ويُصلحُه إن انحرف. لا يطبعُ رمزاً ولا سرّاً:
# الطلباتُ إلى api.telegram.org تُمرَّرُ إلى curl على stdin لا في سطرِ الأوامر.
# ينتمي إلى: deploy/casaos/tunnel (ADR 0293). يُثبَّتُ في /opt/wasla/wasla-tunnel-sync.sh (700، root).
set -euo pipefail
umask 077
ENV=/etc/wasla/gateway.env
PUB=/etc/wasla/public.env
COMPOSE=(docker compose -f /opt/wasla/compose.yml)
LOG_TAG=wasla-tunnel-sync
log(){ logger -t "$LOG_TAG" -- "$*"; echo "$*"; }

host=$(curl -fsS -m 5 http://127.0.0.1:20299/quicktunnel 2>/dev/null | sed -nE 's/.*"hostname":"([^"]+)".*/\1/p' || true)
# منفذُ المقاييسِ خاصٌّ بهذا النفق (20299): 20241 الافتراضيُّ قد يحجزُه نفقٌ آخرُ على الخادم
# (نفقُ SSH المؤقّت)، فيُقرأُ رابطُه خطأً ويُوجَّهُ الـwebhook إليه.
[ -n "$host" ] || { log "no_tunnel_hostname"; exit 0; }
url="https://$host"

val(){ sed -nE "s/^$1=(.*)$/\1/p" "$ENV" | tail -1; }
secret=$(val TELEGRAM_WEBHOOK_SECRET)
current=$(sed -nE 's/^MINIAPP_URL=(.*)$/\1/p' "$PUB" 2>/dev/null | tail -1 || true)

wait_ready(){ # $1 = اسمُ الحاوية
  for _ in $(seq 1 60); do
    if docker exec "$1" bun -e "fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}

if [ "$current" != "$url" ]; then
  log "url_changed from=${current:-none} to=$url"
  printf 'MINIAPP_URL=%s\n' "$url" > "$PUB.tmp"; chmod 600 "$PUB.tmp"; mv "$PUB.tmp" "$PUB"
  for svc in gateway-1 gateway-2; do
    "${COMPOSE[@]}" up -d --no-deps --force-recreate "$svc" >/dev/null 2>&1
    cid=$("${COMPOSE[@]}" ps -q "$svc")
    if wait_ready "$cid"; then log "recreated_ready svc=$svc"; else log "recreated_NOT_READY svc=$svc"; exit 1; fi
  done
fi

tg(){ # $1 = token  $2 = method ؛ الجسمُ JSON على stdin الثاني
  local body; body=$(cat)
  printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$1" "$2" | curl -fsS -m 15 -K - -H 'Content-Type: application/json' --data-binary "$body"
}
allowed='["message","edited_message","callback_query","chat_member","my_chat_member","chat_join_request"]'
for kind in rider driver; do
  case $kind in rider) token=$(val RIDER_BOT_TOKEN);; driver) token=$(val DRIVER_BOT_TOKEN);; esac
  want="$url/webhook/telegram/$kind"
  have=$(echo '{}' | tg "$token" getWebhookInfo | sed -nE 's/.*"url":"([^"]*)".*/\1/p' | sed 's#\\/#/#g')
  if [ "$have" != "$want" ]; then
    res=$(printf '{"url":"%s","secret_token":"%s","allowed_updates":%s,"max_connections":40,"drop_pending_updates":false}' "$want" "$secret" "$allowed" | tg "$token" setWebhook | sed -nE 's/.*"ok":(true|false).*/\1/p')
    log "set_webhook bot=$kind ok=$res"
  fi
done
