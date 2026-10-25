#!/usr/bin/env bash
# LOAD-01 — قراءةُ الإقلاعِ المُدمَجةُ (#656) وفحصُ الإبطالِ بأمرٍ واحد (#657): مقارنةٌ مقترنةٌ (PROTOCOL-load01-boot-ab.md):
#   ثماني موجاتِ m5-1500 + حِملٌ مختلطٌ ثابتٌ لبوتِ السائق بالترتيب A1 B1 B2 A2 A3 B3 B4 A4.
#   الفرقُ الوحيدُ شيفرةُ البوّابة: wt-ref يُبدَّلُ إلى A_SHA أو B_SHA قبلَ كلِّ موجة، وكلُّ ما عداهُ (المسارُ ref
#   نفسُه، المولّدان، الحِملُ، القالبُ الواحد) واحدٌ للذراعين؛ وحارسٌ آليٌّ يقصرُ فرقَ A..B على الملفّاتِ المتوقَّعة.
# لا تغييرَ في الحملِ ولا العتبات؛ gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 محروسان.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01boot-out
A_SHA=${A_SHA:?}; B_SHA=${B_SHA:?}; REF_SHA=${REF_SHA:?}; CONC=${CONC:-1500}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
# بصمةُ الدوالِّ لقالبِ A (هجراتُ #655) — الفهرسانِ لا يمسّانِ دالّةً فهيَ بصمةُ التشغيلِ 40170539016 نفسُها — PROTOCOL §2
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
EXPECTED_AB_DIFF="apps/gateway/src/index.ts apps/gateway/src/routes/session-telegram.ts apps/gateway/src/server.ts packages/application/identity/ports.ts packages/application/identity/session-bootstrap.ts packages/infrastructure/consent/consent-store.ts packages/infrastructure/identity/redis-session-revocation-store.ts packages/infrastructure/identity/revocable-session-reader.ts packages/infrastructure/identity/session-bootstrap-snapshot.ts packages/infrastructure/identity/viewer-account.ts"
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktrees wt-ref=A=$A_SHA (يُبدَّلُ لكلِّ ذراع) wt-acc=A=$A_SHA (هجراتُ القالبِ الواحد)"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$A_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
for S in "$A_SHA" "$B_SHA" "$REF_SHA"; do
  BUDGET_SRC=$(git -C "$H" show "$S:packages/shared/config/connection-budget.ts")
  CONTAINER_SRC=$(git -C "$H" show "$S:apps/gateway/src/container.ts")
  [[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 $S — لا موجة"; exit 1; }
  [[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 $S — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (A و B و REF)"
AB_DIFF=$(git -C "$H" diff --name-only "$A_SHA" "$B_SHA" -- apps packages deploy docker supabase package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $AB_DIFF)" = "$(echo $EXPECTED_AB_DIFF)" ] || { echo "AB_DIFF_UNEXPECTED [$AB_DIFF] — لا موجة"; exit 1; }
echo "AB_DIFF_GATEWAY_CODE_ONLY [$AB_DIFF]"
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED kinds=command:message=1:1"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-ref/deploy/capacity-run/config/run.env" "$W/wt-acc/deploy/capacity-run/config/run.env" || true

log "setup-env (infra|db|migrate) من wt-acc ⇒ قاعدةٌ بهجراتِ A"
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

FP="$H/deploy/capacity-run/b24-runner/fingerprint.sql"
# أسماءُ القواعدِ بحروفٍ صغيرة: SQL يطوي الاسمَ غيرَ المقتبس، و-d يطابقُه حرفيًّا (أسقطَ التشغيلَ 40118151074).
fingerprint() { $PSQL -d "$1" -v ON_ERROR_STOP=1 -q -f "$FP" 2>&1 | grep -v '^$'; }
log "قالبُ A: هجراتُ A + seat-seed.sql ⇒ ceezr_cap_tpl_a"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -qc "create database ceezr_cap_tpl_a template ceezr_cap_20261016"
fingerprint ceezr_cap_tpl_a > "$OUT/tpl-fingerprint-A.txt" || { cat "$OUT/tpl-fingerprint-A.txt"; exit 1; }
cp "$OUT/tpl-fingerprint-A.txt" "$OUT/tpl-fingerprint.txt"
for arm in A; do
  f=$(grep -o 'fn_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt" || true)
  ef=EXP_FN_$arm
  [ "$f" = "${!ef}" ] || { echo "TPL_${arm}_FINGERPRINT_MISMATCH got[$f] expected[${!ef}] — لا موجة"; exit 1; }
  echo "TPL_${arm}_FN_MATCH $f $(grep -o 'idx_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt") $(grep -o 'idxn_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt")"
done
# قالبٌ واحدٌ للذراعين: لا هجرةَ في فرقِ A..B (الحارسُ أعلاه)؛ فالفهرسانِ الجديدانِ حاضرانِ في القالبِ للذراعين.
idxn=$($PSQL -d ceezr_cap_tpl_a -Atc "select count(*) from pg_indexes where indexname in ('telegram_update_jobs_reply_lane_open_idx','telegram_update_jobs_reply_open_created_idx')")
[ "$idxn" = 2 ] || { echo "TPL_A_REPLY_INDEXES_MISSING n=$idxn — لا موجة"; exit 1; }
echo "TPL_SINGLE_FOR_BOTH_ARMS reply_indexes=2"
activate() { # ARM NAME — القالبُ الواحدُ (A) للذراعين، وشيفرةُ البوّابةِ في wt-ref تُبدَّلُ إلى شيفرةِ الذراع
  $PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl with (force)" -c "create database ceezr_cap_tpl template ceezr_cap_tpl_a"
  local f; f=$(fingerprint ceezr_cap_tpl | grep -o 'fn_md5=[^ ]*') || { echo "TPL_ACTIVE_FINGERPRINT_FAIL arm=$1"; return 1; }
  [ "$f" = "$EXP_FN_A" ] || { echo "TPL_ACTIVE_MISMATCH arm=$1 $f"; return 1; }
  local want sha=${1}_SHA; want=${!sha}
  git -C "$W/wt-ref" checkout -q --detach "$want" || { echo "CODE_CHECKOUT_FAIL arm=$1"; return 1; }
  [ "$(git -C "$W/wt-ref" rev-parse HEAD)" = "$want" ] || { echo "CODE_ARM_MISMATCH arm=$1"; return 1; }
  [ -z "$(git -C "$W/wt-ref" status --porcelain --untracked-files=no)" ] || { echo "CODE_DIRTY arm=$1"; return 1; }
  echo "TPL_ACTIVE arm=$1 $f code=$want" | tee "$OUT/tpl-active-$2.txt"
}
activate A pre

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

log "مرجعُ الخمول ← validity (مرّةً واحدةً قبلَ أوّلِ موجة)"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b24" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-b24" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b24" "$OUT/idle-b24"

export SEQ_PREFIX=load01boot
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
SLOTS=()
wave() { # SLOT(A1…) IDX ⇒ يضبطُ V
  local SLOT=$1 IDX=$2 ARM=${1:0:1} NAME=boot-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  log "موجةُ القياس $NAME arm=$ARM conc=$CONC (مدن=$N)"
  $NSX redis-cli -p 56379 config resetstat >/dev/null 2>&1 || echo "REDIS_RESETSTAT_FAIL $NAME"
  local ARMSHA=${ARM}_SHA
  "$B/bin/b24-seq.sh" "$NAME" "$CONC" "$IDX" "M:ref:${!ARMSHA}" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01boot-$NAME-M-$CONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$ARM" > "$D/arm.txt"
  $NSX redis-cli -p 56379 info commandstats > "$D/redis-cmdstats.txt" 2>&1 || echo "REDIS_CMDSTATS_FAIL $NAME"
  grep -E "cmdstat_(get|mget|set|eval|evalsha|incr|expire|pexpire):" "$D/redis-cmdstats.txt" | sed "s/^/REDIS_$NAME /" || true
  bun "$H/deploy/capacity-run/monitor/job-timeline.ts" "$D" > "$D/job-timeline.json" 2>"$D/job-timeline.err" || true
  python3 - "$D/job-timeline.json" <<'PY' || true
import json,sys
d=json.load(open(sys.argv[1]))
print('TIMELINE',json.dumps({'instrumented':d['instrumented'],'mixed':{k:d['mixed'][k] for k in ('planned','sent','ok2xx','skipped','byKind')} if d['mixed'] else None,'byKind':[{'kind':k['kind'],'n':k['n'],'notDone':k['notDone'],'queueP50':k['queue']['p50'],'finishP50':k['finish']['p50'],'replyP50':k['reply']['p50']} for k in d['byKind']],'poolOccP50':d['pool']['occupancy']['p50']},ensure_ascii=False))
PY
  python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
  $B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
  grep -E "G1" "$D/gates.txt" | head -2 || true
  V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$D/validity.json") || true
  # PROTOCOL §6: الحِملُ المختلطُ المعروضُ هو المخطَّط (MIXED_RULE)؛ وإلّا فالموجةُ غيرُ صالحة ⇒ إعادةٌ واحدة.
  local MV; MV=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));m=d.get('mixedValidity') or {};print('MIXED_OK' if m.get('valid') else 'MIXED_INVALID '+' | '.join(m.get('reasons',['job-timeline غائب'])))" "$D/job-timeline.json" 2>/dev/null || echo "MIXED_INVALID job-timeline غائب")
  echo "$MV" | tee "$D/mixed-validity.txt"
  [ "$MV" = MIXED_OK ] || V=INVALID_MIXED
  echo "VALIDITY_$NAME $V"; cat "$D/validity.json"; echo
  SLOTS+=("$SLOT:$D")
}
I=80
for SLOT in A1 B1 B2 A2 A3 B3 B4 A4; do
  V=INVALID
  wave "$SLOT" "$I"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((I+10)) (PROTOCOL §3)؛ الأصلُ محفوظٌ مُستبدَلًا"
    wave "$SLOT" "$((I+10))"
  fi
  I=$((I+1))
done

log "الحكمُ المقترن (PROTOCOL §5): G1 بقاعدةِ AB_RULE، والآليّةُ بقاعدةِ MECH_RULE"
bun "$H/deploy/capacity-run/monitor/drainer-decompose.ts" --paired "${SLOTS[@]}" > "$OUT/ab-verdict.json" 2>"$OUT/ab-verdict.err" || cat "$OUT/ab-verdict.err"
bun "$H/deploy/capacity-run/monitor/job-timeline.ts" --paired "${SLOTS[@]}" > "$OUT/mech-verdict.json" 2>"$OUT/mech-verdict.err" || cat "$OUT/mech-verdict.err"
python3 -c "
import json;d=json.load(open('$OUT/mech-verdict.json'))
for k in ('contactQueueP50','nonContactQueueP50','contactFinishP50','nonContactFinishP50'): print('MECH',k,json.dumps(d[k]))
" || true
python3 -c "
import json;d=json.load(open('$OUT/ab-verdict.json'));v=d['verdict']
print('AB_RESULT',json.dumps({'decision':v['decision'],'why':v['why'],'meanDPp':v['meanDPp'],'pairs':v['pairs'],'excluded':v['excluded'],'armG1':v['armG1'],'claimMeanMsByArm':d['claimMeanMsByArm']},ensure_ascii=False))
for w in d['waves']: print('AB_WAVE',w['slot'],'superseded' if w['superseded'] else '',w['valid'],w['pairedComparability']['verdict'],w['g1'],w['claimMeanMs'],w['hardwareFactor'])
" || true
log "محكُّ الآليّة (PROTOCOL §6 BOOT_RULE)"
python3 "$H/deploy/capacity-run/b24-runner/boot-mech.py" "${SLOTS[@]}" > "$OUT/boot-mech.json" 2>"$OUT/boot-mech.err" || cat "$OUT/boot-mech.err"
python3 -c "
import json;d=json.load(open('$OUT/boot-mech.json'))
print('BOOT_RESULT',json.dumps({k:d[k] for k in ('verdict','why')},ensure_ascii=False))
for w in d['waves']: print('BOOT_WAVE',json.dumps(w,ensure_ascii=False))
" || true
echo "{\"a_sha\":\"$A_SHA\",\"b_sha\":\"$B_SHA\",\"ref_sha\":\"$REF_SHA\",\"mixed_rate\":$MIXED_RATE,\"mixed_sec\":$MIXED_SEC,\"mixed_seed\":$MIXED_SEED,\"conc\":$CONC,\"cities\":\"$CITIES\",\"slots\":\"${SLOTS[*]}\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; rm -rf "$OUT/raw"; exit 1; fi
echo "SECRET_AUDIT_CLEAN"
log DONE
