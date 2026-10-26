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

# ---------- 4–6) كتلةُ قرارِ الرفعِ الفعليةُ من سيرِ العملِ: العلامةُ القديمةُ لا تنجو ----------
# تُقتطعُ كتلةُ «التدقيقِ النهائيِّ وقرارِ الرفعِ» من ملفِّ سيرِ العملِ نفسِهِ وتُشغَّل
# بمتغيّراتِ بيئةٍ موجهةٍ — فتُختبرُ الكتلةُ المستعملةُ فعلًا لا سكربتٌ داخليٌّ وحدَهُ.
WF_BLOCK=$(python3 - "$H/.github/workflows/load01-c2-http-wait-probe.yml" <<'PYWF'
import sys, yaml
wf = yaml.safe_load(open(sys.argv[1]))
for step in wf['jobs']['seat']['steps']:
    if step.get('name') == 'التدقيق النهائي وقرار الرفع':
        print(step['run'])
        break
PYWF
)
[ -n "$WF_BLOCK" ] || { echo "T4_FAIL: كتلةُ القرارِ لم تُقتطعْ من سيرِ العملِ"; RC_TOTAL=1; }

wf_run_block() { # OUTDIR FINAL_SCRIPT GITHUB_OUT ⇒ يعيدُ رمزَ الكتلةِ
  local OUTD=$1 FINAL=$2 GHO=$3
  set +e
  PROBE_OUT=$OUTD PROBE_SECRETS="$TMP/secrets.env" \
    PROBE_AUDIT_PY="$AUDIT" PROBE_FINAL=$FINAL GITHUB_OUTPUT=$GHO \
    bash -c "$WF_BLOCK"
  local RC=$?
  set -e
  return $RC
}

# T4: علامةٌ قديمةٌ + برنامجٌ نهائيٌّ يتعذّرُ تشغيلُهُ (ينهارُ قبلَ أيِّ شيءٍ) — لا رفعَ كاملَ
OUTD=$TMP/wf-crash; mkdir -p "$OUTD"
touch "$OUTD/AUDIT_PASSED"   # علامةٌ قديمةٌ مزروعةٌ
printf '#!/usr/bin/env bash\nexit 2\n' > "$TMP/final-crash.sh"; chmod +x "$TMP/final-crash.sh"
wf_run_block "$OUTD" "$TMP/final-crash.sh" "$TMP/gho4.txt" && RC4=0 || RC4=$?
MODE4=$(grep -o 'mode=[a-z]*' "$TMP/gho4.txt" | head -1)
[ "$RC4" -ne 0 ] || { echo "T4_FAIL: انهيارُ البرنامجِ النهائيِّ مُرِّرَ"; RC_TOTAL=1; }
[ "$MODE4" = "mode=report" ] || { echo "T4_FAIL: وضعٌ $MODE4 معَ انهيارٍ — العلامةُ القديمةُ نجتْ"; RC_TOTAL=1; }
[ ! -f "$OUTD/AUDIT_PASSED" ] || { echo "T4_FAIL: علامةٌ قديمةٌ بقيتْ — الإبطالُ في خطوةِ الاستدعاءِ مفقودٌ"; RC_TOTAL=1; }
echo "T4_PASS (انهيارُ النهائيِّ: تقريرٌ فقط والعلامةُ القديمةُ أُبطلتْ)"

# T5: برنامجٌ يخرجُ قبلَ حذفِ العلامةِ (محاكاةُ إصدارٍ معطوبٍ) — الإبطالُ في الخطوةِ يحمي
OUTD=$TMP/wf-earlyexit; mkdir -p "$OUTD"
touch "$OUTD/AUDIT_PASSED"
printf '#!/usr/bin/env bash\nexit 1\n' > "$TMP/final-earlyexit.sh"; chmod +x "$TMP/final-earlyexit.sh"
wf_run_block "$OUTD" "$TMP/final-earlyexit.sh" "$TMP/gho5.txt" && RC5=0 || RC5=$?
MODE5=$(grep -o 'mode=[a-z]*' "$TMP/gho5.txt" | head -1)
[ "$RC5" -ne 0 ] || { echo "T5_FAIL: خروجٌ معطوبٌ مُرِّرَ"; RC_TOTAL=1; }
[ "$MODE5" = "mode=report" ] || { echo "T5_FAIL: وضعٌ $MODE5 معَ خروجٍ معطوبٍ"; RC_TOTAL=1; }
[ ! -f "$OUTD/AUDIT_PASSED" ] || { echo "T5_FAIL: علامةٌ نجتْ منَ برنامجٍ لا يحذفُها"; RC_TOTAL=1; }
echo "T5_PASS (خروجٌ قبلَ الحذفِ: الإبطالُ في الخطوةِ يمنعُ الرفعَ)"

# T6: مقابسُ إيجابيٌّ: البرنامجُ الحقيقيُّ + شجرةٌ نظيفةٌ ⇒ رفعٌ كاملٌ
OUTD=$TMP/wf-ok; mkdir -p "$OUTD/raw"; echo artifact > "$OUTD/raw/sentinel.txt"
wf_run_block "$OUTD" "$RUNNER/probe-final-audit.sh" "$TMP/gho6.txt" && RC6=0 || RC6=$?
MODE6=$(grep -o 'mode=[a-z]*' "$TMP/gho6.txt" | head -1)
[ "$RC6" -eq 0 ] || { echo "T6_FAIL: نظافةٌ رُفضتْ"; RC_TOTAL=1; }
[ "$MODE6" = "mode=evidence" ] || { echo "T6_FAIL: وضعٌ $MODE6 معَ نظافةٍ"; RC_TOTAL=1; }
[ -f "$OUTD/AUDIT_PASSED" ] || { echo "T6_FAIL: لا علامةَ بعدَ نظافةٍ"; RC_TOTAL=1; }
echo "T6_PASS (نظافةٌ: رفعٌ كاملٌ)"

if [ $RC_TOTAL -ne 0 ]; then echo "FINAL_AUDIT_TEST_FAIL"; exit 1; fi
echo "FINAL_AUDIT_TEST_OK — قرارُ الرفعِ منَ تدقيقٍ نهائيٍّ جديدٍ يُبطلُ ما قبلَهُ، والتسريبُ اللاحقُ يمنعُ الرفعَ، وتوقفُ البوابةِ النظيفُ يُحفظُ"
