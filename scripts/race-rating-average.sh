#!/usr/bin/env bash
# الغرض: تشغيل سباق فعلي بجلستَي PostgreSQL متوازيتين على submit_rating لإثبات
#   أو نفي ضياع تحديث متوسط التقييم (نمط «فحص-ثم-كتابة بلا قفل»).
# الحالة: سكربت إثبات فعلي — بوابة D في أمر الإغلاق الشامل (2026-08-13).
# ينتمي إلى: scripts
# الاستعمال: DATABASE_URL=... bash scripts/race-rating-average.sh
# ملاحظة: التداخل هنا محتوم لا احتمالي — الجلسة الأولى تُبقي معاملتها مفتوحة
#   بعد نداء الدالّة، فتقرأ الثانية لقطةً لا ترى إدراج الأولى، ثم تكتب فوقها.

set -uo pipefail
DB="${DATABASE_URL:?عيّن DATABASE_URL}"
DRIVER='00000000-0000-4000-8000-000000000201'
FIFO="$(mktemp -u)"; mkfifo "$FIFO"

psql "$DB" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/race-rating-average.sql" >/dev/null

echo "--- الحالة قبل السباق ---"
psql "$DB" -tA -F'|' -c "select coalesce(rating_average::text,'NULL'), rating_count from drivers where id='$DRIVER'"

# الجلسة الأولى: تُدرج تقييمها وتُعيد الحساب ثم تنتظر إشارة قبل الإتمام.
( { echo "begin;"
    echo "select submit_rating('00000000-0000-4000-8000-000000000401'::uuid, 990002::bigint, 5::smallint);"
    cat "$FIFO" >/dev/null
    echo "commit;"
  } | psql "$DB" -tA >/tmp/race-s1.out 2>&1 ) &
S1=$!

sleep 2  # ضمان أن الجلسة الأولى نفّذت الدالّة فعلاً وما زالت مفتوحة

# الجلسة الثانية: تُدرج تقييمها وتُعيد الحساب بلقطتها الخاصة. ستحجزها الأولى على
# صفّ السائق، فتبقى منتظرة إلى أن تُتمّ الأولى، ثم تكتب قيمتها المحسوبة سلفاً.
( psql "$DB" -tA -c "begin; select submit_rating('00000000-0000-4000-8000-000000000402'::uuid, 990003::bigint, 1::smallint); commit;" \
    >/tmp/race-s2.out 2>&1 ) &
S2=$!

sleep 2
echo "" > "$FIFO"   # أطلِق إتمام الجلسة الأولى
wait $S1 $S2
rm -f "$FIFO"

echo "--- ناتج الجلسة الأولى (نجمة 5) ---"; cat /tmp/race-s1.out
echo "--- ناتج الجلسة الثانية (نجمة 1) ---"; cat /tmp/race-s2.out

echo "--- الحالة بعد السباق ---"
psql "$DB" -tA -F'|' -c "select coalesce(rating_average::text,'NULL') as stored_avg, rating_count as stored_count from drivers where id='$DRIVER'"
echo "--- الحقيقة من مصدرها (جدول ratings) ---"
psql "$DB" -tA -F'|' -c "select round(avg(stars)::numeric,2) as true_avg, count(*) as true_count from ratings where ratee_user_id='00000000-0000-4000-8000-000000000101' and is_flagged=false"

STORED=$(psql "$DB" -tAc "select rating_count from drivers where id='$DRIVER'")
TRUE=$(psql "$DB" -tAc "select count(*) from ratings where ratee_user_id='00000000-0000-4000-8000-000000000101' and is_flagged=false")
if [ "$STORED" != "$TRUE" ]; then
  echo "النتيجة: ❌ سباقٌ مُثبَت — المُخزَّن $STORED والحقيقي $TRUE. تحديثٌ ضائع."
  exit 1
fi
echo "النتيجة: ✅ لا ضياع — المُخزَّن $STORED يطابق الحقيقي $TRUE."
