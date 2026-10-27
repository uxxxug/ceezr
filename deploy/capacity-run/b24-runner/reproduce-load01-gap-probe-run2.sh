#!/usr/bin/env bash
# الغرض: إعادةُ إنتاجِ أحكامِ LOAD-01-GAP-PROBE-RUN2 (بوابةُ A/A، وبوابةُ الكلفة، والوصفيّ) من الخامِ المستخرَجِ
#   من أثرِ التشغيل 40422906521 (الأثر 12700079867)، ثمّ مقارنتُها حرفيًّا بالملفّاتِ المحفوظةِ في
#   docs/evidence/capacity/LOAD01-GAP-PROBE-RUN2-20261027/. لا يشغّلُ أيَّ موجةٍ ولا يلمسُ أيَّ خدمة.
# الاستعمال: reproduce-load01-gap-probe-run2.sh <مجلّدُ الأثرِ المستخرَج (يحوي raw/)>
# المخرجُ: REPRO_OK عندَ التطابق، وإلّا رمزُ خروجٍ غيرُ صفريّ.
set -euo pipefail
ART=${1:?مجلّدُ الأثرِ المستخرَج}
H=$(cd "$(dirname "$0")/../../.." && pwd)
G2="$H/deploy/capacity-run/b24-runner/gap2-analyze.py"
PA="$H/deploy/capacity-run/b24-runner/probe-analyze.py"
EV="$H/docs/evidence/capacity/LOAD01-GAP-PROBE-RUN2-20261027"
R="$ART/raw"; T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
w() { ls -d "$R"/load01gap2-probe-"$1"-M-1500; }
# الخامُ مطابقٌ لبيانِه داخلَ كلِّ موجة
for d in "$R"/load01gap2-probe-*; do (cd "$d" && sha256sum -c --quiet SHA256SUMS); done
set +e
python3 "$G2" aa2 "$(w AA1-i70)" "$(w AA2-i71)" "$T/aa-gate.json" >/dev/null; rc=$?
set -e
[ "$rc" -eq 0 ] || { echo "بوابةُ A/A لم تجتزْ عندَ الإعادة (rc=$rc)"; exit 2; }
python3 "$PA" cost "$(w COST-ON1-i71)" "$(w COST-OFF1-i72)" "$(w COST-OFF2-i73)" "$(w COST-ON2-i74)" "$T/cost-gate.json" >/dev/null
python3 "$G2" describe "$T/aa-descriptive.json" "$(w AA1-i70)" "$(w AA2-i71)" >/dev/null
python3 "$G2" describe "$T/cost-descriptive.json" "$(w COST-ON1-i71)" "$(w COST-ON2-i74)" >/dev/null
python3 - "$T" "$EV" <<'PY'
import json, sys
t, ev = sys.argv[1], sys.argv[2]
def load(p): return json.load(open(p))
a, b = load(f"{t}/aa-gate.json"), load(f"{ev}/aa-gate.json")
assert a["verdict"] == b["verdict"] and a["pass"] is True, "aa2"
assert a["inherited_detail"] == b["inherited_detail"], "aa2 detail"
c, d = load(f"{t}/cost-gate.json"), load(f"{ev}/cost-gate.json")
assert (c["verdict"], c["d1_ms"], c["d2_ms"]) == (d["verdict"], d["d1_ms"], d["d2_ms"]), "cost"
for n in ("aa-descriptive.json", "cost-descriptive.json"):
    x, y = load(f"{t}/{n}"), load(f"{ev}/{n}")
    for wx, wy in zip(x["waves"], y["waves"]):
        wx.pop("wave", None); wy.pop("wave", None)
    assert x == y, n
print("REPRO_OK", a["verdict"], c["verdict"], c["d1_ms"], c["d2_ms"])
PY
