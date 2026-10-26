#!/usr/bin/env bash
# اختبارُ منطقِ قرارِ الرفعِ (probe-final-audit.sh) على المجلّدِ نفسِهِ دونَ تنظيفِ العلامةِ
# داخلَ مساعدِ اختبارٍ — لأنّ الثغرةَ كانتْ علامةً قديمةً تُجيزُ رفعَ محتوىً لاحقٍ لم يجتزْ
# التدقيقَ النهائيَّ. الحالاتُ الثلاثُ الواجبةُ:
#   1) تدقيقٌ ناجحٌ أولًا (علامةٌ) ثمّ سرٌّ يُضافُ وإخفاقٌ لاحقٌ: لا رفعَ كاملًا (تُبطلُ
#      العلامةُ القديمةُ ويسقطُ الأثرُ الخامُ ويُسجَّلُ السببُ).
#   2) نجاحٌ ثمّ سرٌّ والخروجُ قبلَ تدقيقِ بوابةٍ أخرى: التدقيقُ النهائيُّ يمنعُ الرفعَ
#      (نفسُ آليةِ الإبطالِ — لا اعتمادَ على علامةٍ سابقةٍ).
#   3) بوابةٌ مرفوضةٌ (توقفٌ موثَّقٌ سابقٌ) معَ محتوىً نهائيٍّ نظيفٍ: تُحفظُ الحزمةُ
#      (علامةُ رفعٍ + بقاءُ الأثرِ الخامِّ) — توقُّفُ البوابةِ نتيجةٌ تشخيصيةٌ تُحفظُ.
set -euo pipefail
H=$(cd "$(dirname "$0")/../../.." && pwd)   # جذرُ المستودعِ (b24-runner/../../..)
RUNNER=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d /tmp/probe-final-audit-XXXXXX)
trap 'rm -rf "$TMP"' EXIT
FA="$RUNNER/probe-final-audit.sh"
AUDIT="$RUNNER/seat-bin/b24-secret-audit.py"
[ -f "$AUDIT" ] || AUDIT="$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py"
OUT=$TMP/out
mkdir -p "$OUT/raw"
SECRETS=$TMP/secrets.env
SECRET_VAL=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
( umask 177; printf 'INTERNAL_SIGNAL_SECRET=%s\nCITIES=JED,MKK\n' "$SECRET_VAL" > "$SECRETS" )
echo wave-artifact > "$OUT/raw/sentinel.txt"
printf 'gate=A/A\nreason=verdict_mismatch\n' > "$OUT/PROBE_STOP.txt"   # توقفُ بوابةٍ سابقٌ موثَّقٌ
RC_TOTAL=0

final_run() { # يُشغّلِ القرارَ النهائيَّ ويعيدُ رمزَهُ (دونَ أيِّ تنظيفٍ بينَ الاستدعاءاتِ)
  set +e
  bash "$FA" "$OUT" "$SECRETS" "$AUDIT" >"$TMP/final.log" 2>&1
  local RC=$?
  set -e
  return $RC
}

# ---------- 1) نجاحٌ أولًا ثمّ سرٌّ وإخفاقٌ لاحقٌ: لا رفعَ كاملًا ----------
final_run && grep -q "FINAL_AUDIT_CLEAN" "$TMP/final.log" || { echo "T1_FAIL: تدقيقٌ نظيفٌ رُفضَ"; RC_TOTAL=1; }
[ -f "$OUT/AUDIT_PASSED" ] || { echo "T1_FAIL: لا علامةَ رفعٍ بعدَ نظافةٍ"; RC_TOTAL=1; }
[ -f "$OUT/raw/sentinel.txt" ] || { echo "T1_FAIL: أثرٌ سقطَ معَ نظافةٍ"; RC_TOTAL=1; }
echo "T1_PASS (نجاحٌ أولًا: علامةٌ وأثرٌ)"
# السرُّ يُضافُ الآنَ — العلامةُ القديمةُ يجبُ أنْ تُبطَلَ
echo "$SECRET_VAL" > "$OUT/raw/leak.txt"
if final_run; then echo "T2_FAIL: تسريبٌ مُرِّرَ"; RC_TOTAL=1; else echo "T2_PASS"; fi
[ ! -f "$OUT/AUDIT_PASSED" ] || { echo "T2_FAIL: علامةٌ قديمةٌ بقيتْ بعدَ إخفاقٍ — ثغرةُ التصريحِ"; RC_TOTAL=1; }
grep -q "reason=SECRET_AUDIT_FAIL" "$OUT/PROBE_STOP.txt" || { echo "T2_FAIL: سببُ الإخفاقِ غيرُ مسجَّلٍ"; RC_TOTAL=1; }
[ ! -d "$OUT/raw" ] || { echo "T2_FAIL: أثرٌ خامٌ بقيَ معَ تسريبٍ"; RC_TOTAL=1; }
echo "T2_PASS (سرٌّ لاحقٌ: إبطالُ العلامةِ القديمةِ وسقوطُ الأثرِ)"

# ---------- 3) بوابةٌ مرفوضةٌ سابقًا + محتوىً نهائيٌّ نظيفٌ: الحزمةُ تُحفظُ ----------
rm -f "$OUT/raw/leak.txt" 2>/dev/null || true
mkdir -p "$OUT/raw"; echo wave-artifact > "$OUT/raw/sentinel.txt"
if final_run; then echo "T3_PASS"; else echo "T3_FAIL: نظافةٌ نهائيةٌ رُفضتْ"; RC_TOTAL=1; fi
[ -f "$OUT/AUDIT_PASSED" ] || { echo "T3_FAIL: توقفُ بوابةٍ نظيفٌ بلا تصريحِ حفظٍ"; RC_TOTAL=1; }
[ -f "$OUT/raw/sentinel.txt" ] || { echo "T3_FAIL: أثرُ التوقفِ النظيفِ لم يُحفَظْ"; RC_TOTAL=1; }
grep -q "reason=verdict_mismatch" "$OUT/PROBE_STOP.txt" || { echo "T3_FAIL: سببُ التوقفِ الأصليِّ ضاعَ"; RC_TOTAL=1; }
echo "T3_PASS (توقفٌ موثَّقٌ نظيفٌ: الحزمةُ تُحفظُ)"

if [ $RC_TOTAL -ne 0 ]; then echo "FINAL_AUDIT_TEST_FAIL"; exit 1; fi
echo "FINAL_AUDIT_TEST_OK — قرارُ الرفعِ منَ تدقيقٍ نهائيٍّ جديدٍ يُبطلُ ما قبلَهُ، والتسريبُ اللاحقُ يمنعُ الرفعَ، وتوقفُ البوابةِ النظيفُ يُحفظُ"
