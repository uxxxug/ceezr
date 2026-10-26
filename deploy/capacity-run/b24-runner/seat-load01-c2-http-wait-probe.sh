#!/usr/bin/env bash
# LOAD-01 · دورةُ تشخيصِ الكمونِ في مسارِ HTTP (load01-c2-http-wait-probe) — PROTOCOL + ملحق 1 (2026-10-26):
#   ستَّ عشرةَ موجةً: AA1 AA2 (ذراعُ A + الأداةِ، m5-1500) ← بوابةُ A/A (وصفيّةٌ: |A−A| ≤ δ) ثمّ
#   معايرةُ شرائحِ الوصولِ من AA1 (تُجمَّدُ قبلَ ABBA) ثمّ فحصُ كلفةِ الأداةِ ON1–OFF1–OFF2–ON2
#   ‏(ON = A+الأداة، ‏OFF = A الأصليُّ 4bd9432e — كلاهما بالرصدِ الأساسيِّ) ← بوابةُ الكلفةِ
#   (|d1| ≤ δ و|d2| ≤ δ) ثمّ S1/S2 ‏(m5-100، تحقّقُ مسارٍ لا حكم) ثمّ ثماني موجاتِ ABBA ‏m5-1500
#   ‏(A1 B1 B2 A2 A3 B3 B4 A4) ← تحليلُ الحكمِ (H1 شرطيٌّ مقترنٌ + H2 انحدارٌ على نافذةِ التفريغِ).
#   المقعدُ يتوقفُ عندَ كلِّ بوابةِ تمهيدٍ (ملحقُ البروتوكولِ §1–§3): فشلُ A/A أو الكلفةِ = إيقافٌ
#   وتوثيق، لا تخفيفَ ولا تجميلًا بإعادةٍ انتقائية.
# ذراعا المنتجِ = التزاما بروتوكولِ C2 + أداةُ الربطِ (فرقُ الأداةِ متطابقٌ حرفيًّا بينَ الذراعين):
#   A = load01c2-probe-arm-A، ‏B = load01c2-probe-arm-B. لا هجراتٍ ولا فهرسَ: القالبانِ بصمةٌ واحدة.
# لا تغييرَ في الحملِ ولا العتبات؛ gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 محروسان.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
# الحكمُ تشخيصيٌّ فقط: لا ادّعاءَ سعةٍ ولا دليلَ عدمِ ضرر؛ LOAD-01M = NOT_MET وLOAD-01 = FAIL يبقيان.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01c2-probe-out
A_SHA=${A_SHA:?}; B_SHA=${B_SHA:?}; OFF_SHA=${OFF_SHA:?}; CONC=${CONC:-1500}; SMOKE_CONC=${SMOKE_CONC:-100}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
EXP_FN_B=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
# فرقُ الأصبعِ بينَ الذراعينِ في ملفّاتِ التشغيل — عينُ حزمةِ C2 (الأداةُ متطابقةٌ بينَ الذراعين):
EXPECTED_AB_DIFF="apps/gateway/src/bots/driver/index.ts apps/gateway/src/bots/shared/language-middleware.ts packages/application/bots/one-shot-driver-lookup.ts packages/application/bots/types.ts packages/infrastructure/identity/directories.ts"
# فرقُ الأداةِ عنْ A الأصليِّ: خمسةُ ملفّاتٍ لا غيرَ (لا تغييرًا سلوكيًّا في مسارِ المنتجِ):
EXPECTED_TOOL_DIFF="apps/gateway/src/background/load-trace.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts deploy/capacity-run/load/wave-report.ts tests/unit/load-trace-httpreq.test.ts"
EXPECTED_IDX_B_ONLY=""
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
PA="$H/deploy/capacity-run/b24-runner/probe-analyze.py"

