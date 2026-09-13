-- ============================================================================
-- migration-phase: expand
-- الغرض: سجلُّ رحلاتِ الراكبِ وتفاصيلُ الرحلةِ الواحدةِ — دالّتا **قراءةٍ محضةٍ**
--   (`rider_ride_history` و`rider_ride_detail`) وبذرُ إعدادِ المنطقةِ الزمنيّةِ
--   التي يُحسَبُ بها عنوانُ الشهرِ (البند `F2-08` · `SR-09` · `SR-10`).
-- الحالة: منفَّذٌ فعليّاً — البند `F2-08`، ومقيسٌ على قاعدةٍ حقيقيّةٍ في
--   `tests/integration/ride-history.test.ts`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/transport/ride-history-store.ts` عبرَ
--   `GET /v1/rides` و`GET /v1/rides/:id/detail`.
-- يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يقرأُ السجلَّ نفسَه بلا
--   دالّةٍ ثالثةٍ، و`F12-16` متى فُكَّ تجميدُ الأجرةِ **يُنشئُ إيصالَه في هجرتِه**
--   ولا يُوسِّعُ هذه.
--
-- ## لماذا الصفحاتُ بمفتاحٍ (`keyset`) لا بـ`offset`
--
-- الراكبُ يُنشئُ رحلاتٍ **أثناءَ** تصفُّحِه لسجلِّه. ومعَ `offset` تُزيحُ رحلةٌ
-- جديدةٌ الصفحةَ كلَّها سطراً، فيُقرأُ صفٌّ مرَّتَينِ أو يُسقَطُ صفٌّ بلا أثرٍ —
-- و«رحلةٌ اختفت من سجلّي» شكوى لا يُمكِنُ تكذيبُها بعدَ وقوعِها. والمفتاحُ
-- `(created_at desc, id desc)` **يُطابِقُ الفهرسَ القائمَ**
-- `orders_rider_created_id_idx (rider_id, created_at desc, id desc)` حرفاً
-- بحرفٍ، فلا فهرسَ جديدٌ يُضافُ ولا سجلَّ استعلاماتٍ ساخنةٍ يُمَسُّ.
--
-- و`id` جزءٌ من المفتاحِ لا زينةٌ: رحلتانِ في الطابعِ الزمنيِّ نفسِه ممكنتانِ
-- (المِلِّي ثانيةُ ليست ذرّةً)، وترتيبٌ على الوقتِ وحدَه يجعلُ حدَّ الصفحةِ
-- غيرَ حاسمٍ فتُكرَّرُ إحداهما أو تُبتلَعُ.
--
-- ## ولماذا عنوانُ الشهرِ يُحسَبُ ههنا بمنطقةٍ **مُعلَنةٍ** لا في المتصفِّحِ
--
-- رحلةُ الواحدةِ ليلاً في اليومِ الأوّلِ من شهرٍ بتوقيتِ الرياضِ هيَ **الحاديةَ
-- عشرةَ من ليلةِ آخرِ يومٍ في الشهرِ الماضي** بتوقيتِ UTC. فالتصنيفُ بـUTC
-- يضعُ الرحلةَ في الشهرِ الخطأِ، والتصنيفُ بساعةِ الجهازِ يجعلُ عنوانَ المجموعةِ
-- يتبدَّلُ بتبدُّلِ إعدادِ هاتفٍ — فيرى راكبانِ للرحلةِ نفسِها شهرَينِ.
--
-- فالمنطقةُ **قيمةُ إعدادٍ لكلِّ مدينةٍ** في `platform_settings` (القاعدة 0.3:
-- لا قيمةَ عملٍ في الشِّفرةِ)، **وتُنشَرُ في الردِّ نفسِه** معَ مصدرِها: مَن قرأَ
-- عنوانَ «سبتمبر ٢٠٢٦» يعرفُ بأيِّ ساعةٍ صُنِّفَ. وإن غابَ الإعدادُ أو كانَ اسمَ
-- منطقةٍ لا تعرفُها القاعدةُ **فالردُّ يقولُ ذلكَ صراحةً** (`FALLBACK_UTC`)
-- ويُصنَّفُ بـUTC — إعلانٌ لا صمتٌ.
--
-- ## ولماذا سجلُّ الأحداثِ يُجمَعُ من `orders` و`audit_log` معاً
--
-- أختامُ الدورةِ الأربعةُ في الصفِّ نفسِه (`created_at` · `matched_at` ·
-- `started_at` · `completed_at`)، **ولا ختمَ للإلغاءِ**: `orders` فيها
-- `cancelled_reason` بلا `cancelled_at`. والوقتُ **مكتوبٌ فعلاً** في صفِّ
-- `order.cancelled` من `audit_log` (هجرةُ `20260811090000`)، و`audit_log`
-- مصنَّفٌ `auditUnboundedUntilCompliance` في سياسةِ الاحتفاظِ — أي لا يُقلَّمُ.
--
-- **فلا يُضافُ عمودٌ ثانٍ لحقيقةٍ مكتوبةٍ** (القاعدة 0.6): عمودٌ جديدٌ يعني
-- مصدرَينِ يفترقانِ عندَ أوّلِ كاتبٍ ينسى أحدَهما، ويعني `null` أبديّاً في كلِّ
-- صفٍّ أُلغيَ قبلَ الهجرةِ — فيُقرأُ «لا وقتَ» عن إلغاءٍ وقتُه معروفٌ.
--
-- ## ولماذا كلُّ حدثٍ يحملُ `source` منشوراً
--
-- السجلُّ يُقرأُ في نزاعٍ. فمَن قرأَه يجبُ أن يعرفَ **من أينَ جاءَ الختمُ**: عمودٌ
-- في `orders` أم صفٌّ في `audit_log`. وحدثٌ بلا وقتٍ يُنشَرُ `at = null`
-- **ولا يُستبدَلُ بالآنَ ولا بالصفرِ**: الغيابُ يُقرأُ غياباً.
--
-- ## ولماذا الملكيّةُ قيدُ استعلامٍ لا فرعُ `if`
--
-- كما في `F2-06` و`F2-07`: `rider_id = v_rider_id` في `where` نفسِها. فمَن سألَ
-- عن رحلةِ غيرِه يُجابُ `ORDER_NOT_FOUND` لا `FORBIDDEN` — وفرقُ الرمزَينِ
-- **يُثبِتُ وجودَ الرحلةِ** لِمَن لا يملكُها، وهذا تسريبٌ لا رسالةُ خطأٍ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- ــ **لا تكتبُ شيئاً في بياناتِ الرحلاتِ**: لا `insert` ولا `update` ولا
--    `delete` على `orders` ولا على `audit_log`. البندُ قراءةٌ محضةٌ، والبذرةُ
--    الوحيدةُ صفُّ إعدادٍ بـ`on conflict do nothing`.
-- ــ **لا تُنشئُ حقلَ مبلغٍ ولا أجرةٍ ولا وسيلةِ دفعٍ ولا خانةً لها** — مُجمَّدةٌ
--    بـ`ADR 0039` §٤ و`م13-7` و`DEC-11`. والسجلُّ ههنا **سجلُّ رحلاتٍ لا كشفُ
--    حسابٍ**، وخانةُ مالٍ فارغةٌ تُقرأُ التزاماً.
-- ــ **لا تُنشئُ مساراً ولا سلسلةَ نقاطٍ ولا عمودَ مسافةٍ مقطوعةٍ** — لا مصدرَ
--    لها، ولا مزوّدَ خرائطَ (`ADR 0007`).
-- ــ **لا تفتحُ تذكرةَ دعمٍ ولا تمسُّ `open_support_ticket`** — `F2-12`.
-- ــ **لا تُنشئُ فهرساً**: الفهرسُ الذي تحتاجُه قائمٌ منذُ `F2-05`.
-- ــ **لا تُعدِّلُ `completed_ride_summary`** — خارجَ النطاقِ المحجوزِ. وبطاقةُ
--    السائقِ تُبنى ههنا نسخةً ثانيةً، **وتوحيدُها دَينٌ مُسمّىً `F2-08-D1`** في
--    `ADR 0107` لا طيٌّ بصمتٍ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (١) بذرةُ المنطقةِ الزمنيّةِ التي يُصنَّفُ بها الشهرُ — قيمةُ إعدادٍ لا ثابتٌ
--     في الشِّفرةِ (القاعدة 0.3). تُبذَرُ لكلِّ مدينةٍ قائمةٍ، ولا تُكتَبُ فوقَ
--     قيمةٍ موجودةٍ: مَن غيَّرَها بعدَ نشرٍ أعلمُ بمدينتِه من هذه الهجرةِ.
-- ----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'ride_history_month_timezone',
       '"Asia/Riyadh"'::jsonb,
       'string',
       'المنطقةُ الزمنيّةُ التي يُحسَبُ بها عنوانُ الشهرِ في سجلِّ رحلاتِ الراكبِ (SR-09). تُنشَرُ في الردِّ نفسِه.',
       false
  from cities c
on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- (٢) سجلُّ الرحلاتِ — صفحةٌ واحدةٌ بمفتاحٍ، مُصنَّفةٌ بالشهرِ، قابلةٌ للبحثِ.
-- ----------------------------------------------------------------------------
create or replace function public.rider_ride_history(
  p_telegram_id        bigint,
  p_query              text        default null,
  p_before_created_at  timestamptz default null,
  p_before_id          uuid        default null,
  p_limit              integer     default 20
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_city_id   uuid;
  v_tz_raw    text;
  v_tz        text;
  v_tz_source text;
  v_query     text;
  v_rows      jsonb;
  v_has_more  boolean;
  v_next      jsonb;
begin
  -- الحدُّ يُرَدُّ ولا يُقصَرُ صامتاً: عميلٌ طلبَ ألفَ صفٍّ يجبُ أن يعرفَ أنَّه
  -- لم يُعطَ ألفاً، لا أن يظنَّ سجلَّه انتهى عندَ الخمسينَ.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  end if;

  -- المؤشِّرُ جزآنِ لا يُفترقانِ: نصفُ مفتاحٍ يُنتِجُ حدَّ صفحةٍ غيرَ حاسمٍ.
  if (p_before_created_at is null) <> (p_before_id is null) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CURSOR');
  end if;

  select u.id, u.city_id into v_user_id, v_city_id from users u where u.telegram_id = p_telegram_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id, r.city_id into v_rider_id, v_city_id from riders r where r.user_id = v_user_id;
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- المنطقةُ الزمنيّةُ: إعدادُ المدينةِ، ويُتحقَّقُ أنَّها اسمٌ **تعرفُه القاعدةُ**
  -- قبلَ استعمالِها — و`at time zone 'مدينةٌ لا وجودَ لها'` يرفعُ استثناءً
  -- يُسقِطُ القراءةَ كلَّها، وسجلُّ رحلاتٍ لا يُقرأُ بسببِ حرفٍ في إعدادٍ أسوأُ
  -- من عنوانِ شهرٍ بـUTC مُعلَنٍ.
  v_tz_raw := nullif(trim(coalesce(get_setting(v_city_id, 'ride_history_month_timezone') #>> '{}', '')), '');

  if v_tz_raw is null then
    v_tz := 'UTC';
    v_tz_source := 'FALLBACK_UTC_SETTING_ABSENT';
  elsif not exists (select 1 from pg_timezone_names z where z.name = v_tz_raw) then
    v_tz := 'UTC';
    v_tz_source := 'FALLBACK_UTC_SETTING_UNKNOWN';
  else
    v_tz := v_tz_raw;
    v_tz_source := 'CITY_SETTING';
  end if;

  -- البحثُ: نصٌّ يُطابَقُ على لافتتَي الطرفَينِ **داخلَ صفوفِ هذا الراكبِ وحدَه**.
  -- والنصُّ الفارغُ **ليسَ بحثاً**: يُعامَلُ معدوماً فلا يُمسَحُ الجدولُ بشرطٍ
  -- يُطابِقُ كلَّ شيءٍ. ولا `pg_trgm` ولا `unaccent` في هذه القاعدةِ، فلا يُدَّعى
  -- بحثٌ ضبابيٌّ ولا تطبيعٌ عربيٌّ — دَينٌ مُعلَنٌ في `ADR 0107`.
  v_query := nullif(trim(coalesce(p_query, '')), '');

  -- `p_limit + 1` صفّاً: الصفُّ الزائدُ **يُقاسُ ولا يُنشَرُ** — هوَ الجوابُ عن
  -- «أثمَّةَ مزيدٌ؟» بلا عدٍّ ثانٍ للجدولِ كلِّه. ولا جدولَ مؤقَّتاً: الاتّصالُ
  -- يمرُّ بمُجمِّعِ معاملاتٍ، وجدولٌ مؤقَّتٌ فيه يعيشُ أطولَ من الطلبِ الذي
  -- أنشأَه فيُقرأُ في طلبِ راكبٍ آخرَ.
  with page as (
    select o.id,
           o.status::text        as status,
           o.service::text       as service,
           o.pickup_label,
           o.dropoff_label,
           o.created_at,
           o.completed_at,
           to_char(o.created_at at time zone v_tz, 'YYYY-MM') as month_key
      from orders o
     where o.rider_id = v_rider_id
       and (p_before_created_at is null
            or (o.created_at, o.id) < (p_before_created_at, p_before_id))
       and (v_query is null
            or o.pickup_label ilike '%' || v_query || '%'
            or o.dropoff_label ilike '%' || v_query || '%')
     order by o.created_at desc, o.id desc
     limit p_limit + 1
  ), kept as (
    select * from page order by created_at desc, id desc limit p_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'order_id',      k.id,
               'status',        k.status,
               'service',       k.service,
               'pickup_label',  k.pickup_label,
               'dropoff_label', k.dropoff_label,
               'created_at',    k.created_at,
               'completed_at',  k.completed_at,
               'month_key',     k.month_key
             ) order by k.created_at desc, k.id desc
           ), '[]'::jsonb),
         (select count(*) from page) > p_limit,
         -- المؤشِّرُ التالي هوَ **آخرُ صفٍّ مُنشَرٍ** لا الصفُّ الزائدُ: الصفحةُ
         -- التاليةُ تبدأُ ممّا بعدَ ما قرأَه العميلُ فعلاً.
         (select jsonb_build_object('created_at', k2.created_at, 'id', k2.id)
            from kept k2 order by k2.created_at asc, k2.id asc limit 1)
    into v_rows, v_has_more, v_next
    from kept k;

  return jsonb_build_object(
    'ok', true,
    'month_timezone', v_tz,
    'month_timezone_source', v_tz_source,
    'query', v_query,
    'limit', p_limit,
    'rides', v_rows,
    'has_more', v_has_more,
    -- ولا يُنشَرُ مؤشِّرٌ حينَ لا مزيدَ: مؤشِّرٌ يُعيدُ صفحةً فارغةً يجعلُ العميلَ
    -- يسألُ سؤالاً يعرفُ الخادمُ جوابَه سلفاً.
    'next_cursor', case when coalesce(v_has_more, false) then v_next else null end
  );
end;
$function$;

comment on function public.rider_ride_history(bigint, text, timestamptz, uuid, integer) is
  'F2-08 / SR-09: صفحةُ سجلِّ رحلاتِ الراكبِ بمفتاحٍ (created_at, id) مُصنَّفةً بالشهرِ بمنطقةٍ مُعلَنةٍ. قراءةٌ محضةٌ بلا أيِّ حقلٍ ماليٍّ (ADR 0039 §4).';

-- ----------------------------------------------------------------------------
-- (٣) تفاصيلُ الرحلةِ الواحدةِ — الأطرافُ والسائقُ **وسجلُّ الأحداثِ بمصادرِه**.
--
-- ولا تُعيدُ مدّةً ولا وترَ خطٍّ ولا حالةَ تقييمٍ: تلكَ حقولُ
-- `completed_ride_summary` (`F2-07`)، وتكرارُها ههنا مصدرُ حقيقةٍ ثانٍ يفترقُ
-- عن الأوّلِ عندَ أوّلِ تصحيحٍ (القاعدة 0.6). فالتفاصيلُ تُجيبُ عن سؤالٍ آخرَ:
-- **ماذا جرى ومتى**، لأيِّ رحلةٍ كانت — منتهيةً أو ملغاةً أو فاشلةً.
-- ----------------------------------------------------------------------------
create or replace function public.rider_ride_detail(
  p_telegram_id bigint,
  p_order_id    uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  v_user_id    uuid;
  v_rider_id   uuid;
  v_order      orders%rowtype;
  v_driver     jsonb;
  v_full_name  text;
  v_events     jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الملكيّةُ **شرطٌ في الاستعلامِ**: لا فرعَ بعدَه يُميِّزُ «ليست لكَ» عن «لا
  -- توجدُ» — وذاكَ التمييزُ نفسُه تسريبُ وجودٍ.
  select * into v_order
    from orders o
   where o.id = p_order_id and o.rider_id = v_rider_id;

  if not found then
    return jsonb_build_object('ok', true, 'found', false, 'refusal', 'ORDER_NOT_FOUND');
  end if;

  if v_order.assigned_driver_id is not null then
    select u.full_name, jsonb_build_object(
             'vehicle_type',   d.vehicle_type,
             'plate_number',   d.plate_number,
             'rating_average', d.rating_average,
             'rating_count',   coalesce(d.rating_count, 0)
           )
      into v_full_name, v_driver
      from drivers d
      join users u on u.id = d.user_id
     where d.id = v_order.assigned_driver_id;

    if v_driver is not null then
      -- الاسمُ الأوّلُ وحدَه: يكفي للتعرُّفِ ولا يُفشي هويّةً كاملةً. والفارغُ
      -- **غيابٌ** لا نصٌّ فارغٌ.
      v_driver := v_driver || jsonb_build_object(
        'first_name', nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '')
      );
    end if;
  end if;

  -- سجلُّ الأحداثِ: كلُّ حدثٍ **وقعَ فعلاً** ولهُ أثرٌ مكتوبٌ. ولا يُصطنَعُ حدثٌ
  -- من حالةٍ: «مُلغاةٌ» حالةٌ، و«أُلغيَت في الساعةِ كذا» حدثٌ — والثاني وحدَه
  -- يُنشَرُ ههنا، ووقتُه من `audit_log` لا من `updated_at` (وذاكَ يتحرَّكُ بأيِّ
  -- كتابةٍ لاحقةٍ فيُقرأُ الإلغاءُ في غيرِ وقتِه).
  select coalesce(jsonb_agg(e order by e.sort_at asc nulls last, e.rank asc), '[]'::jsonb)
    into v_events
    from (
      select jsonb_build_object('kind', k, 'at', at, 'source', src, 'detail', detail) as e,
             at as sort_at,
             rank
        from (
          select 'REQUESTED' as k, v_order.created_at as at, 'orders.created_at' as src,
                 jsonb_build_object('service', v_order.service::text) as detail, 1 as rank
          union all
          select 'MATCHED', v_order.matched_at, 'orders.matched_at',
                 jsonb_build_object('broadcast_round', v_order.broadcast_round), 2
           where v_order.matched_at is not null
          union all
          select 'STARTED', v_order.started_at, 'orders.started_at', '{}'::jsonb, 3
           where v_order.started_at is not null
          union all
          select 'COMPLETED', v_order.completed_at, 'orders.completed_at', '{}'::jsonb, 4
           where v_order.completed_at is not null
          union all
          select 'CANCELLED', a.created_at, 'audit_log',
                 jsonb_build_object(
                   'reason', coalesce(a.payload ->> 'reason', v_order.cancelled_reason),
                   'previous_status', a.payload ->> 'previous_status'
                 ), 5
            from audit_log a
           where a.action = 'order.cancelled'
             and a.entity_type = 'order'
             and a.entity_id = v_order.id
          union all
          -- إلغاءٌ بلا أثرٍ في السجلِّ: يقعُ للصفوفِ التي أُلغيَت بمسارٍ لا يكتبُ
          -- `audit_log` (أو قبلَ وجودِه). فيُنشَرُ الحدثُ **بلا وقتٍ** ومصدرُه
          -- مُسمّىً `UNRECORDED` — الغيابُ يُقرأُ غياباً، ولا يُخترَعُ له ختمٌ.
          select 'CANCELLED', null::timestamptz, 'UNRECORDED',
                 jsonb_build_object('reason', v_order.cancelled_reason), 5
           where v_order.status::text = 'cancelled'
             and not exists (
               select 1 from audit_log a2
                where a2.action = 'order.cancelled'
                  and a2.entity_type = 'order'
                  and a2.entity_id = v_order.id
             )
        ) raw
    ) e;

  return jsonb_build_object(
    'ok', true,
    'found', true,
    'order_id', v_order.id,
    'status', v_order.status::text,
    'service', v_order.service::text,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'cancelled_reason', v_order.cancelled_reason,
    'driver', coalesce(v_driver, 'null'::jsonb),
    'events', v_events
  );
end;
$function$;

comment on function public.rider_ride_detail(bigint, uuid) is
  'F2-08 / SR-10: أطرافُ الرحلةِ وسائقُها وسجلُّ أحداثِها بمصادرِها. لا مدّةَ ولا وترَ (تلكَ في completed_ride_summary) ولا حقلَ ماليَّ (ADR 0039 §4) ولا مسارَ (ADR 0007).';

-- ----------------------------------------------------------------------------
-- (٤) نزعُ التنفيذِ — إلزاميٌّ لكلِّ دالّةٍ أُنشِئَت أو استُبدِلَت ههنا.
--
-- و**درسُ `F2-06` مكتوبٌ بثمنِه**: `postgres` يمنحُ `execute` لدورِ `public` على
-- كلِّ دالّةٍ جديدةٍ **تلقائيّاً**، فسقطَت شغلةُ التكاملِ في CI على طبقةِ
-- الصلاحيّاتِ لا على منطقٍ. و`anon` و`authenticated` يُستدَلُّ عليهما من
-- `public`، وحاجزُ العقدِ الساكنُ يُسقِطُ كلَّ دالّةٍ في هذا الملفِّ لا يُنزَعُ
-- تنفيذُها بالأدوارِ الثلاثةِ مُسمّاةً.
-- ----------------------------------------------------------------------------
revoke execute on function rider_ride_history(bigint, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke execute on function rider_ride_detail(bigint, uuid) from public, anon, authenticated;
