#!/usr/bin/env bash
#   ثماني موجاتٍ ABBA BAAB على مشغِّلٍ واحد عند 750 مستخدمًا — قياسُ صافيِ أثرِ إصلاحاتِ JOB-TICK
#   المدموجة (PROTOCOL-b33mtick.md). ref=e47ca99d (ما قبل #627) · cand=2aa557aa (main بعد #629).
#   الميزانيةُ 8000 في جميعِ الموجاتِ والذراعين (الافتراضيةُ المعتمدة — لا تجاوز) تُثبَّتُ عبرَ
#   B33M_IDLE_BUDGET_MS إلى secrets.env؛ fresh-db.sh ينظّفُ القيمةَ القديمةَ قبلَ كلِّ موجة.
#   المُعايِنُ (B33M_OUTBOX=1) مطلقٌ في جميعِ الموجاتِ والذراعين — أثرُ الأداةِ ثابتٌ بينَ الذراعين.
#   لا تغييرَ في الحملِ ولا العتبات؛ لا تسجيلَ Batch33 ولا إعلانَ LOAD-01 بأيِّ نتيجة.
# لا أسرارَ حقيقيّة: setup-env يولّدُ أسرارَ المقعدِ المحلّيّةَ عشوائيّاً (600) ولا تُطبَع.
set -euo pipefail
MODE=${1:?smoke|full}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/b33mtick-out
R_SHA=${R_SHA:?}; C_SHA=${C_SHA:?}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

# فخُّ الخروجِ (PROTOCOL-b33mtick §7): بوّابةُ الحفظِ نتيجةُ تدقيقِ الأسرارِ لا مجرّدُ وجودِ ملف —
# نجاحُ التدقيقِ يكتبُ علامةَ .audit-ok؛ وفشلُه يحجرُ كلَّ محتوىً مشتبهٍ في $OUT (الخامُّ والحطامُ
# وصفحاتُ السجلِّ كلُّها — لا raw/ وحدها) ببيانِ أسماءٍ وبصماتٍ بلا محتوى، ويُحفظُ تقريرُ التدقيقِ
# وبيانُ الحجرِ وحدَهما. الإنهاءُ عبرَ SIGKILL يُتجاوزُ هذا الفخَّ — يُعلَنُ ذلك في البروتوكولِ §7.
finalize() { # $1 = رمزُ الخروجِ المقصودُ (من الحالةِ أو 128+رقمِ الإشارةِ)
  rc=${1:-$?}
  trap - EXIT SIGTERM SIGINT
  if [ -f "$OUT/.audit-ok" ]; then exit "$rc"; fi
  SA_RC=0
  python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
  cat "$OUT/secret-audit.txt" 2>/dev/null || true
  if [ $SA_RC -eq 0 ]; then
    touch "$OUT/.audit-ok"
  else
    # حجرُ كلِّ محتوىً مشتبهٍ: كلُّ ملفٍّ في $OUT (خامٌّ وسجلاتٌ وحطامٌ) بصماتُه تُحفظُ ثم يُحذفُ —
    # يبقى تقريرُ التدقيقِ وبيانُ الحجرِ فقط. الإفصاحُ (§7): هذا ليسَ استيفاءً لحفظِ كلِّ النتائج.
    # بيانُ البصماتِ يُكتبُ خارجَ الشجرةِ المحصورةِ (في /tmp) ثمَّ يُنقلُ — فلا يحصرُ نفسَهُ
    ( cd "$OUT" && find . -type f ! -name secret-audit.txt ! -name .audit-ok | sort | xargs sha256sum > /tmp/quarantine-manifest.b33mtick 2>/dev/null ) || true
    mv /tmp/quarantine-manifest.b33mtick "$OUT/quarantine-manifest.txt" 2>/dev/null || true
    find "$OUT" -mindepth 1 -maxdepth 1 ! -name secret-audit.txt ! -name quarantine-manifest.txt ! -name .audit-ok -exec rm -rf {} + 2>/dev/null || true
    echo "SECRET_AUDIT_FAIL_EARLY_EXIT"
    exit 1
  fi
  exit "$rc"
}
# رموزُ الخروجِ الصريحةُ للإشاراتِ (130=SIGINT، 143=SIGTERM) — لا رمزَ آخرِ أمرٍ السابقِ
trap 'finalize $?' EXIT
trap 'finalize 143' SIGTERM
trap 'finalize 130' SIGINT

