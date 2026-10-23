#!/usr/bin/env bash
# اختبارُ محليٌّ لمساراتِ الخروجِ في seat-b33mtick.sh: نجاحٌ، تدقيقٌ فاشلٌ (سرٌّ في الخامِّ)،
# SIGTERM (143)، SIGINT (130)، ونقلُ gateway-proc.json عبر collect() الفعليةِ إلى raw/.
# يُبنى النصُّ المختبرُ من رأسِ seat-b33mtick.sh نفسِهِ (حتى مصائدِ الإشاراتِ كلِّها) —
# فيختبرُ الشيفرةَ الفعليةَ لا نسخةً منها. أيُّ إخفاقِ تأكيدٍ واحدٍ يجعلُ رمزَ خروجِ الحزمةِ
# غيرَ صفريٍّ (يُجمعُ عبرَ FAILS). ملاحظةٌ: set -m (job control) ضروريٌّ — إطلاقُ نصٍّ
# خلفيًا بـ& يورثُه SIGINT متجاهلًا فيُلغى مصيدتَه؛ معَ set -m يستعيدُ الافتراضيَّ
# فتُختبرُ المصيدةُ الفعليةُ كما في CI (حيثُ يعملُ النصُّ كعمليةٍ رئيسةٍ لا خلفيةٍ).
set -u
set -m
HERE=$(cd "$(dirname "$0")" && pwd)
SEAT="$HERE/../seat-b33mtick.sh"
REPO_ROOT=$(cd "$HERE/../../../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/b33mtick-finalize-test.XXXXXX)
[ "${KEEP:-0}" = 1 ] || trap 'rm -rf "$TEST_ROOT"' EXIT

# (أ) رأسُ النصِّ الفعليِّ حتى مصيدةِ SIGINT الأخيرةِ (جميعُ المصائدِ داخلَ النصِّ المختبرِ)
head -n "$(grep -n "^trap 'finalize 130' SIGINT$" "$SEAT" | cut -d: -f1)" "$SEAT" | sed \
  -e 's|^B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=\$W/ceezr; OUT=/home/user/b33mtick-out$|B=${TEST_B:?}; H=${TEST_H:?}; OUT=${TEST_OUT:?}|' \
  -e 's|^R_SHA=\${R_SHA:?}; C_SHA=\${C_SHA:?}$|R_SHA=${TEST_SHA:-x}; C_SHA=${TEST_SHA:-x}|' \
  > "$TEST_ROOT/seat-test.sh"
# (ب) دالةُ collect() الفعليةُ منقولةً حرفيًا (تُستدعى في اختبارِ النقلِ أدناه)
sed -n '/^collect() {/,/^}$/p' "$SEAT" >> "$TEST_ROOT/seat-test.sh"

cat >> "$TEST_ROOT/seat-test.sh" <<'EOF'
# ---------- محرّكُ الاختبارِ (ملحقٌ بعدَ النصِّ الفعليِّ؛ المتغيراتُ لاحقةً للمصائدِ) ----------
FAILS=0

# --- اختبارُ النقلِ: gateway-proc.json من evidence/ إلى raw/ عبر collect() الفعليةِ
# (التوقيعُ الفعليُّ: collect تأخذُ أسماءَ الموجاتِ وتقرأُ من $B/runs/$r/evidence؛
#  bun غيرُ متاحٍ محليًا فيفشلُ الجامعُ الرئيسُ برمزٍ محفوظٍ CRC ولا يوقفُ بقيةَ الجمع)
if [ "${TEST_COLLECT:-0}" = 1 ]; then
  R="b33mtick-m-a1-ref-750"
  E="$TEST_B/runs/$R/evidence"
  mkdir -p "$E" "$TEST_B/runs/current/evidence" "$TEST_B/bin"
  printf '{"pid":12345,"cwd":"/srv/x","cmd_ok":true}\n' > "$E/gateway-proc.json"
  printf 'NOTIFICATION_DRAIN_BUDGET_MS=8000\n' > "$TEST_B/runs/current/evidence/gateway-drain-budget.txt"
  printf 'x\n' > "$E/b24-env.json"
  # ملفاتٌ أدنى صالحةٌ حتى لا تُنتجَ أدواتُ الجمعِ أخطاءً (مساراتٌ طويلةٌ في التتبعِ
  # تُطابقُ نمطَ التدقيقِ العامَّ) — النقلُ هو المُختبرُ لا الأخطاءُ الاصطناعيةُ
  touch "$E/miniapp-load-events.jsonl" "$E/dispatch-trace.jsonl"
  printf 'id,created_ms,broadcast_round\n' > "$E/orders.csv"
  printf 'order_id,round,created_ms,telegram_id,status\n' > "$E/offers.csv"
  collect "$R"
  if cmp -s "$E/gateway-proc.json" "$OUT/raw/$R/gateway-proc.json" \
     && [ -f "$OUT/raw/$R/gateway-drain-budget.txt" ] \
     && [ -f "$OUT/raw/$R/b24-env.json" ]; then
    echo "COLLECT_OK"
  else
    echo "COLLECT_FAIL"; FAILS=$((FAILS+1))
  fi
  exit $((FAILS > 0 ? 1 : 0))
fi

# --- حالاتُ المصيرِ: تُشغَّلُ كعملياتٍ مستقلةٍ (الخلفيةُ للإشاراتِ)
if [ "${TEST_SIGTERM:-0}" = 1 ]; then
  while :; do sleep 10 & wait $!; done
elif [ "${TEST_SIGINT:-0}" = 1 ]; then
  while :; do sleep 10 & wait $!; done
else
  exit ${TEST_EXIT:-0}
fi
EOF

run_case() { # name secret_in expect_rc expect_marker expect_raw
  local name=$1 secret_in=$2 expect_rc=$3 expect_marker=$4 expect_raw=$5
  local t=$TEST_ROOT/$name
  mkdir -p "$t/b" "$t/out/raw"
  # بيئةُ المقعدِ المزيفةُ: سرٌّ عشوائيٌّ بصيغةِ مفتاحٍ=قيمةٍ (كما يقرؤهُ التدقيقُ) لا يُطبعُ
  printf 'TEST_SECRET=FAKE_SECRET_%s\n' "$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$t/b/secrets.env"
  printf 'clean line\n' > "$t/out/raw/event.jsonl"
  if [ "$secret_in" = yes ]; then cat "$t/b/secrets.env" >> "$t/out/raw/event.jsonl"; fi
  local rc=0
  if [ "$name" = sigterm ]; then
    TEST_B="$t/b" TEST_H="$REPO_ROOT" TEST_OUT="$t/out" TEST_SIGTERM=1 \
      bash "$TEST_ROOT/seat-test.sh" test-mode > "$t/log" 2>&1 &
    local pid=$!
    sleep 1; kill -TERM $pid; wait $pid || rc=$?
  elif [ "$name" = sigint ]; then
    TEST_B="$t/b" TEST_H="$REPO_ROOT" TEST_OUT="$t/out" TEST_SIGINT=1 \
      bash "$TEST_ROOT/seat-test.sh" test-mode > "$t/log" 2>&1 &
    local pid=$!
    sleep 1; kill -INT $pid; wait $pid || rc=$?
  else
    TEST_B="$t/b" TEST_H="$REPO_ROOT" TEST_OUT="$t/out" TEST_EXIT="$expect_rc" \
      bash "$TEST_ROOT/seat-test.sh" test-mode > "$t/log" 2>&1 || rc=$?
  fi
  local ok=1
  [ "$rc" = "$expect_rc" ] || { echo "  RC=$rc (want $expect_rc)"; ok=0; }
  if [ "$expect_marker" = yes ]; then
    [ -f "$t/out/.audit-ok" ] || { echo "  marker missing ($name path)"; ok=0; }
  else
    [ ! -f "$t/out/.audit-ok" ] || { echo "  marker should NOT exist"; ok=0; }
  fi
  if [ "$expect_raw" = yes ]; then
    [ -f "$t/out/raw/event.jsonl" ] || { echo "  raw should survive ($name path)"; ok=0; }
  else
    [ ! -f "$t/out/raw/event.jsonl" ] || { echo "  raw/ should be quarantined"; ok=0; }
    [ -f "$t/out/quarantine-manifest.txt" ] || { echo "  manifest missing"; ok=0; }
  fi
  if [ $ok = 1 ]; then
    echo "[$name] PASS (rc=$rc)"
  else
    echo "[$name] FAIL"
    sed -n '1,12p' "$t/log" | sed 's/FAKE_SECRET_.*/[سرٌّ]/'
    FAILS=$((FAILS+1))
  fi
}

FAILS=0
echo "== A) نجاحٌ: محتوى نظيفٌ ⇒ علامةٌ ورمزٌ 0"
run_case success no  0 yes yes
echo "== B) فشلُ التدقيقِ: سرٌّ في الخامِّ ⇒ حجرٌ ورمزٌ 1"
run_case auditfail yes 1 no no
echo "== C) SIGTERM ⇒ رمزُ 143 معَ عملِ الفخِّ"
run_case sigterm no  143 yes yes
echo "== D) SIGINT ⇒ رمزُ 130 معَ عملِ الفخِّ"
run_case sigint no  130 yes yes
echo "== E) نقلُ gateway-proc.json عبرَ collect() إلى raw/"
CF=0
mkdir -p "$TEST_ROOT/collect/b"
TEST_B="$TEST_ROOT/collect/b" TEST_H="$REPO_ROOT" TEST_OUT="$TEST_ROOT/collect/out" \
  TEST_COLLECT=1 \
  bash "$TEST_ROOT/seat-test.sh" test-mode > "$TEST_ROOT/collect/log" 2>&1 || CF=1
grep -q COLLECT_OK "$TEST_ROOT/collect/log" || { echo "  collect() transfer failed"; CF=1; }
grep -q COLLECT_FAIL "$TEST_ROOT/collect/log" && CF=1
if [ "$CF" = 0 ]; then echo "[collect] PASS"; else echo "[collect] FAIL"; FAILS=$((FAILS+1)); fi

echo "FAILS=$FAILS"
[ "$FAILS" = 0 ]
