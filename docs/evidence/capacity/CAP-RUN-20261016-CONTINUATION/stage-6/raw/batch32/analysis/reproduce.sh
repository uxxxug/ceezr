#!/usr/bin/env bash
# إعادةُ إنتاجِ حكمِ الدفعةِ 32 من الملفاتِ الملتزَمةِ وحدَها (CAP-RUN-20261016-CONTINUATION).
# الخطوةُ الوحيدةُ غيرُ المباشرة: فكُّ ضغطِ gates.txt.gz (حتميٌّ وبلا فقد) لأنّ المحلّلَ يقرأُ gates.txt بمسارٍ مباشر،
# والملفاتُ الخامُّ محفوظةٌ مضغوطةً وفقَ ADR 0094 §3. لا يكتبُ شيئاً في الشجرة (PYTHONDONTWRITEBYTECODE).
# الاستعمالُ من جذرِ المستودع:
#   bash docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/batch32/analysis/reproduce.sh
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cmp "$HERE/b32-analyze.py" "$HERE/b32-analyze.pinned-c2c78d23.py"
cp -r "$HERE/../gh-seat-39711901468" "$WORK/gh-seat-39711901468"
for gz in "$WORK"/gh-seat-39711901468/raw/*/gates.txt.gz; do gunzip -k "$gz"; done
# s1 الأولى (b32main-s1-*) أُبطِلَت بموجةٍ واحدة (P2: iowait) فأُعيدَت السلسلةُ كلُّها مرّةً (s1r) وفقَ PLAN §6؛ تبقى محفوظةً خارجَ القرار.
RUNS=(b32main-s1r-C1-750 b32main-s1r-P1-750 b32main-s1r-P2-750 b32main-s1r-C2-750 b32main-s1r-C3-750 b32main-s1r-P3-750 b32main-s1r-P4-750 b32main-s1r-C4-750 b32main-s2-P5-750 b32main-s2-C5-750 b32main-s2-C6-750 b32main-s2-P6-750 b32main-s2-P7-750 b32main-s2-C7-750 b32main-s2-C8-750 b32main-s2-P8-750 b32main-a1-I1-750 b32main-a1-I2-750)
python3 "$HERE/b32-analyze.py" decide "$WORK/gh-seat-39711901468" 24000 "${RUNS[@]}" > "$WORK/recomputed.json"
python3 - "$HERE/../gh-seat-39711901468/b32-decision.json" "$WORK/recomputed.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
def norm(o): return json.dumps(o, sort_keys=True, ensure_ascii=False)
ok = norm(a) == norm(b)
print(("PASS: الناتجُ المعادُ حسابُه مطابقٌ بالكامل (موجاتٍ ونتيجةً) للقرارِ المحفوظ" if ok
       else "FAIL: الناتجُ المعادُ حسابُه يخالفُ القرارَ المحفوظ"))
sys.exit(0 if ok else 1)
PY
python3 "$HERE/b32-paths-table.py" "$WORK/recomputed.json" | cmp - "$HERE/b32-paths-table.out.txt" && echo "PASS: جدولُ المساراتِ مطابق"
