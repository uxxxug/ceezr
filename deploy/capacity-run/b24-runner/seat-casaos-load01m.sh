#!/usr/bin/env bash
# =============================================================================
# الغرض: مقعدُ LOAD-01M على خادمِ CasaOS (WASLA) — سلّمُ موجاتِ m5 حتّى m5-2500
#   (5,000 مستخدم متزامن عبرَ JED وMKK وRUH وTIF وMED) بسلسلةِ المقعدِ الرسميّةِ نفسِها:
#   setup-env → seat-seed → قالبٌ مُفهرَس → b24-seq/qual-wave/wave-full/run-wave →
#   collect-evidence → gates/b33m-analyze valid/base-analyze wave → تدقيقُ الأسرار.
# الحالة: منفّذ فعلياً — 2026-10-30.
# ينتمي إلى: deploy/capacity-run/b24-runner
# التشغيل: داخلَ حاويةِ `wasla/load01m-seat:u2604` (Ubuntu 26.04، PG 18.6 + PostGIS 3.6.4،
#   Redis 8.0.5، Bun 1.4.3 — حزمُ provision-root.sh حرفًا) بـ`--network none`: الحاويةُ نفسُها
#   هي النطاقُ المعزول (لا خروجَ، loopback وحده)، و`/usr/local/bin/sudo` فيها يحوّلُ
#   `ip netns exec ceezrsbx2` إلى تنفيذٍ مباشر. لا قاعدةَ إنتاجٍ ولا تيليجرامَ حقيقيّ.
# الفرقُ عن seat-load01-main-baseline.sh: لا حرّاسَ SHA الخاصّةِ بتجربةِ C2 (EXP_FN_A وC2_DIFF)،
#   فالشيفرةُ هنا هي المنشورةُ نفسُها؛ والثوابتُ المحميّةُ (gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50)
#   مفحوصةٌ كما هي. وقاعدةُ الإعادة: موجةٌ غيرُ صالحةٍ تُعادُ مرّةً بفهرس +10 والأصلُ محفوظ.
# =============================================================================
set -euo pipefail
export HOME=/home/user PATH=/usr/local/bin:/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=${CAP_SEAT_CG:-.} CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=${OUT:-/home/user/casaos-out}
WAVES=${WAVES:-"m5-250:250:60 m5-500:500:61 m5-1000:1000:62 m5-1500:1500:63 m5-2500:2500:64"}
CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
export MIXED_RATE=${MIXED_RATE:-20} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
BA="$H/deploy/capacity-run/b24-runner/base-analyze.py"
SHA=$(git -C "$H" rev-parse HEAD)

log "اختبارٌ ذاتيٌّ للمحلّل وفحوصُ المقعدِ الموروثة — الشيفرة $SHA"
python3 "$H/deploy/capacity-run/b24-runner/base-analyze-selftest.py" || { echo "BASE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — لا موجة"; exit 1; }
[ -z "${LOAD_GEN_FETCH_CAP:-}" ] || { echo "LOAD_GEN_FETCH_CAP_SET_IN_SEAT_ENV — لا موجة"; exit 1; }

