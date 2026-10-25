#!/usr/bin/env bash
# موجةٌ كاملةٌ: قاعدةٌ نظيفةٌ ← عيّناتُ موارد ← wave+finish ← pgss + سجلُّ البوابةِ المقصوص
set -u
B=/srv/ceezr-cap-20261016; ROUND=$1; CONC=$2; IDX=$3
export REPO=/home/user/workspace/wt-ref
/srv/ceezr-cap-20261016/bin/fresh-db.sh || exit 1
sleep 5
mkdir -p $B/runs/$ROUND.side
grep -E '^(DISPATCH_|NOTIFICATION_|DIAG_LOCAL_)' $B/secrets.env > $B/runs/$ROUND.side/diag-env.txt || true
GWLOG=$B/runs/current/evidence/gateway.log; START_LINE=$(wc -l < $GWLOG)
# الدفعة 26: الحدُّ الفعليُّ الذي قرأته البوابةُ الحيّة + عيّناتُ نافذتِه منَ Redis (للجانبَين بالتساوي)
if [ -n "${B26_SESSION_LIMIT:-}" ]; then
  $B/bin/session-limit-check.sh /home/user/workspace/wt-ref "$B26_SESSION_LIMIT" > $B/runs/$ROUND.side/session-limit.json 2>&1
  $B/bin/nsx python3 $B/bin/rl-sampler.py $B/runs/$ROUND.side/rl-window.jsonl $(( ${WAVE_SEC:-180} + 240 )) "$B26_SESSION_LIMIT" &
fi
python3 $B/bin/res-sampler.py $B/runs/$ROUND.side/resources.jsonl $(( ${WAVE_SEC:-180} + 240 )) &
SP=$!
# b33m (PROTOCOL-b33m.md): عيّناتُ الصادرِ كلَّ 5 ث أثناءَ الموجةِ — بغيابِ B33M_OUTBOX لا شيءَ يتغيّر.
OS=""
if [ "${B33M_OUTBOX:-}" = 1 ]; then python3 $B/bin/outbox-sampler.py $B/runs/$ROUND.side/b33m-outbox-samples.jsonl 900 5 & OS=$!; fi
$B/bin/run-wave-ref.sh "$ROUND" "[{\"name\":\"wave-$CONC\",\"sec\":${WAVE_SEC:-180},\"conc\":$CONC}]" 180 "$IDX"
RC=$?
kill $SP 2>/dev/null
[ -n "$OS" ] && kill $OS 2>/dev/null
sudo -n ip netns exec ceezrsbx2 pkill -f '[r]l-sampler.py' 2>/dev/null || true
$B/bin/pgss-dump.sh $B/runs/$ROUND/evidence/pgss-top.txt 30
tail -n +$((START_LINE+1)) $GWLOG > $B/runs/$ROUND/evidence/gateway.wave.log
$B/bin/db-export.sh $B/runs/$ROUND/evidence || true
# b33m: صفوفُ الصادرِ بلا chat_id ولا payload (أزمنةٌ وحالاتٌ وعدّاداتٌ فقط) قبلَ أيِّ fresh-db لاحق.
if [ "${B33M_OUTBOX:-}" = 1 ]; then
  $B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q -c \"\\copy (select left(id::text, 8) as id8, kind, status, round(extract(epoch from created_at)*1000) as created_ms, round(extract(epoch from delivered_at)*1000) as delivered_ms, round(extract(epoch from died_at)*1000) as died_ms, round(extract(epoch from next_attempt_at)*1000) as next_attempt_ms, round(extract(epoch from updated_at)*1000) as updated_ms, attempts, signal_wait_count, delivered_channel, last_error, dead_reason, error_code, (offer_id is not null) as has_offer, left(order_id::text, 8) as order8 from notification_outbox) to stdout with csv header\"" > $B/runs/$ROUND/evidence/b33m-outbox-rows.csv || echo "B33M_OUTBOX_EXPORT_FAIL"
  mv $B/runs/$ROUND.side/b33m-outbox-samples.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null
fi
[ -n "${TRACE_FILE:-}" ] && cp "$TRACE_FILE" $B/runs/$ROUND/evidence/dispatch-trace.jsonl
mv $B/runs/$ROUND.side/diag-env.txt $B/runs/$ROUND/evidence/ 2>/dev/null
mv $B/runs/$ROUND.side/session-limit.json $B/runs/$ROUND.side/rl-window.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null
mv $B/runs/$ROUND.side/resources.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null; rmdir $B/runs/$ROUND.side
echo "WAVE_DONE $ROUND rc=$RC"
