#!/usr/bin/env bash
# مقعدُ تجربةِ §5.8 (SINGLE_TRIP) — LOAD-01، المرحلةُ الثانيةُ (المسجَّلةُ مسبقًا في
# PROTOCOL-load01-notice-trace.md الملحقِ د): متغيّرٌ واحدٌ — الالتقاطُ في رحلةٍ واحدةٍ
# (ST: `NOTIFICATION_CLAIM_SINGLE_TRIP=1`) مقابلَ المسارِ الحاليّ (CUR). الهجرةُ
# (20261028120000: إعادةُ `request_id` معَ الصفِّ منَ الدالّةِ نفسِها) في القالبِ
# للذراعينِ معًا، والعَلَمُ وحدهُ يُبدِّلُ المسارَ. لا حدَّ محميَّاً يُمسُّ، ولا كنساً
# ولا ضغطاً ولا ترتيباً ولا إزالةَ تكرارٍ: الصفُّ يُملَكُ بالفعلِ برمزِ الحجزِ، والقيمةُ
# هي هيَ التي كانَ يستعلمُ عنها الاستعلامُ الثاني. أدواتُ الأثرِ والتفكيكِ (trace
# وclaim-split وclaim-wait) مطفأةٌ في الذراعينِ — لا كلفتَها ولا بياناتِها.
# ترتيبُ الموجاتِ (§5.8): S1(ST) عندَ conc=100 بوابةُ خطِّ القياسِ، ثمّ ST1 CUR1 CUR2
# ST2 ST3 CUR3. التشخيصُ لا القبولَ: نجاحُ هذهِ التجربةِ لا يرفعُ LOAD-01 ولا
# LOAD-01M ولا يدمجُ شيئاً بلا مراجعةٍ؛ وحتّى ACCEPT لا يُغيّرُ المسارَ الافتراضيَّ.
# لا قاعدةَ إنتاج، لا Render، لا تيليجرامَ حقيقيّ (المحاكي).
set -euo pipefail
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/load01singletrip-out
ARM_SHA=${ARM_SHA:?}; HARNESS_SHA=${HARNESS_SHA:?}; MAIN_SHA=${MAIN_SHA:?}; CONC=${CONC:-1500}; SMOKE_CONC=${SMOKE_CONC:-100}; CITIES=${CITIES:-JED,MKK,RUH,TIF,MED}
# بصمةُ القالبِ (هجراتُ الذراعِ حتى 20261028120000 + seat-seed): الدالةُ عادَ إليها
# `request_id` فتغيّرَتْ بصمةُ الدوالِّ. حُسِبَتْ على قاعدةٍ مُهاجَرةٍ محليًّا وطُوبِقَتِ
# المنهجيّةُ على بصمةِ الذراعِ السابقِ (9d7035c8…) قبلَ الاعتمادِ (RESULT §5.8).
EXP_FN_A=fn_md5=1db3b1a24626ed2c4fb9b86e59352529
# الهجرةُ الوحيدةُ المتوقَّعةُ في الذراعِ مقابلَ main — §5.8: «الهجرةُ في الذراعينِ معًا».
EXP_MIGRATION=supabase/migrations/20261028120000_load01_claim_single_trip.sql
OVERLAY="deploy/capacity-run/load/driver-onboarding.ts deploy/capacity-run/load/job-status-poller.ts deploy/capacity-run/load/miniapp-load.ts tests/unit/job-status-poller.test.ts"
export MIXED_RATE=${MIXED_RATE:?} MIXED_SEC=${MIXED_SEC:-${WAVE_SEC:-300}} MIXED_SEED=${MIXED_SEED:-1}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }
BA="$H/deploy/capacity-run/b24-runner/base-analyze.py"
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"
VT="$H/deploy/capacity-run/monitor/single-trip-verdict.ts"
CORR_SIG="select request_id from notification_outbox where id = \$1::uuid"
CLAIM_SIG="select claim_notification_delivery() result"

