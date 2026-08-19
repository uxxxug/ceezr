-- الغرض: إثبات/نفي سباق «فحص-ثم-كتابة بلا قفل» في إعادة حساب متوسط التقييم داخل
--   الدالّة submit_rating. راكبان يقيّمان السائق نفسه في اللحظة نفسها على طلبين
--   مختلفين، فيقرأ كلٌّ منهما مجموع التقييمات في لقطته الخاصة ويكتبه، فيضيع أحدهما.
-- الحالة: سكربت إثبات فعلي — بوابة D في أمر الإغلاق الشامل (2026-08-13).
-- ينتمي إلى: scripts
-- طريقة التشغيل موثَّقة في docs/evidence/gate-d-rating-race-20260813.txt
-- ملاحظة: هذا الملف تهيئة البيانات فقط؛ التزامن يقوده scripts/race-rating-average.sh
--   عبر جلستَي psql منفصلتين، إذ لا يمكن لجلسة واحدة أن تتسابق مع نفسها.

begin;

-- مدينة موجودة أصلاً من الـseed: جدة. لا تُنشأ مدينة جديدة كي يبقى النطاق خمس مدن.
create temporary table _ctx on commit drop as
select id as city_id from cities where code = 'JED' limit 1;

insert into users (id, city_id, telegram_id, role, full_name, language_code)
select '00000000-0000-4000-8000-000000000101', city_id, 990001, 'driver', 'سائق السباق', 'ar' from _ctx
on conflict (id) do nothing;
insert into users (id, city_id, telegram_id, role, full_name, language_code)
select '00000000-0000-4000-8000-000000000102', city_id, 990002, 'rider', 'راكب أ', 'ar' from _ctx
on conflict (id) do nothing;
insert into users (id, city_id, telegram_id, role, full_name, language_code)
select '00000000-0000-4000-8000-000000000103', city_id, 990003, 'rider', 'راكب ب', 'ar' from _ctx
on conflict (id) do nothing;

insert into drivers (id, city_id, user_id, verification_status)
select '00000000-0000-4000-8000-000000000201', city_id,
       '00000000-0000-4000-8000-000000000101', 'verified' from _ctx
on conflict (id) do nothing;

insert into riders (id, city_id, user_id)
select '00000000-0000-4000-8000-000000000301', city_id,
       '00000000-0000-4000-8000-000000000102' from _ctx
on conflict (id) do nothing;
insert into riders (id, city_id, user_id)
select '00000000-0000-4000-8000-000000000302', city_id,
       '00000000-0000-4000-8000-000000000103' from _ctx
on conflict (id) do nothing;

-- طلبان مكتملان مختلفان لنفس السائق: الشرط الذي يجعل السباق ممكناً فعلاً،
-- إذ القيد الفريد ratings_one_per_order_direction يمنع تكرار التقييم لطلب واحد.
insert into orders (id, city_id, rider_id, assigned_driver_id, service, status,
                    pickup, dropoff, completed_at)
select '00000000-0000-4000-8000-000000000401', city_id,
       '00000000-0000-4000-8000-000000000301',
       '00000000-0000-4000-8000-000000000201', 'transport', 'completed',
       st_setsrid(st_makepoint(39.1751, 21.5471), 4326)::geography,
       st_setsrid(st_makepoint(39.1901, 21.5601), 4326)::geography,
       now() from _ctx
on conflict (id) do nothing;

insert into orders (id, city_id, rider_id, assigned_driver_id, service, status,
                    pickup, dropoff, completed_at)
select '00000000-0000-4000-8000-000000000402', city_id,
       '00000000-0000-4000-8000-000000000302',
       '00000000-0000-4000-8000-000000000201', 'transport', 'completed',
       st_setsrid(st_makepoint(39.1751, 21.5471), 4326)::geography,
       st_setsrid(st_makepoint(39.1901, 21.5601), 4326)::geography,
       now() from _ctx
on conflict (id) do nothing;

-- تنظيف أثر أي تشغيل سابق كي تكون القراءة نظيفة (حذف بيانات اختبار لا حذف كود).
delete from ratings where order_id in ('00000000-0000-4000-8000-000000000401',
                                      '00000000-0000-4000-8000-000000000402');
update drivers set rating_average = null, rating_count = 0
 where id = '00000000-0000-4000-8000-000000000201';

commit;
