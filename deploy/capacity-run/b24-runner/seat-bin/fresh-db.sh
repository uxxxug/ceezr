#!/usr/bin/env bash
# قاعدةٌ نظيفةٌ قبلَ كلِّ موجةٍ: نسخٌ من القالبِ المُهاجَرِ + تفريغُ Redis + إعادةُ تشغيلِ البوابةِ (بلا مشرفٍ: svc.sh مباشرةً).
set -euo pipefail
B=/srv/ceezr-cap-20261016; REPO=${REPO:-/home/user/workspace/wt-acc}
sudo -n ip netns exec ceezrsbx2 pkill -TERM -f '[a]pps/gateway/src/index.ts' || true
# أثرُ التشخيصِ اختياريٌّ: يُكتَبُ في ملفِّ أسرارِ المقعدِ عندَ TRACE_FILE ويُزالُ بغيابِه
sed -i '/^DISPATCH_TRACE_FILE=/d' $B/secrets.env
if [ -n "${TRACE_FILE:-}" ]; then rm -f "$TRACE_FILE"; echo "DISPATCH_TRACE_FILE=$TRACE_FILE" >> $B/secrets.env; fi
sed -i '/^DISPATCH_DIAG_/d;/^NOTIFICATION_DRAIN_LANES=/d;/^NOTIFICATION_DRAIN_BUDGET_MS=/d;/^DIAG_LOCAL_/d' $B/secrets.env
# b33m-idle: ميزانيةُ شوطِ التصريفِ لكلِّ موجةٍ (PROTOCOL-b33m-idle.md §2) — تُمرَّرُ عبرَ secrets.env
# لأنها القناةُ الوحيدةُ التي تنجو من تصفيةِ sudo المزدوجِ في nsx/start_bg (نفسُ قناةِ DIAG_ المسجَّلة)؛
# السطرُ السابقُ ينظّفُ قيمةَ الموجةِ السابقةِ فلا تسربَ بينَ الذراعين.
[ -n "${B33M_IDLE_BUDGET_MS:-}" ] && printf 'NOTIFICATION_DRAIN_BUDGET_MS=%s\n' "$B33M_IDLE_BUDGET_MS" >> $B/secrets.env
# DIAG_EXTRA="K=V K=V": متغيّراتُ تجربةِ عزلٍ صريحةٌ تُسجَّلُ في الأثرِ (لا تُستعمَلُ في القبول)
# LOAD-01M: قائمةُ المدنِ للمولّدِ عبرَ القناةِ نفسِها (secrets.env يُقرأُ في wave.sh بـset -a)؛
# تُنظَّفُ قبلَ كلِّ موجةٍ فلا تتسرّبُ قائمةُ موجةٍ إلى أخرى. غيابُ LOAD01M_CITIES = مدينةٌ واحدة (CITY).
sed -i '/^CITIES=/d;/^CITY=/d' $B/secrets.env
[ -n "${LOAD01M_CITIES:-}" ] && printf 'CITIES=%s\n' "$LOAD01M_CITIES" >> $B/secrets.env
[ -n "${LOAD01M_CITY:-}" ] && printf 'CITY=%s\n' "$LOAD01M_CITY" >> $B/secrets.env
# LOAD-01 (تفكيكُ P7): أثرُ محاولاتِ التسليمِ يُشعَلُ للموجةِ بـNOTICE_TRACE_KIND وحدَه، ويُنظَّفُ قبلَها دائمًا.
# CLAIM-SPLIT (الملحق ج): تفكيكُ زمنِ الالتقاطِ يتبعُ ذراعَ الأثرِ نفسَه، فكلفتُه داخلَ قياسِ §5.2.
sed -i '/^NOTIFICATION_ATTEMPT_TRACE=/d;/^NOTIFICATION_ATTEMPT_TRACE_KINDS=/d;/^NOTIFICATION_CLAIM_SPLIT=/d' $B/secrets.env
if [ -n "${NOTICE_TRACE_KIND:-}" ]; then
  printf 'NOTIFICATION_ATTEMPT_TRACE=1\nNOTIFICATION_ATTEMPT_TRACE_KINDS=%s\nNOTIFICATION_CLAIM_SPLIT=1\n' "$NOTICE_TRACE_KIND" >> $B/secrets.env
fi
# LOAD-01 §5.8 (SINGLE_TRIP): ذراعُ ST يُشعلُ الالتقاطَ في رحلةٍ واحدةٍ (الهجرةُ
# 20261028120000 في القالبِ للذراعينِ معًا؛ لا يتغيّرُ لا حدٌّ محميّ ولا كنسٌ ولا ضغطٌ).
# يُنظَّفُ قبلَ كلِّ موجةٍ فلا يتسرّبُ بينَ الذراعين؛ غيابُه = CUR بنصِّهِ.
sed -i '/^NOTIFICATION_CLAIM_SINGLE_TRIP=/d' $B/secrets.env
if [ -n "${CLAIM_TRIP:-}" ]; then printf 'NOTIFICATION_CLAIM_SINGLE_TRIP=%s\n' "$CLAIM_TRIP" >> $B/secrets.env; fi
for kv in ${DIAG_EXTRA:-}; do echo "$kv" >> $B/secrets.env; done
[ -n "${DIAG_POOL:-}" ] && echo "DISPATCH_DIAG_DEDICATED_POOL=$DIAG_POOL" >> $B/secrets.env
[ -n "${DIAG_REQ:-}" ] && echo "DISPATCH_DIAG_REQUEST_POOL=$DIAG_REQ" >> $B/secrets.env
[ -n "${DIAG_DRAINER_BG:-}" ] && echo "DISPATCH_DIAG_DRAINER_BG=$DIAG_DRAINER_BG" >> $B/secrets.env
true
for i in $(seq 1 30); do $B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts'" >/dev/null || break; sleep 1; done
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -q -c 'drop database if exists ceezr_cap_20261016 with (force)' -c 'create database ceezr_cap_20261016 template ceezr_cap_tpl' && psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q -c 'create extension if not exists pg_stat_statements' -c 'select pg_stat_statements_reset()' >/dev/null && redis-cli -p 56379 flushall >/dev/null"
cd $REPO && RUN_BASE=$B RUN_DIR=$B/runs/current bash deploy/capacity-run/svc.sh gateway
# b33m-idle: تسجيلُ القيمةِ الفعليةِ من بيئةِ عمليةِ البوّابةِ الحيّةِ (المتغيرُ وحده لا البيئةُ كاملةً)
for i in $(seq 1 30); do
  sleep 1
  GWPID=$( { pgrep -f '[a]pps/gateway/src/index.ts' | tail -1; } || true )
  [ -n "$GWPID" ] && tr '\0' '\n' < /proc/$GWPID/environ | grep '^NOTIFICATION_DRAIN_BUDGET_MS=' > $B/runs/current/evidence/gateway-drain-budget.txt 2>/dev/null && break
done
for i in $(seq 1 60); do
  sleep 2
  if $B/bin/nsx bash -c "curl -s -m 2 http://127.0.0.1:54300/ready" 2>/dev/null | grep -q '"ready"'; then
    echo "FRESH_DB_OK sha=$(git -C $REPO rev-parse --short HEAD) gateway_pid=$($B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts' | tail -1") budget=$(cat $B/runs/current/evidence/gateway-drain-budget.txt 2>/dev/null || echo unrecorded)"; exit 0
  fi
done
echo "FRESH_DB_GATEWAY_NOT_READY" >&2; exit 1
