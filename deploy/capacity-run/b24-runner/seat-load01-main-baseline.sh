#!/usr/bin/env bash
# LOAD-01-MAIN-BASELINE · خطُّ أساسِ G1 على main الحاليّ — PROTOCOL-load01-main-baseline.md (مسجَّلٌ قبلَ أوّلِ موجة):
#   أربعُ موجاتٍ m5-1500 + حملٌ مختلط، كلُّها على الالتزامِ نفسِه M (= main @ M_SHA) بلا أيِّ تعديلٍ سلوكيّ،
#   والمولّدُ بسلوكِه الافتراضيّ (LOAD_GEN_FETCH_CAP غيرُ مضبوط). M1..M4 بفهارسَ 80..83؛ إعادةٌ واحدةٌ لموجةٍ غيرِ صالحةٍ (+10).
#   فحوصٌ قبلَ أيِّ موجة: gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50، وفرقُ المنتجِ عنْ A‴ = ملفّاتُ #663 الخمسةُ حرفًا،
#   وبصمةُ القالبِ 9d7035c8… (لا هجراتَ بعدَ A‴)، وBUN_CONFIG_MAX_HTTP_REQUESTS غيرُ مضبوط.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
# خطُّ أساسٍ لا قبول: LOAD-01M = NOT_MET وLOAD-01 = FAIL يبقيان.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01base-out
A_SHA=${M_SHA:?}; A3_SHA=${A3_SHA:?}; CONC=${CONC:-1500}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
# فرقُ M عنْ A‴ (63bc7b0f، ذراعِ RUN3/RUN4) في شيفرةِ المقعد: #663 وحدَه (C2 — دمجُ قراءةِ لغةِ المرسلِ في contact)
EXPECTED_C2_DIFF="apps/gateway/src/bots/driver/index.ts apps/gateway/src/bots/shared/language-middleware.ts packages/application/bots/one-shot-driver-lookup.ts packages/application/bots/types.ts packages/infrastructure/identity/directories.ts"
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
BA="$H/deploy/capacity-run/b24-runner/base-analyze.py"
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"

