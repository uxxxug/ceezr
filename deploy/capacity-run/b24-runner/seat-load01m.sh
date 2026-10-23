#!/usr/bin/env bash
# LOAD-01M — هدفُ المدنِ الخمسِ المكمِّلُ (PROTOCOL-load01m.md). موجةٌ واحدةٌ لكلِّ مشغِّلٍ:
#   seat-load01m.sh NAME CONC CITIES   (CITIES = "JED" لمدينةٍ واحدة، أو "JED,MKK,RUH,TIF,MED")
# الشيفرةُ = EXP_SHA (main + المولّدُ متعدّدُ المدن)؛ gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50
# يُتحقَّقُ منهما قبلَ أيِّ موجة. العتباتُ وقواعدُ الصلاحيةِ كما هي (gates.sh/wave-report.ts وb26 rules).
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ (المحاكي المحلّي فقط). أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
set -euo pipefail
NAME=${1:?NAME}; CONC=${2:?CONC}; CITIES=${3:?CITIES}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01m-out
EXP_SHA=${EXP_SHA:?}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktree EXP=$EXP_SHA wave=$NAME conc=$CONC cities=$CITIES"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$EXP_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$EXP_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
git -C "$H" show "$EXP_SHA:packages/shared/config/connection-budget.ts" | grep -q "^  gatewayRequest: 5," || { echo "GATEWAY_REQUEST_NOT_5 — لا موجة"; exit 1; }
git -C "$H" show "$EXP_SHA:apps/gateway/src/container.ts" | grep -q "IMMEDIATE_REDISPATCH_LIMIT = 50;" || { echo "REDISPATCH_LIMIT_NOT_50 — لا موجة"; exit 1; }
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50"
# الفرقُ عن main محصورٌ في المولّدِ وتقريرِه واختباراتِه وعدّةِ المقعد — لا تغييرَ في المنتج.
PROD_DIFF=$(git -C "$H" diff --name-only "${MAIN_SHA:?}" "$EXP_SHA" -- apps packages supabase deploy/capacity-run/config | tr '\n' ' ')
# التشغيلُ الثالث: فرقُ المنتجِ يجبُ أن يساويَ EXPECTED_PRODUCT_DIFF حرفيًّا (إصلاحُ PR #632 وحدَه).
[ "$(echo $PROD_DIFF)" = "$(echo ${EXPECTED_PRODUCT_DIFF:-})" ] || { echo "PRODUCT_DIFF_UNEXPECTED [$PROD_DIFF] — لا موجة"; exit 1; }
echo "PRODUCT_DIFF_AS_EXPECTED main=$MAIN_SHA exp=$EXP_SHA [${PROD_DIFF:-none}]"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-acc/deploy/capacity-run/config/run.env" || true

log "setup-env (infra|db|migrate)"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
. "$H/deploy/capacity-run/b24-runner/b26-session-limit.env"
B26_SESSION_LIMIT=${B26_SESSION_EXCHANGE_PER_MINUTE:?}
sed -i '/^SESSION_EXCHANGE_PER_MINUTE=/d' "$B/secrets.env"
echo "SESSION_EXCHANGE_PER_MINUTE=$B26_SESSION_LIMIT" >> "$B/secrets.env"
export B26_SESSION_LIMIT
NSX=$B/bin/nsx; PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres"
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$NSX bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null