log "worktrees R=$R_SHA C=$C_SHA"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$R_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$C_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
grep -H "^  gatewayRequest: " "$W/wt-ref/packages/shared/config/connection-budget.ts" "$W/wt-acc/packages/shared/config/connection-budget.ts"
# عزلُ التدخلِ (PROTOCOL-b33mtick §1): فرقُ المساراتِ التشغيليةِ بينَ الذراعين = runner.ts وحده — وإلّا لا موجة.
RUNTIME_FILES=$(git -C "$H" diff --name-only "$R_SHA" "$C_SHA" -- apps packages deploy | sort | tr '\n' ' ')
[ "$RUNTIME_FILES" = "apps/workers/src/runner.ts " ] || { echo "RUNTIME_DIFF_UNEXPECTED [$RUNTIME_FILES] — لا موجة"; exit 1; }
echo "RUNTIME_DIFF_OK apps/workers/src/runner.ts فقط"
git -C "$H" show "$C_SHA:packages/shared/config/connection-budget.ts" | grep -q "^  gatewayRequest: 5," || { echo "GATEWAY_REQUEST_NOT_5 $C_SHA — لا موجة"; exit 1; }
git -C "$H" show "$C_SHA:apps/gateway/src/container.ts" | grep -q "IMMEDIATE_REDISPATCH_LIMIT = 50;" || { echo "REDISPATCH_LIMIT_NOT_50 $C_SHA — لا موجة"; exit 1; }
echo "FROZEN_CONSTANTS_OK gatewayRequest=5 IMMEDIATE_REDISPATCH_LIMIT=50"
grep -H "^TELEGRAM_DRAIN_LANES=" "$W/wt-ref/deploy/capacity-run/config/run.env" "$W/wt-acc/deploy/capacity-run/config/run.env"
L_ref=$(grep -m1 '^TELEGRAM_DRAIN_LANES=' "$W/wt-ref/deploy/capacity-run/config/run.env" | cut -d= -f2)
L_acc=$(grep -m1 '^TELEGRAM_DRAIN_LANES=' "$W/wt-acc/deploy/capacity-run/config/run.env" | cut -d= -f2)
[ "$L_ref" = "$L_acc" ] || { echo "DRAIN_LANES_MISMATCH ref=$L_ref acc=$L_acc — لا موجة"; exit 1; }
echo "DRAIN_LANES_OK =$L_ref (سقفُ الإرسالِ = دلوُ المحاكي MOCK_GLOBAL_PER_BOT_PER_SEC + إيقاعُ التصريف — يُثبَّتُ من المحاكيِ الحيِّ قبلَ الموجات، §5)"
grep -H "IMMEDIATE_REDISPATCH_LIMIT = " "$W/wt-ref/apps/gateway/src/container.ts" "$W/wt-acc/apps/gateway/src/container.ts"
# تثبيتُ سقفِ الإرسالِ (§5): ثابتٌ برمجيٌّ صريحٌ — دلوُ الصادرِ العالميُّ 25/ث (لكلِّ رمزِ بوتٍ)
# وحصةُ المحادثةِ 1/ث في packages/infrastructure/notification/outbound-rate-bucket.ts
# (DEFAULT_OUTBOUND_RATE_LIMITS) — لا يُعدَّلُ ببيئةٍ ولا بـplatform_settings (حدُّ منصّةٍ لا سياسة).
# يتطابقُ بينَ الذراعينِ بالشيفرةِ: الفرقُ التشغيليُّ runner.ts وحده (تحققٌ آليٌّ أعلاه).
for wt in wt-ref wt-acc; do
  grep -q "global: { limit: 25, windowMs: 1000 }" "$W/$wt/packages/infrastructure/notification/outbound-rate-bucket.ts" || { echo "OUTBOUND_BUCKET_NOT_25 $wt — لا موجة"; exit 1; }
