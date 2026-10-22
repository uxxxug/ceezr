#!/usr/bin/env bash
# الدفعة 32 (نسخةُ seat-b31.sh حرفًا، والفرقُ: ذراعانِ للقرار C (مرجع) وP (مرشّح) بسلسلتين ABBA من 8، ومرساةُ I للإعلامِ
#   (موجتان بعدَ السلسلتين، خارجَ القرار)، وحُرّاسٌ إضافيّة: P−C ملفّاتٌ معلنةٌ وحدَها، gatewayRequest: 5 وIMMEDIATE_REDISPATCH_LIMIT = 50
#   في الأذرعِ الثلاثة، ومخرجاتُ b32 ومحلِّلُ b32؛ PLAN-b32.md مثبَّتةٌ قبلَ أوّلِ موجة).
# الدفعة 31 (نسخةُ seat-b30.sh حرفًا، والفرقُ: أربعةُ أذرعٍ A/D/S/X وسلسلتانِ من 8 ومخرجاتُ b31 ومحلِّلُ b31؛ PLAN-b31.md مثبَّتةٌ قبلَ أوّلِ موجة).
# الدفعة 30 (نسخةُ seat-b28.sh حرفًا حتى الجامع، والفرقُ: ثلاثةُ أذرعٍ A/L/S ومخرجاتُ b30 ومحلِّلُ b30؛ PLAN-b30.md مثبَّتةٌ قبلَ أوّلِ موجة).
# الدفعة 28 (نسخةُ seat-b27.sh حرفًا، والفرقُ: مخرجاتُ b28، سلسلةٌ واحدة main/50، جامعُ أدلّةٍ ببيانٍ مُعلَن (collect-evidence.ts) بدلَ القائمةِ التي أسقطت telegram-jobs.csv، وتأكيدُ عدمِ تغيّرِ المجمّعِ/الاتصال بين R وC، ومحلِّلُ b28) — الدفعة 27 (نسخةُ seat-b26.sh حرفًا، والفرقُ: SHAs السلسلةِ والحدُّ ومحلِّلُ b27 فقط) — الدفعة 26 (مبنيٌّ على seat.sh للدفعة 25 حرفًا، والفرقُ: حدُّ مبادلةِ الجلسةِ للمقعدِ وحدَه + فحصٌ تمهيديٌّ + عدّاداتُ 429) — مقعدُ GitHub (4 vCPU): يبني نسخةً من مقعدِ CAP-RUN-20261016 بالمساراتِ نفسِها حرفاً،
# ثمّ مرجعَ خمولٍ ← validity مشتقّة ← الموجات. يعملُ بالمستخدم «user» داخلَ ceezrseat.slice.
#   seat-b28.sh full   (SERIES=main، LIMIT=50)
# لا أسرارَ حقيقيّة: setup-env يولّدُ أسرارَ المقعدِ المحلّيّةَ عشوائيّاً (600) ولا تُطبَع.
set -euo pipefail
MODE=${1:?smoke|full}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/b32-out
MAIN_SHA=${MAIN_SHA:?}; C_ARM=${C_ARM:?}; P_ARM=${P_ARM:?}; I_ARM=${I_ARM:?}; LIMIT=${LIMIT:?}
# wt-ref = C (المرجع)؛ wt-acc يبدأُ على P ويُبدِّلُه b24-seq.sh إلى P أو I قبلَ كلِّ موجةٍ مرشّحة.
R_SHA=$C_ARM; C_SHA=$P_ARM; SERIES=b32
# بادئةُ أسماءِ الموجات: b28main للتشغيلِ المحكوم، وb28rep للنسخةِ التشخيصيّة (PLAN-b28-replicate.md).
RUN_TAG=${RUN_TAG:-main}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktrees R=$R_SHA C=$C_SHA"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$R_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$C_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  # وسيطُ REST خارجَ مساحةِ العمل: له قفلُه ووحداتُه (كما على المقعدِ الأصليّ).
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
grep -H "^  gatewayRequest: " "$W/wt-ref/packages/shared/config/connection-budget.ts" "$W/wt-acc/packages/shared/config/connection-budget.ts"
# الدفعة 32: لا تغييرَ في سعةِ المجمّعِ ولا في تركيبِ الاتصال بين main وC وP وI (gatewayRequest: 5) — وإلّا لا موجة.
for X in $C_ARM $P_ARM $I_ARM; do git -C "$H" diff --quiet "$MAIN_SHA" "$X" -- packages/shared/config/connection-budget.ts packages/infrastructure/db/client.ts || { echo "POOL_CHANGED main..$X — لا موجة"; exit 1; }; done
for X in $C_ARM $P_ARM $I_ARM; do git -C "$H" diff --quiet "$MAIN_SHA" "$X" -- deploy/capacity-run/load || { echo "GENERATOR_CHANGED main..$X — لا موجة"; exit 1; }; done
# مهلةُ الإيجارِ وعددُ المساراتِ وإعادةُ المحاولة دونَ تغيير.
for X in $C_ARM $P_ARM $I_ARM; do git -C "$H" diff --quiet "$MAIN_SHA" "$X" -- packages/shared/config/domain-ingress.ts deploy/capacity-run/config/run.env packages/infrastructure/db/telegram-update-queue.ts || { echo "DRAINER_CONFIG_CHANGED main..$X — لا موجة"; exit 1; }; done
# الدفعة 32: المتغيّرُ الوحيدُ بين C وP — الملفّاتُ المعلنةُ في PLAN-b32.md §4 وحدَها.
PC_FILES=$(git -C "$H" diff --name-only "$C_ARM" "$P_ARM" | sort | tr '\n' ' ')
[ "$PC_FILES" = "apps/gateway/src/background/telegram-update-drainer.ts packages/infrastructure/db/query-deadline.ts tests/unit/query-deadline-gate-priority.test.ts " ] || { echo "P_MINUS_C_UNEXPECTED [$PC_FILES] — لا موجة"; exit 1; }
echo "P_MINUS_C_FILES $PC_FILES"
# الثابتان المجمَّدان في الأذرعِ الثلاثة حرفًا.
for X in $C_ARM $P_ARM $I_ARM; do
  git -C "$H" show "$X:packages/shared/config/connection-budget.ts" | grep -q "^  gatewayRequest: 5," || { echo "GATEWAY_REQUEST_NOT_5 $X — لا موجة"; exit 1; }
  git -C "$H" show "$X:apps/gateway/src/container.ts" | grep -q "IMMEDIATE_REDISPATCH_LIMIT = 50;" || { echo "REDISPATCH_LIMIT_NOT_50 $X — لا موجة"; exit 1; }
