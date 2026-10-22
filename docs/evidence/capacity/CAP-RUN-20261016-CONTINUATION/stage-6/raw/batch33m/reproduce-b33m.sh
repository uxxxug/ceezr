#!/usr/bin/env bash
# إعادةُ إنتاجِ أحكامِ b33m من الأرشيف (git + python3 فقط). يُشغَّلُ من جذرِ المستودع.
#  - حكمُ run1 بمحلِّلِ v1 المسجَّلِ (268e969e) ⇒ مطابقٌ لـ b33m-analysis.json المؤرشف (القرارُ NOT_READY)
#  - ناتجُ v2 (44146f7c) على run1 ⇒ مطابقٌ لـ analysis/b33m-analysis-v2-on-run1-POSTHOC.json (وصفيٌّ لاحق، لا قرار)
#  - صلاحيةُ الموجات: run1 m1 = VALID، وconfirm m1/m2 = INVALID (iowait)
set -euo pipefail
S=docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/batch33m
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
for f in b25-analyze.py b26-analyze.py b33m-analyze.py; do git show 268e969e:deploy/capacity-run/b24-runner/$f > "$T/$f"; done
git show 44146f7c:deploy/capacity-run/b24-runner/b33m-analyze-v2.py > "$T/b33m-analyze-v2.py"
R1=$S/gh-seat-39748767389; RC=$S/gh-seat-39754064651
python3 "$T/b33m-analyze.py" wave "$R1/raw/b33mmain-m1-M-750" > "$T/v1.json"
cmp "$T/v1.json" "$R1/b33m-analysis.json" && echo "PASS: v1 على run1 مطابقٌ بايتًا ببايت — $(python3 -c "import json;print(json.load(open('$T/v1.json'))['b33_choice_rule']['decision'])")"
python3 "$T/b33m-analyze-v2.py" wave "$R1/raw/b33mmain-m1-M-750" > "$T/v2.json"
cmp "$T/v2.json" "$S/analysis/b33m-analysis-v2-on-run1-POSTHOC.json" && echo "PASS: v2 على run1 (لاحق) مطابق — $(python3 -c "import json;print(json.load(open('$T/v2.json'))['b33_choice_rule']['decision'])")"
for w in "$R1/raw/b33mmain-m1-M-750" "$RC/raw/b33mconfirm-m1-M-750" "$RC/raw/b33mconfirm-m2-M-750"; do
  echo "VALIDITY $(basename "$w") $(python3 "$T/b33m-analyze.py" valid "$w" 24000 2>/dev/null)"
done