log "اختباراتٌ ذاتيّةٌ (§4) وفحوصُ المقعدِ الموروثة"
python3 "$H/deploy/capacity-run/b24-runner/base-analyze-selftest.py" || { echo "BASE_ANALYZER_SELFTEST_FAIL — لا موجة"; exit 1; }
[ -z "${BUN_CONFIG_MAX_HTTP_REQUESTS:-}" ] || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_SET — لا موجة"; exit 1; }
[ -z "${LOAD_GEN_FETCH_CAP:-}" ] || { echo "LOAD_GEN_FETCH_CAP_SET_IN_SEAT_ENV — لا موجة"; exit 1; }
# شجرةُ الذراعِ النظيفةُ (كما في مقعدِ notice-trace): الاختبارُ الذاتيّ والإقلاعُ
# والتدقيقُ من wt-acc لا من شجرةِ المقعدِ التي تُوسَخُ بأسرارِ الموجاتِ — وARM_SHA
# نفسُهُ رأسُ الفرعِ فلا فروقَ بينَ الشجرتينِ قبلَ أيِّ تدقيقٍ.
log "worktree: wt-acc على ARM_SHA"
git -C "$H" worktree add -f --detach "$W/wt-acc" "$ARM_SHA" >/dev/null 2>&1
(cd "$W/wt-acc" && bun install --frozen-lockfile >"$OUT/bun-install-wt-acc.log" 2>&1)
(cd "$W/wt-acc/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-wt-acc.log" 2>&1)
# حزمةُ المحوّلِ: اختباراتُ §5.8 خضراءُ قبلَ أيِّ موجةٍ (وحدةً؛ والتكاملُ على PG
# حقيقيّ في CI) — التأكيدُ الذاتيُّ هنا لا القبولَ.
(cd "$W/wt-acc" && bun test tests/unit/notification-claim-single-trip.test.ts tests/unit/notification-claim-split.test.ts >"$OUT/selftest.log" 2>&1) || { tail -20 "$OUT/selftest.log"; echo "SINGLE_TRIP_SELFTEST_FAIL — لا موجة"; exit 1; }

log "بنيةُ الذراعِ (نفسُ فحوصِ المقعدِ) + جردُ هجراتِ §5.8"
git -C "$H" cat-file -e "$ARM_SHA^{commit}" 2>/dev/null || { echo "ARM_SHA_UNREADABLE — لا موجة"; exit 1; }
# الحدودُ المحميّةُ الأخرى: لا يغيّرُها فرقُ الذراعِ عن main (تُقارَنُ ملفّاتُها حرفًا)
PROTECTED="packages/shared/config/connection-budget.ts packages/infrastructure/notification/outbound-rate-bucket.ts packages/shared/config/domain-ingress.ts apps/gateway/src/container.ts"
for F in $PROTECTED; do
  git -C "$H" cat-file -e "$ARM_SHA:$F" || { echo "PROTECTED_FILE_MISSING $F — لا موجة"; exit 1; }
  git -C "$H" diff --quiet "$MAIN_SHA" "$ARM_SHA" -- "$F" || { echo "PROTECTED_FILE_CHANGED $F — لا موجة"; exit 1; }