done
echo "OUTBOUND_BUCKET_OK global limit=25/s chat=1/s (ثابتٌ متطابقٌ بينَ الذراعينِ بالشيفرةِ — والحرجُ/العاليُ يأخذُ 25 كاملةً وغيرُ الحرجِ حصتَهُ 0.8×25=20)"
# بصمةُ العدّةِ (ثابتةٌ بينَ الذراعينِ بالبنية): جامعُ الدليلِ وfresh-db.sh (قناةُ الميزانية).
sha256sum "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$H/deploy/capacity-run/monitor/wave-evidence-manifest.json" > "$OUT/collector.sha256sums"
echo "COLLECTOR $(cut -c1-16 "$OUT/collector.sha256sums" | tr "\n" " ")"
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
  echo "arms: ref=$R_SHA cand=$C_SHA budget=8000 (default) all waves"
  echo "running_services:"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print "  "$1}'
} > "$OUT/seat-env.txt" 2>&1
cat "$OUT/seat-env.txt" | head -30
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh assert)

log "مرجعُ الخمول (البوّابةُ مطفأة) ← validity B23-RUNNER-V1"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b24" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b24-runner/derive-validity.py" "$B/qual/idle-b24" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b24" "$OUT/idle-b24"
echo "VALIDITY_PINNED $(date -Is) sha256=$(sha256sum $B/bin/validity.json | cut -c1-16)"

# SEQ_PREFIX ثابتٌ لهذه التجربة (b33mtick)؛ الميزانيةُ 8000 موحَّدةٌ في كلِّ الموجاتِ والذراعين (PROTOCOL-b33mtick §1)
export SEQ_PREFIX=b33mtick
collect() { # RUN… — المُعايِنُ مطلقٌ دائمًا، ومعه نسخُ قيمةِ ميزانيةِ البوّابةِ الحيّةِ وسجلِّ النشرِ b24-env.json
  for r in "$@"; do
    E=$B/runs/$r/evidence; D=$OUT/raw/$r; mkdir -p "$D"; [ -d "$E" ] || { echo "MISSING $r"; continue; }
    CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
    grep -E "^COLLECT_(MISSING|DONE)" "$D/collect.out" | sed "s|^|$r |" || true; echo "$r COLLECT_RC=$CRC"
    cp -r "$B/qual/$r" "$D/qual" 2>/dev/null || true
    python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
    $B/bin/gates.sh "$r" > "$D/gates.txt" 2>&1 || true
    cp "$B/runs/current/evidence/gateway-drain-budget.txt" "$D/gateway-drain-budget.txt" 2>/dev/null || echo "$r BUDGET_RECORD_MISSING"
    cp "$E/gateway-proc.json" "$D/gateway-proc.json" 2>/dev/null || echo "$r GWPROC_RECORD_MISSING"
    cp "$E/b24-env.json" "$D/b24-env.json" 2>/dev/null || echo "$r ENV_RECORD_MISSING"
    python3 "$H/deploy/capacity-run/b24-runner/b33m-extract.py" "$E" "$D" > "$D/b33m-extract.out" 2>&1 || echo "$r B33M_EXTRACT_FAIL"
    tail -1 "$D/b33m-extract.out" | cut -c1-400
    (cd "$D" && sha256sum b33m-* > b33m.sha256sums) || echo "$r B33M_SUMS_FAIL"
  done
}
AN="$H/deploy/capacity-run/b24-runner/b26-analyze.py"
AN33="$H/deploy/capacity-run/b24-runner/b33m-analyze.py"
P=b33mtick
# مقارنةُ التجربةِ — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33mtick §4–§6)
TICKCOMP="$H/deploy/capacity-run/b24-runner/b33mtick-compare.py"