[ -d "$W/wt-acc" ] || { echo "WT_ACC_MISSING — حضّرْ wt-acc وwt-ref وbun install قبلَ عزلِ الشبكة"; exit 1; }
git -C "$W/wt-acc" checkout -q --detach "$SHA"; git -C "$W/wt-ref" checkout -q --detach "$SHA"
BUDGET_SRC=$(git -C "$H" show "$SHA:packages/shared/config/connection-budget.ts")
CONTAINER_SRC=$(git -C "$H" show "$SHA:apps/gateway/src/container.ts")
[[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 — لا موجة"; exit 1; }
[[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 — لا موجة"; exit 1; }
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 sha=$SHA" | tee "$OUT/frozen-constants.txt"

log "setup-env (infra|db|migrate) من wt-acc"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
. "$H/deploy/capacity-run/b24-runner/b26-session-limit.env"
B26_SESSION_LIMIT=${B26_SESSION_EXCHANGE_PER_MINUTE:?}
sed -i '/^SESSION_EXCHANGE_PER_MINUTE=/d' "$B/secrets.env"; echo "SESSION_EXCHANGE_PER_MINUTE=$B26_SESSION_LIMIT" >> "$B/secrets.env"
export B26_SESSION_LIMIT

NSX=$B/bin/nsx; PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres"
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$NSX bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null
FP="$H/deploy/capacity-run/b24-runner/fingerprint.sql"
log "القالب: هجراتُ الشيفرة + seat-seed.sql ⇒ ceezr_cap_tpl"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl_m with (force)" -c "create database ceezr_cap_tpl_m template ceezr_cap_20261016"
$PSQL -d ceezr_cap_tpl_m -v ON_ERROR_STOP=1 -q -f "$FP" 2>&1 | grep -v '^$' > "$OUT/tpl-fingerprint.txt" || { cat "$OUT/tpl-fingerprint.txt"; exit 1; }
cat "$OUT/tpl-fingerprint.txt"
activate() { # NAME
  $PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl with (force)" -c "create database ceezr_cap_tpl template ceezr_cap_tpl_m"
  $PSQL -d ceezr_cap_tpl -v ON_ERROR_STOP=1 -q -f "$FP" 2>&1 | grep -o 'fn_md5=[^ ]*' | sed "s/^/TPL_ACTIVE $1 /" | tee "$OUT/tpl-active-$1.txt"
}
activate pre

cp "$H"/deploy/capacity-run/b24-runner/seat-bin/* "$B/bin/"; chmod 755 "$B"/bin/*
(cd "$W/wt-acc" && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh mock && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh shim)
sleep 8
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh status) | tee "$OUT/svc-status.txt" || true
grep -q "telegram-mock=up" "$OUT/svc-status.txt" && grep -q "shim=up" "$OUT/svc-status.txt" || { echo "SEAT_SERVICES_DOWN"; exit 1; }
{
  echo "date_utc=$(date -Is)"; echo "nproc=$(nproc)"; lscpu | grep -E "Model name|^CPU\(s\)" | tr -s ' '
  free -m | head -2; uname -r; postgres --version; redis-server --version; echo "bun=$(bun --version)"
  cat /sys/fs/cgroup/cpu.max 2>/dev/null | sed 's/^/container_cpu_max=/'; cat /sys/fs/cgroup/memory.max 2>/dev/null | sed 's/^/container_mem_max=/'
  ulimit -n | sed 's/^/nofile=/'; ip -o link | awk '{print "link="$2}'
  $PSQL -d postgres -Atc "select name||'='||setting||coalesce(unit,'') from pg_settings where source not in ('default','override','client','session') order by 1"
} > "$OUT/seat-env.txt" 2>&1
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh assert) | tee "$OUT/isolation-assert.txt"

log "مرجعُ الخمول ← validity (مرّةً قبلَ أوّلِ موجة)"
"$B/bin/idle-baseline.sh" "$B/qual/idle-casaos" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-casaos" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-casaos" "$OUT/idle-casaos"

export SEQ_PREFIX=casaos
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi

wave() { # NAME CONC IDX ⇒ يضبطُ V
  local NAME=$1 WCONC=$2 IDX=$3 TAG="$1-i$3"
  activate "$TAG" >/dev/null || { V=INVALID; return; }
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  log "موجة $TAG conc=$WCONC (مدن=$N) code=$SHA"
  local CPID=""
  if [ -n "${CHAOS_PLAN:-}" ]; then
    # حقنُ الأعطالِ أثناءَ الحقن: يبدأُ عدُّ CHAOS_PLAN (بالدقائق) لحظةَ بدءِ الجولة، ويعيدُ تشغيلَ
    # الخدماتِ بـsvc.sh من wt-acc نفسِه. موجةُ الفوضى ليست بوّابةَ LOAD-01M ولا تُعادُ.
    ( until grep -q "started round=" "$OUT/seq-$TAG.log" 2>/dev/null; do sleep 1; done
      cd /home/user/workspace/wt-acc && RUN_BASE=$B RUN_DIR=$B/runs/current SOAK_START_MS=$(date +%s%3N) \
        "$B/bin/nsx" bun deploy/capacity-run/monitor/chaos.ts ) > "$OUT/chaos-$TAG.log" 2>&1 &
    CPID=$!
  fi
  "$B/bin/b24-seq.sh" "$TAG" "$WCONC" "$IDX" "M:cand:$SHA" > "$OUT/seq-$TAG.log" 2>&1 || true
  [ -n "$CPID" ] && { wait "$CPID" 2>/dev/null || true; }
  local RUN=casaos-$TAG-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$TAG.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$TAG COLLECT_RC=$CRC conc=$WCONC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  [ -n "${CHAOS_PLAN:-}" ] && { cp "$E/fault-injection.json" "$D/" 2>/dev/null || cp "$B/runs/current/evidence/fault-injection.json" "$D/" 2>/dev/null || true; cp "$OUT/chaos-$TAG.log" "$D/" 2>/dev/null || true; }
  cp "$OUT/tpl-active-$TAG.txt" "$D/tpl-active.txt" 2>/dev/null || true; echo "$SHA" > "$D/arm-sha.txt"
  bun "$H/deploy/capacity-run/monitor/job-timeline.ts" "$D" > "$D/job-timeline.json" 2>"$D/job-timeline.err" || true
  python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
  $B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
  cat "$D/gates.txt" | head -3 || true
  V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$D/validity.json") || true
  local MV; MV=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));m=d.get('mixedValidity') or {};print('MIXED_OK' if m.get('valid') else 'MIXED_INVALID '+' | '.join(m.get('reasons',['job-timeline غائب'])))" "$D/job-timeline.json" 2>/dev/null || echo "MIXED_INVALID job-timeline غائب")
  echo "$MV" | tee "$D/mixed-validity.txt"
  [ "$MV" = MIXED_OK ] || V=INVALID_MIXED
  echo "VALIDITY_$TAG $V"; cat "$D/validity.json"; echo
  python3 "$BA" wave "$D" "$D/base-wave.json" 2>"$D/base-wave.err" && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('BASE_WAVE',d['wave'],d['g1'],d['contact_acq'],d['failedGates'])" "$D/base-wave.json" || echo "BASE_WAVE_ANALYZE_FAIL $TAG"
  echo "$TAG $WCONC $V $D" >> "$OUT/waves.txt"
}

for spec in $WAVES; do
  IFS=: read -r NAME CONC IDX <<< "$spec"
  V=INVALID
  wave "$NAME" "$CONC" "$IDX"
  if [ "$V" != VALID ] && [ -z "${CHAOS_PLAN:-}" ]; then
    echo "قاعدةُ الإعادة: $NAME غيرُ صالحة ($V) ⇒ إعادةٌ واحدةٌ بفهرس $((IDX+10)) (الأصلُ محفوظ)"
    wave "$NAME" "$CONC" "$((IDX+10))"
  fi
done

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
[ $SA_RC -eq 0 ] && echo "SECRET_AUDIT_CLEAN" || echo "SECRET_AUDIT_FAIL"
log DONE
