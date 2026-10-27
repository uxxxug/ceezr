#!/usr/bin/env bash
# LOAD01-NOTICE-TRACE · تفكيكُ اختناقِ الإشعارات (PROTOCOL-load01-notice-trace.md، مسجَّلٌ قبلَ أوّلِ موجة):
#   ذراعٌ واحدةٌ في الشيفرة (ARM_SHA = التزامُ التشغيل: رأسُ فرعِ الطلبِ + أداةُ الحملِ المخفَّفةُ 50121273 تراكبًا
#   بملفّاتِها الأربعةِ حرفًا — شرطُ الذراعِ B في HARNESS-AB، لا دمجَ لها)، ومتغيّرٌ واحدٌ بينَ الموجات:
#   NOTICE_TRACE_KIND (ON = rider_trip_notice، OFF = غائب). S1(ON) عند conc=100 بوابةُ خطِّ القياس، ثمّ ست موجاتِ
#   m5-1500 + حملٌ مختلط بالترتيب ON1 OFF1 OFF2 ON2 ON3 OFF3 (فهارسُ 80..85؛ إعادةٌ واحدةٌ لغيرِ الصالحةِ بفهرس +10).
# فحوصٌ قبلَ أيِّ موجة: gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 وTELEGRAM_JOB_CONSUMER_CONCURRENCY 100
#   وحدُّ الدلوِ العالميِّ 25/ث في شيفرةِ الذراع، وفرقُ التراكبِ، وبصمةُ القالب 9d7035c8…، والاختباراتُ الذاتيّة.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ (المحاكي). تشخيصٌ لا قبول: LOAD-01M = NOT_MET وLOAD-01 = FAIL يبقيان.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01noticetrace-out
ARM_SHA=${ARM_SHA:?}; HARNESS_SHA=${HARNESS_SHA:?}; MAIN_SHA=${MAIN_SHA:?}; CONC=${CONC:-1500}; SMOKE_CONC=${SMOKE_CONC:-100}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
TRACE_KIND=rider_trip_notice
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
OVERLAY="deploy/capacity-run/load/driver-onboarding.ts deploy/capacity-run/load/job-status-poller.ts deploy/capacity-run/load/miniapp-load.ts tests/unit/job-status-poller.test.ts"
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
BA="$H/deploy/capacity-run/b24-runner/base-analyze.py"
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"
VT="$H/deploy/capacity-run/monitor/notice-trace-verdict.ts"