log "قالبُ المقعد"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -qc "create database ceezr_cap_tpl template ceezr_cap_20261016"
$PSQL -d ceezr_cap_tpl -q -f "$H/deploy/capacity-run/b24-runner/fingerprint.sql" 2>&1 | grep -v '^$' > "$OUT/tpl-fingerprint.txt"
echo "TPL_FINGERPRINT $(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$OUT/tpl-fingerprint.txt") expected $(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$H/deploy/capacity-run/b24-runner/expected-fingerprint.txt")"
$PSQL -d ceezr_cap_tpl -Atc "select code||':'||is_active from cities order by code" | tr '\n' ' ' | sed 's/^/CITIES_ACTIVE /'; echo

cp "$H"/deploy/capacity-run/b24-runner/seat-bin/* "$B/bin/"; chmod 755 "$B"/bin/*
(cd "$W/wt-acc" && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh mock && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh shim)
sleep 8
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh status) | tee "$OUT/svc-status.txt" || true
grep -q "telegram-mock=up" "$OUT/svc-status.txt" && grep -q "shim=up" "$OUT/svc-status.txt" || { echo "SEAT_SERVICES_DOWN"; exit 1; }
{
  echo "date_utc=$(date -Is)"; echo "nproc=$(nproc)"; lscpu | grep -E "Model name|^CPU\(s\)" | tr -s ' '
  free -m | head -2; uname -r; postgres --version; redis-server --version; echo "bun=$(bun --version)"
  echo "seat_cpu_max=$(cat /sys/fs/cgroup/$CAP_SEAT_CG/cpu.max 2>/dev/null)"; ulimit -n | sed 's/^/nofile=/'
  $PSQL -d postgres -Atc "select name||'='||setting||coalesce(unit,'') from pg_settings where source not in ('default','override','client','session') order by 1"
} > "$OUT/seat-env.txt" 2>&1
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh assert)

log "مرجعُ الخمول ← validity"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b24" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-b24" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b24" "$OUT/idle-b24"

export SEQ_PREFIX=load01m
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
log "موجةُ القياس $NAME conc=$CONC (مدن=$N: $CITIES)"
"$B/bin/b24-seq.sh" "$NAME" "$CONC" 80 "M:ref:$EXP_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
RUN=load01m-$NAME-M-$CONC
grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
echo "COLLECT_RC=$CRC"
cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
$B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
cat "$D/gates.txt" | tail -60
V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$OUT/validity-$NAME.json") || true
echo "VALIDITY_$NAME $V"; cat "$OUT/validity-$NAME.json"
python3 "$H/deploy/capacity-run/b24-runner/b26-analyze.py" wave "$D" 50 "$B26_SESSION_LIMIT" > "$OUT/b26-wave-$NAME.json" 2>"$OUT/b26-wave-$NAME.err" || true
# تقريرُ المدنِ والعزلِ — قاعدةُ الموجةِ ما زالت قائمةً (لا fresh-db بعدها في هذا المشغِّل).
DBURL=$(grep -m1 '^DATABASE_URL=' "$B/secrets.env" | cut -d= -f2- || true)
[ -n "$DBURL" ] || DBURL=$(grep -m1 '^DATABASE_URL=' "$W/wt-acc/deploy/capacity-run/config/run.env" | cut -d= -f2- || true)
MRC=0
$NSX bash -c "export RUN_DIR='$B/runs/$RUN' DATABASE_URL='$DBURL'; cd '$W/wt-acc' && exec /home/user/.bun/bin/bun deploy/capacity-run/load/multi-city-report.ts" > "$D/multi-city-report.out" 2>&1 || MRC=$?
cp "$E/multi-city-report.json" "$D/" 2>/dev/null || true
echo "MULTI_CITY_RC=$MRC"; head -c 4000 "$D/multi-city-report.out"; echo
bash "$H/deploy/capacity-run/b24-runner/load01m-diag.sh" "$RUN" 2>&1 | tee "$D/load01m-diag.txt"
echo "{\"name\":\"$NAME\",\"conc\":$CONC,\"cities\":\"$CITIES\",\"users\":$((CONC*2)),\"validity\":\"$V\",\"exp_sha\":\"$EXP_SHA\",\"main_sha\":\"$MAIN_SHA\",\"multi_city_rc\":$MRC}" > "$OUT/wave-summary.json"
cat "$OUT/wave-summary.json"
log "تدقيقُ الأسرار"
# CITIES/CITY قائمةُ مدنٍ عامّةٌ لا سرّ؛ تُزالُ من secrets.env قبلَ التدقيقِ لئلّا تُطابِقَ اسمَ المدنِ في
# الملخّصِ (إنذارٌ كاذبٌ أسقطَ أدلّةَ m5-* في التشغيلِ الأوّل 39925887251). بقيّةُ الأسرارِ تُدقَّقُ كما هي.
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; rm -rf "$OUT/raw"; exit 1; fi
echo "SECRET_AUDIT_CLEAN"
log DONE
