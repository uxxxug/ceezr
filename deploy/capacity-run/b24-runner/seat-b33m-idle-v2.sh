#!/usr/bin/env bash
#   أربعُ موجاتٍ متتاليةٍ على مشغِّلٍ واحد: OFF، ON، ON، OFF (فهارسُ الطرازِ 72–75، الإعادةُ +10)
#   والفرقُ الوحيدُ المسموحُ بينَ الذراعين: NOTIFICATION_DRAIN_BUDGET_MS=8000 مقابلَ 9400
#   (يُمرَّرُ عبرَ B33M_IDLE_BUDGET_MS إلى secrets.env — القناةُ الوحيدةُ التي تنجو من تصفيةِ sudo؛
#   fresh-db.sh ينظّفُ القيمةَ القديمةَ قبلَ كلِّ موجةٍ فلا تسربَ بينَ الموجات).
#   المُعايِنُ (B33M_OUTBOX=1) مطلقٌ في جميعِ الموجاتِ والذراعين — أثرُ الأداةِ ثابتٌ بينَ الذراعين.
#   لا تغييرَ في الشيفرةِ ولا الحملِ ولا العتبات؛ لا تسجيلَ Batch33 ولا إعلانَ LOAD-01 بأيِّ نتيجة.
# لا أسرارَ حقيقيّة: setup-env يولّدُ أسرارَ المقعدِ المحلّيّةَ عشوائيّاً (600) ولا تُطبَع.
set -euo pipefail
MODE=${1:?smoke|full}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/b33m-idle2-out
MAIN_SHA=${MAIN_SHA:?}; C_ARM=${C_ARM:?}; C_BASE=${C_BASE:?}
R_SHA=$C_ARM; C_SHA=$C_ARM
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktrees R=$R_SHA C=$C_SHA"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$R_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$C_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
grep -H "^  gatewayRequest: " "$W/wt-ref/packages/shared/config/connection-budget.ts" "$W/wt-acc/packages/shared/config/connection-budget.ts"
# لا تغييرَ في سعةِ المجمّعِ ولا تركيبِ الاتصالِ ولا المولّدِ ولا إعداداتِ الدرينر بين main وC′ — وإلّا لا موجة.
git -C "$H" diff --quiet "$MAIN_SHA" "$C_ARM" -- packages/shared/config/connection-budget.ts packages/infrastructure/db/client.ts || { echo "POOL_CHANGED main..$C_ARM — لا موجة"; exit 1; }
git -C "$H" diff --quiet "$MAIN_SHA" "$C_ARM" -- deploy/capacity-run/load || { echo "GENERATOR_CHANGED main..$C_ARM — لا موجة"; exit 1; }
git -C "$H" diff --quiet "$MAIN_SHA" "$C_ARM" -- packages/shared/config/domain-ingress.ts deploy/capacity-run/config/run.env packages/infrastructure/db/telegram-update-queue.ts || { echo "DRAINER_CONFIG_CHANGED main..$C_ARM — لا موجة"; exit 1; }
# C′ − C = أداةُ الرصدِ وحدَها (PROTOCOL-b33m.md §2) — لا تغييرَ في المنتج.
CC_FILES=$(git -C "$H" diff --name-only "$C_BASE" "$C_ARM" | sort | tr '\n' ' ')
[ "$CC_FILES" = "deploy/capacity-run/load/db-audit.ts deploy/capacity-run/load/p7-attribution.ts " ] || { echo "CPRIME_MINUS_C_UNEXPECTED [$CC_FILES] — لا موجة"; exit 1; }
echo "CPRIME_MINUS_C_FILES $CC_FILES"
git -C "$H" show "$C_ARM:packages/shared/config/connection-budget.ts" | grep -q "^  gatewayRequest: 5," || { echo "GATEWAY_REQUEST_NOT_5 $C_ARM — لا موجة"; exit 1; }
git -C "$H" show "$C_ARM:apps/gateway/src/container.ts" | grep -q "IMMEDIATE_REDISPATCH_LIMIT = 50;" || { echo "REDISPATCH_LIMIT_NOT_50 $C_ARM — لا موجة"; exit 1; }
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-ref/deploy/capacity-run/config/run.env" "$W/wt-acc/deploy/capacity-run/config/run.env"
grep -H "IMMEDIATE_REDISPATCH_LIMIT = " "$W/wt-ref/apps/gateway/src/container.ts" "$W/wt-acc/apps/gateway/src/container.ts"
if git -C "$H" diff --quiet "$R_SHA" "$C_SHA" -- packages/shared/config/connection-budget.ts packages/infrastructure/db/client.ts; then
  echo "POOL_UNCHANGED R=$R_SHA C=$C_SHA"; else echo "POOL_CHANGED — لا موجة"; exit 1; fi
