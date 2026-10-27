#!/usr/bin/env bash
# LOAD-01-GAP-PROBE-RUN2 · قياسُ فجوةِ الكمونِ خارجَ الجسر — PROTOCOL-load01-gap-probe-run2.md (مسجَّلٌ قبلَ أوّلِ موجة):
#   ستُّ موجاتٍ m5-1500 كحدٍّ أقصى: AA1 AA2 (ذراعُ A″ = A′ + أدواتُ RUN2، فهرسا 70/71) ← بوابةُ A/A
#   (gap2-analyze aa2: الحدودُ السبعةُ الموروثةُ |AA2−AA1| ≤ δ=15ms ∧ valid2 ∧ بصمةُ عتادٍ متطابقة)
#   ← بوابةُ كلفةِ الأداةِ ON1–OFF1–OFF2–ON2 (71–74؛ ON = A″، OFF = 30c9dae6 بلا أيِّ أداةِ فجوة؛ probe-analyze.py cost
#   دونَ تغيير). **لا ABBA في هذهِ الدورة ولا حكمَ B−A.** الوصفيُّ (gap2-analyze describe) يُكتبُ قبلَ أيِّ توقّف.
#   المقعدُ يتوقفُ عندَ كلِّ بوابة: لا تخفيفَ ولا إعادةَ انتقائيّةً (إعادةٌ واحدةٌ لموجةٍ غيرِ صالحةٍ وفقَ القاعدةِ الموروثةِ فقط).
# لا تغييرَ في الحملِ ولا العتبات؛ gatewayRequest 5 وIMMEDIATE_REDISPATCH_LIMIT 50 محروسان.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ. أسرارُ المقعدِ عشوائيّةٌ محلّيّةٌ لا تُطبَع.
# الحكمُ تشخيصيٌّ فقط: لا ادّعاءَ سعةٍ؛ LOAD-01M = NOT_MET وLOAD-01 = FAIL يبقيان.
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01gap-run2-out
A_SHA=${A_SHA:?}; A1_SHA=${A1_SHA:?}; OFF_SHA=${OFF_SHA:?}; CONC=${CONC:-1500}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
EXP_FN_A=fn_md5=9d7035c825d977ca3f8ba5d78c73af4f
# فرقُ أداةِ RUN2 عنْ OFF (ذراعِ C2 ‏A): ملفّاتُ #671 الثمانيةُ + ملفّاتُ RUN2 لا غيرَ
EXPECTED_TOOL_DIFF="apps/gateway/src/background/load-trace.ts apps/gateway/src/index.ts apps/gateway/src/realtime/http-bridge.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts packages/infrastructure/observability/loop-probe.ts tests/unit/http-bridge-gap-probe.test.ts tests/unit/load-http-split.test.ts tests/unit/load-trace-httpreq.test.ts tests/unit/load01-gap-probe-run2.test.ts"
# فرقُ A″ عنْ A′ ‏(3bead327، ذراعِ RUN1): ملفّاتُ RUN2 وحدَها
EXPECTED_RUN2_DIFF="apps/gateway/src/background/load-trace.ts apps/gateway/src/index.ts apps/gateway/src/realtime/http-bridge.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts packages/infrastructure/observability/loop-probe.ts tests/unit/load-trace-httpreq.test.ts tests/unit/load01-gap-probe-run2.test.ts"
GAP_TOOL_FILES="apps/gateway/src/realtime/http-bridge.ts apps/gateway/src/background/load-trace.ts apps/gateway/src/index.ts deploy/capacity-run/load/lib.ts deploy/capacity-run/load/miniapp-load.ts packages/infrastructure/observability/loop-probe.ts"
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-180}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
PA="$H/deploy/capacity-run/b24-runner/probe-analyze.py"   # وضعُ cost وحدَه (قاعدةُ C2)
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"

