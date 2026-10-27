#!/usr/bin/env bash
# LOAD-01-GAP-PROBE-RUN3 · سيمافورُ fetch المقيسُ في المولّد — PROTOCOL-load01-gap-probe-run3.md (مسجَّلٌ قبلَ أوّلِ موجة):
#   ستُّ موجاتٍ m5-1500 كحدٍّ أقصى، كلُّها على الالتزامِ نفسِه A‴ (= A″ + ملفّاتُ RUN3 وحدَها)، والذراعانِ يختلفانِ بمتغيّرِ بيئةٍ واحد:
#   S = LOAD_GEN_FETCH_CAP=256 (حدُّ Bun الافتراضيُّ نفسُه)، N = غيرُ مضبوط (سلوكُ RUN2).
#   AA1 AA2 (S، 70/71) ← q والوصفيّ ← بوابةُ A/A (gap3 aa3) ← S1 N1 N2 S2 (71–74) ← بوابتا الكلفةِ (probe-analyze cost) وتكافؤِ الحمل (gap3 load).
#   لا رفعَ لحدِّ Bun (BUN_CONFIG_MAX_HTTP_REQUESTS غيرُ مضبوطٍ ويُفحَص)، gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 محروسان.
#   لا إعادةَ لموجةٍ صالحةٍ ولا لبوابةٍ أخفقت (إعادةٌ واحدةٌ لموجةٍ غيرِ صالحةِ البيئةِ وفقَ القاعدةِ الموروثةِ فقط).
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
# الحكمُ تشخيصيٌّ فقط: لا ادّعاءَ سعةٍ؛ LOAD-01M = NOT_MET وLOAD-01 = FAIL يبقيان.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01gap-run3-out
A_SHA=${A_SHA:?}; A2_SHA=${A2_SHA:?}; CONC=${CONC:-1500}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
# فرقُ A‴ عنْ A″ ‏(0d3ae995، ذراعِ RUN2): ملفّاتُ RUN3 وحدَها (المولّدُ واختباراتُه — لا بوّابةَ ولا منتج)
EXPECTED_RUN3_DIFF="deploy/capacity-run/load/driver-onboarding.ts deploy/capacity-run/load/fetch-gate.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts tests/unit/load-trace-httpreq.test.ts tests/unit/load01-gap-probe-run3.test.ts"
GAP_TOOL_FILES="apps/gateway/src/realtime/http-bridge.ts apps/gateway/src/background/load-trace.ts apps/gateway/src/index.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts deploy/capacity-run/load/fetch-gate.ts deploy/capacity-run/load/driver-onboarding.ts packages/infrastructure/observability/loop-probe.ts"
REG_CAP=256
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
PA="$H/deploy/capacity-run/b24-runner/probe-analyze.py"   # وضعُ cost وحدَه (قاعدةُ C2)
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"
G3="$H/deploy/capacity-run/b24-runner/gap3-analyze.py"

