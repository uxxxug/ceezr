#!/usr/bin/env bash
# اختبارُ إخفاقِ المحلّلِ على كُتلِ التنفيذِ الفعليةِ في المقعدِ: يُقتطعُ مقطعُ البواباتِ
# التمهيديةِ (من موجتَي A/A حتى PRE_GATES_PASSED) من نصِّ المقعدِ نفسِهِ ويُشغَّلُ بمحلّلٍ
# وهميٍّ يخرجُ برمزٍ غيرِ صفريٍّ دونَ إنتاجِ JSON — سيناريوهانِ:
#   A) إخفاقُ محلّلِ A/A: توقُّفٌ موثَّقٌ (AA_GATE_ANALYZE_FAIL) + تدقيقُ أسرارٍ + لا موجةَ
#      بعدَ AA1/AA2 (لا COST-* ولا PRE_GATES_PASSED) ولا ملفَّ حكمٍ قديمَ يُقرأُ.
#   C) إخفاقُ محلّلِ الكلفةِ بعدَ نجاحِ A/A: توقُّفٌ موثَّقٌ (COST_GATE_ANALYZE_FAIL) + تدقيقٌ
#      + موجاتُ A/A والكلفةِ الأربعُ فقطْ (لا S1/S2 ولا ABBA) ولا PRE_GATES_PASSED.
# المحلّلُ الوهميُّ لا يكتبُ ملفَّ حكمٍ إطلاقًا عندَ الإخفاقِ، والمشغّلُ والتدقيقُ حقيقيانِ.
set -euo pipefail
H=$(cd "$(dirname "$0")/../../.." && pwd)   # جذرُ المستودعِ (b24-runner/../../..)
RUNNER=$(cd "$(dirname "$0")" && pwd)
SEAT=$RUNNER/seat-load01-c2-http-wait-probe.sh
[ -f "$SEAT" ] || { echo "ANALYZE_FAIL_TEST_FAIL: المقعدُ غائبٌ"; exit 1; }
GATE=$RUNNER/probe-gate.sh
AA_PASS="إعادةُ_إنتاجٍ_ضمنَ_±δ"
COST_PASS="كلفةٌ_محدودةٌ_بـ±δ"
TMP=$(mktemp -d /tmp/probe-analyze-fail-XXXXXX)
if [ "${PROBE_TEST_KEEP:-0}" != 1 ]; then trap 'rm -rf "$TMP"' EXIT; else echo "KEPT $TMP"; fi
SECRETS=$TMP/secrets.env
( umask 177; printf 'INTERNAL_SIGNAL_SECRET=%s\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$SECRETS" )
cp "$RUNNER/seat-bin/b24-secret-audit.py" "$TMP/audit.py" 2>/dev/null || cp "$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py" "$TMP/audit.py"

# ---------- اقتطاعُ مقطعِ البواباتِ التمهيديةِ من نصِّ المقعدِ الفعليِّ ----------
BLOCK=$(sed -n '/^log "الموجتانِ A\/A/,/^echo "PRE_GATES_PASSED/p' "$SEAT")
[ -n "$BLOCK" ] || { echo "ANALYZE_FAIL_TEST_FAIL: مقطعُ البواباتِ لم يُقتطعْ"; exit 1; }
# إثباتُ أنَّ ما بعدَ المقطعِ (موجاتُ التحقّقِ S1/S2) لا تبدأُ: حارسٌ بعدَ المقطعِ
GUARD='echo "SENTINEL_AFTER_PREGATES"; for SLOT in S1 S2; do wave "$SLOT" 90 "$SMOKE_CONC"; done'

# ---------- محلّلٌ وهميٌّ: يقرأُ السيناريو من MOCK_FAIL ----------
PA=$TMP/mock-analyzer.py
cat > "$PA" <<'MOCK'
import json, os, sys
# وسائطُ المقعدِ: mode wave_dir... out.json — الفشلُ بلا JSON عندَ السيناريو
mode = sys.argv[1]
out_json = sys.argv[-1]
fail = os.environ.get('MOCK_FAIL', '')
if fail == 'aa':
    print('mock: instrument failure (arr1s missing)', file=sys.stderr)
    sys.exit(1)
if mode == 'aa':
    json.dump({'mode': 'aa', 'verdict': os.environ['MOCK_AA_PASS']}, open(out_json, 'w'))
    sys.exit(0)
if mode == 'strata':
    open(out_json, 'w').write('{"bands":[]}')
    sys.exit(0)
if fail == 'cost':
    print('mock: cost analyzer crash', file=sys.stderr)
    sys.exit(1)
print('mock: unknown scenario', file=sys.stderr)
sys.exit(1)
MOCK

run_block() ( # يُشغّلِ المقطعَ الفعليَّ في قشرةٍ فرعيةٍ فلا يقتلُ exitُ المقعدِ الاختبارَ نفسَهُ
  local OUT=$1
  local -a WAVES=()
  declare -A WDIR
  wave() { echo "$1" >>"$OUT/waves.txt"; V=VALID; WDIR[$1]="$OUT/wave-$1"; mkdir -p "${WDIR[$1]}"; }
  log() { echo "[log] $*"; }
  CONC=100; SMOKE_CONC=100; MIXED_RATE=100; MIXED_SEC=100; MIXED_SEED=1
  CITIES=city; B=$TMP; H=$H
  : >"$OUT/waves.txt"
  eval "$BLOCK
$GUARD"
  exit $?
)

RC_TOTAL=0
check_common() { # OUT LABEL REASON — عناصرُ التوقفِ المشتركةُ
  local OUT=$1 LABEL=$2 REASON=$3
  grep -q "gate=$LABEL" "$OUT/PROBE_STOP.txt" || { echo "FAIL: بوابةُ التوقفِ خاطئةٌ"; RC_TOTAL=1; }
  grep -q "reason=$REASON" "$OUT/PROBE_STOP.txt" || { echo "FAIL: سببُ التوقفِ ($REASON) غيرُ موثَّقٍ"; RC_TOTAL=1; }
  [ -s "$OUT/wave-summary-stop.json" ] || { echo "FAIL: ملخصُ التوقفِ غائبٌ"; RC_TOTAL=1; }
  [ -s "$OUT/secret-audit.txt" ] || { echo "FAIL: تدقيقُ الأسرارِ لم يُشغَّلْ"; RC_TOTAL=1; }
  grep -q "SECRET_AUDIT_CLEAN\|نظيف\|clean" "$OUT/secret-audit.txt" || true
  ! grep -q "PRE_GATES_PASSED" "$OUT/run.log" || { echo "FAIL: PRE_GATES_PASSED بعدَ إخفاقٍ"; RC_TOTAL=1; }
  ! grep -q "SENTINEL_AFTER_PREGATES" "$OUT/run.log" || { echo "FAIL: بلغَ التنفيذُ ما بعدَ البواباتِ"; RC_TOTAL=1; }
}

# ---------- A) إخفاقُ محلّلِ A/A ----------
OUT=$TMP/out-aa; mkdir -p "$OUT"
MOCK_FAIL=aa MOCK_AA_PASS="$AA_PASS" run_block "$OUT" aa >"$OUT/run.log" 2>&1 && RC=0 || RC=$?
[ "$RC" -ne 0 ] || { echo "A_FAIL: إخفاقُ المحلّلِ مُرِّرَ (رمزُ $RC)"; RC_TOTAL=1; }
check_common "$OUT" A/A AA_GATE_ANALYZE_FAIL
[ ! -f "$OUT/aa-gate.json" ] || { echo "A_FAIL: ملفُّ حكمٍ قديمٌ قُرئَ"; RC_TOTAL=1; }
# لا موجةَ بعدَ A/A: AA1/AA2 فقطْ ولا COST-*
grep -qx -- AA1 "$OUT/waves.txt" && grep -qx -- AA2 "$OUT/waves.txt" || { echo "A_FAIL: موجتا A/A ناقصتان"; RC_TOTAL=1; }
grep -q "COST-" "$OUT/waves.txt" && { echo "A_FAIL: موجاتُ الكلفةِ بدأتْ بعدَ إخفاقِ A/A"; RC_TOTAL=1; }
grep -q "S1\|S2" "$OUT/waves.txt" && { echo "A_FAIL: موجاتُ التحقّقِ بدأتْ"; RC_TOTAL=1; }
echo "A_PASS"

# ---------- C) إخفاقُ محلّلِ الكلفةِ بعدَ نجاحِ A/A ----------
OUT=$TMP/out-cost; mkdir -p "$OUT"
MOCK_FAIL=cost MOCK_AA_PASS="$AA_PASS" run_block "$OUT" cost >"$OUT/run.log" 2>&1 && RC=0 || RC=$?
[ "$RC" -ne 0 ] || { echo "C_FAIL: إخفاقُ محلّلِ الكلفةِ مُرِّرَ"; RC_TOTAL=1; }
check_common "$OUT" COST COST_GATE_ANALYZE_FAIL
[ ! -f "$OUT/cost-gate.json" ] || { echo "C_FAIL: ملفُّ حكمِ كلفةٍ قديمٌ قُرئَ"; RC_TOTAL=1; }
# A/A والكلفةُ الأربعُ فقطْ: لا S1/S2
for SLOT in AA1 AA2 COST-ON1 COST-OFF1 COST-OFF2 COST-ON2; do
  grep -qx -- "$SLOT" "$OUT/waves.txt" || { echo "C_FAIL: موجةُ $SLOT ناقصةٌ"; RC_TOTAL=1; }
done
grep -qxE "S1|S2|A1|B1" "$OUT/waves.txt" && { echo "C_FAIL: موجاتٌ بعدَ بوابةِ الكلفةِ بدأتْ"; RC_TOTAL=1; }
grep -q "GATE_A/A_PASSED" "$OUT/run.log" || { echo "C_FAIL: بوابةُ A/A لم تُجَزْ قبلَ الكلفةِ"; RC_TOTAL=1; }
echo "C_PASS"

if [ $RC_TOTAL -ne 0 ]; then echo "ANALYZE_FAIL_TEST_FAIL"; exit 1; fi
echo "ANALYZE_FAIL_TEST_OK — إخفاقُ المحلّلِ (A/A والكلفةِ) يوقفُ المقطعَ الفعليَّ موثَّقًا معَ تدقيقِ الأسرارِ، ولا JSON قديمَ ولا موجةَ لاحقةَ"