log "اختباراتٌ ذاتيّةٌ (§4) وفحوصُ المقعدِ الموروثة"
python3 "$H/deploy/capacity-run/b24-runner/base-analyze-selftest.py" || { echo "BASE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — لا موجة"; exit 1; }
[ -z "${LOAD_GEN_FETCH_CAP:-}" ] || { echo "LOAD_GEN_FETCH_CAP_SET_IN_SEAT_ENV — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-final-audit.test.sh" || { echo "PROBE_FINAL_AUDIT_TEST_FAIL — لا موجة"; exit 1; }

log "worktree: wt-acc وwt-ref على ARM_SHA"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$ARM_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-ref" "$ARM_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
# اختباراتُ أدواتِ القياسِ الذاتيّةُ في شجرةِ الذراعِ نفسِها (فيها الاعتمادات) — الإخفاقُ يوقفُ قبلَ أيِّ موجة
(cd "$W/wt-acc" && bun test tests/unit/notice-decompose.test.ts tests/unit/notice-trace-verdict.test.ts tests/unit/notification-attempt-trace.test.ts tests/unit/notification-claim-split.test.ts >"$OUT/selftest.log" 2>&1) || { tail -20 "$OUT/selftest.log"; echo "NOTICE_TOOLS_SELFTEST_FAIL — لا موجة"; exit 1; }
BUDGET_SRC=$(git -C "$H" show "$ARM_SHA:packages/shared/config/connection-budget.ts")
CONTAINER_SRC=$(git -C "$H" show "$ARM_SHA:apps/gateway/src/container.ts")
[[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 — لا موجة"; exit 1; }
[[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 — لا موجة"; exit 1; }
# الحدودُ المحميّةُ الأخرى: لا يغيّرُها فرقُ الذراعِ عن main (تُقارَنُ ملفّاتُها حرفًا)
PROTECTED="packages/shared/config/connection-budget.ts packages/infrastructure/notification/outbound-rate-bucket.ts packages/shared/config/domain-ingress.ts apps/gateway/src/container.ts"
for F in $PROTECTED; do
  git -C "$H" cat-file -e "$ARM_SHA:$F" || { echo "PROTECTED_FILE_MISSING $F — لا موجة"; exit 1; }
  git -C "$H" diff --quiet "$MAIN_SHA" "$ARM_SHA" -- "$F" || { echo "PROTECTED_FILE_CHANGED $F — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 protected_files_unchanged_vs_main" | tee "$OUT/frozen-constants.txt"
PARENT=$(git -C "$H" rev-parse "$ARM_SHA^")
OV_DIFF=$(git -C "$H" diff --name-only "$PARENT" "$ARM_SHA" | sort | tr '\n' ' ')
[ "$(echo $OV_DIFF)" = "$(echo $OVERLAY)" ] || { echo "OVERLAY_DIFF_UNEXPECTED [$OV_DIFF] — لا موجة"; exit 1; }
git -C "$H" diff --quiet "$HARNESS_SHA" "$ARM_SHA" -- $OVERLAY || { echo "OVERLAY_NOT_IDENTICAL_TO_HARNESS — لا موجة"; exit 1; }
PROD_DIFF=$(git -C "$H" diff --name-only "$MAIN_SHA" "$PARENT" -- apps packages supabase docker package.json bun.lock | sort | tr '\n' ' ')
echo "OVERLAY_OK files=$(echo $OV_DIFF | wc -w) parent=${PARENT:0:8}" >> "$OUT/frozen-constants.txt"
echo "PRODUCT_DIFF_VS_MAIN files=$(echo $PROD_DIFF | wc -w) (لا هجرة: $(git -C "$H" diff --name-only "$MAIN_SHA" "$PARENT" -- supabase | wc -l))" >> "$OUT/frozen-constants.txt"
[ "$(git -C "$H" diff --name-only "$MAIN_SHA" "$PARENT" -- supabase | wc -l)" = 0 ] || { echo "MIGRATION_IN_ARM — لا موجة"; exit 1; }
for F in config/run.env; do
  ! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_$F — لا موجة"; exit 1; }
  ! grep -q '^LOAD_GEN_FETCH_CAP=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "LOAD_GEN_FETCH_CAP_IN_$F — لا موجة"; exit 1; }
done
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED"
grep "^TELEGRAM_DRAIN_LANES=" "$W/wt-acc/deploy/capacity-run/config/run.env" | tee -a "$OUT/frozen-constants.txt" || true

log "setup-env (infra|db|migrate) من wt-acc ⇒ قاعدةٌ بهجراتِ A"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$B/secrets.env" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_SECRETS — لا موجة"; exit 1; }
sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"   # §3.4 — المولّدُ بسلوكِه الافتراضيّ (بلا سيمافور)
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
export SEQ_PREFIX=load01noticetrace
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR WVAL WARM
SPECS=()
# قيمُ ضبطِ الأثرِ ليست أسرارًا، و`rider_trip_notice` يظهرُ مشروعًا في كلِّ دليل؛ يكتبُها fresh-db.sh لكلِّ
# موجة. تُزالُ فورَ انتهاءِ كلِّ موجةٍ وعندَ أيِّ خروج (حادثةُ التشغيلِ 40523141202: خروجُ بوّابةِ S1 المبكّرُ
# تخطّى الإزالةَ فعدَّها التدقيقُ النهائيُّ سرًّا مطابَقًا وأسقطَ الخام).
drop_trace_cfg() { sed -i '/^NOTIFICATION_ATTEMPT_TRACE=/d;/^NOTIFICATION_ATTEMPT_TRACE_KINDS=/d;/^NOTIFICATION_CLAIM_SPLIT=/d' "$B/secrets.env" 2>/dev/null || true; }
trap drop_trace_cfg EXIT

wave() { # SLOT(ON1|OFF1|S1…) IDX [CONC] ⇒ يضبطُ V
  local SLOT=$1 IDX=$2 WCONC=${3:-$CONC} ARM NAME
  case "$SLOT" in ON*|S1) ARM=ON;; OFF*) ARM=OFF;; *) echo "SLOT_ARM_UNKNOWN $SLOT"; V=INVALID; return;; esac
  NAME=ntr-$1-i$2
  activate A "$NAME" || { V=INVALID; return; }
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  if [ "$ARM" = ON ]; then export NOTICE_TRACE_KIND=$TRACE_KIND; else unset NOTICE_TRACE_KIND; fi
  log "موجةُ القياس $NAME trace=$ARM code=$ARM_SHA conc=$WCONC (مدن=$N)"
  hwfp "$OUT/hw-$NAME-pre.json" pre
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  unset NOTICE_TRACE_KIND; drop_trace_cfg
  local RUN=load01noticetrace-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE|NOTICE_DECOMPOSE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  hwfp "$D/hw-post.json" post; mv "$OUT/hw-$NAME-pre.json" "$D/hw-pre.json"
  # الذراعُ كما قرأتها البوّابةُ الحيّة (diag-env.txt منقولٌ إلى الأدلّة في wave-full.sh)
  # الملحق ج: ذراعُ ON = الأثرُ والتفكيكُ معًا؛ أحدُهما وحدَه = SPLIT_ONLY/TRACE_ONLY ⇒ عدمُ تطابقٍ يُبطلُ الموجة.
  local TS=0 CS=0
  grep -q "^NOTIFICATION_ATTEMPT_TRACE=1" "$E/diag-env.txt" 2>/dev/null && TS=1
  grep -q "^NOTIFICATION_CLAIM_SPLIT=1" "$E/diag-env.txt" 2>/dev/null && CS=1
  case "$TS$CS" in 11) echo ON;; 00) echo OFF;; 10) echo TRACE_ONLY;; *) echo SPLIT_ONLY;; esac > "$D/trace-arm-seen.txt"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC conc=$WCONC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$ARM" > "$D/arm.txt"; echo "$ARM_SHA" > "$D/arm-sha.txt"
  bun "$H/deploy/capacity-run/monitor/job-timeline.ts" "$D" > "$D/job-timeline.json" 2>"$D/job-timeline.err" || true
  $B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
  V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$D/validity.json") || true
  local MV; MV=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));m=d.get('mixedValidity') or {};print('MIXED_OK' if m.get('valid') else 'MIXED_INVALID '+' | '.join(m.get('reasons',['job-timeline غائب'])))" "$D/job-timeline.json" 2>/dev/null || echo "MIXED_INVALID job-timeline غائب")
  echo "$MV" | tee "$D/mixed-validity.txt"
  [ "$MV" = MIXED_OK ] || V=INVALID_MIXED
  [ "$(cat "$D/trace-arm-seen.txt")" = "$ARM" ] || { echo "TRACE_ARM_MISMATCH $NAME"; V=INVALID_ARM; }
  echo "VALIDITY_$NAME $V"; cat "$D/validity.json"; echo
  python3 "$BA" wave "$D" "$D/base-wave.json" 2>"$D/base-wave.err" && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('BASE_WAVE',d['wave'],d['g1'],d['failedGates'])" "$D/base-wave.json" || echo "BASE_WAVE_ANALYZE_FAIL $NAME"
  [ -f "$D/notice-decompose.json" ] && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('NOTICE_DECOMPOSE',sys.argv[2],json.dumps({'valid':d['validity'],'attempts':d['attemptsSeen'],'pending':[d['pendingAtAudit'],d['auditPending']],'oldest':[d['reconstructedOldestPendingSec'],d['auditOldestPendingSec']],'oldest20':d['oldest20']['groupsPct'],'pass':(d.get('drainPasses') or {}).get('pass',{}).get('pctOfPassElapsed'),'claimMeanMs':(d.get('drainPasses') or {}).get('pass',{}).get('claimMeanMs'),'claimSplit':(d.get('drainPasses') or {}).get('pass',{}).get('claimSplit'),'loop':(d.get('drainPasses') or {}).get('pass',{}).get('loop')},ensure_ascii=False))" "$D/notice-decompose.json" "$NAME" || echo "NOTICE_DECOMPOSE_ABSENT $NAME arm=$ARM"
  case "$SLOT" in S*) ;; *) WDIR["$SLOT"]=$D; WVAL["$SLOT"]=$V; WARM["$SLOT"]=$ARM ;; esac
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "بوابةُ خطِّ القياس S1 (trace=ON عند conc=$SMOKE_CONC) — PROTOCOL §4: لا تدخلُ في الحكم"
V=INVALID
wave S1 90 "$SMOKE_CONC"
if [ "$V" != VALID ]; then wave S1 100 "$SMOKE_CONC"; fi
[ "$V" = VALID ] || { echo "SMOKE_INVALID S1 — إيقافٌ قبلَ الموجاتِ الست"; exit 1; }
SD=$OUT/raw/load01noticetrace-ntr-S1-i$([ -d "$OUT/raw/load01noticetrace-ntr-S1-i100-M-$SMOKE_CONC" ] && echo 100 || echo 90)-M-$SMOKE_CONC
python3 - "$SD/notice-decompose.json" <<'PYS' || { echo "TRACE_PIPELINE_BROKEN — لا موجة (PROTOCOL §4: الأثرُ لا يصلُ أو لا يطابقُ اللقطة)"; exit 1; }
import json,sys
d=json.load(open(sys.argv[1]))
ok = d["attemptsSeen"] > 0 and d["unmeteredAttempts"] == 0 and d["validity"]["ok"]
print("TRACE_PIPELINE", "OK" if ok else "BROKEN", json.dumps({"attempts": d["attemptsSeen"], "reasons": d["validity"]["reasons"]}))
sys.exit(0 if ok else 1)
PYS

