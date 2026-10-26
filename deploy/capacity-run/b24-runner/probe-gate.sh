#!/usr/bin/env bash
# بوابةُ تمهيدٍ واحدةٌ لدورةِ load01-c2-http-wait-probe — تُستدعى من المقعدِ بعدَ توليدِ
# ملفِ حكمِ البوابةِ (aa-gate.json أو cost-gate.json). المسؤولياتُ:
#   1) استخراجُ الحكمِ منَ الملفِ (فشلُ الاستخراجِ = توقفٌ).
#   2) مطابقتُه معَ الحكمِ المتوقعِ؛ المخالفةُ أو الغيابُ = **توقفٌ** لا تخفيفَ.
#   3) عندَ التوقفِ: كتابةُ سببِه (PROBE_STOP.txt) وملخصِ المحاولاتِ (wave-summary-stop.json)،
#      **ثمّ تدقيقُ الأسرارِ قبلَ أيِّ خروجٍ** (حتى مسارُ الإخفاقِ لا ينشرُ أثرًا بلا تدقيقٍ)،
#      ثمّ الخروجُ برمزِ 1 — فتتوقفُ الموجاتُ اللاحقةُ كلُّها (set -euo pipefail في المقعدِ).
# وضعُ التوقفِ المباشرِ: probe-gate.sh --stop "<سببٌ نصّيٌّ>" <label> <OUT> <secrets> <audit_py> <runner_dir>
#   — يُستدعى منَ المقعدِ عندَ إخفاقِ المحلّلِ نفسِهِ (لا ملفَّ حكمٍ أصلًا): توثيقُ السببِ
#     وتدقيقُ الأسرارِ وخروجٌ برمزِ 1، فلا JSON قديمَ يُقرأُ ولا موجةَ لاحقةَ تبدأُ.
# الاستدعاءُ: probe-gate.sh <gate.json> <expected_verdict> <label> <OUT_dir> <secrets_env> <audit_py> <runner_dir>
set -euo pipefail

audit_run() { # <secrets> <audit_py> <OUT> <label> ⇒ 0 إذا نظيفَ، 1 وإلا (توقفٌ منظّمٌ + حذفُ الأثرِ الخامِّ)
  local SECRETS=$1 AUDIT_PY=$2 OUT=$3 LABEL=$4 SA_RC=0
  python3 "$AUDIT_PY" "$SECRETS" "$OUT" >"$OUT/secret-audit.txt" 2>&1 || SA_RC=$?
  cat "$OUT/secret-audit.txt"
  if [ $SA_RC -ne 0 ]; then
    echo "SECRET_AUDIT_FAIL (عندَ $LABEL)"
    # توقفٌ منظّمٌ مسجَّلٌ قبلَ الخروجِ (كما أيِّ سببِ توقفٍ آخر) + سقوطُ الأثرِ الخامِّ
    printf 'gate=%s\nreason=SECRET_AUDIT_FAIL\nstopped_at_utc=%s\n' "$LABEL" "$(date -Is)" > "$OUT/PROBE_STOP.txt"
    printf '{"stopped_gate":"%s","reason":"SECRET_AUDIT_FAIL","date_utc":"%s"}\n' "$LABEL" "$(date -Is)" > "$OUT/wave-summary-stop.json"
    rm -rf "$OUT/raw"
    return 1
  fi
  # البوابةُ لا تمنحُ تصريحَ رفعٍ: قرارُ الرفعِ يصدرُهُ التدقيقُ النهائيُّ بعدَ انتهاءِ
  # المقعدِ (probe-final-audit.sh) — علامةُ بوابةٍ سابقةٍ لا تُجيزُ رفعَ محتوىً لاحقٍ.
  return 0
}

if [ "${1:-}" = "--stop" ]; then
  MSG=$2; LABEL=$3; OUT=$4; SECRETS=$5; AUDIT_PY=$6; RUNNER_DIR=$7
  mkdir -p "$OUT"
  echo "PROBE_STOP: $MSG — إيقافٌ وتوثيقٌ وتدقيقُ أسرارٍ لا تخفيفَ"
  printf 'gate=%s\nreason=%s\nstopped_at_utc=%s\n' "$LABEL" "$MSG" "$(date -Is)" > "$OUT/PROBE_STOP.txt"
  printf '{"stopped_gate":"%s","reason":"%s","date_utc":"%s"}\n' "$LABEL" "$MSG" "$(date -Is)" > "$OUT/wave-summary-stop.json"
  audit_run "$SECRETS" "$AUDIT_PY" "$OUT" "$LABEL" || exit 1   # فشلُ التدقيقِ يستبدلُ السببَ بـ SECRET_AUDIT_FAIL ويحذفُ الأثرَ الخامَّ
  exit 1
fi

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
audit_run "$SECRETS" "$AUDIT_PY" "$OUT" "$LABEL" || exit 1

[ "$VERDICT" = "$EXPECTED" ] || exit 1
echo "GATE_${LABEL}_PASSED ($VERDICT)"
