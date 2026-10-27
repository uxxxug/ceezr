#!/usr/bin/env bash
# الغرض: إعادةُ إنتاجِ أحكامِ LOAD-01-GAP-PROBE-RUN3 (بوابةُ A/A ‏aa3، وحكمُ q، و`valid3` للموجتين)
#   من الخامِّ المستخرَجِ من أثرِ التشغيل 40459459708 (الأثر load01gap-run3)، ثمّ مقارنتُها حرفيًّا
#   بالملفّاتِ المحفوظةِ في docs/evidence/capacity/LOAD01-GAP-PROBE-RUN3-20261027/. لا يشغّلُ أيَّ موجةٍ
#   ولا يلمسُ أيَّ خدمة. الدورةُ توقّفت عندَ بوابةِ A/A فلا موجاتِ كلفةٍ ولا تكافؤِ حملٍ يُعادُ إنتاجُها.
# الاستعمال: reproduce-load01-gap-probe-run3.sh <مجلّدُ الأثرِ المستخرَج (يحوي raw/)>
# المخرجُ: REPRO_OK عندَ التطابقِ الكامل، وإلّا رمزُ خروجٍ غيرُ صفريّ.
set -euo pipefail
ART=${1:?مجلّدُ الأثرِ المستخرَج}
H=$(cd "$(dirname "$0")/../../.." && pwd)
G3="$H/deploy/capacity-run/b24-runner/gap3-analyze.py"
EV="$H/docs/evidence/capacity/LOAD01-GAP-PROBE-RUN3-20261027"
R="$ART/raw"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
w() { ls -d "$R"/load01gap3-probe-"$1"-M-1500; }
# الخامُ مطابقٌ لبيانِه داخلَ كلِّ موجة
for d in "$R"/load01gap3-probe-*; do (cd "$d" && sha256sum -c --quiet SHA256SUMS); done
# البوابةُ أخفقت في الدورةِ (PROBE_STOP) فتُعادُ الحساباتُ نفسُها ويُقارنُ الحكمُ المخزَّنُ كما هو.
# المحلّلُ يخرجُ برمزٍ غيرِ صفريٍّ عندَ إخفاقِ البوابةِ (بالتصميم) فلا يوقفُ السكربتَ — المقارنةُ من JSON.
python3 "$G3" aa3 "$(w AA1-i70)" "$(w AA2-i71)" "$T/aa-gate.json" >/dev/null || true
python3 "$G3" q "$(w AA1-i70)" "$(w AA2-i71)" "$T/q-verdict.json" >/dev/null || true
python3 - "$T" "$EV" <<'PY'
import json, sys
t, ev = sys.argv[1], sys.argv[2]
def load(p): return json.load(open(p))
# بوابةُ A/A: الإخفاقُ نفسُهُ والحرفيّةُ في الحدودِ السبعة
a, b = load(f"{t}/aa-gate.json"), load(f"{ev}/aa-gate.json")
assert a["verdict"] == b["verdict"], "aa3 verdict"
assert a["pass"] is False and b["pass"] is False, "aa3 pass"
assert a["inherited_detail"] == b["inherited_detail"], "aa3 detail"
# حكمُ q: الحالةُ لكلِّ موجةٍ والأرقامُ حرفيًّا
q, r = load(f"{t}/q-verdict.json"), load(f"{ev}/q-verdict.json")
assert q["per_wave"] == r["per_wave"], "q per_wave"
assert q["verdict"] == r["verdict"], "q verdict"
print("REPRO_OK", b["verdict"], "|", q["verdict"], "| EXPLAINED×", sum(1 for w in q["per_wave"] if w["status"] == "EXPLAINED"))
PY
