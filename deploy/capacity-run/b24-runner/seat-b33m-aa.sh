#!/usr/bin/env bash
# تجربةُ A/A لحسمِ أثرِ أداةِ الرصدِ على G1 + موجةُ التأكيدِ c2 (PROTOCOL-b33m-aa.md) — نسخةُ seat-b33m.sh
#   حتى «فحصٌ تمهيديٌّ» حرفًا، والفرق: أربعُ موجاتٍ متتاليةٍ على مشغِّلٍ واحد: OFF، ON، ON، OFF
#   (B33M_OUTBOX=0/1/1/0، فهارس 32–35)، وإعادةٌ واحدةٌ لكلِّ موجةٍ غيرِ صالحةٍ (فهرسُها +10).
#   لا تغييرَ في المنتجِ ولا الحملِ ولا العتبات؛ أولُ موجةِ ON صالحةٍ = موجةُ التأكيدِ c2 (حكمُ v2 المسجَّلِ حرفًا).
#   لا يُبدَّلُ بينَ الموجاتِ إلّا B33M_OUTBOX (الفرقُ الوحيدُ المسموحُ بينَ الذراعين).
# لا أسرارَ حقيقيّة: setup-env يولّدُ أسرارَ المقعدِ المحلّيّةَ عشوائيّاً (600) ولا تُطبَع.
set -euo pipefail
MODE=${1:?smoke|full}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/b33m-out
MAIN_SHA=${MAIN_SHA:?}; C_ARM=${C_ARM:?}; C_BASE=${C_BASE:?}
R_SHA=$C_ARM; C_SHA=$C_ARM
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

# SEQ_PREFIX ثابتٌ لهذه التجربة (b33maa)؛ B33M_OUTBOX يُمرَّرُ لكلِّ موجةٍ على حدة (PROTOCOL-b33m-aa.md §2)
export SEQ_PREFIX=b33maa
collect() { # OUTBOX RUN…
  local OB=$1; shift
  for r in "$@"; do
    E=$B/runs/$r/evidence; D=$OUT/raw/$r; mkdir -p "$D"; [ -d "$E" ] || { echo "MISSING $r"; continue; }
    CRC=0; bun "$H/deploy/capacity-run/monitor/collect-evidence.ts" "$E" "$D" > "$D/collect.out" 2>&1 || CRC=$?
    grep -E "^COLLECT_(MISSING|DONE)" "$D/collect.out" | sed "s|^|$r |" || true; echo "$r COLLECT_RC=$CRC"
    cp -r "$B/qual/$r" "$D/qual" 2>/dev/null || true
    python3 "$H/deploy/capacity-run/monitor/p4-decompose.py" "$E" > "$D/p4-decompose.out.json" 2>"$D/p4-decompose.err" || true
    $B/bin/gates.sh "$r" > "$D/gates.txt" 2>&1 || true
    if [ "$OB" = 1 ]; then
      python3 "$H/deploy/capacity-run/b24-runner/b33m-extract.py" "$E" "$D" > "$D/b33m-extract.out" 2>&1 || echo "$r B33M_EXTRACT_FAIL"
      tail -1 "$D/b33m-extract.out" | cut -c1-400
      (cd "$D" && sha256sum b33m-* > b33m.sha256sums) || echo "$r B33M_SUMS_FAIL"
    else
      echo "$r B33M_EXTRACT_SKIPPED (OFF)"
    fi
  done
}
AN="$H/deploy/capacity-run/b24-runner/b26-analyze.py"
AN33="$H/deploy/capacity-run/b24-runner/b33m-analyze.py"
# PROTOCOL-b33m-confirm.md: محلِّلُ القرارِ للموجةِ التأكيديّة v2؛ وv1 يُحسَبُ معه للإعلامِ (b33m-analysis-v1.json).
AN33W="$H/deploy/capacity-run/b24-runner/${B33M_ANALYZER:-b33m-analyze.py}"
P=b33maa
# أثرُ أداةِ الرصدِ على G1 — مقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33m-aa.md §4–§5)
AACOMP="$H/deploy/capacity-run/b24-runner/b33m-aa-compare.py"

log "فحصٌ تمهيديٌّ (ليس موجةَ قياس): C′ عند 750 لمدّة 120s — الحدُّ الفعليّ، وحضورُ الأداةِ والعيّناتِ والاستخراج"
# الفحصُ التمهيديُّ يتحققُ من أداةِ ذراعِ ON (المُعايِنُ مُطلقٌ فيه) — التشغيلُ الأولُ (39769205541) فشل
# لأنّ الاستدعاءَ لم يمرّر B33M_OUTBOX=1 فسقط INSTR_MISSING قبلَ أيِّ موجة؛ لا تغييرَ في القواعد.
WAVE_SEC=120 B33M_OUTBOX=1 "$B/bin/b24-seq.sh" smoke 750 28 "S0:ref:$C_ARM" > "$OUT/seq-smoke.log" 2>&1 || true
collect 1 $P-smoke-S0-750
SMOKE_RC=0
python3 "$AN" smoke "$OUT" $P-smoke-S0-750 "$B26_SESSION_LIMIT" > "$OUT/b33m-smoke.json" 2>"$OUT/b33m-smoke.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke.err"
python3 "$AN33" instr "$OUT/raw/$P-smoke-S0-750" > "$OUT/b33m-smoke-instr.json" 2>"$OUT/b33m-smoke-instr.err" || SMOKE_RC=$?
cat "$OUT/b33m-smoke-instr.json" "$OUT/b33m-smoke-instr.err"
if [ $SMOKE_RC -ne 0 ]; then
  echo "SMOKE_FAIL — لا موجةَ قياس (PROTOCOL-b33m-aa.md §6: الأداةُ ناقصةٌ أو الحدُّ غيرُ مثبت؛ لا تخمين)"