done
PARENT=$(git -C "$H" rev-parse "$ARM_SHA^")
OV_DIFF=$(git -C "$H" diff --name-only "$PARENT" "$ARM_SHA" | sort | tr '\n' ' ')
[ "$(echo "$OV_DIFF" | xargs)" = "$(echo "$OVERLAY" | xargs)" ] || { echo "OVERLAY_DIFF_NOT_LIGHT_HARNESS files='$OV_DIFF' — لا موجة"; exit 1; }
git -C "$H" diff --quiet "$HARNESS_SHA" "$ARM_SHA" -- $OVERLAY || { echo "OVERLAY_NOT_IDENTICAL_TO_HARNESS — لا موجة"; exit 1; }
PROD_DIFF=$(git -C "$H" diff --name-only "$MAIN_SHA" "$PARENT" -- apps packages supabase docker package.json bun.lock | sort | tr '\n' ' ')
echo "OVERLAY_OK files=$(echo $OV_DIFF | wc -w) parent=${PARENT:0:8}" >> "$OUT/frozen-constants.txt"
echo "PRODUCT_DIFF_VS_MAIN files=$(echo $PROD_DIFF | wc -w)" >> "$OUT/frozen-constants.txt"
# §5.8 تنصُّ: «الهجرةُ في الذراعينِ معًا» — فالجردُ يتوقّعُ هجرةً واحدةً بالاسمِ، لا
# صفراً كما في تجاربِ التشخيصِ السابقةِ. أيُّ هجرةٍ أخرى = بنيةٌ غيرُ معلومةٍ = لا موجة.
MIG_DIFF=$(git -C "$H" diff --name-only "$MAIN_SHA" "$PARENT" -- supabase | sort | tr '\n' ' ')
[ "$(echo "$MIG_DIFF" | xargs)" = "$EXP_MIGRATION" ] || { echo "MIGRATION_INVENTORY_MISMATCH expected='$EXP_MIGRATION' got='$MIG_DIFF' — لا موجة"; exit 1; }
for F in config/run.env; do
  ! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_$F — لا موجة"; exit 1; }
  ! grep -q '^LOAD_GEN_FETCH_CAP=' "$W/wt-acc/deploy/capacity-run/$F" || { echo "LOAD_GEN_FETCH_CAP_IN_$F — لا موجة"; exit 1; }
done
echo "MIXED rate=$MIXED_RATE sec=$MIXED_SEC seed=$MIXED_SEED"
grep "^TELEGRAM_DRAIN_LANES=" "$W/wt-acc/deploy/capacity-run/config/run.env" | tee -a "$OUT/frozen-constants.txt" || true