log "اختبارٌ ذاتيٌّ للمحلّلِ (§6) وفحوصُ المقعدِ الموروثة"
python3 "$H/deploy/capacity-run/b24-runner/base-analyze-selftest.py" || { echo "BASE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — لا موجة"; exit 1; }
[ -z "${LOAD_GEN_FETCH_CAP:-}" ] || { echo "LOAD_GEN_FETCH_CAP_SET_IN_SEAT_ENV — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-final-audit.test.sh" || { echo "PROBE_FINAL_AUDIT_TEST_FAIL — لا موجة"; exit 1; }

log "worktree: wt-acc (مسارُ التشغيل) وwt-ref (b24-env.json وحده) — كلاهما على M"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-ref" "$A_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
BUDGET_SRC=$(git -C "$H" show "$A_SHA:packages/shared/config/connection-budget.ts")
CONTAINER_SRC=$(git -C "$H" show "$A_SHA:apps/gateway/src/container.ts")
[[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 — لا موجة"; exit 1; }
[[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 — لا موجة"; exit 1; }
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (M)" | tee "$OUT/frozen-constants.txt"
C2_DIFF=$(git -C "$H" diff --name-only "$A3_SHA" "$A_SHA" -- apps packages deploy/capacity-run/load deploy/capacity-run/monitor deploy/capacity-run/config docker supabase package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $C2_DIFF)" = "$(echo $EXPECTED_C2_DIFF)" ] || { echo "C2_DIFF_UNEXPECTED [$C2_DIFF] — لا موجة"; exit 1; }
# القائمةُ في سجلِّ المهمّةِ وحدَه: مساراتُها الطويلةُ (≥40 محرفًا) يطابقُها نمطُ تدقيقِ الأسرارِ فتوقفُ الرفع (المحاولةُ 1)
echo "C2_DIFF_AS_EXPECTED [$C2_DIFF] (#663 وحدَه — لا هجرةَ ولا مولّدَ ولا إعدادات)"
echo "C2_DIFF_AS_EXPECTED files=$(echo $C2_DIFF | wc -w)" >> "$OUT/frozen-constants.txt"
for F in config/run.env; do
  ! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_$F — لا موجة"; exit 1; }
  ! grep -q '^LOAD_GEN_FETCH_CAP=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "LOAD_GEN_FETCH_CAP_IN_$F — لا موجة"; exit 1; }
done
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED kinds=command:message=1:1"
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
export SEQ_PREFIX=load01base
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR WVAL
wave() { # SLOT IDX ⇒ يضبطُ V
  local SLOT=$1 IDX=$2 WCONC=$CONC ARM=A NAME ARM_SHA=$A_SHA
  NAME=base-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  log "موجةُ خطِّ الأساس $NAME code=$ARM_SHA conc=$WCONC (مدن=$N)"
  hwfp "$OUT/hw-$NAME-pre.json" pre
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01base-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  hwfp "$D/hw-post.json" post; mv "$OUT/hw-$NAME-pre.json" "$D/hw-pre.json"
  local CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
  echo "$NAME COLLECT_RC=$CRC conc=$WCONC"
  cp -r "$B/qual/$RUN" "$D/qual" 2>/dev/null || true
  cp "$OUT/tpl-active-$NAME.txt" "$D/tpl-active.txt"; echo "$SLOT cap=none" > "$D/arm.txt"; echo "$ARM_SHA" > "$D/arm-sha.txt"
  ls "$D/load-trace.jsonl.gz" >/dev/null 2>&1 || echo "TRACE_MISSING $NAME"  # collect-evidence يحفظُه مضغوطًا (wave-evidence-manifest)
  bun "$H/deploy/capacity-run/monitor/job-timeline.ts" "$D" > "$D/job-timeline.json" 2>"$D/job-timeline.err" || true
  python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
  $B/bin/gates.sh "$RUN" > "$D/gates.txt" 2>&1 || true
  grep -E "G1" "$D/gates.txt" | head -2 || true
  V=$(python3 "$H/deploy/capacity-run/b24-runner/b33m-analyze.py" valid "$D" "$B26_SESSION_LIMIT" 2>"$D/validity.json") || true
  local MV; MV=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));m=d.get('mixedValidity') or {};print('MIXED_OK' if m.get('valid') else 'MIXED_INVALID '+' | '.join(m.get('reasons',['job-timeline غائب'])))" "$D/job-timeline.json" 2>/dev/null || echo "MIXED_INVALID job-timeline غائب")
  echo "$MV" | tee "$D/mixed-validity.txt"
  [ "$MV" = MIXED_OK ] || V=INVALID_MIXED
  echo "VALIDITY_$NAME $V"; cat "$D/validity.json"; echo
  python3 "$BA" wave "$D" "$D/base-wave.json" 2>"$D/base-wave.err" && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('BASE_WAVE',d['wave'],d['g1'],d['contact_acq'],d['failedGates'])" "$D/base-wave.json" || echo "BASE_WAVE_ANALYZE_FAIL $NAME"
  WDIR["$SLOT"]=$D; WVAL["$SLOT"]=$V
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "أربعُ موجاتِ خطِّ الأساس M1..M4 (m5-$CONC، فهارسُ 80..83)"
for SLOT in M1 M2 M3 M4; do
  V=INVALID
  case "$SLOT" in M1) IDX=80;; M2) IDX=81;; M3) IDX=82;; M4) IDX=83;; esac
  wave "$SLOT" "$IDX"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحة ⇒ إعادةٌ واحدةٌ بفهرس $((IDX+10)) (الأصلُ محفوظ)"
    wave "$SLOT" "$((IDX+10))"
  fi
  [ "$V" = VALID ] || { echo "WAVE_INVALID $SLOT — BASELINE_INCOMPLETE: تُعالَجُ صلاحيّةُ القياسِ قبلَ أيِّ تفسير (§5.1)"; break; }
done
HW_FILES=$(for S in "${!WDIR[@]}"; do ls "${WDIR[$S]}"/hw-*.json; done)
python3 "$G2" hw "$OUT/hw-all-waves.json" "$OUT/hw-seat-pre.json" $HW_FILES >"$OUT/hw-all-waves.log" 2>&1 || true
HW_OK=$(python3 -c "import json,sys;print('yes' if json.load(open(sys.argv[1]))['identical'] else 'no')" "$OUT/hw-all-waves.json" 2>/dev/null || echo no)
echo "HW_IDENTICAL $HW_OK"
VALID_DIRS=""
for S in M1 M2 M3 M4; do
  [ -n "${WDIR[$S]:-}" ] || continue
  [ "${WVAL[$S]:-}" = VALID ] || continue   # §5.1 — الصالحةُ وحدَها (b33m valid + MIXED_OK)
  VALID_DIRS="$VALID_DIRS ${WDIR[$S]}"
done
BRC=0; python3 "$BA" summary "$OUT/baseline-summary.json" $VALID_DIRS || BRC=$?
[ "$HW_OK" = yes ] || { echo "HW_MISMATCH — BASELINE_INCOMPLETE (§5.1)"; python3 - "$OUT/baseline-summary.json" <<'PYX' || true
import json,sys
p=sys.argv[1]; d=json.load(open(p)); d["verdict"]="BASELINE_INCOMPLETE"; d.setdefault("reasons",[]).append("بصمةُ العتادِ غيرُ متطابقةٍ عبرَ الموجات"); json.dump(d,open(p,"w"),ensure_ascii=False,indent=1,sort_keys=True)
PYX
}
echo "BASELINE_ANALYZE_RC=$BRC"

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