# بروتوكولُ b33m-idle §2: الميزانيةُ تُمرَّرُ لكلِّ موجةٍ عبرَ secrets.env (قناةُ DIAG_ المسجَّلة)؛
# fresh-db.sh (نسخةُ هذا الفرع) ينظّفُ NOTIFICATION_DRAIN_BUDGET_MS القديمةَ قبلَ إلحاقِ الجديدة.
sha256sum "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$H/deploy/capacity-run/monitor/wave-evidence-manifest.json" > "$OUT/collector.sha256sums"
echo "COLLECTOR $(cut -c1-16 "$OUT/collector.sha256sums" | tr "\n" " ")"
# بصمةُ fresh-db.sh المعدَّلة (قناةُ الميزانية) — تُطبعُ في سجلِّ المقعدِ لا في دليلٍ مرفوعٍ منفصل.
sha256sum "$H/deploy/capacity-run/b24-runner/seat-bin/fresh-db.sh" > "$OUT/fresh-db.sha256sums"
echo "FRESH_DB_PIN $(cut -c1-16 "$OUT/fresh-db.sha256sums")"

log "setup-env (infra|db|migrate) من wt-acc"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
echo "secrets_keys=$(cut -d= -f1 "$B/secrets.env" | tr '\n' ' ')"
. "$H/deploy/capacity-run/b24-runner/b26-session-limit.env"
B26_SESSION_LIMIT=${B26_SESSION_EXCHANGE_PER_MINUTE:?}
DEM=$(python3 -c "import json;print(json.load(open('$H/deploy/capacity-run/b24-runner/b26-demand.json'))['SESSION_EXCHANGE_PER_MINUTE'])")
[ "$DEM" = "$B26_SESSION_LIMIT" ] || { echo "SESSION_LIMIT_MISMATCH env=$B26_SESSION_LIMIT demand=$DEM"; exit 1; }
sed -i '/^SESSION_EXCHANGE_PER_MINUTE=/d' "$B/secrets.env"
echo "SESSION_EXCHANGE_PER_MINUTE=$B26_SESSION_LIMIT" >> "$B/secrets.env"
export B26_SESSION_LIMIT
echo "SEAT_SESSION_LIMIT=$B26_SESSION_LIMIT run_env_ref=$(grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' $W/wt-ref/deploy/capacity-run/config/run.env | cut -d= -f2) run_env_acc=$(grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' $W/wt-acc/deploy/capacity-run/config/run.env | cut -d= -f2)" | tee "$OUT/session-limit-seat.txt"
NSX=$B/bin/nsx; PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres"
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$NSX bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null
$PSQL -d postgres -Atc "show shared_preload_libraries"

log "قالبُ المقعد: هجراتٌ + seat-seed.sql ثمّ ceezr_cap_tpl"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -qc "create database ceezr_cap_tpl template ceezr_cap_20261016"
$PSQL -d ceezr_cap_tpl -q -f "$H/deploy/capacity-run/b24-runner/fingerprint.sql" 2>&1 | grep -v '^$' > "$OUT/tpl-fingerprint.txt"
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
  echo "seat_cpu_max=$(cat /sys/fs/cgroup/$CAP_SEAT_CG/cpu.max 2>/dev/null)"
  $PSQL -d postgres -Atc "select name||'='||setting||coalesce(unit,'') from pg_settings where source not in ('default','override','client','session') order by 1"
  echo "pg_cgroup=$(cat /proc/$(pgrep -f 'postgres -D' | head -1)/cgroup)"; echo "self_cgroup=$(cat /proc/self/cgroup)"
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

