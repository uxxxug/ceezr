#!/usr/bin/env bash
# اختبارُ انحدارٍ يُنفّذِ الغلافَ فعلًا (خطأُ التشغيلِ 40194323581: مسارُ cand لم يكن يمرّرُ
# متغيراتِ الحملِ المختلطِ عبرَ netns فلم ينطلقِ المولّدُ). يُنشئُ كعبَ nsx وكعبَ wave.sh
# يستقبلانِ البيئةَ، ويُنفّذِ الغلافَ بحالتَي الضبطِ والغيابِ، ويتحققُ من وصولِ القيمِ حرفيًا،
# ويرفضُ الغلافَ المكسورَ (بلا تمريرٍ) — أي أنّ الاختبارَ يفشلُ على الشيفرةِ التي كسرتِ الموجةَ.
set -u
cd "$(dirname "$0")"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/repo/deploy/capacity-run"

# كعبُ nsx: يقطعُ البيئةَ كما يفعلُ الغلافُ الفعليُّ: nsx = «sudo -n ip netns exec $NS sudo -n -u user "$@"»
# (setup-env-20261016.sh) وsudo يصفّرُ البيئةَ افتراضيًّا (env_reset) — فالمتغيرُ لا يعبرُ إلّا عبرَ
# قائمةِ التصديرِ في سطرِ exec. هذا جوهرُ خطأِ 40194323581: الغلافُ القديمُ لم يكن يُدرجُها فلم تصلْ
# (وقد ثبتَ ذلك عمليًّا: موجةُ التشغيلِ الفاشلِ رأتْ mixed: null ونجحَتْ بعدَ الإصلاحِ).
printf '#!/usr/bin/env bash\nexec env -i "$@"\n' > "$T/bin/nsx"; chmod +x "$T/bin/nsx"
# كعبُ wave.sh: يسقطُ البيئةَ المُستلمةَ إلى ملفِّ الالتقاط
printf '#!/usr/bin/env bash\nexport PATH=/usr/bin:/bin:$PATH\nenv | grep -E "^(MIXED_RATE|MIXED_SEC|MIXED_SEED|GEN_WAIT_ITERS|ARRIVAL_RATE|RIDER_SOCKET_MIX)=" | sort > %s\ntrue\n' "$T/capture.txt" > "$T/repo/deploy/capacity-run/wave.sh"
chmod +x "$T/repo/deploy/capacity-run/wave.sh"
# كعبُ finish-wave.sh صامتٌ
: > "$T/repo/deploy/capacity-run/finish-wave.sh"; chmod +x "$T/repo/deploy/capacity-run/finish-wave.sh"

# نسخةُ الغلافِ الحقيقيِّ معَ استبدالِ مسارَي B وREPO بالكعبين (بلا أيِّ تعديلٍ على سطرِ exec؛
# B وREPO على سطرٍ واحدٍ مفصولَينِ بفاصلةٍ منقوطةٍ)
sed -e "s|^B=[^;]*; REPO=[^ ]*|B=$T; REPO=$T/repo|" run-wave.sh > "$T/wrapper.sh"

fail() { echo "FAIL: $1"; exit 1; }

# 1) الضبطُ: القيمُ تعبرُ حرفيًا
env MIXED_RATE=20 MIXED_SEC=180 MIXED_SEED=1 GEN_WAIT_ITERS=108 \
  bash "$T/wrapper.sh" R1 profile.json 30 5 || fail "الغلافُ فشلَ في حالةِ الضبط"
diff - "$T/capture.txt" <<'EOF' || fail "القيمُ المُمرَّرةُ لا تطابقُ المضبوطة"
GEN_WAIT_ITERS=108
MIXED_RATE=20
MIXED_SEC=180
MIXED_SEED=1
EOF

# 2) الغيابُ: لا يعبرُ شيءٌ (الحرّاسُ المُشرَّطةُ لا تُضيفُ عندَ الغياب)
env -u MIXED_RATE -u MIXED_SEC -u MIXED_SEED -u GEN_WAIT_ITERS -u ARRIVAL_RATE -u RIDER_SOCKET_MIX \
  bash "$T/wrapper.sh" R2 profile.json 30 6 || fail "الغلافُ فشلَ في حالةِ الغياب"
[ ! -s "$T/capture.txt" ] || fail "عندَ الغيابِ عَبَرَ: $(cat "$T/capture.txt")"

# 3) الغلافُ المكسورُ (كما كانَ قبلَ الإصلاحِ: بلا تمريرِ MIXED_* وGEN_WAIT_ITERS) يجبُ أن يُكتشَف:
#    نُولّدُه بحذفِ الحُرّاسِ المُشرَّطةِ من سطرِ exec ثم نُنفّذُه بحالةِ الضبطِ ونُطالبُ باكتشافِه.
sed -e "s|^B=[^;]*; REPO=[^ ]*|B=$T; REPO=$T/repo|" \
    -e 's/\${ARRIVAL_RATE:+ARRIVAL_RATE=\$ARRIVAL_RATE} //g' \
    -e 's/\${GEN_WAIT_ITERS:+GEN_WAIT_ITERS=\$GEN_WAIT_ITERS} //g' \
    -e 's/\${MIXED_RATE:+MIXED_RATE=\$MIXED_RATE} //g' \
    -e 's/\${MIXED_SEC:+MIXED_SEC=\$MIXED_SEC} //g' \
    -e 's/\${MIXED_SEED:+MIXED_SEED=\$MIXED_SEED} //g' \
    run-wave.sh > "$T/broken.sh"
env MIXED_RATE=20 MIXED_SEC=180 MIXED_SEED=1 GEN_WAIT_ITERS=108 \
  bash "$T/broken.sh" R3 profile.json 30 7 || fail "الغلافُ المكسورُ فشلَ تنفيذًا"
if grep -q '^MIXED_RATE=' "$T/capture.txt" 2>/dev/null; then
  fail "الغلافُ المكسورُ مرّرَ المتغيراتِ (الاختبارُ لا يكشفُ الانحدارَ)"
else
  echo "BROKEN_WRAPPER_DETECTED — الاختبارُ يكشفُ الانحدارَ فعلًا"
fi

echo "HANDOFF_TEST_OK — الضبطُ يعبرُ حرفيًا، والغيابُ لا يُضيفُ، والمكسورُ يُكتشَف (run-wave.sh)"
