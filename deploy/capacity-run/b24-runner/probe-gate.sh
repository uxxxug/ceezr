#!/usr/bin/env bash
# بوابةُ تمهيدٍ واحدةٌ لدورةِ load01-c2-http-wait-probe — تُستدعى من المقعدِ بعدَ توليدِ
# ملفِ حكمِ البوابةِ (aa-gate.json أو cost-gate.json). المسؤولياتُ:
#   1) استخراجُ الحكمِ منَ الملفِ (فشلُ الاستخراجِ = توقفٌ).
#   2) مطابقتُه معَ الحكمِ المتوقعِ؛ المخالفةُ أو الغيابُ = **توقفٌ** لا تخفيفَ.
#   3) عندَ التوقفِ: كتابةُ سببِه (PROBE_STOP.txt) وملخصِ المحاولاتِ (wave-summary-stop.json)،
#      **ثمّ تدقيقُ الأسرارِ قبلَ أيِّ خروجٍ** (حتى مسارُ الإخفاقِ لا ينشرُ أثرًا بلا تدقيقٍ)،
#      ثمّ الخروجُ برمزِ 1 — فتتوقفُ الموجاتُ اللاحقةُ كلُّها (set -euo pipefail في المقعدِ).
# الاستدعاءُ: probe-gate.sh <gate.json> <expected_verdict> <label> <OUT_dir> <secrets_env> <audit_py> <runner_dir>
set -euo pipefail
GATE_JSON=$1; EXPECTED=$2; LABEL=$3; OUT=$4; SECRETS=$5; AUDIT_PY=$6; RUNNER_DIR=$7

mkdir -p "$OUT"
REASON=""
if [ ! -s "$GATE_JSON" ]; then
  echo "[$(date -u +%T)] GATE_${LABEL}_NO_VERDICT: ملفُ الحكمِ غائبٌ أو فارغٌ — توقف"
  VERDICT="__MISSING__"; REASON="no_verdict_file"
elif ! VERDICT=$(python3 -c "import json;print(json.load(open('$GATE_JSON'))['verdict'])" 2>/dev/null); then
  VERDICT="__EXTRACT_FAIL__"; REASON="verdict_extract_fail"
fi
echo "GATE_${LABEL}_VERDICT $VERDICT"
if [ "$VERDICT" != "$EXPECTED" ]; then
  echo "PROBE_STOP: بوابةُ $LABEL لم تُجَز (الحكمُ: $VERDICT؛ المتوقعُ: $EXPECTED) — إيقافٌ وتوثيقٌ لا تخفيفَ (ملحقُ البروتوكول)"
  [ -n "$REASON" ] || REASON="verdict_mismatch"
  printf 'gate=%s\nreason=%s\ngot=%s\nexpected=%s\nstopped_at_utc=%s\n' \
    "$LABEL" "$REASON" "$VERDICT" "$EXPECTED" "$(date -Is)" > "$OUT/PROBE_STOP.txt"
  printf '{"stopped_gate":"%s","reason":"%s","verdict":"%s","expected":"%s","date_utc":"%s"}\n' \
    "$LABEL" "$REASON" "$VERDICT" "$EXPECTED" "$(date -Is)" > "$OUT/wave-summary-stop.json"
fi

# تدقيقُ الأسرارِ في كلِّ مسارٍ (إجازةٍ أو توقفٍ) قبلَ الخروجِ — فشلُه يُسقطُ الأثرَ الخامَّ
SA_RC=0
python3 "$AUDIT_PY" "$SECRETS" "$OUT" > "$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
cat "$OUT/secret-audit.txt"
if [ $SA_RC -ne 0 ]; then
  echo "SECRET_AUDIT_FAIL (عندَ بوابةِ $LABEL)"
  rm -rf "$OUT/raw"
  exit 1
fi

[ "$VERDICT" = "$EXPECTED" ] || exit 1
echo "GATE_${LABEL}_PASSED ($VERDICT)"
