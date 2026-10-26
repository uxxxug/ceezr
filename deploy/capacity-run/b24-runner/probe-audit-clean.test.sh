#!/usr/bin/env bash
# اختبارُ صداقةِ مخرجاتِ المحلّلِ معَ تدقيقِ الأسرارِ: التشغيلُ الأولُ للدورةِ توقفَ عندَ
# بوابةِ A/A لأنّ بصماتِ SHA-256 للمدخلاتِ كانتْ سلاسلَ 64-سداسيّةً داخلَ ملفاتِ الحُكمِ
# (aa-gate.json وسجلِّه) فطابقتْ نمطَ base64 الطويلَ في b24-secret-audit.py. هذا الاختبارُ
# يمنعُ عودةَ ذلك: يولّدُ موجتينِ اصطناعيتينِ، يُشغّلُ المحلّلَ (aa ثمّ strata)، ثمّ يُشغّلُ
# التدقيقَ الحقيقيَّ على مجلّدِ المخرجاتِ — ويجبُ أن يكونَ نظيفًا. ويُثبتُ أنَّ الاختبارَ
# يكشفُ الانحدارَ فعلًا: زرعُ سلسلةِ 64-سداسيّةٍ داخلَ ملفِّ حكمٍ يجعلُ التدقيقَ يفشلُ.
set -euo pipefail
H=$(cd "$(dirname "$0")/../../.." && pwd)   # جذرُ المستودعِ (b24-runner/../../..)
RUNNER=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d /tmp/probe-audit-clean-XXXXXX)
trap 'rm -rf "$TMP"' EXIT
PA="$RUNNER/probe-analyze.py"
AUDIT="$RUNNER/seat-bin/b24-secret-audit.py"
[ -f "$AUDIT" ] || AUDIT="$H/deploy/capacity-run/b24-runner/seat-bin/b24-secret-audit.py"
SECRETS=$TMP/secrets.env
( umask 177; printf 'INTERNAL_SIGNAL_SECRET=%s\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$SECRETS" )
RC_TOTAL=0

# ---------- موجتانِ اصطناعيتانِ (أحداثُ الطورِ + أثرُ أداةِ الربطِ) ----------
for d in w1 w2; do mkdir -p "$TMP/$d"; done
python3 - "$TMP" <<'PY'
import json, random, sys, datetime
tmp = sys.argv[1]
t0 = 1792997000000
iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat().replace("+00:00", "Z")
for d, seed in (("w1", 11), ("w2", 22)):
    random.seed(seed)
    with open(f"{tmp}/{d}/miniapp-load-events.jsonl", "w") as f:
        f.write(json.dumps({"event": "phase.start", "t": iso(t0)}) + "\n")
        f.write(json.dumps({"event": "phase.drain_start", "t": iso(t0 + 300000)}) + "\n")
        f.write(json.dumps({"event": "phase.end", "t": iso(t0 + 400000)}) + "\n")
    with open(f"{tmp}/{d}/load-trace.jsonl", "w") as f:
        for s in range(60):
            for _ in range(20):
                f.write(json.dumps({"k": "arr1s", "at": t0 + s * 1000, "cls": "http", "name": "POST /v1/rides", "n": 1}) + "\n")
                f.write(json.dumps({"k": "pseat", "at": t0 + s * 1000 + 500, "requestId": "r%d" % random.randrange(10 ** 9),
                                    "path": "http:POST /v1/rides", "pool": "ceezr:gatewayRequest", "kind": "job",
                                    "waitMs": random.uniform(100, 200), "runMs": random.uniform(50, 100),
                                    "waitStartAt": t0 + s * 1000}) + "\n")
PY

# ---------- المحلّلُ ثمّ التدقيقُ الحقيقيُّ: يجبُ أن يكونَ نظيفًا ----------
OUT=$TMP/out; mkdir -p "$OUT"
python3 "$PA" aa "$TMP/w1" "$TMP/w2" "$OUT/aa-gate.json" >"$OUT/aa-gate.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: المحلّلُ أخفقَ"; cat "$OUT/aa-gate.log"; exit 1; }
python3 "$PA" strata "$TMP/w1" "$OUT/strata.json" >"$OUT/strata.log" 2>&1 \
  || { echo "AUDIT_CLEAN_TEST_FAIL: strata أخفقَ"; exit 1; }
set +e
python3 "$AUDIT" "$SECRETS" "$OUT" >"$TMP/audit.log" 2>&1
ARC=$?
set -e
if [ $ARC -ne 0 ]; then
  echo "AUDIT_CLEAN_TEST_FAIL: مخرجاتُ المحلّلِ توقِفُ تدقيقَ الأسرارِ:"; cat "$TMP/audit.log"; exit 1
fi
grep -q "AUDIT_CLEAN" "$TMP/audit.log" || { echo "AUDIT_CLEAN_TEST_FAIL: لا تصريحَ نظافةٍ"; exit 1; }
[ -f "$TMP/w1/input-sha256sums.txt" ] || { echo "AUDIT_CLEAN_TEST_FAIL: ملفُّ بصماتِ المدخلاتِ غائبٌ"; exit 1; }
grep -qE "^[0-9a-f]{64}  " "$TMP/w1/input-sha256sums.txt" || { echo "AUDIT_CLEAN_TEST_FAIL: بصمةٌ ناقصةٌ"; exit 1; }
echo "T1_PASS"

# ---------- زرعُ الانحدارِ: سلسلةُ 64-سداسيّةٍ داخلَ ملفِّ حكمٍ يجبُ أن تُكتشَف ----------
printf '{"input_hashes": {"events": "%s"}}\n' "$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$OUT/regression.json"
set +e
python3 "$AUDIT" "$SECRETS" "$OUT" >"$TMP/audit2.log" 2>&1
ARC=$?
set -e
[ $ARC -ne 0 ] || { echo "AUDIT_CLEAN_TEST_FAIL: الانحدارُ المزروعُ لم يُكتشَفْ"; exit 1; }
grep -q "regression.json" "$TMP/audit2.log" || { echo "AUDIT_CLEAN_TEST_FAIL: الملفُّ المزروعُ لم يُسمَّ"; exit 1; }
echo "T2_PASS"

echo "AUDIT_CLEAN_TEST_OK — مخرجاتُ المحلّلِ نظيفةٌ لتدقيقِ الأسرارِ، والانحدارُ المزروعُ يُكتشَفُ"