log "اختبارٌ ذاتيٌّ للمحلّلِ على بياناتٍ مصغرةٍ معروفةِ النتائجِ (شرطُ ملحقِ البروتوكولِ)"
python3 "$H/deploy/capacity-run/b24-runner/probe-analyze-selftest.py" || { echo "PROBE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }

log "worktree اثنان: wt-acc (مسارُ التشغيلِ للذراعين، يبدأُ من A) وwt-ref (سجلُ b24-env.json وحده، على B)"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-ref" "$B_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
for S in "$A_SHA" "$B_SHA" "$OFF_SHA"; do
  BUDGET_SRC=$(git -C "$H" show "$S:packages/shared/config/connection-budget.ts")
  CONTAINER_SRC=$(git -C "$H" show "$S:apps/gateway/src/container.ts")
  [[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 $S — لا موجة"; exit 1; }
  [[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 $S — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (A و B و OFF)"
AB_DIFF=$(git -C "$H" diff --name-only "$A_SHA" "$B_SHA" -- apps packages deploy docker supabase package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $AB_DIFF)" = "$(echo $EXPECTED_AB_DIFF)" ] || { echo "AB_DIFF_UNEXPECTED [$AB_DIFF] — لا موجة"; exit 1; }
echo "AB_DIFF_BATCH [$AB_DIFF]"
TOOL_DIFF=$(git -C "$H" diff --name-only "$OFF_SHA" "$A_SHA" -- apps packages deploy docker supabase tests package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $TOOL_DIFF)" = "$(echo $EXPECTED_TOOL_DIFF)" ] || { echo "TOOL_DIFF_UNEXPECTED [$TOOL_DIFF] — لا موجة"; exit 1; }
echo "TOOL_DIFF_AS_EXPECTED [$TOOL_DIFF] (فرقُ الأداةِ عنْ A الأصليِّ — لا سلوكَ منتجٍ يتغير)"
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED kinds=command:message=1:1"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-acc/deploy/capacity-run/config/run.env" || true

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
fingerprint() { $PSQL -d "$1" -v ON_ERROR_STOP=1 -q -f "$FP" 2>&1 | grep -v '^$'; }
log "قالبُ A: هجراتُ A + seat-seed.sql ⇒ ceezr_cap_tpl_a"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "create database ceezr_cap_tpl_a template ceezr_cap_20261016"
log "قالبُ B: قاعدةٌ مستقلّةٌ بهجراتِ wt-acc@B + seat-seed.sql ⇒ ceezr_cap_tpl_b (البصمةُ يجبُ أن تطابقَ A حرفيًّا)"
git -C "$W/wt-acc" checkout -q "$B_SHA"
log "wt-acc الآن على B=$B_SHA (سيُبدَّلُ التزامُه قبلَ كلِّ موجةٍ عبرَ b24-seq)"
(CAP_MAIN_DB=ceezr_cap_bbuild CAP_TEST_DB=ceezr_cap_bbuild_t bash "$W/wt-acc/deploy/capacity-run/setup-env-20261016.sh" db \
  && CAP_MAIN_DB=ceezr_cap_bbuild CAP_TEST_DB=ceezr_cap_bbuild_t bash "$W/wt-acc/deploy/capacity-run/setup-env-20261016.sh" migrate) \
  >"$OUT/setup-env-B.log" 2>&1 || { tail -20 "$OUT/setup-env-B.log"; exit 1; }
tail -2 "$OUT/setup-env-B.log"
$PSQL -d ceezr_cap_bbuild -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "create database ceezr_cap_tpl_b template ceezr_cap_bbuild"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database ceezr_cap_bbuild with (force)" -c "drop database ceezr_cap_bbuild_t with (force)"
fingerprint ceezr_cap_tpl_a > "$OUT/tpl-fingerprint-A.txt" || { cat "$OUT/tpl-fingerprint-A.txt"; exit 1; }
fingerprint ceezr_cap_tpl_b > "$OUT/tpl-fingerprint-B.txt" || { cat "$OUT/tpl-fingerprint-B.txt"; exit 1; }
cp "$OUT/tpl-fingerprint-A.txt" "$OUT/tpl-fingerprint.txt"
for arm in A B; do
  f=$(grep -o 'fn_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt" || true)
  ef=EXP_FN_$arm
  [ "$f" = "${!ef}" ] || { echo "TPL_${arm}_FINGERPRINT_MISMATCH got[$f] expected[${!ef}] — لا موجة"; exit 1; }
  echo "TPL_${arm}_FN_MATCH $f $(grep -o 'idx_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt") $(grep -o 'idxn_md5=[^ ]*' "$OUT/tpl-fingerprint-$arm.txt")"
done
idxset() { $PSQL -d "$1" -Atc "select distinct regexp_replace(indexname, '_[0-9]{8}(_|\M)', '_YYYYMMDD\1', 'g')||' '||md5(regexp_replace(indexdef, '_[0-9]{8}(_|\M)', '_YYYYMMDD\1', 'g')) from pg_indexes where schemaname='public' and tablename not in ('spatial_ref_sys') order by 1" | LC_ALL=C sort; }
idxset ceezr_cap_tpl_a > "$OUT/tpl-idxset-A.txt"; idxset ceezr_cap_tpl_b > "$OUT/tpl-idxset-B.txt"
B_ONLY=$(comm -13 "$OUT/tpl-idxset-A.txt" "$OUT/tpl-idxset-B.txt" | tr '\n' ' '); A_ONLY=$(comm -23 "$OUT/tpl-idxset-A.txt" "$OUT/tpl-idxset-B.txt" | tr '\n' ' ')
[ "$(echo $B_ONLY)" = "$(echo $EXPECTED_IDX_B_ONLY)" ] || { echo "TPL_AB_INDEX_DIFF_UNEXPECTED B_only[$B_ONLY] — لا موجة"; exit 1; }
[ -z "$(echo $A_ONLY)" ] || { echo "TPL_AB_A_ONLY_INDEXES[$A_ONLY] — لا موجة"; exit 1; }
echo "TPL_AB_INDEX_DIFF_AS_EXPECTED [$(echo $EXPECTED_IDX_B_ONLY)]"
for k in col_md5 nonempty; do
  [ "$(grep -o "$k=.*" "$OUT/tpl-fingerprint-A.txt")" = "$(grep -o "$k=.*" "$OUT/tpl-fingerprint-B.txt")" ] || { echo "TPL_AB_${k}_DIFFER — لا موجة"; exit 1; }
done
echo "TPL_AB_SAME_COLUMNS_AND_SEED"
activate() { # ARM NAME
  $PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl with (force)" -c "create database ceezr_cap_tpl template ceezr_cap_tpl_${1,,}"
  local f ef=EXP_FN_$1; f=$(fingerprint ceezr_cap_tpl | grep -o 'fn_md5=[^ ]*') || { echo "TPL_ACTIVE_FINGERPRINT_FAIL arm=$1"; return 1; }
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

export SEQ_PREFIX=load01c2
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR  # SLOT ⇒ دليلُ الموجةِ الصالحةِ الأخيرةِ (الأصلُ يُستبدَلُ بالإعادةِ)
wave() { # SLOT IDX [CONC] ⇒ يضبطُ V — الأداةُ مفعّلةٌ في كلِّ الموجاتِ (DISPATCH_TRACE_FILE دائمًا في b24-trace)
  local SLOT=$1 IDX=$2 WCONC=${3:-$CONC} ARM NAME ARM_SHA
  case "$SLOT" in
    A*|S1|AA*|COST-ON*) ARM=A; ARM_SHA=$A_SHA;;
    B*|S2) ARM=B; ARM_SHA=$B_SHA;;
    COST-OFF*) ARM=A; ARM_SHA=$OFF_SHA;;
    *) echo "SLOT_ARM_UNKNOWN $SLOT"; V=INVALID; return;;
  esac
  NAME=probe-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  log "موجةُ القياس $NAME arm=$ARM code=$ARM_SHA conc=$WCONC (مدن=$N)"
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01c2-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC conc=$WCONC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$ARM" > "$D/arm.txt"; echo "$ARM_SHA" > "$D/arm-sha.txt"
  # مدخلاتُ المحلّلِ إلزاميةٌ في كلِّ موجةٍ (أثرُ الأداةِ أو الأثرُ الأساسيُّ بحسبِ الذراعِ)
  ls "$D/load-trace.jsonl" >/dev/null 2>&1 || { echo "TRACE_MISSING $NAME — لا تحليل"; }
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
  local MV; MV=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));m=d.get('mixedValidity') or {};print('MIXED_OK' if m.get('valid') else 'MIXED_INVALID '+' | '.join(m.get('reasons',['job-timeline غائب'])))" "$D/job-timeline.json" 2>/dev/null || echo "MIXED_INVALID job-timeline غائب")
  echo "$MV" | tee "$D/mixed-validity.txt"
  [ "$MV" = MIXED_OK ] || V=INVALID_MIXED
  echo "VALIDITY_$NAME $V"; cat "$D/validity.json"; echo
  WDIR["$SLOT"]=$D
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "الموجتانِ A/A (ذراعُ A + الأداةِ، m5-$CONC) — بوابةُ قابليةِ إعادةِ الإنتاجِ (ملحق §2)"
for SLOT in AA1 AA2; do
  V=INVALID
  wave "$SLOT" 70
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس 80 (الأصلُ محفوظٌ مُستبدَلًا)"
    wave "$SLOT" 80
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — إيقافٌ قبلَ البوابةِ"; exit 1; }
done
python3 "$PA" aa "${WDIR[AA1]}" "${WDIR[AA2]}" "$OUT/aa-gate.json" >"$OUT/aa-gate.log" 2>&1 || { cat "$OUT/aa-gate.log"; echo "AA_GATE_ANALYZE_FAIL — إيقاف"; exit 1; }
AA_VERDICT=$(python3 -c "import json;print(json.load(open('$OUT/aa-gate.json'))['verdict'])")
echo "AA_GATE_VERDICT $AA_VERDICT"
[ "$AA_VERDICT" = "إعادةُ_إنتاجٍ_ضمنَ_±δ" ] || { echo "PROBE_STOP: بوابةُ A/A لم تُجَز ($AA_VERDICT) — إيقافٌ وتوثيقٌ لا تخفيفَ (ملحق §2)"; exit 1; }
log "بوابةُ A/A مُجازةٌ ($AA_VERDICT) — تُجمَّدُ حدودُ شرائحِ الوصولِ من AA1 قبلَ أيِّ موجةِ حكمٍ (ملحق §5)"
python3 "$PA" strata "${WDIR[AA1]}" "$OUT/strata.json" >"$OUT/strata.log" 2>&1 || { cat "$OUT/strata.log"; echo "STRATA_FAIL — إيقاف"; exit 1; }
cat "$OUT/strata.json"

log "فحصُ كلفةِ الأداةِ ON–OFF–OFF–ON (m5-$CONC) — ON = A+الأداة، OFF = A الأصليُّ (كلاهما بالرصدِ الأساسيِّ)"
for SLOT in COST-ON1 COST-OFF1 COST-OFF2 COST-ON2; do
  V=INVALID
  case "$SLOT" in
    COST-ON1) IDX=71;; COST-OFF1) IDX=72;; COST-OFF2) IDX=73;; COST-ON2) IDX=74;;
  esac
  wave "$SLOT" "$IDX"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((IDX+10)) (الأصلُ محفوظٌ مُستبدَلًا)"
    wave "$SLOT" "$((IDX+10))"
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — إيقافٌ قبلَ بوابةِ الكلفةِ"; exit 1; }
done
python3 "$PA" cost "${WDIR[COST-ON1]}" "${WDIR[COST-OFF1]}" "${WDIR[COST-OFF2]}" "${WDIR[COST-ON2]}" "$OUT/cost-gate.json" >"$OUT/cost-gate.log" 2>&1 || { cat "$OUT/cost-gate.log"; echo "COST_GATE_ANALYZE_FAIL — إيقاف"; exit 1; }
COST_VERDICT=$(python3 -c "import json;print(json.load(open('$OUT/cost-gate.json'))['verdict'])")
echo "COST_GATE_VERDICT $COST_VERDICT"
[ "$COST_VERDICT" = "كلفةٌ_محدودةٌ_بـ±δ" ] || { echo "PROBE_STOP: بوابةُ الكلفةِ لم تُجَز ($COST_VERDICT) — إيقافٌ قبلَ موجاتِ الحكمِ لا تخفيفَ (ملحق §1)"; exit 1; }
echo "PRE_GATES_PASSED — الأداةُ كلفةً محدودةٌ بـ±δ، وإعادةُ الإنتاجِ ضمنَ ±δ (وصفُ البوابتينِ لا إثباتَ عدمِ ضررٍ عامًّا)"