else
  # أربعُ موجاتٍ مضادّةٍ للترتيب: OFF، ON، ON، OFF (PROTOCOL-b33m-aa.md §2)؛ إعادةٌ واحدةٌ لكلِّ موجةٍ غيرِ صالحة (§6)
  measure() { # NAME IDX OUTBOX
    log "موجةُ القياس $1 (B33M_OUTBOX=$3)"
    B33M_OUTBOX=$3 "$B/bin/b24-seq.sh" "$1" 750 "$2" "M:ref:$C_ARM" > "$OUT/seq-$1.log" 2>&1 || true
    RUN=$P-$1-M-750
    collect $3 $RUN
    grep -E "^SEQ|QUAL_DONE|WAVE_DONE|INVALID|MISMATCH|PREFLIGHT|INFLIGHT" "$OUT/seq-$1.log" || true
    V=$(python3 "$AN33" valid "$OUT/raw/$RUN" "$B26_SESSION_LIMIT" 2>"$OUT/validity-$1.json")
    echo "VALIDITY_$1 $V"
    if [ "$V" = VALID ]; then
      # تحليلُ b26 لكلِّ موجةٍ صالحةٍ (البواباتُ والمسارُ، للذراعينِ على السواء)
      python3 "$AN" wave "$OUT/raw/$RUN" 50 "$B26_SESSION_LIMIT" > "$OUT/b26-wave-$1.json" 2>"$OUT/b26-wave-$1.err" || true
      if [ "$3" = 1 ]; then
        python3 "$AN33" wave "$OUT/raw/$RUN" > "$OUT/b33m-analysis-v1-$1.json" 2>/dev/null || true
        if [ "$CONFIRM_DONE" != 1 ]; then
          # أولُ موجةِ ON صالحةٍ = موجةُ التأكيدِ c2 (PROTOCOL-b33m-aa.md §1) — حكمُ v2 المسجَّلِ حرفًا
          CONFIRM_DONE=1 CONFIRM_RUN=$RUN
          export CONFIRM_DONE CONFIRM_RUN
          python3 "$AN33W" wave "$OUT/raw/$RUN" > "$OUT/b33m-analysis.json" 2>"$OUT/b33m-analysis.err" || tail -5 "$OUT/b33m-analysis.err"
          python3 -c "import json;d=json.load(open('$OUT/b33m-analysis.json'));print('B33M_RESULT',json.dumps({'run':'$RUN','complete':d['completeness']['complete'],'choice':d['b33_choice_rule'],'H':{k:v.get('verdict') for k,v in d['hypotheses'].items()}},ensure_ascii=False))" || true
        fi
      fi
    fi
  }
  CONFIRM_DONE=0; export CONFIRM_DONE
  for spec in "w1-off:32:0" "w2-on:33:1" "w3-on:34:1" "w4-off:35:0"; do
    IFS=: read -r NAME IDX OB <<< "$spec"
    V=INVALID
    measure "$NAME" "$IDX" "$OB"
    if [ "$V" != VALID ]; then
      echo "قاعدةُ الإعادة: موجةٌ غيرُ صالحةٍ ⇒ إعادةٌ واحدةٌ كاملة ($NAME-r)؛ الأصلُ محفوظٌ ولا يدخلُ المقارنة (PROTOCOL-b33m-aa.md §6)"
      measure "$NAME-r" "$((IDX+10))" "$OB"
    fi
  done
  # مقارنةُ A/A — المقاييسُ وقاعدةُ القرارِ المسجَّلةُ مسبقًا (PROTOCOL-b33m-aa.md §4–§5)
  python3 "$AACOMP" "$OUT" > "$OUT/b33m-aa-compare.json" 2>"$OUT/b33m-aa-compare.err" || tail -10 "$OUT/b33m-aa-compare.err"
  python3 -c "import json;d=json.load(open('$OUT/b33m-aa-compare.json'));print('B33M_AA_RESULT',json.dumps({'decision':d['decision'],'why':d['why'],'arms':d['arms_summary']},ensure_ascii=False))" || true
  if [ "$CONFIRM_DONE" = 1 ]; then
    echo "CONFIRM_WAVE_C2=$CONFIRM_RUN"
  else
    echo "B33M_NO_VALID_ON_WAVE — لا قرارَ v2 ولا إعادةَ إضافية (PROTOCOL-b33m-aa.md §5.5)"
  fi
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
