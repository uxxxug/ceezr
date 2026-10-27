#!/usr/bin/env bash
# الغرض: إعادةُ إنتاجِ أحكامِ LOAD-01-GAP-PROBE-RUN4 (بوابةُ A/A ‏aa4 على ttfbResid، وحكمُ q،
#   وبوابتا الكلفةِ وتكافؤِ الحملِ من موجاتِ S/N) من الخامِّ المستخرَجِ من أثرِ التشغيل
#   40465541423 (الأثر load01gap-run4)، ثمّ مقارنتُها حرفيًّا بالملفّاتِ المحفوظةِ في
#   docs/evidence/capacity/LOAD01-GAP-PROBE-RUN4-20261027/. لا يشغّلُ أيَّ موجةٍ ولا يلمسُ أيَّ خدمة.
# الاستعمال: reproduce-load01-gap-probe-run4.sh <مجلّدُ الأثرِ المستخرَج (يحوي raw/)>
# المخرجُ: REPRO_OK عندَ التطابقِ الكامل، وإلّا رمزُ خروجٍ غيرُ صفريّ.
set -euo pipefail
ART=${1:?مجلّدُ الأثرِ المستخرَج}
H=$(cd "$(dirname "$0")/../../.." && pwd)
G3="$H/deploy/capacity-run/b24-runner/gap3-analyze.py"
G4="$H/deploy/capacity-run/b24-runner/gap4-analyze.py"
EV="$H/docs/evidence/capacity/LOAD01-GAP-PROBE-RUN4-20261027"
R="$ART/raw"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
w() { ls -d "$R"/load01gap4-probe-"$1"-M-1500; }
# الخامُ مطابقٌ لبيانِه داخلَ كلِّ موجة
for d in "$R"/load01gap4-probe-*; do (cd "$d" && sha256sum -c --quiet SHA256SUMS); done
# البوابةُ اجتازت في هذهِ الدورةِ؛ المحلّلُ يخرجُ برمزٍ صفريٍّ عندَ النجاحِ وبغيرِ صفريٍّ عندَ الإخفاقِ
# (بالتصميم) فلا يوقفُ السكربتَ — المقارنةُ من JSON.
python3 "$G4" aa4 "$(w AA1-i70)" "$(w AA2-i71)" "$T/aa-gate.json" >/dev/null || true
python3 "$G4" q "$(w AA1-i70)" "$(w AA2-i71)" "$T/q-verdict.json" >/dev/null || true
PA="$H/deploy/capacity-run/b24-runner/probe-analyze.py"
python3 "$PA" cost "$(w S1-i71)" "$(w N1-i72)" "$(w N2-i73)" "$(w S2-i74)" "$T/cost-gate.json" >/dev/null || true
python3 "$G3" load "$(w S1-i71)" "$(w N1-i72)" "$(w N2-i73)" "$(w S2-i74)" "$T/load-gate.json" >/dev/null || true
python3 - "$T" "$EV" <<'PY'
import json, sys
t, ev = sys.argv[1], sys.argv[2]
def load(p): return json.load(open(p))
# بوابةُ A/A على ttfbResid: الاجتيازُ نفسُهُ والحرفيّةُ في الحدودِ السبعة
a, b = load(f"{t}/aa-gate.json"), load(f"{ev}/aa-gate.json")
assert a["verdict"] == b["verdict"], "aa4 verdict"
assert a["pass"] is True and b["pass"] is True, "aa4 pass"
assert a["aa4_detail"] == b["aa4_detail"], "aa4 detail"
# حكمُ q: الحالةُ لكلِّ موجةٍ والأرقامُ حرفيًّا — قابلٌ للتفسيرِ الآن
q, r = load(f"{t}/q-verdict.json"), load(f"{ev}/q-verdict.json")
assert q["per_wave"] == r["per_wave"], "q per_wave"
assert q["verdict"] == r["verdict"], "q verdict"
ws = load(f"{ev}/wave-summary.json")
assert ws["q_interpretable"] is True, "q interpretable (wave-summary)"
# بوابتا الكلفةِ وتكافؤِ الحملِ: الأحكامُ والأرقامُ حرفيًّا
for name in ("cost-gate", "load-gate"):
    x, y = load(f"{t}/{name}.json"), load(f"{ev}/{name}.json")
    for k in ("verdict", "mode"):
        assert x[k] == y[k], f"{name} {k}"
    assert x.get("rates", x.get("detail", {})) == y.get("rates", y.get("detail", {})), f"{name} detail"
print("REPRO_OK", b["verdict"], "|", q["verdict"], "| EXPLAINED×", sum(1 for w in q["per_wave"] if w["status"] == "EXPLAINED"))
PY
