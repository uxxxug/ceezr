#!/usr/bin/env bash
# إعادةُ إنتاجِ تحليلِ b33mdis منَ الملفاتِ الملتزَمةِ في هذا المستودعِ وحدها.
# الاستخدام: bash raw/b33mdis/analysis/reproduce.sh [دليلُ عملٍ مؤقت]  (من جذرِ المستودع)
# يتحققُ أولًا منَ بصماتِ الخامِّ الملتزَمِ (SHA256SUMS داخلَ كلِّ موجةٍ — منقولةٌ منَ الأرشيفِ الأصليِّ،
# والأصلُ هو الحاكمُ)، ثمَّ يجهّزُ نسخةَ العملَ (نسخُ كاملٌ للموجةِ + فكُّ ضغطِ الصادرِ gzip -n وحده
# لأنَّ المحلّلَ يقرأُ csv مفكوكًا بينما تقرأُ الأداتانِ v1/v2 الـgz مباشرةً)، ثمَّ يشغّلُ المحلّلَ المثبَّتَ
# (تسميةُ الملفِ تحيلُ إلى الالتزامِ الأولِ للمحلّلِ b92b4ebc؛ الخطةُ مثبَّتةٌ في da954fb8) ويقارنُ
# مخرجاتِهِ بالمؤرشفةِ في هذا الدليلِ (out-b33mdis.json وout-summary.json وout-a-v2-*.json للموجاتِ الثماني).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../../../../" && pwd)"
HERE="$ROOT/docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/b33mdis/analysis"
RAW="$ROOT/docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/b33mtick/gh-seat-39892956247"
WORK="${1:-$(mktemp -d)}"
echo "work: $WORK"
fail=0
for d in "$RAW"/raw/b33mtick-m-a[1-8]-*-750; do
  (cd "$d" && sha256sum -c SHA256SUMS --quiet) || { echo "SHA256SUMS FAIL: $d"; fail=1; }
done
[ "$fail" = 0 ] && echo "SHA256SUMS: OK (8 waves)"
# البيانُ الداخليُّ b33m.sha256sums (ليس بيانَ SHA256SUMS) — تُفحصُ مداخلُه بفكِّ الضغطِ عندَ الحاجة
# (المخرجاتُ الخامُّ ضُغطتْ gzip -n عندَ النقلِ — ARCHIVE-PROVENANCE)
python3 - "$RAW" <<'PY'
import gzip, hashlib, sys
from pathlib import Path
raw = Path(sys.argv[1]) / "raw"
fail = 0
for d in sorted(raw.iterdir()):
    ms = d / "b33m.sha256sums"
    if not ms.exists():
        continue
    for line in ms.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        h, name = line.split("  ", 1)
        p = d / name
        if p.exists():
            data = p.read_bytes()
        elif (d / (name + ".gz")).exists():
            data = gzip.decompress((d / (name + ".gz")).read_bytes())
        else:
            print(f"b33m.sha256sums MISSING: {d.name}/{name}"); fail = 1; continue
        if hashlib.sha256(data).hexdigest() != h:
            print(f"b33m.sha256sums MISMATCH: {d.name}/{name}"); fail = 1
print("b33m.sha256sums: OK" if not fail else "b33m.sha256sums: FAIL")
sys.exit(fail)
PY
[ $? = 0 ] || fail=1
mkdir -p "$WORK/waves"
for d in "$RAW"/raw/b33mtick-m-a[1-8]-*-750; do
  w=$(basename "$d")
  cp -r "$d" "$WORK/waves/$w"
  gzip -n -dc "$d/b33m-outbox-rows.csv.gz" > "$WORK/waves/$w/b33m-outbox-rows.csv"
done
# المحلّلُ يعتمدُ tools/ المجاورةَ له (نسختانِ بايتيّتانِ منَ الأصلِ المحفوظِ على main في raw/batch33m/analysis/)
cp "$HERE/b33mdis-analyze.pinned-b92b4ebc.py" "$WORK/b33mdis-analyze.py"
mkdir -p "$WORK/tools"
cp "$HERE/tools/b33m-analyze.py" "$HERE/tools/b33m-analyze-v2.py" "$WORK/tools/"
python3 "$WORK/b33mdis-analyze.py" "$RAW" "$WORK"
# المقارنةُ: الموجاتُ الثماني وحدها (out-a-v2-s0-cand.json أثرُ تشغيلٍ سابقٍ قبلَ تضييقِ مرشّحِ العيّنةِ — لا يُعادُ إنتاجُه هنا)
for f in out-b33mdis.json out-summary.json; do
  cmp -s "$WORK/$f" "$HERE/$f" && echo "IDENTICAL: $f" || { echo "DIFFERS: $f"; fail=1; }
done
for w in a1-ref a2-cand a3-cand a4-ref a5-cand a6-ref a7-ref a8-cand; do
  cmp -s "$WORK/out-a-v2-$w.json" "$HERE/out-a-v2-$w.json" && echo "IDENTICAL: out-a-v2-$w.json" || { echo "DIFFERS: out-a-v2-$w.json"; fail=1; }
done
exit $fail
