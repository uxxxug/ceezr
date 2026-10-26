#!/usr/bin/env bash
# اختبارُ بواباتِ التمهيدِ بمشغّلٍ وهميّ: يثبتُ أنَّ بوابةً فاشلةً (A/A أو الكلفةِ)
# تُوقفُ المقعدَ (رمزُ 1 + PROBE_STOP.txt + تدقيقُ أسرارٍ) وأنَّ الناجحةَ تُجيزُ
# (رمزُ 0 ولا ملفَّ توقفٍ)، وأنَّ البوابتينِ في نصِّ المقعدِ تقعانِ قبلَ حلقةِ ABBA
# فلا موجةَ حكمٍ تبدأُ بعدَ إخفاقِ بوابةٍ. كذلك يطابقُ سلاسلَ الأحكامِ بينَ المحلّلِ
# والمقعدِ (AA_PASS/COST_PASS) ويثبتُ أنَّ التحليلَ الفاشلَ يُوقفُ لا يُمرَّرُ.
set -euo pipefail
H=$(cd "$(dirname "$0")/../../.." && pwd)   # جذرُ المستودعِ (b24-runner/../../..)
RUNNER=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d /tmp/probe-gate-test-XXXXXX)
GATE=$RUNNER/probe-gate.sh
AA_PASS="إعادةُ_إنتاجٍ_ضمنَ_±δ"
COST_PASS="كلفةٌ_محدودةٌ_بـ±δ"
SECRETS=$TMP/secrets.env
( umask 177; printf 'INTERNAL_SIGNAL_SECRET=%s\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$SECRETS" )
cp "$RUNNER/seat-bin/b24-secret-audit.py" "$TMP/audit.py" 2>/dev/null || cp "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$TMP/audit.py"
OUT=$TMP/out; mkdir -p "$OUT"
RC_TOTAL=0

gate_run() { # FILE EXPECTED LABEL ⇒ يطبعُ النتيجةَ ويعيدُ رمزَ البوابةِ
  rm -f "$OUT/PROBE_STOP.txt" "$OUT/wave-summary-stop.json" "$OUT/secret-audit.txt" "$OUT/AUDIT_PASSED"
  set +e
  bash "$GATE" "$1" "$2" "$3" "$OUT" "$SECRETS" "$TMP/audit.py" "$RUNNER" >"$TMP/gate.log" 2>&1
  local RC=$?
  set -e
  return $RC
}

# ---------- 1) بوابةُ A/A ناجحةٌ: رمزُ 0 ولا ملفَّ توقفٍ ----------
python3 - "$OUT/aa-ok.json" <<PY
import json;json.dump({"mode":"aa","verdict":"$AA_PASS"},open(__import__("sys").argv[1],"w"))
PY
gate_run "$OUT/aa-ok.json" "$AA_PASS" A/A && echo "T1_PASS" || { echo "T1_FAIL"; RC_TOTAL=1; }
[ ! -f "$OUT/PROBE_STOP.txt" ] || { echo "T1_FAIL: ملفُّ توقفٍ معَ إجازةٍ"; RC_TOTAL=1; }
[ -s "$OUT/secret-audit.txt" ] || { echo "T1_FAIL: لا تدقيقَ أسرارٍ في مسارِ الإجازةِ"; RC_TOTAL=1; }

# ---------- 2) بوابةُ A/A فاشلةٌ: رمزُ 1 + توقفٌ + تدقيقٌ ----------
python3 - "$OUT/aa-bad.json" <<PY
import json;json.dump({"mode":"aa","verdict":"قابليةُ_إعادةِ_الإنتاجِ_غيرُ_مثبتة"},open(__import__("sys").argv[1],"w"))
PY
if gate_run "$OUT/aa-bad.json" "$AA_PASS" A/A; then echo "T2_FAIL: بوابةٌ فاشلةٌ مُرِّرت"; RC_TOTAL=1; else echo "T2_PASS"; fi
grep -q "gate=A/A" "$OUT/PROBE_STOP.txt" && grep -q "reason=verdict_mismatch" "$OUT/PROBE_STOP.txt" || { echo "T2_FAIL: سببُ التوقفِ غائبٌ"; RC_TOTAL=1; }
[ -s "$OUT/wave-summary-stop.json" ] || { echo "T2_FAIL: ملخصُ التوقفِ غائبٌ"; RC_TOTAL=1; }
[ -s "$OUT/secret-audit.txt" ] || { echo "T2_FAIL: لا تدقيقَ أسرارٍ في مسارِ التوقفِ"; RC_TOTAL=1; }

# ---------- 3) بوابةُ الكلفةِ فاشلةٌ (ملوّثة): توقفٌ ----------
python3 - "$OUT/cost-bad.json" <<PY
import json;json.dump({"mode":"cost","verdict":"الأداةُ_ملوّثةٌ_للقياس"},open(__import__("sys").argv[1],"w"))
PY
if gate_run "$OUT/cost-bad.json" "$COST_PASS" COST; then echo "T3_FAIL"; RC_TOTAL=1; else echo "T3_PASS"; fi
grep -q "gate=COST" "$OUT/PROBE_STOP.txt" || { echo "T3_FAIL"; RC_TOTAL=1; }

# ---------- 4) حكمٌ غائبٌ (فشلُ التحليلِ): توقفٌ لا تمريرٌ ----------
if gate_run "$OUT/nonexistent.json" "$AA_PASS" A/A; then echo "T4_FAIL"; RC_TOTAL=1; else echo "T4_PASS"; fi
grep -q "reason=no_verdict_file" "$OUT/PROBE_STOP.txt" || { echo "T4_FAIL: السببُ غائبٌ"; RC_TOTAL=1; }
: > "$OUT/empty.json"
if gate_run "$OUT/empty.json" "$AA_PASS" A/A; then echo "T4_FAIL (فارغٌ)"; RC_TOTAL=1; else echo "T4_PASS (فارغٌ)"; fi

# ---------- 5) سلاسلُ الأحكامِ بينَ المحلّلِ والمقعدِ + ترتيبُ البواباتِ قبلَ ABBA ----------
SEAT=$RUNNER/seat-load01-c2-http-wait-probe.sh
[ -f "$SEAT" ] || { echo "T5_FAIL: المقعدُ غائبٌ"; RC_TOTAL=1; }
SEAT_SRC=$(cat "$SEAT")
echo "$SEAT_SRC" | grep -qF "$AA_PASS" || { echo "T5_FAIL: سلسلةُ A/A لا تطابقُ المقعدَ"; RC_TOTAL=1; }
echo "$SEAT_SRC" | grep -qF "$COST_PASS" || { echo "T5_FAIL: سلسلةُ الكلفةِ لا تطابقُ المقعدَ"; RC_TOTAL=1; }
AA_LINE=$(echo "$SEAT_SRC" | grep -n 'probe-gate.sh.*aa-gate' | head -1 | cut -d: -f1)
COST_LINE=$(echo "$SEAT_SRC" | grep -n 'probe-gate.sh.*cost-gate' | head -1 | cut -d: -f1)
ABBA_LINE=$(echo "$SEAT_SRC" | grep -n 'for SLOT in A1 B1 B2 A2 A3 B3 B4 A4' | head -1 | cut -d: -f1)
[ -n "$AA_LINE" ] && [ -n "$COST_LINE" ] && [ -n "$ABBA_LINE" ] \
  && [ "$AA_LINE" -lt "$ABBA_LINE" ] && [ "$COST_LINE" -lt "$ABBA_LINE" ] \
  || { echo "T5_FAIL: البوابتانِ ليستا قبلَ ABBA (aa=$AA_LINE cost=$COST_LINE abba=$ABBA_LINE)"; RC_TOTAL=1; }
echo "T5_PASS"

# ---------- 6) وضعُ التوقفِ المباشرُ --stop: سببٌ موثَّقٌ + تدقيقٌ + رمزُ 1 ----------
rm -f "$OUT/PROBE_STOP.txt" "$OUT/wave-summary-stop.json" "$OUT/secret-audit.txt" "$OUT/AUDIT_PASSED"
set +e
bash "$GATE" --stop "TEST_DIRECT_STOP" A/A "$OUT" "$SECRETS" "$TMP/audit.py" "$RUNNER" >"$TMP/stop.log" 2>&1
RC=$?
set -e
[ "$RC" -ne 0 ] || { echo "T6_FAIL: --stop مرَّ"; RC_TOTAL=1; }
grep -q "gate=A/A" "$OUT/PROBE_STOP.txt" && grep -q "reason=TEST_DIRECT_STOP" "$OUT/PROBE_STOP.txt" || { echo "T6_FAIL: سببُ التوقفِ غيرُ موثَّقٍ"; RC_TOTAL=1; }
[ -s "$OUT/wave-summary-stop.json" ] || { echo "T6_FAIL: ملخصُ التوقفِ غائبٌ"; RC_TOTAL=1; }
[ -s "$OUT/secret-audit.txt" ] || { echo "T6_FAIL: لا تدقيقَ في مسارِ --stop"; RC_TOTAL=1; }
echo "T6_PASS"

# ---------- 7) حكمٌ مرفوضٌ + تدقيقٌ نظيف: توقفٌ موثَّقٌ معَ حفظِ الدليلِ ----------
mkdir -p "$OUT/raw"; echo wave-artifact > "$OUT/raw/sentinel.txt"
if gate_run "$OUT/aa-bad.json" "$AA_PASS" A/A; then echo "T7_FAIL: بوابةٌ فاشلةٌ مُرِّرت"; RC_TOTAL=1; else echo "T7_PASS"; fi
grep -q "reason=verdict_mismatch" "$OUT/PROBE_STOP.txt" || { echo "T7_FAIL: سببُ التوقفِ خاطئٌ"; RC_TOTAL=1; }
[ -f "$OUT/AUDIT_PASSED" ] || { echo "T7_FAIL: لا علامةَ اجتيازِ تدقيقٍ — سيرُ العملِ لن يرفعَ الدليلَ"; RC_TOTAL=1; }
[ -f "$OUT/raw/sentinel.txt" ] || { echo "T7_FAIL: أثرٌ خامٌ حُذفَ معَ تدقيقٍ نظيفٍ"; RC_TOTAL=1; }

# ---------- 8) تدقيقٌ فاشل: توقفٌ منظّمٌ بسببهِ + لا علامةَ رفعٍ + سقوطُ الأثرِ الخامِّ ----------
SECRET_VAL=$(grep INTERNAL_SIGNAL_SECRET "$SECRETS" | cut -d= -f2)
mkdir -p "$OUT/raw"; echo "$SECRET_VAL" > "$OUT/raw/leak.txt"
if gate_run "$OUT/aa-ok.json" "$AA_PASS" A/A; then echo "T8_FAIL: تدقيقٌ فاشلٌ مُرِّرَ"; RC_TOTAL=1; else echo "T8_PASS"; fi
grep -q "reason=SECRET_AUDIT_FAIL" "$OUT/PROBE_STOP.txt" || { echo "T8_FAIL: سببُ إخفاقِ التدقيقِ غيرُ مسجَّلٍ"; RC_TOTAL=1; }
[ ! -f "$OUT/AUDIT_PASSED" ] || { echo "T8_FAIL: علامةُ رفعٍ معَ تدقيقٍ فاشلٍ"; RC_TOTAL=1; }
[ ! -d "$OUT/raw" ] || { echo "T8_FAIL: أثرٌ خامٌ بقيَ معَ تدقيقٍ فاشلٍ"; RC_TOTAL=1; }

rm -rf "$TMP"
if [ $RC_TOTAL -ne 0 ]; then echo "GATE_STOP_TEST_FAIL"; exit 1; fi
echo "GATE_STOP_TEST_OK — البواباتُ تُوقفُ ولا تُمرِّرُ، والتدقيقُ يجري في المسارينِ، والبوابتانِ قبلَ ABBA"