I=80
for SLOT in ON1 OFF1 OFF2 ON2 ON3 OFF3; do
  V=INVALID
  wave "$SLOT" "$I"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((I+10)) (PROTOCOL §4)؛ الأصلُ محفوظٌ"
    wave "$SLOT" "$((I+10))"
  fi
  I=$((I+1))
done

HW_FILES=$(for S in "${!WDIR[@]}"; do ls "${WDIR[$S]}"/hw-*.json; done)
python3 "$G2" hw "$OUT/hw-all-waves.json" "$OUT/hw-seat-pre.json" $HW_FILES >"$OUT/hw-all-waves.log" 2>&1 || true
HW_OK=$(python3 -c "import json,sys;print('yes' if json.load(open(sys.argv[1]))['identical'] else 'no')" "$OUT/hw-all-waves.json" 2>/dev/null || echo no)
echo "HW_IDENTICAL $HW_OK"

log "الحكمُ (PROTOCOL §5): TRACE/OVERHEAD/ATTRIBUTION/REPRO عبرَ notice-trace-verdict"
for S in ON1 OFF1 OFF2 ON2 ON3 OFF3; do
  [ -n "${WDIR[$S]:-}" ] && SPECS+=("$S:${WARM[$S]}:$([ "${WVAL[$S]}" = VALID ] && echo VALID || echo INVALID):${WDIR[$S]}")