log "اختبارٌ ذاتيٌّ للمحلّلِ على بياناتٍ مصغرةٍ معروفةِ النتائجِ (شرطُ ملحقِ البروتوكولِ)"
python3 "$H/deploy/capacity-run/b24-runner/gap-analyze-selftest.py" || { echo "GAP_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
python3 "$H/deploy/capacity-run/b24-runner/gap2-analyze-selftest.py" || { echo "GAP2_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
python3 "$H/deploy/capacity-run/b24-runner/gap3-analyze-selftest.py" || { echo "GAP3_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — شرطُ الحملِ يتغيّر، لا موجة"; exit 1; }
[ -z "${LOAD_GEN_FETCH_CAP:-}" ] || { echo "LOAD_GEN_FETCH_CAP_SET_IN_SEAT_ENV — الذراعُ تُضبطُ لكلِّ موجةٍ في secrets.env وحدَه، لا موجة"; exit 1; }
python3 "$H/deploy/capacity-run/b24-runner/probe-analyze-selftest.py" || { echo "PROBE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-gate-stop.test.sh" || { echo "PROBE_GATE_STOP_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-analyze-fail.test.sh" || { echo "PROBE_ANALYZE_FAIL_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-audit-clean.test.sh" || { echo "PROBE_AUDIT_CLEAN_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-final-audit.test.sh" || { echo "PROBE_FINAL_AUDIT_TEST_FAIL — لا موجة"; exit 1; }

log "worktree اثنان: wt-acc (مسارُ التشغيل، على A‴) وwt-ref (سجلُ b24-env.json وحده، على A‴)"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-ref" "$A_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
for S in "$A_SHA"; do
  BUDGET_SRC=$(git -C "$H" show "$S:packages/shared/config/connection-budget.ts")
  CONTAINER_SRC=$(git -C "$H" show "$S:apps/gateway/src/container.ts")
  [[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 $S — لا موجة"; exit 1; }
  [[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 $S — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (A‴)"
RUN3_DIFF=$(git -C "$H" diff --name-only "$A2_SHA" "$A_SHA" -- apps packages deploy docker supabase tests package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $RUN3_DIFF)" = "$(echo $EXPECTED_RUN3_DIFF)" ] || { echo "RUN3_DIFF_UNEXPECTED [$RUN3_DIFF] — لا موجة"; exit 1; }
echo "RUN3_DIFF_AS_EXPECTED [$RUN3_DIFF] (المولّدُ واختباراتُه وحدَها — لا بوّابةَ ولا منتج)"
for F in config/run.env; do
  ! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_$F — لا موجة"; exit 1; }
  ! grep -q '^LOAD_GEN_FETCH_CAP=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "LOAD_GEN_FETCH_CAP_IN_$F — لا موجة"; exit 1; }
done
for f in $GAP_TOOL_FILES; do
  echo "$(git -C "$H" show "$A_SHA:$f" | sha256sum | cut -c1-64)  $f" >> "$OUT/gap-tool-fingerprint.sha256sums"
done
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED kinds=command:message=1:1"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-acc/deploy/capacity-run/config/run.env" || true

log "setup-env (infra|db|migrate) من wt-acc ⇒ قاعدةٌ بهجراتِ A"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$B/secrets.env" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_SECRETS — لا موجة"; exit 1; }
sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
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
fingerprint ceezr_cap_tpl_a > "$OUT/tpl-fingerprint-A.txt" || { cat "$OUT/tpl-fingerprint-A.txt"; exit 1; }
cp "$OUT/tpl-fingerprint-A.txt" "$OUT/tpl-fingerprint.txt"
f=$(grep -o 'fn_md5=[^ ]*' "$OUT/tpl-fingerprint-A.txt" || true)
[ "$f" = "$EXP_FN_A" ] || { echo "TPL_A_FINGERPRINT_MISMATCH got[$f] expected[$EXP_FN_A] — لا موجة"; exit 1; }
echo "TPL_A_FN_MATCH $f"
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

# بصمةُ العتادِ والحصّةِ (البروتوكول §4.3) — تُكتبُ قبلَ كلِّ موجةٍ وبعدَها؛ مفاتيحُ الهويّةِ تُقارَنُ بـgap2-analyze hw.
hwfp() { # <out.json> <phase>
  python3 - "$1" "$2" "$CAP_SEAT_CG" <<'PYH'
import hashlib, json, os, platform, subprocess, sys, datetime
out, phase, cg = sys.argv[1], sys.argv[2], sys.argv[3]
def rd(p):
    try:
        return open(p, encoding="utf-8").read().strip()
    except OSError:
        return None
def lscpu(key):
    try:
        for line in subprocess.run(["lscpu"], capture_output=True, text=True).stdout.splitlines():
            if line.split(":")[0].strip() == key:
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return None
flags = None
for line in (rd("/proc/cpuinfo") or "").splitlines():
    if line.startswith("flags"):
        flags = hashlib.md5(line.split(":", 1)[1].strip().encode()).hexdigest()
        break
osr = {}
for line in (rd("/etc/os-release") or "").splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        osr[k] = v.strip('"')
stat = (rd("/proc/stat") or "").splitlines()
steal = int(stat[0].split()[8]) if stat and len(stat[0].split()) > 8 else None
try:
    bunv = subprocess.run(["bun", "--version"], capture_output=True, text=True).stdout.strip() or None
except OSError:
    bunv = None
doc = {
    "phase": phase, "date_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "cpu_model": lscpu("Model name"), "arch": platform.machine(), "nproc": os.cpu_count(),
    "cpuset_effective": rd(f"/sys/fs/cgroup/{cg}/cpuset.cpus.effective") or rd("/sys/fs/cgroup/cpuset.cpus.effective"),
    "seat_cpu_max": rd(f"/sys/fs/cgroup/{cg}/cpu.max"), "kernel": platform.release(),
    "os_release": osr.get("PRETTY_NAME"), "image_os": os.environ.get("IMAGE_OS") or None,
    "image_version": os.environ.get("IMAGE_VERSION") or None, "cpu_flags_md5": flags, "bun_version": bunv,
    "cpu_stat": rd(f"/sys/fs/cgroup/{cg}/cpu.stat"), "psi_cpu": rd("/proc/pressure/cpu"),
    "steal_ticks": steal, "loadavg": rd("/proc/loadavg"),
}
json.dump(doc, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PYH
}
hwfp "$OUT/hw-seat-pre.json" seat-pre
export SEQ_PREFIX=load01gap3
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR  # SLOT ⇒ دليلُ الموجةِ الصالحةِ الأخيرةِ (الأصلُ يُستبدَلُ بالإعادةِ)
wave() { # SLOT IDX [CONC] ⇒ يضبطُ V — الأداةُ مفعّلةٌ في كلِّ الموجاتِ (DISPATCH_TRACE_FILE دائمًا في b24-trace)
  local SLOT=$1 IDX=$2 WCONC=${3:-$CONC} ARM=A NAME ARM_SHA=$A_SHA CAP
  case "$SLOT" in
    AA*|S*) CAP=$REG_CAP;;
    N*) CAP=none;;
    *) echo "SLOT_ARM_UNKNOWN $SLOT"; V=INVALID; return;;
  esac
  NAME=probe-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  # الذراعُ متغيّرُ بيئةٍ واحدٌ في secrets.env (يحمّلُه wave.sh)؛ القيمةُ المفعولةُ تُتحقّقُ لاحقًا من gen_env وhttp_call (valid3)
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  [ "$CAP" = none ] || echo "LOAD_GEN_FETCH_CAP=$CAP" >> "$B/secrets.env"
  log "موجةُ القياس $NAME arm=$SLOT cap=$CAP code=$ARM_SHA conc=$WCONC (مدن=$N)"
  hwfp "$OUT/hw-$NAME-pre.json" pre
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01gap3-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  hwfp "$D/hw-post.json" post; mv "$OUT/hw-$NAME-pre.json" "$D/hw-pre.json"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC conc=$WCONC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$SLOT cap=$CAP" > "$D/arm.txt"; echo "$ARM_SHA" > "$D/arm-sha.txt"
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
  # valid3 (§4.2) بالسعةِ المسجّلةِ للذراع — تُسجَّلُ لكلِّ موجةٍ ولا تُطلِقُ إعادةً انتقائيّة
  python3 "$G3" valid3 "$D" "$CAP" "$D/gap3-validity.json" >/dev/null 2>"$D/gap3-validity.err" || echo "GAP3_VALIDITY_ANALYZE_FAIL $NAME"
  python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('GAP3_VALIDITY',d['wave'],d['valid'],json.dumps(d['run3'],ensure_ascii=False),' | '.join(d['reasons']))" "$D/gap3-validity.json" 2>/dev/null || true
  WDIR["$SLOT"]=$D
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "الموجتانِ A/A (ذراعُ S = سيمافورٌ 256، m5-$CONC، فهرسانِ 70 و71) — بوابةُ قابليةِ إعادةِ الإنتاج (§4.4)"
AA_IDX=70
for SLOT in AA1 AA2; do
  V=INVALID
  wave "$SLOT" "$AA_IDX"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((AA_IDX+10)) (الأصلُ محفوظٌ مُستبدَلًا)"
    wave "$SLOT" "$((AA_IDX+10))"
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — إيقافٌ قبلَ البوابةِ"; exit 1; }
  AA_IDX=$((AA_IDX+1))
done
rm -f "$OUT/aa-gate.json" "$OUT/q-verdict.json"   # لا JSON قديمَ يُقرأُ بعدَ إخفاقِ المحلّلِ أو قبلهُ
# q والوصفيُّ أولًا (يُحفظانِ في مساري الاجتيازِ والتوقفِ كليهما)؛ q يُفسَّرُ فقط إن اجتازت البواباتُ الثلاث (§6)
python3 "$G3" describe "$OUT/aa-descriptive.json" "${WDIR[AA1]}" "${WDIR[AA2]}" >"$OUT/aa-descriptive.log" 2>&1 || echo "AA_DESCRIBE_FAIL (وصفيٌّ — لا يغيّرُ البوابة)"
python3 "$G3" q "${WDIR[AA1]}" "${WDIR[AA2]}" "$OUT/q-verdict.json" >"$OUT/q-verdict.log" 2>&1 || echo "Q_ANALYZE_FAIL (يُسجَّلُ — لا حكم)"
python3 -c "import json;d=json.load(open('$OUT/q-verdict.json'));print('Q_VERDICT',d['verdict'],json.dumps([{k:p[k] for k in ('status','n_D_gt256','U_head_mean_D','queueWait_mean_D','U_resid_mean_D','U_resid_mean_N','wait_share_of_U_head_D')} for p in d['per_wave']],ensure_ascii=False))" 2>/dev/null || true
AA_RC=0; python3 "$G3" aa3 "${WDIR[AA1]}" "${WDIR[AA2]}" "$OUT/aa-gate.json" >"$OUT/aa-gate.log" 2>&1 || AA_RC=$?
if [ ! -s "$OUT/aa-gate.json" ] || { [ "$AA_RC" -ne 0 ] && [ "$AA_RC" -ne 3 ]; }; then
  cat "$OUT/aa-gate.log"
  echo "AA_GATE_ANALYZE_FAIL — إخفاقُ المحلّلِ = غيابُ الحكمِ: توثيقُ التوقفِ وتدقيقُ الأسرارِ عبرَ مشغّلِ البوابةِ"
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "AA_GATE_ANALYZE_FAIL" A/A "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1
fi
bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" "$OUT/aa-gate.json" "إعادةُ_إنتاجٍ_ضمنَ_±δ" "A/A" "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" \
  || { echo "PROBE_STOP عندَ بوابةِ A/A — الموجاتُ اللاحقةُ لا تبدأ (q محفوظٌ غيرُ قابلٍ للتفسير)"; exit 1; }
log "بوابةُ A/A مُجازةٌ — بوابةٌ تشخيصيّةٌ لا اختبارُ سعة"

log "تكافؤُ الحمل S1–N1–N2–S2 (m5-$CONC) — S = سيمافورٌ 256، N = بلا سعة؛ الالتزامُ والحملُ ثابتان"
for SLOT in S1 N1 N2 S2; do
  V=INVALID
  case "$SLOT" in
    S1) IDX=71;; N1) IDX=72;; N2) IDX=73;; S2) IDX=74;;
  esac
  wave "$SLOT" "$IDX"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((IDX+10)) (الأصلُ محفوظٌ مُستبدَلًا)"
    wave "$SLOT" "$((IDX+10))"
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — إيقافٌ قبلَ بوابتَي الحمل"; sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"; exit 1; }
done
sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
HW_FILES=$(for S in AA1 AA2 S1 N1 N2 S2; do ls "${WDIR[$S]}"/hw-*.json; done)
python3 "$G2" hw "$OUT/hw-all-waves.json" "$OUT/hw-seat-pre.json" $HW_FILES >"$OUT/hw-all-waves.log" 2>&1 || true
python3 "$G3" describe "$OUT/load-descriptive.json" "${WDIR[S1]}" "${WDIR[N1]}" "${WDIR[N2]}" "${WDIR[S2]}" >"$OUT/load-descriptive.log" 2>&1 || echo "LOAD_DESCRIBE_FAIL (وصفيّ)"
python3 -c "import json,sys;sys.exit(0 if json.load(open(sys.argv[1]))['identical'] else 1)" "$OUT/hw-all-waves.json" || {
  echo "LOAD_HW_MISMATCH — موجاتُ الحملِ غيرُ صالحةٍ للمقارنة (لا تفسيرَ سببيّ)"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "LOAD_HW_MISMATCH" LOAD "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1; }
rm -f "$OUT/cost-gate.json" "$OUT/load-gate.json"
# البوابتانِ تُحسبانِ كلتاهما قبلَ أيِّ توقّف — فلا تُخفي إحداهما الأخرى
COST_OK=1; python3 "$PA" cost "${WDIR[S1]}" "${WDIR[N1]}" "${WDIR[N2]}" "${WDIR[S2]}" "$OUT/cost-gate.json" >"$OUT/cost-gate.log" 2>&1 || COST_OK=0
LOAD_RC=0; python3 "$G3" load "${WDIR[S1]}" "${WDIR[N1]}" "${WDIR[N2]}" "${WDIR[S2]}" "$OUT/load-gate.json" >"$OUT/load-gate.log" 2>&1 || LOAD_RC=$?
if [ "$COST_OK" -ne 1 ] || [ ! -s "$OUT/cost-gate.json" ] || [ ! -s "$OUT/load-gate.json" ] || { [ "$LOAD_RC" -ne 0 ] && [ "$LOAD_RC" -ne 3 ]; }; then
  cat "$OUT/cost-gate.log" "$OUT/load-gate.log"
  echo "LOAD_GATES_ANALYZE_FAIL — غيابُ الحكم"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "LOAD_GATES_ANALYZE_FAIL" LOAD "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1
fi
python3 -c "import json;c=json.load(open('$OUT/cost-gate.json'));l=json.load(open('$OUT/load-gate.json'));print('COST',c['verdict'],c.get('d1_ms'),c.get('d2_ms'));print('LOAD',l['verdict'],json.dumps(l['checks'],ensure_ascii=False))" || true
bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" "$OUT/cost-gate.json" "كلفةٌ_محدودةٌ_بـ±δ" "COST" "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" \
  || { echo "PROBE_STOP عندَ بوابةِ الكلفة — q غيرُ قابلٍ للتفسير"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" "$OUT/load-gate.json" "حملٌ_متكافئٌ_ضمنَ_±5%" "LOAD" "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" \
  || { echo "PROBE_STOP عندَ بوابةِ تكافؤِ الحمل — q غيرُ قابلٍ للتفسير"; exit 1; }
echo "LOAD_GATES_PASSED — السيمافورُ لم يغيّرِ الحملَ بقاعدتَي §4.5"
AA_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/aa-gate.json'))['verdict'])")
Q_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/q-verdict.json'))['verdict'])" 2>/dev/null || echo "غيابُ_الحكم")
COST_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/cost-gate.json'))['verdict'])")
LOAD_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/load-gate.json'))['verdict'])")
echo "{\"a_sha\":\"$A_SHA\",\"a2_sha\":\"$A2_SHA\",\"registered_cap\":$REG_CAP,\"mixed_rate\":$MIXED_RATE,\"mixed_sec\":$MIXED_SEC,\"mixed_seed\":$MIXED_SEED,\"conc\":$CONC,\"cities\":\"$CITIES\",\"aa_verdict\":\"$AA_SUMMARY\",\"q_verdict\":\"$Q_SUMMARY\",\"cost_verdict\":\"$COST_SUMMARY\",\"load_verdict\":\"$LOAD_SUMMARY\",\"q_interpretable\":true,\"slots\":\"AA1 AA2 S1 N1 N2 S2\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then
  echo "SECRET_AUDIT_FAIL — توقفٌ منظّمٌ مسجَّلٌ لا خروجٌ صامتٌ"
  printf 'gate=FINAL\nreason=SECRET_AUDIT_FAIL\nstopped_at_utc=%s\n' "$(date -Is)" > "$OUT/PROBE_STOP.txt"
  printf '{"stopped_gate":"FINAL","reason":"SECRET_AUDIT_FAIL","date_utc":"%s"}\n' "$(date -Is)" > "$OUT/wave-summary-stop.json"
  rm -rf "$OUT/raw"
  exit 1
fi
echo "SECRET_AUDIT_CLEAN"
log DONE