log "setup-env (infra|db|migrate) من wt-acc ⇒ قاعدةٌ بهجراتِ الذراعِ (والهجرةُ في الذراعينِ معًا)"
(cd "$W/wt-acc" && git checkout -q "$ARM_SHA" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
! grep -q '^BUN_CONFIG_MAX_HTTP_REQUESTS=' "$B/secrets.env" || { echo "BUN_CONFIG_MAX_HTTP_REQUESTS_IN_SECRETS — لا موجة"; exit 1; }
sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"   # §3.4 — المولّدُ بسلوكِهِ الافتراضيّ (بلا سيمافور)
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
. "$H/deploy/capacity-run/b24-runner/b26-session-limit.env"
B26_SESSION_LIMIT=${B26_SESSION_EXCHANGE_PER_MINUTE:?}
sed -i '/^SESSION_EXCHANGE_PER_MINUTE=/d' "$B/secrets.env"
echo "SESSION_EXCHANGE_PER_MINUTE=$B26_SESSION_LIMIT" >> "$B/secrets.env"
export B26_SESSION_LIMIT
PSQL="$B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -tAX"
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$B/bin/nsx bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null

FP="$H/deploy/capacity-run/b24-runner/fingerprint.sql"
fingerprint() { $PSQL -d "$1" -v ON_ERROR_STOP=1 -q -f "$FP" 2>&1 | grep -v '^$'; }
log "قالبُ A: هجراتُ الذراعِ + seat-seed.sql ⇒ ceezr_cap_tpl_a (للذراعينِ معاً — §5.8)"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "create database ceezr_cap_tpl_a template ceezr_cap_20261016"
fingerprint ceezr_cap_tpl_a > "$OUT/tpl-fingerprint-A.txt" || { cat "$OUT/tpl-fingerprint-A.txt"; exit 1; }
cp "$OUT/tpl-fingerprint-A.txt" "$OUT/tpl-fingerprint.txt"
f=$(grep -o 'fn_md5=[^ ]*' "$OUT/tpl-fingerprint-A.txt" || true)
[ "$f" = "$EXP_FN_A" ] || { echo "TPL_A_FINGERPRINT_MISMATCH got[$f] expected[$EXP_FN_A] — لا موجة"; exit 1; }
echo "TPL_A_FN_MATCH $f"
activate() { # ARM NAME — يعيدُ إنشاءَ قالبِ الموجةِ من قالبِ الذراعِ ويتحقّقُ من بصمتِه
  $PSQL -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists ceezr_cap_tpl with (force)" -c "create database ceezr_cap_tpl template ceezr_cap_tpl_${1,,}"
  local f; f=$(fingerprint ceezr_cap_tpl | grep -o 'fn_md5=[^ ]*') || { echo "TPL_ACTIVE_FINGERPRINT_FAIL arm=$1"; return 1; }
  [ "$f" = "$EXP_FN_A" ] || { echo "TPL_ACTIVE_MISMATCH arm=$1 $f"; return 1; }
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

# بصمةُ العتادِ والحصّةِ (البروتوكول §4.3) — قبلَ كلِّ موجةٍ وبعدَها؛ مفاتيحُ الهويّةِ تُقارَنُ بـgap2-analyze hw.
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
def h(*parts):
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()[:12]
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
steal = None
try:
    lines = subprocess.run(["vmstat"], capture_output=True, text=True).stdout.splitlines()
    if len(lines) > 2:
        steal = lines[-1].split()[-1]
except OSError:
    pass
mem = rd("/proc/meminfo") or ""
doc = {
    "phase": phase, "at": now, "platform": platform.platform(), "python": platform.python_version(),
    "cpu_model": lscpu("Model name"), "cpu_mhz": lscpu("CPU max MHz"), "cpu_count": os.cpu_count(),
    "cgroup": rd(f"/sys/fs/cgroup/{cg}/cpu.max"), "meminfo_total_kb": mem.splitlines()[0] if mem else None,
    "hostname": platform.node(), "kernel": rd("/proc/sys/kernel/osrelease"),
    "fingerprint": h(platform.platform(), lscpu("Model name"), os.cpu_count(), mem.splitlines()[0] if mem else None),
    "steal_ticks": steal, "loadavg": rd("/proc/loadavg"),
}
json.dump(doc, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
PYH
}
hwfp "$OUT/hw-seat-pre.json" seat-pre
export SEQ_PREFIX=load01singletrip
export GEN_WAIT_ITERS=$(( (${WAVE_SEC:-300} + 900) / 10 ))
N=$(echo "$CITIES" | tr ',' '\n' | grep -c .)
if [ "$N" -gt 1 ]; then export LOAD01M_CITIES="$CITIES"; unset LOAD01M_CITY; else export LOAD01M_CITY="$CITIES"; unset LOAD01M_CITIES; fi
declare -A WDIR WVAL WARM
SPECS=()
# عَلَمُ §5.8 ليسَ سراً (`NOTIFICATION_CLAIM_SINGLE_TRIP`) ويظهرُ مشروعاً في diag-env؛
# يكتبُهُ fresh-db.sh لكلِّ موجةٍ ويُنظَّفُ قبلَها دائماً (وحدةُ متغيّرٍ واحدٍ).
drop_trip_cfg() { sed -i '/^NOTIFICATION_CLAIM_SINGLE_TRIP=/d' "$B/secrets.env" 2>/dev/null || true; }
trap drop_trip_cfg EXIT

log "مرجعُ الخمول ← validity (مرّةً واحدةً قبلَ أوّلِ موجة)"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b24" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-b24" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b24" "$OUT/idle-b24"

wave() { # SLOT(ST1|CUR1|…) IDX [CONC] ⇒ يضبطُ V
  local SLOT=$1 IDX=$2 WCONC=${3:-$CONC} ARM NAME
  case "$SLOT" in ST*|S1) ARM=ST;; CUR*) ARM=CUR;; *) echo "SLOT_ARM_UNKNOWN $SLOT"; V=INVALID; return;; esac
  NAME=stp-$1-i$2
  activate A "$NAME" || { V=INVALID; return; }
  sed -i '/^LOAD_GEN_FETCH_CAP=/d' "$B/secrets.env"
  if [ "$ARM" = ST ]; then export CLAIM_TRIP=1; else unset CLAIM_TRIP; fi
  log "موجةُ القياسِ $NAME arm=$ARM code=$ARM_SHA conc=$WCONC (مدن=$N)"
  hwfp "$OUT/hw-$NAME-pre.json" pre
  "$B/bin/b24-seq.sh" "$NAME" "$WCONC" "$IDX" "M:cand:$ARM_SHA" > "$OUT/seq-$NAME.log" 2>&1 || true
  unset CLAIM_TRIP; drop_trip_cfg
  local RUN=load01singletrip-$NAME-M-$WCONC E D
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|PREFLIGHT|INFLIGHT|TEMPLATE" "$OUT/seq-$NAME.log" || true
  E=$B/runs/$RUN/evidence; D=$OUT/raw/$RUN; mkdir -p "$D"
  hwfp "$D/hw-post.json" post; mv "$OUT/hw-$NAME-pre.json" "$D/hw-pre.json"
  # الذراعُ كما قرأتها البوابةُ الحيّةُ (diag-env.txt منقولٌ إلى الأدلةِ في wave-full.sh)
  local TRIP=0
  grep -q "^NOTIFICATION_CLAIM_SINGLE_TRIP=1$" "$E/diag-env.txt" 2>/dev/null && TRIP=1
  case "$TRIP" in 1) echo ST;; 0) echo CUR;; esac > "$D/arm-seen.txt"
  # جردُ §5.8: استعلاماتُ الالتقاطِ في هذهِ الموجةِ منَ pgss (عددُ نداءاتِ الدالةِ مقابلَ
  # عددِ استعلاماتِ الارتباطِ) — ST رحلةٌ واحدةٌ (ارتباطٌ ≈ 0) وCUR اثنتينِ.
  python3 - "$D" "$E" "$ARM" "$CLAIM_SIG" "$CORR_SIG" > "$D/claim-inventory.json" <<'PYI' || true