done
VRC=0; (cd "$W/wt-acc" && bun "$VT" "$OUT/notice-trace-verdict.json" "${SPECS[@]}") || VRC=$?
echo "VERDICT_RC=$VRC"
[ "$HW_OK" = yes ] || echo "HW_MISMATCH — الحكمُ وصفيٌّ (§4)"
echo "{\"arm_sha\":\"$ARM_SHA\",\"harness_sha\":\"$HARNESS_SHA\",\"main_sha\":\"$MAIN_SHA\",\"mixed_rate\":$MIXED_RATE,\"conc\":$CONC,\"cities\":\"$CITIES\",\"hw_identical\":\"$HW_OK\",\"trace_kind\":\"$TRACE_KIND\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
# قيمُ ضبطِ الأثرِ ليست أسرارًا، و`rider_trip_notice` (≥8 محارف) يظهرُ مشروعًا في كلِّ دليل — تُزالُ قبلَ التدقيق
# وإلّا عدَّها المدقّقُ سرًّا مطابَقًا حرفيًّا فحذفَ الخامَّ (درسٌ مُستبَقٌ لا حادثة).
sed -i '/^NOTIFICATION_ATTEMPT_TRACE=/d;/^NOTIFICATION_ATTEMPT_TRACE_KINDS=/d' "$B/secrets.env"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then
  echo "SECRET_AUDIT_FAIL — توقفٌ منظّمٌ مسجَّلٌ لا خروجٌ صامتٌ"
  printf 'gate=FINAL\nreason=SECRET_AUDIT_FAIL\nstopped_at_utc=%s\n' "$(date -Is)" > "$OUT/PROBE_STOP.txt"
  rm -rf "$OUT/raw"
  exit 1
fi
echo "SECRET_AUDIT_CLEAN"
log DONE
