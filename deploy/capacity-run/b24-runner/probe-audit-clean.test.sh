#!/usr/bin/env bash
# اختبارُ صداقةِ مخرجاتِ المحلّلِ معَ تدقيقِ الأسرارِ: التشغيلُ الأولُ للدورةِ توقفَ عندَ
# بوابةِ A/A لأنّ بصماتِ SHA-256 للمدخلاتِ كانتْ سلاسلَ 64-سداسيّةً داخلَ ملفاتِ الحُكمِ
# (aa-gate.json وسجلِّه) فطابقتْ نمطَ base64 الطويلَ في b24-secret-audit.py. هذا الاختبارُ
# يمنعُ عودةَ ذلك على الشجرةِ الكاملةِ كما يبنيها المقعدُ (الموجاتُ تحتَ OUT/raw):
# يولّدُ 8 موجاتٍ اصطناعيةٍ (أربعٌ ON بوصفِ http كاملٍ وأربعٌ OFF بوصفِ pdb فقط)، يُشغّلُ
# الأوضاعَ الأربعةَ (aa وstrata وcost وab)، ثمّ يُشغّلُ التدقيقَ الحقيقيَّ على الشجرةِ كلِّها —
# نظافةٌ واجبةٌ. ويُثبتُ أنَّ الفحصَ الحرفيَّ يبقى ساريًا رغمَ إعفاءِ اسمِ ملفِّ البصماتِ:
# زرعُ قيمةِ سرِّ الاختبارِ المعروفةِ داخلَ input-sha256sums.txt يُفشلُ التدقيقَ، وزرعُ
# سلسلةٍ 64-سداسيّةٍ داخلَ ملفِّ حكمٍ يُكتشَفُ (كشفُ الانحدارِ).
set -euo pipefail
H=$(cd "$(dirname "$0")/../../.." && pwd)   # جذرُ المستودعِ (b24-runner/../../..)
RUNNER=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d /tmp/probe-audit-clean-XXXXXX)
trap 'rm -rf "$TMP"' EXIT
PA="$RUNNER/probe-analyze.py"
AUDIT="$RUNNER/seat-bin/b24-secret-audit.py"
[ -f "$AUDIT" ] || AUDIT="$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py"
SECRETS=$TMP/secrets.env
SECRET_VAL=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
( umask 177; printf 'INTERNAL_SIGNAL_SECRET=%s\n' "$SECRET_VAL" > "$SECRETS" )
OUT=$TMP/out
RAW=$OUT/raw

# ---------- 8 موجاتٍ اصطناعيةٍ تحتَ OUT/raw كما يبنيها المقعدُ ----------
# أربعٌ ON (w1..w4): أحداثُ طورٍ + arr1s/pseat (http كاملٌ) + صفوفُ pdb للكلفةِ
# أربعٌ OFF (w5..w8): أحداثُ طورٍ + pdb فقط (لا أداةَ على ذراعِ OFF) — cost وab يستهلكانِها
python3 - "$RAW" <<'PY'
import json, random, sys, datetime
raw = sys.argv[1]
t0 = 1792997000000
iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
for i, seed in enumerate((11, 22, 33, 44, 55, 66, 77, 88), start=1):
    d = f"{raw}/w{i}"
    import os
    os.makedirs(d, exist_ok=True)
    random.seed(seed)
    on = i <= 4
    with open(f"{d}/miniapp-load-events.jsonl", "w") as f:
        f.write(json.dumps({"event": "phase.start", "t": iso(t0)}) + "\n")
        f.write(json.dumps({"event": "phase.drain_start", "t": iso(t0 + 300000)}) + "\n")
        f.write(json.dumps({"event": "phase.end", "t": iso(t0 + 400000)}) + "\n")
    with open(f"{d}/load-trace.jsonl", "w") as f:
        for s in range(60):
            if on:
                for _ in range(20):
                    f.write(json.dumps({"k": "arr1s", "at": t0 + s * 1000, "cls": "http", "name": "POST /v1/rides", "n": 1}) + "\n")
                    f.write(json.dumps({"k": "pseat", "at": t0 + s * 1000 + 500, "requestId": "r%d" % random.randrange(10 ** 9),
                                        "path": "http:POST /v1/rides", "pool": "ceezr:gatewayRequest", "kind": "job",
                                        "waitMs": random.uniform(100, 200), "runMs": random.uniform(50, 100),
                                        "waitStartAt": t0 + s * 1000}) + "\n")
            # صفوفُ pdb (flush كلَّ 5ث داخلَ الحقنِ) — مقياسُ الكلفةِ مشتركٌ بينَ ON وOFF
            if s % 5 == 4:
                f.write(json.dumps({"k": "pdb", "at": t0 + (s + 1) * 1000, "path": "http:POST /v1/rides",
                                    "pool": "ceezr:gatewayRequest", "kind": "job", "n": 20,
                                    "waitSumMs": 20 * random.uniform(100, 200), "runSumMs": 20 * random.uniform(50, 100)}) + "\n")
