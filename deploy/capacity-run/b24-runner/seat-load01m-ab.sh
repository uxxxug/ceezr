#!/usr/bin/env bash
# LOAD-01M · الدورةُ الثالثة — مقارنةٌ مقترنةٌ على مشغِّلٍ واحد (PROTOCOL-load01m-ab.md):
#   ثماني موجاتِ m5-1500 بالترتيب A1 B1 B2 A2 A3 B3 B4 A4، والفرقُ الوحيدُ بينَ الذراعين قالبُ القاعدة.
#   A = خطُّ الأساس (A_SHA)، B = #647 (B_SHA). الفرقُ بينهما في ملفّاتِ التشغيلِ = ثلاثُ هجراتٍ وحدَها (حارسٌ آلي)،
#   فتعملُ البوّابةُ والمولّدُ من wt-ref (= B_SHA) للذراعين بأدواتِ ref نفسِها، ويُبدَّلُ ceezr_cap_tpl قبلَ كلِّ موجة.
# لا تغييرَ في المنتجِ ولا الحملِ ولا العتبات؛ gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 محروسان.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01m-out
A_SHA=${A_SHA:?}; B_SHA=${B_SHA:?}; CONC=${CONC:-1500}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
# بصماتُ القالبين المقيسةُ في موجاتِ خطِّ الأساس (40072049298) و#647 (40093933836) — PROTOCOL §2
EXP_FN_A=fn_md5=ba159019383b0ff487b9b53cebc214dc; EXP_IDX_A=idx_md5=93ff71e47c49e78a13f9c7b969dc85af
EXP_FN_B=fn_md5=db6d947096fe114e001ca377d966d3ff; EXP_IDX_B=idx_md5=db010b197746659fc2a4e007a86756f7
EXPECTED_AB_DIFF="supabase/migrations/20261024120000_load01_contact_first_claim_order.sql supabase/migrations/20261024140000_load01_contact_first_claim_contact_index.sql supabase/migrations/20261024140100_load01_contact_first_indexed_claim.sql"
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktrees wt-ref=B=$B_SHA (التشغيل) wt-acc=A=$A_SHA (هجراتُ A وحدَها)"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$B_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
for S in "$A_SHA" "$B_SHA"; do
  BUDGET_SRC=$(git -C "$H" show "$S:packages/shared/config/connection-budget.ts")
  CONTAINER_SRC=$(git -C "$H" show "$S:apps/gateway/src/container.ts")
  [[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 $S — لا موجة"; exit 1; }
  [[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 $S — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (A و B)"
AB_DIFF=$(git -C "$H" diff --name-only "$A_SHA" "$B_SHA" -- apps packages deploy docker supabase package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $AB_DIFF)" = "$(echo $EXPECTED_AB_DIFF)" ] || { echo "AB_DIFF_UNEXPECTED [$AB_DIFF] — لا موجة"; exit 1; }
echo "AB_DIFF_MIGRATIONS_ONLY [$AB_DIFF]"
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
fingerprint() { $PSQL -d "$1" -q -f "$FP" 2>&1 | grep -v '^$'; }
log "قالبُ A: هجراتُ A + seat-seed.sql ⇒ ceezr_cap_tpl_A"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -qc "create database ceezr_cap_tpl_A template ceezr_cap_20261016"
log "قالبُ B: قاعدةٌ مستقلّةٌ بهجراتِ wt-ref (B) + seat-seed.sql ⇒ ceezr_cap_tpl_B"
(CAP_MAIN_DB=ceezr_cap_bbuild CAP_TEST_DB=ceezr_cap_bbuild_t bash "$W/wt-ref/deploy/capacity-run/setup-env-20261016.sh" db \
  && CAP_MAIN_DB=ceezr_cap_bbuild CAP_TEST_DB=ceezr_cap_bbuild_t bash "$W/wt-ref/deploy/capacity-run/setup-env-20261016.sh" migrate) \
  >"$OUT/setup-env-B.log" 2>&1 || { tail -20 "$OUT/setup-env-B.log"; exit 1; }
tail -2 "$OUT/setup-env-B.log"
$PSQL -d ceezr_cap_bbuild -v ON_ERROR_STOP=1 -q -f "$W/wt-ref/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -qc "create database ceezr_cap_tpl_B template ceezr_cap_bbuild"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database ceezr_cap_bbuild" -c "drop database ceezr_cap_bbuild_t"
fingerprint ceezr_cap_tpl_A > "$OUT/tpl-fingerprint-A.txt"; fingerprint ceezr_cap_tpl_B > "$OUT/tpl-fingerprint-B.txt"
cp "$OUT/tpl-fingerprint-A.txt" "$OUT/tpl-fingerprint.txt"
for arm in A B; do
  f=$(grep -o 'fn_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt"); i=$(grep -o 'idx_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt")
  ef=EXP_FN_$arm; ei=EXP_IDX_$arm
  [ "$f" = "${!ef}" ] && [ "$i" = "${!ei}" ] || { echo "TPL_${arm}_FINGERPRINT_MISMATCH got[$f $i] expected[${!ef} ${!ei}] — لا موجة"; exit 1; }
  echo "TPL_${arm}_FINGERPRINT_MATCH $f $i"
done
# الأعمدةُ والصفوفُ غيرُ الفارغةِ متطابقةٌ بينَ القالبين (لا فرقَ إلّا الدوالُّ والفهارس)
for k in col_md5 nonempty; do
  [ "$(grep -o "$k=.*" "$OUT/tpl-fingerprint-A.txt")" = "$(grep -o "$k=.*" "$OUT/tpl-fingerprint-B.txt")" ] || { echo "TPL_AB_${k}_DIFFER — لا موجة"; exit 1; }
done
echo "TPL_AB_SAME_COLUMNS_AND_SEED"
activate() { # ARM NAME
  $PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl with (force)" -c "create database ceezr_cap_tpl template ceezr_cap_tpl_$1"
  local f ef=EXP_FN_$1; f=$(fingerprint ceezr_cap_tpl | grep -o 'fn_md5=[^ ]*')
  [ "$f" = "${!ef}" ] || { echo "TPL_ACTIVE_MISMATCH arm=$1 $f"; return 1; }
  echo "TPL_ACTIVE arm=$1 $f" | tee "$OUT/tpl-active-$2.txt"
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

export SEQ_PREFIX=load01m
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
SLOTS=()
wave() { # SLOT(A1…) IDX ⇒ يضبطُ V
  local SLOT=$1 IDX=$2 ARM=${1:0:1} NAME=ab-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  log "موجةُ القياس $NAME arm=$ARM conc=$CONC (مدن=$N)"
  "$B/bin/b24-seq.sh" "$NAME" "$CONC" "$IDX" "M:ref:$B_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01m-$NAME-M-$CONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$ARM" > "$D/arm.txt"
  python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
  $B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
  grep -E "G1" "$D/gates.txt" | head -2 || true
  V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$D/validity.json") || true
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

log "الحكمُ المقترن (PROTOCOL §5)"
bun "$H/deploy/capacity-run/monitor/drainer-decompose.ts" --paired "${SLOTS[@]}" > "$OUT/ab-verdict.json" 2>"$OUT/ab-verdict.err" || cat "$OUT/ab-verdict.err"
python3 -c "
import json;d=json.load(open('$OUT/ab-verdict.json'));v=d['verdict']
print('AB_RESULT',json.dumps({'decision':v['decision'],'why':v['why'],'meanDPp':v['meanDPp'],'pairs':v['pairs'],'excluded':v['excluded'],'armG1':v['armG1'],'claimMeanMsByArm':d['claimMeanMsByArm']},ensure_ascii=False))
for w in d['waves']: print('AB_WAVE',w['slot'],'superseded' if w['superseded'] else '',w['valid'],w['pairedComparability']['verdict'],w['g1'],w['claimMeanMs'],w['hardwareFactor'])
" || true
echo "{\"a_sha\":\"$A_SHA\",\"b_sha\":\"$B_SHA\",\"conc\":$CONC,\"cities\":\"$CITIES\",\"slots\":\"${SLOTS[*]}\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; rm -rf "$OUT/raw"; exit 1; fi
echo "SECRET_AUDIT_CLEAN"
log DONE