done
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-ref/deploy/capacity-run/config/run.env" "$W/wt-acc/deploy/capacity-run/config/run.env"
grep -H "IMMEDIATE_REDISPATCH_LIMIT = " "$W/wt-ref/apps/gateway/src/container.ts" "$W/wt-acc/apps/gateway/src/container.ts"
if git -C "$H" diff --quiet "$R_SHA" "$C_SHA" -- packages/shared/config/connection-budget.ts packages/infrastructure/db/client.ts; then
  echo "POOL_UNCHANGED R=$R_SHA C=$C_SHA"; else echo "POOL_CHANGED — لا موجة"; exit 1; fi
# البصماتُ الكاملةُ في ملفِّ *.sha256sums (ضمنَ استثناءِ ملفّاتِ البصماتِ في التدقيق) لا في سطرٍ نصّيٍّ — سطرُ
# collector.txt في التشغيلِ الأوّل (39559093346) أسقطَ تدقيقَ الأسرارِ فحُجِرَ الخامّ.
sha256sum "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$H/deploy/capacity-run/monitor/wave-evidence-manifest.json" > "$OUT/collector.sha256sums"
echo "COLLECTOR $(cut -c1-16 "$OUT/collector.sha256sums" | tr "\n" " ")"

log "setup-env (infra|db|migrate) من wt-acc"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
# المقعدُ الأصليُّ أُضيفَ إليه INTERNAL_SIGNAL_SECRET يدويّاً (64 hex) بعدَ setup-env؛ بلاه تعيدُ إشارةُ العروضِ 503.
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
echo "secrets_keys=$(cut -d= -f1 "$B/secrets.env" | tr '\n' ' ')"
# ── الدفعة 26: حدُّ مبادلةِ الجلسةِ لمقعدِ الاختبارِ وحدَه (مثبَّتٌ قبلَ أوّلِ موجةٍ في b26-session-limit.env)
# secrets.env يُقرأُ بعدَ run.env في svc.sh وwave.sh، فيعلو على 6000 هناك للجانبَين بالتساوي؛ run.env
# في الشيفرة (6000) والقيمةُ الافتراضيّةُ في policy.ts (30، حدُّ الإنتاج) لا يُمسّان.
. "$H/deploy/capacity-run/b24-runner/b26-session-limit.env"
B26_SESSION_LIMIT=${B26_SESSION_EXCHANGE_PER_MINUTE:?}
DEM=$(python3 -c "import json;print(json.load(open('$H/deploy/capacity-run/b24-runner/b26-demand.json'))['SESSION_EXCHANGE_PER_MINUTE'])")
[ "$DEM" = "$B26_SESSION_LIMIT" ] || { echo "SESSION_LIMIT_MISMATCH env=$B26_SESSION_LIMIT demand=$DEM"; exit 1; }
sed -i '/^SESSION_EXCHANGE_PER_MINUTE=/d' "$B/secrets.env"
echo "SESSION_EXCHANGE_PER_MINUTE=$B26_SESSION_LIMIT" >> "$B/secrets.env"
export B26_SESSION_LIMIT
echo "SEAT_SESSION_LIMIT=$B26_SESSION_LIMIT run_env_ref=$(grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' $W/wt-ref/deploy/capacity-run/config/run.env | cut -d= -f2) run_env_acc=$(grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' $W/wt-acc/deploy/capacity-run/config/run.env | cut -d= -f2)" | tee "$OUT/session-limit-seat.txt"
NSX=$B/bin/nsx; PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres"
# المقعدُ الأصليّ: pg_stat_statements مُحمَّلٌ مسبقاً (postgresql.auto.conf).
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$NSX bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null
$PSQL -d postgres -Atc "show shared_preload_libraries"