# SEQ_PREFIX ثابتٌ لهذه التجربة (b33midle2)؛ B33M_IDLE_BUDGET_MS يُمرَّرُ لكلِّ موجةٍ على حدة (PROTOCOL-b33m-idle-v2.md §2)
export SEQ_PREFIX=b33midle2
collect() { # RUN… — المُعايِنُ مطلقٌ دائمًا (كلا الذراعين)، ومعه نسخُ قيمةِ ميزانيةِ البوّابةِ الحيّة
  for r in "$@"; do
    E=$B/runs/$r/evidence; D=$OUT/raw/$r; mkdir -p "$D"; [ -d "$E" ] || { echo "MISSING $r"; continue; }
    CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
    grep -E "^COLLECT_(MISSING|DONE)" "$D/collect.out" | sed "s|^|$r |" || true; echo "$r COLLECT_RC=$CRC"
    cp -r "$B/qual/$r" "$D/qual" 2>/dev/null || true
    python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
    $B/bin/gates.sh "$r" > "$D/gates.txt" 2>&1 || true
    cp "$B/runs/current/evidence/gateway-drain-budget.txt" "$D/gateway-drain-budget.txt" 2>/dev/null || echo "$r BUDGET_RECORD_MISSING"
    python3 "$H/deploy/capacity-run/b24-runner/b33m-extract.py" "$E" "$D" > "$D/b33m-extract.out" 2>&1 || echo "$r B33M_EXTRACT_FAIL"
    tail -1 "$D/b33m-extract.out" | cut -c1-400
    (cd "$D" && sha256sum b33m-* > b33m.sha256sums) || echo "$r B33M_SUMS_FAIL"
  done
}
AN="$H/deploy/capacity-run/b24-runner/b26-analyze.py"
AN33="$H/deploy/capacity-run/b24-runner/b33m-analyze.py"
# حكمُ v2 (b33m-analyze-v2) يُحسَبُ لكلِّ موجةٍ صالحةٍ للإعلامِ لا للقرار — قرارُ هذه التجربةِ قاعدتُها هي (§5).
AN33W="$H/deploy/capacity-run/b24-runner/${B33M_ANALYZER:-b33m-analyze-v2.py}"
P=b33midle2
# مقارنةُ التدخلِ — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33m-idle-v2.md §4–§5)
IDLECOMP="$H/deploy/capacity-run/b24-runner/b33m-idle-compare.py"

log "فحصٌ تمهيديٌّ (ليس موجةَ قياس): ذراعُ ON عند 750 لمدّة 120s — سباكةُ الميزانيةِ والعدّةُ والاستخراج"
# الفحصُ يتحققُ من ذراعِ ON (الميزانيةُ 9400) لأنها التي تحتاجُ إثباتَ سباكة؛ فشلُها يُسقطُ التجربةَ قبلَ أيِّ موجة.
WAVE_SEC=120 B33M_OUTBOX=1 B33M_IDLE_BUDGET_MS=9400 "$B/bin/b24-seq.sh" smoke 750 71 "S0:ref:$C_ARM" > "$OUT/seq-smoke.log" 2>&1 || true
collect $P-smoke-S0-750
SMOKE_RC=0
python3 "$AN" smoke "$OUT" $P-smoke-S0-750 "$B26_SESSION_LIMIT" > "$OUT/b33m-smoke.json" 2>"$OUT/b33m-smoke.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke.err"
python3 "$AN33" instr "$OUT/raw/$P-smoke-S0-750" > "$OUT/b33m-smoke-instr.json" 2>"$OUT/b33m-smoke-instr.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke-instr.json" "$OUT/b33m-smoke-instr.err"
# تحققُ سباكةِ الميزانيةِ (PROTOCOL-b33m-idle-v2.md §2): القيمةُ الفعليةُ لعمليةِ البوّابةِ الحيّة في الفحصِ التمهيديّ.
SMOKE_BUDGET=$(cat "$OUT/raw/$P-smoke-S0-750/gateway-drain-budget.txt" 2>/dev/null || true)
echo "SMOKE_GATEWAY_BUDGET=${SMOKE_BUDGET:-MISSING}"
if [ "$SMOKE_BUDGET" = "NOTIFICATION_DRAIN_BUDGET_MS=9400" ]; then
  echo "BUDGET_PLUMBING_OK"
