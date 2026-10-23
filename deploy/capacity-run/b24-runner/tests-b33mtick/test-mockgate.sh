#!/usr/bin/env bash
# اختبارُ محليٌّ لبوابةِ قراءةِ بيئةِ المحاكي (MOCK_ENV_READ_FAIL) في seat-b33mtick.sh —
# الكتلةُ تُستخرجُ من النصِّ الفعليِّ حرفيًا (لا نسخةً يدويةً) وتُشغَّل بخياراتِ المقعدِ
# نفسِها (bash -euo pipefail). الحالاتُ:
# (1) قيمةٌ مضبوطةٌ + هويةٌ صحيحةٌ ⇒ التقاطُ 20 كاملةً معَ rc=0 وبيانٌ مكتوبٌ
# (2) قراءةٌ ناجحةٌ والمفتاحُ غائبٌ ⇒ unset معَ عدِّ المداخل
# (3) PID ميتٌ ⇒ فشلٌ مُغلقٌ
# (4) هويةٌ خاطئةٌ (عمليةٌ حيّةٌ بلا اسمِ المحاكي) ⇒ فشلٌ مُغلقٌ
# (5) ملفُ pid غائبٌ ⇒ فشلٌ مُغلقٌ
# (6) موجَّه: عمليةُ محاكيٍ بملكيةِ جذرٍ (بيئةٌ غيرُ قابلةٍ للقراءةِ مباشرةً) ⇒ فشلُ
#     القراءةِ المباشرةِ يستدعي المسارَ المرفوعَ (sudo) فعلًا وتُستكملُ البوابةُ به
# (7) موجَّه: فشلُ فتحِ الملفِّ في القارئِ يُرجعُ رمزًا غيرَ صفريٍّ (لا استمرارًا إلى printf)
# أيُّ إخفاقٍ ⇒ رمزُ خروجٍ غيرُ صفريٍّ (FAILS).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
SEAT="$HERE/../seat-b33mtick.sh"
TEST_ROOT=$(mktemp -d /tmp/b33mtick-mockgate-test.XXXXXX)
[ "${KEEP:-0}" = 1 ] || trap 'rm -rf "$TEST_ROOT"' EXIT

# استخراجُ الكتلةِ الفعليةِ: من تعليقِ «هويةُ المحاكي» حتى سطرِ mock-send-bucket.txt
awk '/^# هويةُ المحاكي/,/mock-send-bucket\.txt/' "$SEAT" > "$TEST_ROOT/gate.sh"
grep -q 'MOCKPID=$(cat' "$TEST_ROOT/gate.sh" || { echo "gate block extraction failed"; exit 1; }
# استخراجُ جسمِ القارئِ (بين علامتي اقتباسِ MOCK_READER) لاختبارِ فشلِ الفتحِ منفردًا
awk "/MOCK_READER='/{f=1;next} f&&/^  '$/{exit} f{print}" "$SEAT" > "$TEST_ROOT/reader-body.sh"
grep -q 'exec 3<' "$TEST_ROOT/reader-body.sh" || { echo "reader extraction failed"; exit 1; }