PY

# ---------- الأوضاعُ الأربعةُ كما يستدعيها المقعدُ ----------
python3 "$PA" aa "$RAW/w1" "$RAW/w2" "$OUT/aa-gate.json" >"$OUT/aa-gate.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: aa أخفقَ"; cat "$OUT/aa-gate.log"; exit 1; }
python3 "$PA" strata "$RAW/w1" "$OUT/strata.json" >"$OUT/strata.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: strata أخفقَ"; exit 1; }
python3 "$PA" cost "$RAW/w1" "$RAW/w5" "$RAW/w6" "$RAW/w2" "$OUT/cost-gate.json" >"$OUT/cost-gate.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: cost أخفقَ"; exit 1; }
python3 "$PA" ab "$RAW/w1" "$RAW/w5" "$RAW/w6" "$RAW/w2" "$RAW/w3" "$RAW/w7" "$RAW/w8" "$RAW/w4" \
  "$OUT/strata.json" "$OUT/ab-result.json" >"$OUT/ab-result.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: ab أخفقَ"; exit 1; }

# ---------- T1: التدقيقُ الحقيقيُّ على الشجرةِ كلِّها (الموجاتُ + ملفاتُ الأحكامِ) ----------
set +e
python3 "$AUDIT" "$SECRETS" "$OUT" >"$TMP/audit.log" 2>&1
ARC=$?
set -e
if [ $ARC -ne 0 ]; then
  echo "AUDIT_CLEAN_TEST_FAIL: مخرجاتُ المحلّلِ توقِفُ تدقيقَ الأسرارِ:"; cat "$TMP/audit.log"; exit 1
fi
grep -q "AUDIT_CLEAN" "$TMP/audit.log" || { echo "AUDIT_CLEAN_TEST_FAIL: لا تصريحَ نظافةٍ"; exit 1; }
for w in w1 w5; do
  grep -qE "^[0-9a-f]{64}  " "$RAW/$w/input-sha256sums.txt" || { echo "AUDIT_CLEAN_TEST_FAIL: بصمةٌ ناقصةٌ في $w"; exit 1; }
done
echo "T1_PASS"

# ---------- T2: كشفُ الانحدارِ: سلسلةُ 64-سداسيّةٍ داخلَ ملفِّ حكمٍ تُكتشَفُ ----------
printf '{"input_hashes": {"events": "%s"}}\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$OUT/regression.json"
set +e
python3 "$AUDIT" "$SECRETS" "$OUT" >"$TMP/audit2.log" 2>&1
ARC=$?
set -e
[ $ARC -ne 0 ] || { echo "AUDIT_CLEAN_TEST_FAIL: الانحدارُ المزروعُ لم يُكتشَفْ"; exit 1; }
grep -q "regression.json" "$TMP/audit2.log" || { echo "AUDIT_CLEAN_TEST_FAIL: الملفُّ المزروعُ لم يُسمَّ"; exit 1; }
rm -f "$OUT/regression.json"
echo "T2_PASS"

# ---------- T3: الفحصُ الحرفيُّ يبقى ساريًا على ملفِّ البصماتِ رغمَ إعفاءِ اسمِهِ ----------
printf '%s  miniapp-load-events.jsonl\n' "$SECRET_VAL" >> "$RAW/w1/input-sha256sums.txt"
set +e
python3 "$AUDIT" "$SECRETS" "$OUT" >"$TMP/audit3.log" 2>&1
ARC=$?
set -e
[ $ARC -ne 0 ] || { echo "AUDIT_CLEAN_TEST_FAIL: السرُّ المزروعُ في ملفِّ البصماتِ لم يُكتشَفْ"; exit 1; }
grep -q "w1/input-sha256sums.txt" "$TMP/audit3.log" || { echo "AUDIT_CLEAN_TEST_FAIL: الملفُّ المزروعُ لم يُسمَّ"; exit 1; }
echo "T3_PASS"

echo "AUDIT_CLEAN_TEST_OK — الأوضاعُ الأربعةُ نظيفةٌ لتدقيقِ الأسرارِ على الشجرةِ الكاملةِ، والانحدارُ والسرُّ المزروعانِ يُكتشَفانِ"