import csv, gzip, json, sys
D, E, ARM, CLAIM_SIG, CORR_SIG = sys.argv[1:6]
claims = correlation = None
try:
    with gzip.open(f"{E}/pgss-full.csv.gz", mode="rt", encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            q = (row.get("query") or "").strip()
            if q.startswith(CLAIM_SIG):
                claims = int(row["calls"])
            elif q.startswith(CORR_SIG):
                correlation = int(row["calls"])
except OSError:
    pass
json.dump({"arm": ARM, "claims": claims, "correlation": correlation,
           "queriesPerClaim": (round(correlation / claims, 3) if claims and correlation is not None else None)},
          open(f"{D}/claim-inventory.json", "w", encoding="utf-8"), ensure_ascii=False)
PYI
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
  [ "$(cat "$D/arm-seen.txt")" = "$ARM" ] || { echo "ARM_MISMATCH $NAME"; V=INVALID_ARM; }
  echo "VALIDITY_$NAME $V"; cat "$D/validity.json"; echo
  python3 "$BA" wave "$D" "$D/base-wave.json" 2>"$D/base-wave.err" && python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print('BASE_WAVE',d['wave'],d['g1'],d['failedGates'])" "$D/base-wave.json" || echo "BASE_WAVE_ANALYZE_FAIL $NAME"
  case "$SLOT" in S*) ;; *) WDIR["$SLOT"]=$D; WVAL["$SLOT"]=$V; WARM["$SLOT"]=$ARM ;; esac
}
bash "$H/deploy/capacity-run/b24-runner/seat-bin/run-wave-handoff.test.sh" || exit 1

