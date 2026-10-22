#!/usr/bin/env bash
# إعادةُ إنتاجِ أحكامِ الدفعاتِ 25 و29 و30 من الملفاتِ الملتزَمةِ والالتزاماتِ المثبَّتةِ وحدَها (2026-10-22).
# لا يكتبُ شيئاً في الشجرة: يعملُ في دليلٍ مؤقّتٍ بروابطَ رمزيّةٍ إلى الخام، ويفكُّ كلَّ .gz إلى نسخةٍ
# مجاورةٍ (حتميٌّ وبلا فقد؛ المحلّلاتُ القديمةُ تقرأُ بعضَ الملفاتِ بأسمائها غيرِ المضغوطة — ADR 0094 §3).
# المحلّلاتُ تُستخرَجُ من الالتزاماتِ المثبَّتةِ قبلَ أوّلِ موجةٍ (لا من نسخٍ لاحقة):
#   ب25: 0d4a6238:deploy/capacity-run/b24-runner/b25-analyze.py
#   ب30: 6b0e5d67:deploy/capacity-run/b24-runner/{b25,b26,b27,b28,b30}-analyze.py + derive-validity.py
#   ب29: raw/batch29/b29_isolate.py (تحليلٌ تشخيصيٌّ للقراءةِ فقط، بلا مقعد)
# الاستعمالُ من جذرِ المستودع (يحتاجُ git وpython3 فقط):
#   bash docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/reproduction-20261022/reproduce.sh
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ROOT="$(git rev-parse --show-toplevel)"
S6="$ROOT/docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
shadow() { python3 - "$1" "$2" <<'PY'
import os, gzip, shutil, sys
src, dst = sys.argv[1], sys.argv[2]
for root, _, files in os.walk(src):
    r = os.path.join(dst, os.path.relpath(root, src)); os.makedirs(r, exist_ok=True)
    for f in files:
        os.symlink(os.path.join(root, f), os.path.join(r, f))
        if f.endswith('.gz') and not os.path.exists(os.path.join(root, f[:-3])):
            with gzip.open(os.path.join(root, f)) as i, open(os.path.join(r, f[:-3]), 'wb') as o:
                shutil.copyfileobj(i, o)
PY
}
same() { python3 - "$1" "$2" "$3" <<'PY'
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
ok = a == b
print(("PASS" if ok else "FAIL") + f": {sys.argv[3]} — المعادُ حسابُه {'مطابقٌ بالكامل' if ok else 'يخالف'} للمحفوظ؛ الحكم: "
      + json.dumps(b.get('result', {}).get('decision'), ensure_ascii=False))
sys.exit(0 if ok else 1)
PY
}
for b in 25 29 30; do (cd "$S6/raw/batch$b" && sha256sum -c SHA256SUMS --quiet) && echo "PASS: batch$b SHA256SUMS"; done

# ب25
A25="$S6/raw/batch25/gh"; mkdir -p "$WORK/b25"; git -C "$ROOT" show 0d4a6238:deploy/capacity-run/b24-runner/b25-analyze.py > "$WORK/b25/an.py"
mkdir -p "$WORK/b25/out"; shadow "$A25" "$WORK/b25/out/raw"
mapfile -t R25 < <(python3 -c "import json,sys;print('\n'.join(json.load(open(sys.argv[1]))['waves']))" "$A25/b25-decision.json")
python3 "$WORK/b25/an.py" decide "$WORK/b25/out" "${R25[@]}" > "$WORK/b25/recomputed.json"
same "$A25/b25-decision.json" "$WORK/b25/recomputed.json" "ب25"

# ب29
python3 "$S6/raw/batch29/b29_isolate.py" "$S6/raw" > "$WORK/b29.json"
cmp "$WORK/b29.json" "$S6/raw/batch29/b29-isolate.out.json" && echo "PASS: ب29 — b29-isolate.out.json مطابقٌ بايتاً ببايت"

# ب30
A30="$S6/raw/batch30/gh-seat-39640036712"; mkdir -p "$WORK/b30"
for f in b25 b26 b27 b28 b30; do git -C "$ROOT" show "6b0e5d67:deploy/capacity-run/b24-runner/$f-analyze.py" > "$WORK/b30/$f-analyze.py"; done
git -C "$ROOT" show 6b0e5d67:deploy/capacity-run/b24-runner/derive-validity.py > "$WORK/b30/derive-validity.py"
cmp "$WORK/b30/b30-analyze.py" "$S6/raw/batch30/analysis/b30-analyze.pinned-6b0e5d67.py"
shadow "$A30" "$WORK/b30/out"
# حدُّ الجلسةِ كما سجّلَه المقعدُ نفسُه (session-limit-seat.txt): 24000
LIMIT=$(gzip -dc "$A30/session-limit-seat.txt.gz" | sed -n 's/^SEAT_SESSION_LIMIT=\([0-9]*\).*/\1/p')
mapfile -t R30 < <(python3 -c "import json,sys;print('\n'.join(json.load(open(sys.argv[1]))['waves']))" "$A30/b30-decision.json")
(cd "$WORK/b30" && python3 b30-analyze.py decide "$WORK/b30/out" "$LIMIT" "${R30[@]}" > "$WORK/b30/recomputed.json")
same "$A30/b30-decision.json" "$WORK/b30/recomputed.json" "ب30"