log "فحصٌ تمهيديٌّ (ليس موجةَ قياس): ذراعُ cand عند 750 لمدّة 120s — سباكةُ الميزانيةِ (8000) والعدّةُ والاستخراج"
WAVE_SEC=120 B33M_OUTBOX=1 B33M_IDLE_BUDGET_MS=8000 "$B/bin/b24-seq.sh" m 750 76 "s0-cand:cand:$C_SHA" > "$OUT/seq-smoke.log" 2>&1 || true
collect $P-m-s0-cand-750
SMOKE_RC=0
python3 "$AN" smoke "$OUT" $P-m-s0-cand-750 "$B26_SESSION_LIMIT" > "$OUT/b33m-smoke.json" 2>"$OUT/b33m-smoke.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke.err"
python3 "$AN33" instr "$OUT/raw/$P-m-s0-cand-750" > "$OUT/b33m-smoke-instr.json" 2>"$OUT/b33m-smoke-instr.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke-instr.json" "$OUT/b33m-smoke-instr.err"
# تحققُ سباكةِ الميزانيةِ (PROTOCOL-b33mtick §1): القيمةُ الفعليةُ لعمليةِ البوّابةِ الحيّة = 8000 (الافتراضية).
SMOKE_BUDGET=$(cat "$OUT/raw/$P-m-s0-cand-750/gateway-drain-budget.txt" 2>/dev/null || true)
echo "SMOKE_GATEWAY_BUDGET=${SMOKE_BUDGET:-MISSING}"
if [ "$SMOKE_BUDGET" = "NOTIFICATION_DRAIN_BUDGET_MS=8000" ]; then
  echo "BUDGET_PLUMBING_OK (8000 = الافتراضيةُ المعتمدة — لا تجاوز)"
else
  echo "BUDGET_PLUMBING_FAIL — لا موجاتِ قياس (PROTOCOL-b33mtick §1)"
  python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || true
  cat "$OUT/secret-audit.txt"
  log "فشلُ سباكةِ الميزانيةِ — الخامُّ محفوظٌ كأثرِ فشلٍ (حجرُ الدليلِ لا يُرفَع)"
  exit 1
fi
if [ $SMOKE_RC -ne 0 ]; then
  echo "SMOKE_FAIL — لا موجاتِ قياس (PROTOCOL-b33mtick §1)"
  python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || true
  cat "$OUT/secret-audit.txt"
  exit 1
fi
# تثبيتُ سقفِ الإرسالِ الفعليِّ (§5): دلوُ المحاكي MOCK_GLOBAL_PER_BOT_PER_SEC من بيئةِ عمليةِ
# المحاكيِ الحيّةِ (الافتراضيُّ 30/ث لكلِّ بوتٍ إن لم يُضبَط) — المحاكيُّ عمليةٌ واحدةٌ تخدمُ
# الذراعينِ معًا فالسقفُ متطابقٌ بالبناء؛ تُسجَّلُ قيمتُهُ الفعليةُ في بيانِ العدّة.
MOCKPID=$(sudo -n ip netns exec ceezrsbx2 pgrep -f 'telegram-mock-server.ts' | tail -1)
# فشلُ فتحِ /proc يُعلَنُ فشلَ قراءةٍ ولا يُستبدلُ بلافتِ الافتراضيِّ (فشلٌ مُغلقٌ لا يُجمِّلُ).
MOCK_READ_FAIL=0
if [ -n "$MOCKPID" ]; then
  MOCK_CAP=$(sudo -n ip netns exec ceezrsbx2 bash -c "tr '\0' '\n' < /proc/$MOCKPID/environ" 2>/dev/null | grep -m1 '^MOCK_GLOBAL_PER_BOT_PER_SEC=') || MOCK_READ_FAIL=1
fi
if [ $MOCK_READ_FAIL -ne 0 ] || [ -z "$MOCKPID" ]; then
  echo "MOCK_ENV_READ_FAIL pid=${MOCKPID:-none} — لا موجاتِ قياس (§5: لا تثبيتَ بلا قراءةٍ فعليةٍ)"
  exit 1
fi
echo "MOCK_SEND_BUCKET=${MOCK_CAP:-MOCK_GLOBAL_PER_BOT_PER_SEC=(default 30, unset)} (pid=$MOCKPID — سقفٌ ثانويٌّ لا يُلزِمُ: الحاكمُ دلوُ الصادرِ 25/ث)" | tee "$OUT/mock-send-bucket.txt"

