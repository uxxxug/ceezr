#!/usr/bin/env bash
# التدقيقُ النهائي وقرارُ رفعِ الدليلِ لدورةِ load01-c2-http-wait-probe — يُستدعى من سيرِ
# العملِ **بعدَ انتهاءِ خطوةِ المقعدِ دائمًا** (نجاحًا أو توقفًا أو إخفاقًا). القاعدةُ:
#   تصريحُ الرفعِ لا تصدرُهُ إلا بوابةٌ أو ختامُ مقعدٍ سابقٌ — بل تدقيقٌ نهائيٌّ جديدٌ على
#   شجرةِ الدليلِ كما ستُرفَعُ، يُبطلُ أيَّ تصريحٍ سابقٍ قبلَ أنْ يبدأَ:
#     1) يُحذفُ AUDIT_PASSED إنْ وُجدَ (إبطالُ التصريحِ القديمِ — علامةُ بوابةٍ سابقةٍ
#        لا تُجيزُ رفعَ محتوىً لاحقٍ لم يجتزْ تدقيقًا).
#     2) يُشغَّلُ b24-secret-audit.py على الشجرةِ كلِّها.
#     3) نجاحٌ ⇒ AUDIT_PASSED جديدةٌ + FINAL_AUDIT_CLEAN (تُرفعُ الحزمةُ كاملةً حتى في
#        مسارِ التوقفِ المُوثَّقِ — توقُّفُ البوابةِ نتيجةٌ تشخيصيةٌ تُحفظُ). فشلٌ ⇒ سببٌ
#        منظّمٌ مسجَّلٌ (SECRET_AUDIT_FAIL) + سقوطُ الأثرِ الخامِّ + لا تصريحَ (لا يُرفعُ
#        إلا التقريرُ المنقَّحُ).
# الاستدعاءُ: probe-final-audit.sh <OUT_dir> <secrets_env> <audit_py>
set -euo pipefail
OUT=$1; SECRETS=$2; AUDIT_PY=$3

if [ ! -d "$OUT" ]; then
  echo "FINAL_AUDIT_NO_OUT: لا شجرةَ دليلٍ أصلًا — لا تصريحَ رفعٍ"
  exit 1
fi

# إبطالُ أيِّ تصريحٍ سابقٍ — القرارُ منَ هذا التدقيقِ وحدَهُ
rm -f "$OUT/AUDIT_PASSED"

# تنظيفُ متغيّراتِ التشغيلِ غيرِ السرِّيةِ منَ ملفِّ الأسرارِ (كما يفعلُ المقعدُ قبلَ تدقيقِه)
sed -i '/^CITIES=/d;/^CITY=/d' "$SECRETS" 2>/dev/null || true

RC=0
python3 "$AUDIT_PY" "$SECRETS" "$OUT" >"$OUT/final-secret-audit.txt" 2>&1 || RC=$?
cat "$OUT/final-secret-audit.txt"
if [ $RC -ne 0 ]; then
  echo "FINAL_AUDIT_FAIL — لا تصريحَ رفعٍ: السببُ مسجَّلٌ والأثرُ الخامُ يسقطُ"
  if [ -f "$OUT/PROBE_STOP.txt" ]; then
    printf 'gate=FINAL_UPLOAD_DECISION\nreason=SECRET_AUDIT_FAIL\nstopped_at_utc=%s\n' "$(date -Is)" >> "$OUT/PROBE_STOP.txt"
  else
    printf 'gate=FINAL_UPLOAD_DECISION\nreason=SECRET_AUDIT_FAIL\nstopped_at_utc=%s\n' "$(date -Is)" > "$OUT/PROBE_STOP.txt"
  fi
  printf '{"stopped_gate":"FINAL_UPLOAD_DECISION","reason":"SECRET_AUDIT_FAIL","date_utc":"%s"}\n' "$(date -Is)" > "$OUT/wave-summary-stop.json"
  rm -rf "$OUT/raw"
  exit 1
fi
touch "$OUT/AUDIT_PASSED"
echo "FINAL_AUDIT_CLEAN — تصريحُ الرفعِ منَ هذا التدقيقِ النهائيِّ وحدَهُ"