log "موجتا التحقّقِ منَ المسار (S1=A ثمّ S2=B عند conc=$SMOKE_CONC) — تحقّقُ مسارٍ لا حكم"
for SLOT in S1 S2; do
  V=INVALID
  wave "$SLOT" 90 "$SMOKE_CONC"
  if [ "$V" != VALID ]; then
    echo "إعادةُ موجةِ التحقّقِ $SLOT (نفسُ قاعدةِ الإعادةِ §4: iowait عابرٌ ونحوه ⇒ إعادةٌ واحدةٌ بفهرس 100)"
    wave "$SLOT" 100 "$SMOKE_CONC"
  fi
  [ "$V" = VALID ] || { echo "SMOKE_INVALID $SLOT — إيقافٌ قبلَ الموجاتِ الثماني (تحقّقُ التبديلِ فشل)"; exit 1; }
done
echo "SMOKE_OK — مسارُ التبديلِ (cand/قالب/شيفرة) يعملُ للذراعين"

I=80
for SLOT in A1 B1 B2 A2 A3 B3 B4 A4; do
  V=INVALID
  wave "$SLOT" "$I"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((I+10)) (PROTOCOL §4)؛ الأصلُ محفوظٌ مُستبدَلًا"
    wave "$SLOT" "$((I+10))"
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — إيقاف"; exit 1; }
  I=$((I+1))