log "قالبُ المقعد: هجراتٌ + seat-seed.sql ثمّ ceezr_cap_tpl"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -qc "create database ceezr_cap_tpl template ceezr_cap_20261016"
$PSQL -d ceezr_cap_tpl -q -f "$H/deploy/capacity-run/b24-runner/fingerprint.sql" 2>&1 | grep -v '^$' > "$OUT/tpl-fingerprint.txt"
# المقارنة: دوالُّ المشروعِ حرفاً والجداولُ غيرُ الفارغةِ بعددِ صفوفِها (أقسامُ السجلِّ المؤرَّخةُ تتبعُ التاريخ).
exp_fn=$(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$H/deploy/capacity-run/b24-runner/expected-fingerprint.txt")
exp_ne=$(grep -o 'nonempty=.*' "$H/deploy/capacity-run/b24-runner/expected-fingerprint.txt")
got_fn=$(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$OUT/tpl-fingerprint.txt"); got_ne=$(grep -o 'nonempty=.*' "$OUT/tpl-fingerprint.txt")
if [ "$exp_fn" = "$got_fn" ] && [ "$exp_ne" = "$got_ne" ]; then echo "TPL_FINGERPRINT_MATCH $got_fn"; else
  echo "TPL_FINGERPRINT_MISMATCH exp[$exp_fn | $exp_ne] got[$got_fn | $got_ne]"; exit 1; fi

log "أدواتُ المقعد"
cp "$H"/deploy/capacity-run/b24-runner/seat-bin/* "$B/bin/"; chmod 755 "$B"/bin/*

log "المحاكي والوسيط من wt-acc"
(cd "$W/wt-acc" && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh mock && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh shim)
sleep 8
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh status) | tee "$OUT/svc-status.txt" || true
grep -q "telegram-mock=up" "$OUT/svc-status.txt" && grep -q "shim=up" "$OUT/svc-status.txt" || { echo "SEAT_SERVICES_DOWN"; tail -20 "$B/runs/current/evidence/shim.log" 2>/dev/null; exit 1; }

log "سجلُّ البيئة"
{
  echo "date_utc=$(date -Is)"; echo "nproc=$(nproc)"; lscpu | grep -E "Model name|^CPU\(s\)|Thread|Core|Socket|Hypervisor|MHz" | tr -s ' '
  free -m | head -2; uname -r; . /etc/os-release; echo "os=$PRETTY_NAME"
  postgres --version; $PSQL -d ceezr_cap_tpl -Atc "select extname||' '||extversion from pg_extension order by 1" | tr '\n' ' '; echo
  redis-server --version; echo "bun=$(bun --version)"; python3 --version; echo "node=$(node --version 2>/dev/null || echo absent)"
  $PSQL -d postgres -Atc "select name||'='||setting||coalesce(unit,'') from pg_settings where source not in ('default','override','client','session') order by 1"
  echo "pg_cgroup=$(cat /proc/$(pgrep -f 'postgres -D' | head -1)/cgroup)"; echo "self_cgroup=$(cat /proc/self/cgroup)"
  echo "seat_cpu_max=$(cat /sys/fs/cgroup/$CAP_SEAT_CG/cpu.max 2>/dev/null)"
  grep -E "open files|processes" /proc/$(pgrep -f 'postgres -D' | head -1)/limits | tr -s ' '
  sudo -n ip netns exec ceezrsbx2 sysctl net.core.somaxconn net.ipv4.ip_local_port_range 2>/dev/null
  cat /sys/kernel/mm/transparent_hugepage/enabled; echo "psi=$(head -1 /proc/pressure/cpu 2>/dev/null)"
  echo "seat_session_exchange_per_minute=$B26_SESSION_LIMIT (secrets.env override; run.env=6000 unchanged; prod default 30 unchanged)"
  echo "running_services:"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print "  "$1}'
} > "$OUT/seat-env.txt" 2>&1
cat "$OUT/seat-env.txt" | head -30
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh assert)

log "مرجعُ الخمول (البوّابةُ مطفأة) ← validity B23-RUNNER-V1"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b24" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-b24" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b24" "$OUT/idle-b24"
echo "VALIDITY_PINNED $(date -Is) sha256=$(sha256sum $B/bin/validity.json | cut -c1-16)"

export SEQ_PREFIX=b32$RUN_TAG
collect() {
  for r in "$@"; do
    E=$B/runs/$r/evidence; D=$OUT/raw/$r; mkdir -p "$D"; [ -d "$E" ] || { echo "MISSING $r"; continue; }
    CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
    grep -E "^COLLECT_(MISSING|DONE)" "$D/collect.out" | sed "s|^|$r |" || true; echo "$r COLLECT_RC=$CRC"
    cp -r "$B/qual/$r" "$D/qual" 2>/dev/null || true
    python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
    $B/bin/gates.sh "$r" > "$D/gates.txt" 2>&1 || true
  done
}
AN="$H/deploy/capacity-run/b24-runner/b26-analyze.py"
AN32="$H/deploy/capacity-run/b24-runner/b32-analyze.py"
P=b32$RUN_TAG

log "فحصٌ تمهيديٌّ (ليس موجةَ قياس): P عند 750 لمدّة 120s — إثباتُ الحدِّ الفعليِّ وغيابِ 429 حدِّ الجلسة"
WAVE_SEC=120 "$B/bin/b24-seq.sh" smoke 750 28 "P0:cand:$P_ARM" > "$OUT/seq-smoke.log" 2>&1 || true
collect $P-smoke-P0-750
SMOKE_RC=0
python3 "$AN" smoke "$OUT" $P-smoke-P0-750 "$B26_SESSION_LIMIT" > "$OUT/b32-smoke.json" 2>"$OUT/b32-smoke.err" || SMOKE_RC=$?
cat "$OUT/b32-smoke.err"
# الأداةُ حاضرةٌ في الفحصِ التمهيديّ (سجلّاتُ pagg وحقولُ البوّابةِ في سطرِ الوظيفة) — وإلّا لا سلسلة.
python3 "$AN32" wave "$OUT/raw/$P-smoke-P0-750" "$B26_SESSION_LIMIT" > "$OUT/b32-smoke-wave.json" 2>"$OUT/b32-smoke-wave.err" || SMOKE_RC=$?
python3 -c "import json,sys;w=json.load(open('$OUT/b32-smoke-wave.json'));ok=w['paths_b32'].get('present') and w['jobs_b32'].get('present');print('SMOKE_INSTRUMENTATION', 'PRESENT' if ok else 'MISSING');sys.exit(0 if ok else 1)" || SMOKE_RC=$?
ALL=""
if [ $SMOKE_RC -ne 0 ]; then
  echo "SMOKE_FAIL — لا سلسلةَ قياس (القاعدةُ المسجَّلة: لا تُعدَّلُ القيمةُ ولا يُخمَّن)"
else
  # سلسلتان إلزاميّتان؛ كلٌّ منهما تُعادُ مرّةً واحدةً كاملةً إن كانت فيها موجةٌ غيرُ صالحة (PLAN-b32.md §6).
  run_series() { # TAG IDX0 NAMES…
    local TAG=$1 I=$2; shift 2
    local items="" n
    for n in "$@"; do
      case $n in C*) items="$items $n:ref:$C_ARM";; P*) items="$items $n:cand:$P_ARM";; I*) items="$items $n:cand:$I_ARM";; esac
    done
    log "السلسلة $TAG: $*"
    # shellcheck disable=SC2086
    "$B/bin/b24-seq.sh" $TAG 750 $I $items > "$OUT/seq-$TAG.log" 2>&1 || true
    RUNS=$(for n in "$@"; do printf "%s-%s-%s-750 " $P $TAG $n; done)
    # shellcheck disable=SC2086
    collect $RUNS
    grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|MISMATCH" "$OUT/seq-$TAG.log" || true
    # shellcheck disable=SC2086
    V=$(python3 "$AN32" validity "$OUT" $# $RUNS 2>"$OUT/validity-$TAG.json")
    echo "SERIES_$TAG $V"
  }
  I=30
  for SPEC in "s1:C1 P1 P2 C2 C3 P3 P4 C4" "s2:P5 C5 C6 P6 P7 C7 C8 P8"; do
    TAG=${SPEC%%:*}; NAMES=${SPEC#*:}
    # shellcheck disable=SC2086
    run_series $TAG $I $NAMES; I=$((I+8))
    if [ "$V" != ALL_VALID ]; then
      echo "قاعدةُ الإعادة: موجةٌ غيرُ صالحةٍ ⇒ تُعادُ السلسلةُ $TAG كاملةً مرّةً واحدة (الأدلّةُ محفوظة)"
      # shellcheck disable=SC2086
      run_series ${TAG}r $I $NAMES; I=$((I+8))
    fi
    ALL="$ALL $RUNS"
  done
  # مرساةُ I (main + الأداة) للإعلامِ وحدَه: موجتان بعدَ السلسلتين، لا تُعادان ولا تدخلان القرار (PLAN-b32.md §5).
  run_series a1 $I I1 I2; I=$((I+2))
  ANCHOR=$RUNS
  # shellcheck disable=SC2086
  python3 "$AN32" decide "$OUT" "$B26_SESSION_LIMIT" $ALL $ANCHOR > "$OUT/b32-decision.json" 2>"$OUT/b32-decision.err" || tail -5 "$OUT/b32-decision.err"
  python3 -c "import json;r=json.load(open('$OUT/b32-decision.json'))['result'];print('B32_DECISION',r.get('decision'),r.get('hypothesis'),'merge_eligible=',r.get('merge_eligible'),json.dumps(r.get('criteria'),ensure_ascii=False))" || true
fi
log "تدقيقُ الأسرارِ على الدليلِ قبلَ أيِّ رفعٍ"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then
  echo "SECRET_AUDIT_FAIL — حجرُ الدليلِ الخامِّ ولا يُرفعَ إلّا تقريرُ التدقيقِ"
  rm -rf "$OUT/raw" "$OUT/idle-b24"
  log "FAIL (secret audit)"
  exit 1
fi
echo "SECRET_AUDIT_CLEAN"
log "DONE"