FAILS=0
echo "== 1) قيمةٌ مضبوطةٌ + هويةٌ صحيحةٌ ⇒ التقاطُ 20 كاملةً (rc=0 وبيانٌ مكتوبٌ)"
t=$TEST_ROOT/c1; mkdir -p "$t/b/pids" "$t/out"
MOCK_GLOBAL_PER_BOT_PER_SEC=20 python3 -c 'import time; time.sleep(600)' telegram-mock-server.ts & P1=$!
echo $P1 > "$t/b/pids/telegram-mock.pid"
( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC1=$?
kill $P1 2>/dev/null
if [ $RC1 -eq 0 ] \
   && grep -q "MOCK_SEND_BUCKET=MOCK_GLOBAL_PER_BOT_PER_SEC=20 " "$t/log" \
   && [ -f "$t/out/mock-send-bucket.txt" ] \
   && grep -qE "pid=$P1, [1-9][0-9]* مدخل" "$t/log"; then
  echo "[c1] PASS"
else
  echo "[c1] FAIL rc=$RC1: $(head -c 200 "$t/log")"; FAILS=$((FAILS+1))
fi

echo "== 2) قراءةٌ ناجحةٌ والمفتاحُ غائبٌ ⇒ unset معَ عدِّ المداخل (rc=0 وبيانٌ مكتوبٌ)"
t=$TEST_ROOT/c2; mkdir -p "$t/b/pids" "$t/out"
python3 -c 'import time; time.sleep(600)' telegram-mock-server.ts & P2=$!
echo $P2 > "$t/b/pids/telegram-mock.pid"
( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC2=$?
kill $P2 2>/dev/null
if [ $RC2 -eq 0 ] \
   && grep -qE "MOCK_SEND_BUCKET=MOCK_GLOBAL_PER_BOT_PER_SEC=unset ⇒ الافتراضيُّ 30/ث .* pid=$P2, [1-9][0-9]* مدخل" "$t/log" \
   && [ -f "$t/out/mock-send-bucket.txt" ]; then
  echo "[c2] PASS"
else
  echo "[c2] FAIL rc=$RC2: $(head -c 200 "$t/log")"; FAILS=$((FAILS+1))
fi

echo "== 3) PID ميتٌ (ملفُ pid قديمٌ) ⇒ فشلٌ مُغلقٌ"
t=$TEST_ROOT/c3; mkdir -p "$t/b/pids" "$t/out"
echo 999999 > "$t/b/pids/telegram-mock.pid"
( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC3=$?
if [ $RC3 -ne 0 ] && grep -q "MOCK_ENV_READ_FAIL" "$t/log"; then
  echo "[c3] PASS"
else
  echo "[c3] FAIL rc=$RC3: $(head -c 200 "$t/log")"; FAILS=$((FAILS+1))
fi

echo "== 4) هويةٌ خاطئةٌ (عمليةٌ حيّةٌ بلا اسمِ المحاكي) ⇒ فشلٌ مُغلقٌ"
t=$TEST_ROOT/c4; mkdir -p "$t/b/pids" "$t/out"
sleep 600 & P4=$!
echo $P4 > "$t/b/pids/telegram-mock.pid"
( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC4=$?
kill $P4 2>/dev/null
if [ $RC4 -ne 0 ] && grep -q "MOCK_ENV_READ_FAIL.*identity_ok=0" "$t/log"; then
  echo "[c4] PASS"
else
  echo "[c4] FAIL rc=$RC4: $(head -c 200 "$t/log")"; FAILS=$((FAILS+1))
fi

echo "== 5) ملفُ pid غائبٌ ⇒ فشلٌ مُغلقٌ"
t=$TEST_ROOT/c5; mkdir -p "$t/b/pids" "$t/out"
( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC5=$?
if [ $RC5 -ne 0 ] && grep -q "MOCK_ENV_READ_FAIL pid=none" "$t/log"; then
  echo "[c5] PASS"
else
  echo "[c5] FAIL rc=$RC5: $(head -c 200 "$t/log")"; FAILS=$((FAILS+1))
fi

echo "== 6) موجَّه: بيئةٌ غيرُ مقروءةٍ مباشرةً (عمليةُ جذرٍ) ⇒ المسارُ المرفوعُ (sudo) فعليٌّ"
# عمليةُ محاكيٍ بملكيةِ جذرٍ: cmdline عامُّ القراءةِ (الهويةُ تنجحُ) وenviron لجذرٍ فقط.
# (أ) القارئُ المستخرجُ نفسُهُ على PID الجذرِ ⇒ رمزٌ غيرُ صفريٍّ — تعذُّرُ القراءةِ
#     المباشرةِ مثبتٌ برمزِ الخروجِ لا مستنتجًا من غيابِ المفتاحِ.
# (ب) البوابةُ الكاملةُ بعدها تنجحُ وتكتبُ البيانَ — فنجاحُ المسارِ المرفوعِ مثبتٌ فعليًا.
if sudo -n true 2>/dev/null; then
  t=$TEST_ROOT/c6; mkdir -p "$t/b/pids" "$t/out"
  sudo -n python3 -c 'import os, time
open("'"$TEST_ROOT"'/c6.pid", "w").write(str(os.getpid()))
time.sleep(600)' telegram-mock-server.ts & P6SUDO=$!
  for _ in $(seq 1 20); do [ -s "$TEST_ROOT/c6.pid" ] && break; sleep 0.2; done
  P6=$(cat "$TEST_ROOT/c6.pid" 2>/dev/null || true)
  if [ -n "$P6" ]; then
    echo $P6 > "$t/b/pids/telegram-mock.pid"
    bash -c "$(cat "$TEST_ROOT/reader-body.sh")" _ "$P6" >/dev/null 2>&1; RC_DIRECT=$?
    ( cd "$t"; B="$t/b" OUT="$t/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t/log" 2>&1; RC6=$?
    if [ $RC_DIRECT -ne 0 ] && [ $RC6 -eq 0 ] \
       && grep -qE "MOCK_SEND_BUCKET=MOCK_GLOBAL_PER_BOT_PER_SEC=.* pid=$P6, [1-9][0-9]* مدخل" "$t/log" \
       && [ -f "$t/out/mock-send-bucket.txt" ]; then
      echo "[c6] PASS (direct reader rc=$RC_DIRECT by permission; full gate rc=0 via elevated path)"
    else
      echo "[c6] FAIL direct_rc=$RC_DIRECT gate_rc=$RC6: $(head -c 300 "$t/log")"; FAILS=$((FAILS+1))
    fi

    echo "== 8) موجَّه: فشلُ المسارِ المرفوعِ (بديلُ sudo يُرجعُ فشلًا) ⇒ فشلٌ مُغلقٌ"
    # الكتلةُ الفعليةُ نفسُها تحتَ bash -euo pipefail معَ بديلٍ اختباريٍّ لـsudo يسجّلُ
    # استدعاءَه ويرجعُ فشلًا: تُشتَرَطُ استدعاءُه، وخروجُ البوابةِ بغيرِ صفريٍّ، وظهورُ
    # MOCK_ENV_READ_FAIL، وعدمُ إنشاءِ mock-send-bucket.txt.
    t8=$TEST_ROOT/c8; mkdir -p "$t8/b/pids" "$t8/out" "$t8/bin"
    echo $P6 > "$t8/b/pids/telegram-mock.pid"
    printf '#!/usr/bin/env bash\necho "SUDO_STUB_INVOKED args=$*" > "%s"\nexit 1\n' "$t8/sudo-stub.log" > "$t8/bin/sudo"
    chmod +x "$t8/bin/sudo"
    ( cd "$t8"; PATH="$t8/bin:$PATH" B="$t8/b" OUT="$t8/out" bash -euo pipefail "$TEST_ROOT/gate.sh" ) > "$t8/log" 2>&1; RC8=$?
    if [ $RC8 -ne 0 ] && grep -q "MOCK_ENV_READ_FAIL" "$t8/log" \
       && [ ! -f "$t8/out/mock-send-bucket.txt" ] \
       && grep -q "SUDO_STUB_INVOKED" "$t8/sudo-stub.log"; then
      echo "[c8] PASS (elevated path failed → gate closed, no bucket file)"
    else
      echo "[c8] FAIL rc=$RC8: $(head -c 300 "$t8/log")"; FAILS=$((FAILS+1))
    fi
    sudo -n kill "$P6" 2>/dev/null
  else
    echo "[c6] SKIP (root process launch failed)"; FAILS=$((FAILS+1))
  fi
  kill $P6SUDO 2>/dev/null
else
  echo "[c6] SKIP (sudo unavailable locally)"; FAILS=$((FAILS+1))
fi


echo "== 7) موجَّه: فشلُ فتحِ الملفِّ في القارئِ ⇒ رمزٌ غيرُ صفريٍّ (لا printf بعدَ فشلٍ)"
bash -c "$(cat "$TEST_ROOT/reader-body.sh")" _ 999999 >/dev/null 2>&1; RC7=$?
if [ $RC7 -ne 0 ]; then
  echo "[c7] PASS (open failure → rc=$RC7)"
else
  echo "[c7] FAIL (open failure returned 0)"; FAILS=$((FAILS+1))
fi

echo "FAILS=$FAILS"
[ "$FAILS" = 0 ]
