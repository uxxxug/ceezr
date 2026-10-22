#!/usr/bin/env bash
# إعادةُ إنتاجِ حكمِ الدفعةِ 31 من الملفاتِ الملتزَمةِ وحدَها (الدفعةُ 31 — CAP-RUN-20261016-CONTINUATION).
# الخطوةُ الوحيدةُ غيرِ المباشرةِ: فكُّ ضغطِ gates.txt.gz (حتميٌّ وبلا فقد) لأنّ المحلّلَ يقرأُ
# gates.txt بمسارٍ مباشرٍ، بينما تُحفَظُ الملفاتُ الخامُّ مضغوطةً وفقَ ADR 0094 §3 (ميزانُ التوثيقِ).
# الاستعمالُ من جذرِ المستودعِ:  bash docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/batch31/analysis/reproduce.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -r "$HERE/../gh-seat-39672264025" "$WORK/gh-seat-39672264025"
for gz in "$WORK"/gh-seat-39672264025/raw/*/gates.txt.gz; do gunzip -k "$gz"; done
RUNS=(b31main-s1-A1-750 b31main-s1-D1-750 b31main-s1-S1-750 b31main-s1-X1-750 b31main-s1-X2-750 b31main-s1-S2-750 b31main-s1-D2-750 b31main-s1-A2-750 b31main-s2-X3-750 b31main-s2-S3-750 b31main-s2-D3-750 b31main-s2-A3-750 b31main-s2-A4-750 b31main-s2-D4-750 b31main-s2-S4-750 b31main-s2-X4-750)
python3 "$HERE/b31-analyze.py" decide "$WORK/gh-seat-39672264025" 24000 "${RUNS[@]}" > "$WORK/recomputed.json"
python3 - "$HERE/../gh-seat-39672264025/b31-decision.json" "$WORK/recomputed.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
def norm(o): return json.dumps(o, sort_keys=True, ensure_ascii=False)
ok = norm(a) == norm(b)
print(("PASS: الناتجُ المعادُ حسابُهُ مطابقٌ بالكاملِ (موجاتًا ونتيجةً) للقرارِ المحفوظِ" if ok
       else "FAIL: الناتجُ المعادُ حسابُهُ يخالفُ القرارَ المحفوظ"))
sys.exit(0 if ok else 1)
PY