# ثماني موجاتٍ ABBA BAAB (PROTOCOL-b33mtick §1: a1:ref a2:cand a3:cand a4:ref a5:cand a6:ref a7:ref a8:cand)
# الميزانيةُ 8000 في الجميع؛ إعادةٌ واحدةٌ لكلِّ موجةٍ غيرِ صالحةٍ (§2: فهرسُ +10)
measure() { # NAME IDX SIDE SHA
  log "موجةُ القياس $1 (side=$3 sha=$4)"
  B33M_OUTBOX=1 B33M_IDLE_BUDGET_MS=8000 "$B/bin/b24-seq.sh" m 750 "$2" "$1:$3:$4" > "$OUT/seq-$1.log" 2>&1 || true
  RUN=$P-m-$1-750
  collect $RUN
  grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|MISMATCH|PREFLIGHT|INFLIGHT" "$OUT/seq-$1.log" || true
  V=$(python3 "$AN33" valid "$OUT/raw/$RUN" "$B26_SESSION_LIMIT" 2>"$OUT/validity-$1.json" || echo INVALID)
  echo "VALIDITY_$1 $V"
  if [ "$V" = VALID ]; then
    python3 "$AN" wave "$OUT/raw/$RUN" 50 "$B26_SESSION_LIMIT" > "$OUT/b26-wave-$1.json" 2>"$OUT/b26-wave-$1.err" || true
    python3 "$AN33" wave "$OUT/raw/$RUN" > "$OUT/b33m-analysis-$1.json" 2>/dev/null || true
  fi
}
for spec in "a1-ref:ref:77:$R_SHA" "a2-cand:cand:78:$C_SHA" "a3-cand:cand:79:$C_SHA" "a4-ref:ref:80:$R_SHA" \
           "a5-cand:cand:81:$C_SHA" "a6-ref:ref:82:$R_SHA" "a7-ref:ref:83:$R_SHA" "a8-cand:cand:84:$C_SHA"; do
  IFS=: read -r NAME SIDE IDX SHA <<< "$spec"
  V=INVALID
  measure "$NAME" "$IDX" "$SIDE" "$SHA"
  if [ "$V" != VALID ]; then
    echo "قاعدةُ الإعادة: موجةٌ غيرُ صالحةٍ ⇒ إعادةٌ واحدةٌ كاملة ($NAME-r)؛ الأصلُ محفوظٌ ولا يدخلُ المقارنة (PROTOCOL-b33mtick §2)"
    measure "$NAME-r" "$((IDX+10))" "$SIDE" "$SHA"
  fi
done
# مقارنةُ التجربةِ — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33mtick §4–§6)
python3 "$TICKCOMP" "$OUT" > "$OUT/b33mtick-compare.json" 2>"$OUT/b33mtick-compare.err" || tail -10 "$OUT/b33mtick-compare.err"
python3 -c "import json;d=json.load(open('$OUT/b33mtick-compare.json'));print('B33MTICK_RESULT',json.dumps({'decision':d['decision'],'why':d['why']},ensure_ascii=False))" || true
log "تدقيقُ الأسرارِ على الدليلِ قبلَ أيِّ رفع (فخُّ الخروجِ يضمنُه عندَ أيِّ إنهاءٍ)"
SA_RC=0
python3 "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$B/secrets.env" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
# نجاحُ التدقيقِ يكتبُ علامةَ .audit-ok (بوّابةُ الحفظِ في فخِّ الخروجِ وفي الرفعِ في workflow)؛
# الفشلُ يتركُ الدليلَ للفخِّ الذي يحجرُ كلَّ مشتبهٍ ببيانِ بصماتٍ (§7) — لا مكرَّرَ هنا لئلّا يختلفَ المسارانِ.
if [ $SA_RC -eq 0 ]; then
  touch "$OUT/.audit-ok"
  echo "SECRET_AUDIT_CLEAN"
else
  log "فشلَ تدقيقُ الأسرار — الفخُّ يحجرُ كلَّ مشتبهٍ (بيانُ بصماتٍ يُرفعُ والمحتوىُ يُحجَر)"
  exit 1
fi
log "DONE"