done

log "تحليلُ الحكمِ المقترنِ (H1 شرائحُ مقترنةٌ + H2 انحدارُ نافذةِ التفريغِ) — البروتوكولُ §5–§6 وملحقُ §5"
python3 "$PA" ab "${WDIR[A1]}" "${WDIR[B1]}" "${WDIR[B2]}" "${WDIR[A2]}" "${WDIR[A3]}" "${WDIR[B3]}" "${WDIR[B4]}" "${WDIR[A4]}" "$OUT/strata.json" "$OUT/ab-result.json" >"$OUT/ab-result.log" 2>&1 || { cat "$OUT/ab-result.log"; echo "AB_ANALYZE_FAIL"; exit 1; }
python3 - "$OUT/ab-result.json" <<'PY' || true
import json,sys
d=json.load(open(sys.argv[1]))
print('H1_RIDES_INJECTION')
for k,v in d['h1'].items():
    if k.startswith('rides|injection'):
        print(' ',k,'mass=%.3f'%v['mass_of_requests'],'point=%s'%v['point_ms'],'ci=%s'%(v['ci_ms'],),'rule=',v['rule'])
print('H2',json.dumps({k:d['h2'][k] for k in ('n_rows','point_ms','ci_ms','rule')},ensure_ascii=False))
print('RESIDUAL_NOTE',d['residual_note'])
PY
echo "{\"a_sha\":\"$A_SHA\",\"b_sha\":\"$B_SHA\",\"off_sha\":\"$OFF_SHA\",\"mixed_rate\":$MIXED_RATE,\"mixed_sec\":$MIXED_SEC,\"mixed_seed\":$MIXED_SEED,\"conc\":$CONC,\"smoke_conc\":$SMOKE_CONC,\"cities\":\"$CITIES\",\"aa_verdict\":\"$AA_VERDICT\",\"cost_verdict\":\"$COST_VERDICT\",\"slots\":\"AA1 AA2 COST-ON1 COST-OFF1 COST-OFF2 COST-ON2 S1 S2 A1 B1 B2 A2 A3 B3 B4 A4\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; rm -rf "$OUT/raw"; exit 1; fi
echo "SECRET_AUDIT_CLEAN"
log DONE