log "اختبارٌ ذاتيٌّ للمحلّلِ على بياناتٍ مصغرةٍ معروفةِ النتائجِ (شرطُ ملحقِ البروتوكولِ)"
python3 "$H/deploy/capacity-run/b24-runner/gap-analyze-selftest.py" || { echo "GAP_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
python3 "$H/deploy/capacity-run/b24-runner/gap2-analyze-selftest.py" || { echo "GAP2_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — شرطُ الحملِ يتغيّر، لا موجة"; exit 1; }
python3 "$H/deploy/capacity-run/b24-runner/probe-analyze-selftest.py" || { echo "PROBE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-gate-stop.test.sh" || { echo "PROBE_GATE_STOP_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-analyze-fail.test.sh" || { echo "PROBE_ANALYZE_FAIL_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-audit-clean.test.sh" || { echo "PROBE_AUDIT_CLEAN_TEST_FAIL — لا موجة"; exit 1; }
bash "$H/deploy/capacity-run/b24-runner/probe-final-audit.test.sh" || { echo "PROBE_FINAL_AUDIT_TEST_FAIL — لا موجة"; exit 1; }

log "worktree اثنان: wt-acc (مسارُ التشغيل، يبدأُ من A″) وwt-ref (سجلُ b24-env.json وحده، على A″)"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$A_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-ref" "$A_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
for S in "$A_SHA" "$OFF_SHA"; do
  BUDGET_SRC=$(git -C "$H" show "$S:packages/shared/config/connection-budget.ts")
  CONTAINER_SRC=$(git -C "$H" show "$S:apps/gateway/src/container.ts")
  [[ "$BUDGET_SRC" == *$'\n  gatewayRequest: 5,'* ]] || { echo "GATEWAY_REQUEST_NOT_5 $S — لا موجة"; exit 1; }
  [[ "$CONTAINER_SRC" == *"IMMEDIATE_REDISPATCH_LIMIT = 50;"* ]] || { echo "REDISPATCH_LIMIT_NOT_50 $S — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50 (A″ و OFF)"
TOOL_DIFF=$(git -C "$H" diff --name-only "$OFF_SHA" "$A_SHA" -- apps packages deploy docker supabase tests package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $TOOL_DIFF)" = "$(echo $EXPECTED_TOOL_DIFF)" ] || { echo "TOOL_DIFF_UNEXPECTED [$TOOL_DIFF] — لا موجة"; exit 1; }
echo "TOOL_DIFF_AS_EXPECTED [$TOOL_DIFF] (فرقُ أدواتِ القياسِ عنْ OFF — لا سلوكَ منتجٍ يتغير)"
RUN2_DIFF=$(git -C "$H" diff --name-only "$A1_SHA" "$A_SHA" -- apps packages deploy docker supabase tests package.json bun.lock | sort | tr '\n' ' ')
[ "$(echo $RUN2_DIFF)" = "$(echo $EXPECTED_RUN2_DIFF)" ] || { echo "RUN2_DIFF_UNEXPECTED [$RUN2_DIFF] — لا موجة"; exit 1; }
echo "RUN2_DIFF_AS_EXPECTED [$RUN2_DIFF]"
for f in $GAP_TOOL_FILES; do
  echo "$(git -C "$H" show "$A_SHA:$f" | sha256sum | cut -c1-64)  $f" >> "$OUT/gap-tool-fingerprint.sha256sums"
done
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
export SEQ_PREFIX=load01gap2
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-180} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR  # SLOT ⇒ دليلُ الموجةِ الصالحةِ الأخيرةِ (الأصلُ يُستبدَلُ بالإعادةِ)
wave() { # SLOT IDX [CONC] ⇒ يضبطُ V — الأداةُ مفعّلةٌ في كلِّ الموجاتِ (DISPATCH_TRACE_FILE دائمًا في b24-trace)
  local SLOT=$1 IDX=$2 WCONC=${3:-$CONC} ARM NAME ARM_SHA
  case "$SLOT" in
    AA*|COST-ON*) ARM=A; ARM_SHA=$A_SHA;;
    COST-OFF*) ARM=A; ARM_SHA=$OFF_SHA;;
    *) echo "SLOT_ARM_UNKNOWN $SLOT"; V=INVALID; return;;
  esac
  NAME=probe-$1-i$2
  activate "$ARM" "$NAME" || { V=INVALID; return; }
  log "موجةُ القياس $NAME arm=$ARM code=$ARM_SHA conc=$WCONC (مدن=$N)"
  hwfp "$OUT/hw-$NAME-pre.json" pre
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  local RUN=load01gap2-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  hwfp "$D/hw-post.json" post; mv "$OUT/hw-$NAME-pre.json" "$D/hw-pre.json"
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
  # صلاحيةُ الربطِ واكتمالُ حقولِ RUN2 (§4.2) — تُسجَّلُ لكلِّ موجةٍ ولا تُطلِقُ إعادةً انتقائيّة؛ موجاتُ OFF بلا أداةٍ فتُسجَّلُ للعلمِ
  python3 "$G2" valid2 "$D" "$D/gap2-validity.json" >/dev/null 2>"$D/gap2-validity.err" || echo "GAP2_VALIDITY_ANALYZE_FAIL $NAME"
  python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('GAP2_VALIDITY',d['wave'],d['valid'],json.dumps(d['run2'],ensure_ascii=False),' | '.join(d['reasons']))" "$D/gap2-validity.json" 2>/dev/null || true
  WDIR["$SLOT"]=$D
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "الموجتانِ A/A (ذراعُ A + الأداةِ، m5-$CONC، فهرسانِ 70 و71 — عيّنتا حملٍ مستقلتانِ) — بوابةُ قابليةِ إعادةِ الإنتاجِ (ملحق §2)"
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
rm -f "$OUT/aa-gate.json"   # لا JSON قديمَ يُقرأُ بعدَ إخفاقِ المحلّلِ أو قبلهُ
# الوصفيُّ أولًا (يُحفظُ في مساري الاجتيازِ والتوقفِ كليهما) — لا قاعدةَ قرارٍ له
python3 "$G2" describe "$OUT/aa-descriptive.json" "${WDIR[AA1]}" "${WDIR[AA2]}" >"$OUT/aa-descriptive.log" 2>&1 || echo "AA_DESCRIBE_FAIL (وصفيٌّ — لا يغيّرُ البوابة)"
AA_RC=0; python3 "$G2" aa2 "${WDIR[AA1]}" "${WDIR[AA2]}" "$OUT/aa-gate.json" >"$OUT/aa-gate.log" 2>&1 || AA_RC=$?
if [ ! -s "$OUT/aa-gate.json" ] || { [ "$AA_RC" -ne 0 ] && [ "$AA_RC" -ne 3 ]; }; then
  cat "$OUT/aa-gate.log"
  echo "AA_GATE_ANALYZE_FAIL — إخفاقُ المحلّلِ = غيابُ الحكمِ: توثيقُ التوقفِ وتدقيقُ الأسرارِ عبرَ مشغّلِ البوابةِ"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "AA_GATE_ANALYZE_FAIL" A/A "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1
fi
bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" "$OUT/aa-gate.json" "إعادةُ_إنتاجٍ_ضمنَ_±δ" "A/A" "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" \
  || { echo "PROBE_STOP عندَ بوابةِ A/A — الموجاتُ اللاحقةُ لا تبدأ"; exit 1; }
log "بوابةُ A/A مُجازةٌ (الحدودُ السبعةُ ضمنَ ±δ، valid2 في الموجتين، بصمةُ العتادِ متطابقة) — بوابةٌ تشخيصيّةٌ لا اختبارُ سعة"

log "فحصُ كلفةِ الأداةِ ON–OFF–OFF–ON (m5-$CONC) — ON = A″ (كلُّ أدواتِ القياس)، OFF = 30c9dae6 (بلا أداةِ فجوة)؛ الحملُ ثابت"
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
HW_FILES=$(for S in AA1 AA2 COST-ON1 COST-OFF1 COST-OFF2 COST-ON2; do ls "${WDIR[$S]}"/hw-*.json; done)
python3 "$G2" hw "$OUT/hw-all-waves.json" "$OUT/hw-seat-pre.json" $HW_FILES >"$OUT/hw-all-waves.log" 2>&1 || true
python3 -c "import json,sys;sys.exit(0 if json.load(open(sys.argv[1]))['identical'] else 1)" "$OUT/hw-all-waves.json" || {
  echo "COST_HW_MISMATCH — موجاتُ الكلفةِ غيرُ صالحةٍ للمقارنة (لا تفسيرَ سببيّ)"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "COST_HW_MISMATCH" COST "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1; }
rm -f "$OUT/cost-gate.json"   # لا JSON قديمَ يُقرأُ بعدَ إخفاقِ المحلّلِ أو قبلهُ
if ! python3 "$PA" cost "${WDIR[COST-ON1]}" "${WDIR[COST-OFF1]}" "${WDIR[COST-OFF2]}" "${WDIR[COST-ON2]}" "$OUT/cost-gate.json" >"$OUT/cost-gate.log" 2>&1; then
  cat "$OUT/cost-gate.log"
  echo "COST_GATE_ANALYZE_FAIL — إخفاقُ المحلّلِ = غيابُ الحكمِ: توثيقُ التوقفِ وتدقيقُ الأسرارِ عبرَ مشغّلِ البوابةِ"
  bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" --stop "COST_GATE_ANALYZE_FAIL" COST "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" || true
  exit 1
fi
bash "$H/deploy/capacity-run/b24-runner/probe-gate.sh" "$OUT/cost-gate.json" "كلفةٌ_محدودةٌ_بـ±δ" "COST" "$OUT" "$B/secrets.env" "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$H/deploy/capacity-run/b24-runner" \
  || { echo "PROBE_STOP عندَ بوابةِ الكلفةِ — موجاتُ الحكمِ لا تبدأ"; exit 1; }
echo "COST_GATE_PASSED — كلفةُ أدواتِ القياسِ محدودةٌ بـ±δ بقاعدةِ C2 (وصفُ البوابةِ لا إثباتَ عدمِ ضررٍ عامًّا)"
python3 "$G2" describe "$OUT/cost-descriptive.json" "${WDIR[COST-ON1]}" "${WDIR[COST-ON2]}" >"$OUT/cost-descriptive.log" 2>&1 || echo "COST_DESCRIBE_FAIL (وصفيّ)"
AA_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/aa-gate.json'))['verdict'])")
COST_SUMMARY=$(python3 -c "import json;print(json.load(open('$OUT/cost-gate.json'))['verdict'])")
echo "{\"a_sha\":\"$A_SHA\",\"a1_sha\":\"$A1_SHA\",\"off_sha\":\"$OFF_SHA\",\"mixed_rate\":$MIXED_RATE,\"mixed_sec\":$MIXED_SEC,\"mixed_seed\":$MIXED_SEED,\"conc\":$CONC,\"cities\":\"$CITIES\",\"aa_verdict\":\"$AA_SUMMARY\",\"cost_verdict\":\"$COST_SUMMARY\",\"slots\":\"AA1 AA2 COST-ON1 COST-OFF1 COST-OFF2 COST-ON2\",\"abba\":\"not_run_by_protocol\"}" > "$OUT/wave-summary.json"

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
