#!/usr/bin/env bash
# إعادةُ إنتاجِ أحكامِ تجربةِ A/A وموجةِ التأكيدِ c2 من الأرشيفِ الملتزَم (git + python3 فقط).
# تشغَّلَ في هذا الطلب: PASS×3 (قارنُ A/A، محلِّلُ v2، صلاحيةُ الموجاتِ الأربع) — 2026-10-22.
set -euo pipefail
R=$(cd "$(dirname "$0")" && pwd)   # …/stage-6/raw/batch33maa
H=$(git -C "$R" rev-parse --show-toplevel)
SEAT="$R/gh-seat-39772236052"
BR="origin/exp/load01-b33m-aa"      # عُدّةُ المقعدِ والمقارنةِ كما شُغِّلت (الالتزام 207d9dfa)
fail() { echo "FAIL: $*"; exit 1; }

echo "— التحققُ من بصماتِ الأرشيف"
(cd "$SEAT" && sha256sum -c SHA256SUMS --quiet) || fail "SHA256SUMS"
echo "PASS: SHA256SUMS على الخامِّ الملتزَم (252 ملفًا)"

echo "— إعادةُ إنتاجِ مقارنةِ A/A (b33m-aa-compare.py كما شُغِّلَ على المقعد)"
git -C "$H" show "$BR:deploy/capacity-run/b24-runner/b33m-aa-compare.py" > "$R/_aa-compare.py"
python3 "$R/_aa-compare.py" "$SEAT" > "$R/_aa-repro.json"
cmp "$R/_aa-repro.json" "$SEAT/b33m-aa-compare.json" || fail "AA compare"
D=$(python3 -c "import json;d=json.load(open('$R/_aa-repro.json'));print(d['decision'])")
[ "$D" = "UNRESOLVED" ] || fail "AA decision ($D)"
echo "PASS: مقارنةُ A/A مطابقةٌ بايتًا ببايت — UNRESOLVED (Δ=+2.85pp بينَ عتبتَي §5)"

echo "— إعادةُ إنتاجِ حكمِ v2 على موجةِ التأكيدِ c2 (b33maa-w2-on-M-750)"
mkdir -p "$R/_an2"; git -C "$H" show "$BR:deploy/capacity-run/b24-runner/b33m-analyze-v2.py" > "$R/_an2/b33m-analyze-v2.py"
git -C "$H" show "$BR:deploy/capacity-run/b24-runner/b33m-analyze.py" > "$R/_an2/b33m-analyze.py"
git -C "$H" show "$BR:deploy/capacity-run/b24-runner/b33m-extract.py" > "$R/_an2/b33m-extract.py"
python3 "$R/_an2/b33m-analyze-v2.py" wave "$SEAT/raw/b33maa-w2-on-M-750" > "$R/_v2-repro.json"
cmp "$R/_v2-repro.json" "$SEAT/b33m-analysis.json" || fail "v2 analysis"
C=$(python3 -c "import json;d=json.load(open('$R/_v2-repro.json'));print(d['b33_choice_rule']['decision'])")
[ "$C" = "NOT_READY" ] || fail "v2 decision ($C)"
echo "PASS: حكمُ v2 على c2 مطابقٌ بايتًا ببايت — NOT_READY (H1 وH2 مدعومتانِ معًا)"

echo "— صلاحيةُ الموجاتِ الأربعِ (validity-*.json)"
for w in w1-off w2-on w3-on w4-off; do
  python3 - "$SEAT/validity-$w.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["is_valid"] is True, d
PY
done
echo "VALIDITY: w1-off VALID · w2-on VALID · w3-on VALID · w4-off VALID"
rm -f "$R/_aa-compare.py" "$R/_aa-repro.json" "$R/_v2-repro.json"; rm -rf "$R/_an2"
echo "PASS: كلُّ الأحكامِ مُعادَةُ الإنتاجِ منَ الأرشيف"