log "بوابةُ خطِّ القياسِ S1 (ذراعُ ST عندَ conc=$SMOKE_CONC) — §5.8: لا تدخلُ في الحكمِ لكنها تُثبتُ أنّ المسارَ يعملُ وجردَهُ صحيحٌ"
V=INVALID
wave S1 90 "$SMOKE_CONC"
if [ "$V" != VALID ]; then wave S1 100 "$SMOKE_CONC"; fi
[ "$V" = VALID ] || { echo "SMOKE_INVALID S1 — إيقافٌ قبلَ الموجاتِ السبعِ (§5.8)"; exit 1; }
SD=$OUT/raw/load01singletrip-stp-S1-i$([ -d "$OUT/raw/load01singletrip-stp-S1-i100-M-$SMOKE_CONC" ] && echo 100 || echo 90)-M-$SMOKE_CONC
python3 - "$SD/claim-inventory.json" <<'PYS' || { echo "ST_PIPELINE_BROKEN — لا موجة (§5.8: الذراعُ لا يلتقطُ أو لا يُسقطُ الاستعلامَ الثاني)"; exit 1; }
import json, sys
d = json.load(open(sys.argv[1]))
ok = d["arm"] == "ST" and d["claims"] is not None and d["claims"] > 0 and (d["correlation"] or 0) == 0
print("ST_PIPELINE", "OK" if ok else "BROKEN", json.dumps(d, ensure_ascii=False))
sys.exit(0 if ok else 1)
PYS

I=80
for SLOT in ST1 CUR1 CUR2 ST2 ST3 CUR3; do
  V=INVALID
  wave "$SLOT" "$I"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: $SLOT غيرُ صالحةٍ ⇒ إعادةٌ واحدةٌ بفهرسٍ $((I+10)) (PROTOCOL §4)؛ الأصلُ محفوظٌ"
    wave "$SLOT" "$((I+10))"
  fi
  I=$((I+1))
done

HW_FILES=$(for S in "${!WDIR[@]}"; do ls "${WDIR[$S]}"/hw-*.json; done)
python3 "$G2" hw "$OUT/hw-all-waves.json" "$OUT/hw-seat-pre.json" $HW_FILES >"$OUT/hw-all-waves.log" 2>&1 || true
HW_OK=$(python3 -c "import json,sys;print('yes' if json.load(open(sys.argv[1]))['identical'] else 'no')" "$OUT/hw-all-waves.json" 2>/dev/null || echo no)
echo "HW_IDENTICAL $HW_OK"

log "الحكمُ (§5.8): ST مقابلَ CUR عبرَ single-trip-verdict"
for S in ST1 CUR1 CUR2 ST2 ST3 CUR3; do
  [ -n "${WDIR[$S]:-}" ] && SPECS+=("$S:${WARM[$S]}:$([ "${WVAL[$S]}" = VALID ] && echo VALID || echo INVALID):${WDIR[$S]}")
done
VRC=0; (cd "$W/wt-acc" && bun "$VT" "$OUT/single-trip-verdict.json" "${SPECS[@]}") || VRC=$?
echo "VERDICT_RC=$VRC"
[ "$HW_OK" = yes ] || echo "HW_MISMATCH — الحكمُ وصفيٌّ (§4)"
echo "{\"arm_sha\":\"$ARM_SHA\",\"harness_sha\":\"$HARNESS_SHA\",\"main_sha\":\"$MAIN_SHA\",\"mixed_rate\":$MIXED_RATE,\"conc\":$CONC,\"cities\":\"$CITIES\",\"hw_identical\":\"$HW_OK\",\"experiment\":\"single-trip\",\"protocol\":\"PROTOCOL-load01-notice-trace.md §5.8\"}" > "$OUT/wave-summary.json"

log "تدقيقُ الأسرار"
sed -i '/^CITIES=/d;/^CITY=/d' "$B/secrets.env"
sed -i '/^NOTIFICATION_CLAIM_SINGLE_TRIP=/d' "$B/secrets.env"
drop_trip_cfg
log "انتهى: الحكمُ في $OUT/single-trip-verdict.json — لا يُدمجُ شيءٌ ولا يُرفعُ LOAD-01 إلا بالمراجعةِ والقبولِ الرسميِّ"