else
  echo "BUDGET_PLUMBING_FAIL — لا موجاتِ قياس (PROTOCOL-b33m-idle-v2.md §2: فشلُ السباكةِ يُسقطُ التجربة)"
  log "تدقيقُ الأسرارِ على الدليلِ قبلَ أيِّ رفع"
  SA_RC=0
  python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
  cat "$OUT/secret-audit.txt"
  if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; fi
  log "فشلُ سباكةِ الميزانيةِ — الخامُّ محفوظٌ كأثرِ فشلٍ (حجرُ الدليلِ لا يُرفَع)"
  exit 1
fi
if [ $SMOKE_RC -ne 0 ]; then
  echo "SMOKE_FAIL — لا موجاتِ قياس (PROTOCOL-b33m-idle-v2.md §2)"
  log "تدقيقُ الأسرارِ على الدليلِ قبلَ أيِّ رفع"
  SA_RC=0
  python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
  cat "$OUT/secret-audit.txt"
  if [ $SA_RC -ne 0 ]; then echo "SECRET_AUDIT_FAIL"; fi
  exit 1
fi

# أربعُ موجاتٍ مضادّةٍ للترتيب: OFF، ON، ON، OFF (PROTOCOL-b33m-idle-v2.md §2)؛ إعادةٌ واحدةٌ لكلِّ موجةٍ غيرِ صالحةٍ (§3)
measure() { # NAME IDX BUDGET
  log "موجةُ القياس $1 (B33M_IDLE_BUDGET_MS=$3)"
  B33M_OUTBOX=1 B33M_IDLE_BUDGET_MS=$3 "$B/bin/b24-seq.sh" "$1" 750 "$2" "M:ref:$C_ARM" > "$OUT/seq-$1.log" 2>&1 || true
  RUN=$P-$1-M-750
  collect $RUN
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|MISMATCH|PREFLIGHT|INFLIGHT" "$OUT/seq-$1.log" || true
  V=$(python3 "$AN33" valid "$OUT/raw/$RUN" "$B26_SESSION_LIMIT" 2>"$OUT/validity-$1.json")
  echo "VALIDITY_$1 $V"
  if [ "$V" = VALID ]; then
    python3 "$AN" wave "$OUT/raw/$RUN" 50 "$B26_SESSION_LIMIT" > "$OUT/b26-wave-$1.json" 2>"$OUT/b26-wave-$1.err" || true
    python3 "$AN33" wave "$OUT/raw/$RUN" > "$OUT/b33m-analysis-v1-$1.json" 2>/dev/null || true
    python3 "$AN33W" wave "$OUT/raw/$RUN" > "$OUT/b33m-analysis-v2-$1.json" 2>"$OUT/b33m-analysis-v2-$1.err" || true
    tail -3 "$OUT/b33m-analysis-v2-$1.err" 2>/dev/null || true
  fi
}
for spec in "w1-off:72:8000" "w2-on:73:9400" "w3-on:74:9400" "w4-off:75:8000"; do
  IFS=: read -r NAME IDX BUD <<< "$spec"
  V=INVALID
  measure "$NAME" "$IDX" "$BUD"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: موجةٌ غيرُ صالحةٍ ⇒ إعادةٌ واحدةٌ كاملة ($NAME-r)؛ الأصلُ محفوظٌ ولا يدخلُ المقارنة (PROTOCOL-b33m-idle-v2.md §3)"
    measure "$NAME-r" "$((IDX+10))" "$BUD"
  fi
done
# مقارنةُ التدخلِ — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33m-idle-v2.md §4–§5)
python3 "$IDLECOMP" "$OUT" > "$OUT/b33m-idle-compare.json" 2>"$OUT/b33m-idle-compare.err" || tail -10 "$OUT/b33m-idle-compare.err"
python3 -c "import json;d=json.load(open('$OUT/b33m-idle-compare.json'));print('B33M_IDLE_RESULT',json.dumps({'decision':d['decision'],'why':d['why'],'arms':d.get('arms_summary',{})},ensure_ascii=False))" || true
log "تدقيقُ الأسرارِ على الدليلِ قبلَ أيِّ رفع"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then
  echo "SECRET_AUDIT_FAIL — حجرُ الدليلِ الخامِّ ولا يُرفعَ إلّا تقريرُ التدقيق"
  rm -rf "$OUT/raw"
  log "فشلَ تدقيقُ الأسرار"
  exit 1
fi
echo "SECRET_AUDIT_CLEAN"
log "DONE"
