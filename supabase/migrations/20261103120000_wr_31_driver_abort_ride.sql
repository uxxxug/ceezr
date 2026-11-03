-- migration-phase: expand
-- ============================================================================
-- الغرض: WR-31 — «قطعُ الرحلةِ» من سطحِ السائقِ: زرٌّ أحمرُ يُنهي طلبًا قُبلَ أو
--   بدأ قبلَ اكتمالِه (راكبٌ مزعجٌ أو طارئٌ)، مع إخطارِ الراكبِ على بوتِهِ وصندوقِ
--   الصادرِ الموحَّدِ، وإعادةِ السائقِ متاحًا، وفتحِ تقييمِ الراكبِ (اتجاهُ السائقِ
--   وحده) للرحلاتِ المقطوعةِ — فالراكبُ المزعجُ هوَ أشدُّ ما يريدُهُ السائقُ مسجَّلًا.
--   قرارُ المالكِ منَ التجربةِ الميدانيةِ المغلقةِ (2026-11-03): زرُّ إنهاءٍ عاديٌّ
--   وزرُّ قطعٍ أحمرُ بلونٍ مختلفٍ.
-- الحالة: منفَّذ فعلياً — 2026-11-03.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: driver_abort_ride (مسارُ البوابةِ `POST /v1/driver/job/:id/abort`)
-- ملاحظات مستقبلية: لو احتاجَ القطعُ أسبابًا مصنَّفةً (مزعج/خطر/تعذَّر الوصول) تُضاف
--   قيمةً مصنَّفةً في `payload` لا عمودًا جديدًا — السجلُّ التاريخيُّ للقطعِ هوَ الحُكم.
-- ============================================================================

-- 1) قطعُ الرحلةِ من سطحِ السائقِ — مِلكيّةٌ ثمَّ انتقالٌ واحدٌ ذرّيّ:
--    `matched` (قُبلَ ولم يبدأ) أو `in_progress` (بدأ) ← `cancelled`.
--    لا يُمسُّ عرضٌ ولا تفاوضٌ هنا: العرضُ قُبلَ وانتهى دورُه، والتفاوضُ أُغلقَ عندَ
--    القبولِ. والسائقُ يعودُ متاحًا كما في الإكمالِ.
create or replace function driver_abort_ride(
  p_driver_telegram_id bigint,
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    users%rowtype;
  v_driver  drivers%rowtype;
  v_order   orders%rowtype;
  v_now     timestamptz := now();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_notice  jsonb;
begin
  if length(coalesce(v_reason, '')) > 500 then
    return jsonb_build_object('ok', false, 'error', 'REASON_TOO_LONG');
  end if;

  select * into v_user from users where telegram_id = p_driver_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_order
    from orders
   where id = p_order_id
     and status in ('matched', 'in_progress')
     and assigned_driver_id = v_driver.id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ABORTABLE');
  end if;

  update orders set status = 'cancelled' where id = p_order_id;

  -- السائقُ يعودُ متاحًا: من قطعَ رحلتَهُ جاهزٌ للتاليةِ بلا أمرٍ إضافيٍّ.
  update driver_availability
     set is_available = true, updated_at = v_now
   where driver_id = v_driver.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user.id, 'order.aborted_by_driver', 'order', p_order_id,
          jsonb_build_object('driver_id', v_driver.id,
                             'was_status', v_order.status,
                             'reason', v_reason));

  -- إخطارُ الراكبِ على بوتِهِ صندوقَ صادرٍ واحدًا لا إرسالًا مباشرًا: إن تعطّلَ
  -- تيليجرامُ لحظتَها بقيَ الصفُّ يعيدُ المحاولةَ (ADR 0265 نفسُ منطقِ الأطوارِ).
  v_notice := enqueue_rider_trip_notice(p_order_id, 'ABORTED');
  if (v_notice->>'ok')::boolean is not true then
    -- الطورُ وقعَ في القاعدةِ قبلَ هذهِ المكالمةِ: فشلُ الإيداعِ يُسجَّلُ ولا يُعادُ
    -- للسائقِ فلا يضغطُ ثانيةً على قطعٍ خُتِمَ.
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_order.city_id, v_user.id, 'rider_trip_notice.enqueue_failed', 'order',
            p_order_id,
            jsonb_build_object('event', 'ABORTED', 'error', v_notice->>'error'));
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'aborted_at', v_now,
    'was_status', v_order.status,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'driver', jsonb_build_object('telegram_id', v_user.telegram_id,
                                 'language_code', v_user.language_code,
                                 'full_name', v_user.full_name),
    'rider', jsonb_build_object('telegram_id', null, 'language_code', null)
  );
end;
$$;

comment on function driver_abort_ride(bigint, uuid, text) is
  'قطعُ الرحلةِ من سطحِ السائقِ (WR-31): طلبٌ قُبلَ أو بدأ قبلَ اكتمالِهِ يُنهيهِ السائقُ بزامِلِ المِلكيّةِ والذرّيّةِ، ويُخطرُ الراكبَ عبرَ صندوقِ الصادرِ، ويُعيدُ السائقَ متاحًا، ويفتحُ تقييمَ الراكبِ للسائقِ (اتجاهُ السائقِ وحدَه).';

revoke all on function driver_abort_ride(bigint, uuid, text) from public, anon, authenticated;
grant execute on function driver_abort_ride(bigint, uuid, text) to service_role;

-- 2) حدثُ `ABORTED` في إخطاراتِ أطوارِ الرحلةِ للراكبِ — امتدادٌ لا استبدال:
--    الدالةُ تُكتبُ هنا على جسمِها القائمِ **بعدَ آخرِ تعديلٍ لها** (20261018150000:
--    ضمُّ `users` يسارًا وإرجاعُ `rider_telegram_id`، وقائمةُ الأحداثِ الكاملةُ مع
--    أحداثِ الجدولةِ والبحثِ) لا على جسمِها الأولَ — فالكتابةُ على الجسمِ القديمِ
--    تُسقِطُ حقلاً يعتمدُ عليه العميلُ (مُقيَّسٌ في اختبارِ التكاملِ لـWR-15)،
--    وتُسقِطُ أحداثَ الجدولةِ (WR-06 ج · WR-22). يُزادُ `ABORTED` وحدَهُ.
create or replace function public.enqueue_rider_trip_notice(p_order_id uuid, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_id uuid;
begin
  if p_event is null or p_event not in ('MATCHED', 'ARRIVED', 'STARTED', 'COMPLETED', 'ABORTED',
                                       'SCHEDULED', 'SCHEDULE_REMINDER', 'SEARCH_STARTED', 'SCHEDULE_MISSED',
                                       'SEARCH_EXPIRED') then
    return jsonb_build_object('ok', false, 'error', 'EVENT_INVALID');
  end if;

  select o.id, o.city_id, r.user_id as rider_user_id, u.telegram_id::text as rider_telegram_id
    into v_order
    from orders o
    join riders r on r.id = o.rider_id
    left join users u on u.id = r.user_id  -- يسارٌ: لا يغيّرُ «وُجِدَ الطلب» عمّا كان
   where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key)
  values (
    v_order.city_id, 'rider_trip_notice', v_order.id, v_order.rider_user_id,
    jsonb_build_object('order_id', v_order.id, 'event', p_event),
    'rider_trip:' || v_order.id::text || ':' || p_event
  )
  on conflict (kind, dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    select n.id into v_id from notification_outbox n
     where n.kind = 'rider_trip_notice'
       and n.dedup_key = 'rider_trip:' || v_order.id::text || ':' || p_event;
    return jsonb_build_object('ok', true, 'created', false, 'delivery_id', v_id,
                              'rider_telegram_id', v_order.rider_telegram_id);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'delivery_id', v_id,
                            'rider_telegram_id', v_order.rider_telegram_id);
end $$;

revoke all on function enqueue_rider_trip_notice(uuid, text) from public, anon, authenticated;
grant execute on function enqueue_rider_trip_notice(uuid, text) to service_role;

-- 3) تقييمُ الراكبِ للرحلاتِ المقطوعةِ — اتجاهُ السائقِ وحدَه:
--    `submit_rating_with_tags` هوَ الكاتبُ القائمُ (تُفوِّضُ إليهِ `submit_rating`)،
--    فيُستبدَلُ هوَ لا يُزادُ حملٌ زائدٌ بجانبِه. الرحلةُ المقطوعةُ تُقيَّمُ من
--    السائقِ وحدَه — فالقطعَ نفسَهُ أثرُ سلوكٍ يريدُهُ السائقُ مسجَّلًا في السمعةِ —
--    والراكبُ لا يُقيِّمُ رحلةً قُطعت (لم تُكمَل): بابُهُ الإكمالُ.
create or replace function public.submit_rating_with_tags(
  p_order_id uuid,
  p_rater_telegram_id bigint,
  p_stars smallint,
  p_comment text default null::text,
  p_tags text[] default null::text[]
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_order     orders%rowtype;
  v_rater     users%rowtype;
  v_driver    drivers%rowtype;
  v_rider     riders%rowtype;
  v_driver_u  users%rowtype;
  v_rider_u   users%rowtype;
  v_direction rating_direction;
  v_ratee     uuid;
  v_window    numeric;
  v_now       timestamptz := now();
  v_rating_id uuid;
  v_rated_at  timestamptz;
  v_tags      text[] := nullif(p_tags, '{}'::text[]);
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('ok', false, 'error', 'STARS_OUT_OF_RANGE');
  end if;

  -- الوسومُ تُحكَمُ **قبلَ أيِّ قراءةٍ**: رفضُ مُدخلٍ لا يحتاجُ صفّاً.
  if v_tags is not null then
    if cardinality(v_tags) > 3 then
      return jsonb_build_object('ok', false, 'error', 'TOO_MANY_RATING_TAGS');
    end if;
    if cardinality(v_tags) <> (select count(distinct t) from unnest(v_tags) as t) then
      return jsonb_build_object('ok', false, 'error', 'DUPLICATE_RATING_TAG');
    end if;
    if not (v_tags <@ array[
      'cleanliness', 'politeness', 'route_adherence', 'punctuality', 'driving_safety'
    ]::text[]) then
      -- الوسمُ المجهولُ **يُرَدُّ** ولا يُخزَّنُ صامتاً ولا يُحذَفُ من المصفوفةِ:
      -- حذفُه يجعلُ الراكبَ يظنُّ أنَّ رأيَه سُجِّلَ وقد أُسقِطَ.
      return jsonb_build_object('ok', false, 'error', 'UNKNOWN_RATING_TAG');
    end if;
  end if;

  select * into v_rater from users where telegram_id = p_rater_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_FOUND');
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where id = v_order.assigned_driver_id;
  select * into v_driver_u from users where id = v_driver.user_id;
  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  -- الاتجاه يُستنتج من هوية المُقيِّم لا يُمرَّر من الخارج: من ليس طرفاً في الرحلة لا يقيّمها
  if v_rater.id = v_rider_u.id then
    v_direction := 'rider_to_driver';
    v_ratee := v_driver_u.id;
  elsif v_rater.id = v_driver_u.id then
    v_direction := 'driver_to_rider';
    v_ratee := v_rider_u.id;
  else
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_PARTY_TO_ORDER');
  end if;

  -- (WR-31) الرحلةُ تُقيَّمُ مكتملةً، إلا القطعَ: فالسائقُ وحدَهُ يُقيِّمُ راكبًا
  -- قطعَ عليهِ الرحلةَ. والراكبُ لا يُقيِّمُ ما لم يُكمَل — بابُهُ الإكمالُ.
  if v_order.status = 'completed' then
    v_rated_at := v_order.completed_at;
  elsif v_order.status = 'cancelled' and v_direction = 'driver_to_rider' then
    v_rated_at := v_order.updated_at;
  else
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETED');
  end if;

  -- بلا رقم مرمَّز: get_setting_number تُطلق MISSING_SETTING عند غياب الصفّ،
  -- فإعدادٌ غائب خطأ تشغيليّ يُعلَن، لا سياسةٌ تُخترع في القاعدة.
  v_window := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  if v_rated_at + make_interval(hours => v_window::integer) < v_now then
    return jsonb_build_object('ok', false, 'error', 'RATING_WINDOW_CLOSED');
  end if;

  begin
    insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id,
                         stars, comment, tags)
    values (v_order.city_id, p_order_id, v_direction, v_rater.id, v_ratee,
            p_stars, nullif(btrim(coalesce(p_comment, '')), ''), v_tags)
    returning id into v_rating_id;
  exception when unique_violation then
    -- القيد الفريد هو الحكم، لا فحص سابق في التطبيق: لا سباق ولا تقييم مكرَّر
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RATED');
  end;

  -- التحديث فوري ليُثمر التقييم في المطابقة التالية مباشرة، والمهمة الدورية
  -- تعيد الحساب من المصدر لتصحّح أي انحراف تراكمي. القفل داخل الدالّة المشتركة.
  perform recompute_ratee_averages(v_ratee, v_direction);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rater.id, 'rating.submitted', 'rating', v_rating_id,
          jsonb_build_object('order_id', p_order_id, 'direction', v_direction,
                             'order_status', v_order.status, 'stars', p_stars,
                             'ratee_user_id', v_ratee,
                             'tags', to_jsonb(coalesce(v_tags, array[]::text[]))));

  return jsonb_build_object('ok', true, 'rating_id', v_rating_id,
                            'direction', v_direction, 'stars', p_stars,
                            'order_status', v_order.status,
                            'tags', to_jsonb(coalesce(v_tags, array[]::text[])));
end;
$function$;

comment on function public.submit_rating_with_tags(uuid, bigint, smallint, text, text[]) is
  'F2-07 + WR-31: مصدرُ حقيقةِ التقييمِ — نجومٌ وملاحظةٌ ووسومٌ من مُعجَمٍ محصورٍ. والرحلةُ المقطوعةُ يُقيِّمُها السائقُ وحدَه (نافذتُها من لحظةِ القطعِ).';

revoke execute on function submit_rating_with_tags(uuid, bigint, smallint, text, text[]) from public, anon, authenticated;
grant execute on function submit_rating_with_tags(uuid, bigint, smallint, text, text[]) to service_role;

-- 4) ملخَّصُ الرحلةِ المقطوعةِ (WR-31) — `completed_ride_summary` الكائنُ القائمُ
--    يُستبدَلُ لا يُزادُ قارئٌ ثانٍ: السائقُ الذي قطعَ يرى بطاقةَ الراكبِ
--    (ليُقيِّمَه) ونافذتُهُ من لحظةِ القطعِ (`updated_at`)، والراكبُ لا يرى
--    بطاقةَ سائقٍ في رحلةٍ ملغاةٍ كما كانَ. المكتملةُ كما كانت حرفًا.
create or replace function completed_ride_summary(
  p_telegram_id bigint,
  p_order_id    uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_user_id  uuid;
  v_rider_id uuid;
  v_driver_id     uuid;
  v_order         record;
  v_order_found   boolean := false;
  v_is_driver     boolean := false;
  v_vehicle_type   text;
  v_plate_number   text;
  v_rating_average numeric;
  v_rating_count   integer;
  v_full_name      text;
  v_counterpart_name text;
  v_window_hours   numeric;
  v_already_rated  boolean := false;
  v_window_closed  boolean := true;
  v_can_rate       boolean := false;
  v_direction      rating_direction;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- المنظورُ يُستنتَجُ من علاقةِ الطلبِ تحديداً لا من دورٍ مُسبَقٍ:
  -- راكبٌ يرى الطلبَ الذي rider_id له، وسائقٌ مُسنَدٌ يرى الطلبَ الذي assigned_driver_id
  -- له. ومن ليسَ طرفاً لا يرى شيئاً.
  --
  -- **وهويّتا المجالِ (`v_rider_id` · `v_driver_id`) تُقرآنِ معاً أوّلاً** — لا
  -- بترتيبٍ متتاليٍ يُخفي الحالةَ الثالثةَ: مستخدمٌ له صفٌّ في `users` (وربّما
  -- سُجِّل بدورٍ ما) ولا صفَّ له في `riders` ولا في `drivers`. هذه الحالةُ ترُدُّ
  -- `RIDER_NOT_REGISTERED` **قبلَ** أيِّ مساسٍ بـ`v_order`، لأنَّ `v_order`
  -- سجلٌّ (`record`) لا يجوزُ ذِكرُ حقلٍ منه قبلَ أن يُسنَدَ إليه شيءٌ — والإسنادُ
  -- هنا مشروطٌ بوجودِ طلبٍ فعلاً، فلا يجوزُ اتّخاذُ `v_order.id is null` حارساً
  -- على أصلٍ لم يُقرأ قط (`55000`: `record "v_order" is not assigned yet`).
  select r.id into v_rider_id from riders r where r.user_id = v_user_id;
  select d.id into v_driver_id from drivers d where d.user_id = v_user_id;

  if v_rider_id is null and v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  if v_rider_id is not null then
    -- راكبٌ: ابحث عن الطلبِ بصفتهِ راكبَه.
    select o.id,
           o.status,
           o.service,
           o.city_id,
           o.assigned_driver_id,
           o.rider_id,
           o.pickup_label,
           o.dropoff_label,
           o.created_at,
           o.matched_at,
           o.started_at,
           o.completed_at,
           o.updated_at,
           case
             when o.started_at is null or o.completed_at is null then null
             else greatest(
               0,
               floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
             )
           end as duration_seconds,
           case
             when o.dropoff is null then null
             else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
           end as straight_line_meters
      into v_order
    from orders o
    where o.id = p_order_id and o.rider_id = v_rider_id;

    v_order_found := found;
  end if;

  if not v_order_found and v_driver_id is not null then
    -- ليسَ راكبَ هذا الطلبِ (أو ليسَ راكباً أصلاً): ابحث بصفتِه سائقَه.
    v_is_driver := true;
    select o.id,
           o.status,
           o.service,
           o.city_id,
           o.assigned_driver_id,
           o.rider_id,
           o.pickup_label,
           o.dropoff_label,
           o.created_at,
           o.matched_at,
           o.started_at,
           o.completed_at,
           o.updated_at,
           case
             when o.started_at is null or o.completed_at is null then null
             else greatest(
               0,
               floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
             )
           end as duration_seconds,
           case
             when o.dropoff is null then null
             else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
           end as straight_line_meters
      into v_order
    from orders o
    where o.id = p_order_id and o.assigned_driver_id = v_driver_id;

    v_order_found := found;
    if not v_order_found then
      v_is_driver := false;
    end if;
  end if;

  if not v_order_found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- بطاقةُ الطرفِ الآخر تُقرأُ للرحلةِ المنتهيةِ وحدها: الرحلةُ التي أُلغِيَت بعدَ
  -- إسنادٍ لا تُعرَضُ بطاقةَ سائقٍ فيها ولا بطاقةَ راكبٍ — **إلا القطعَ منَ
  -- السائقِ (WR-31)**: فبطاقةُ الراكبِ هيَ مفتاحُ تقييمِه، والسائقُ يرى من قطعَ
  -- عليهِ الرحلةَ.
  if v_order.status = 'completed' or (v_order.status = 'cancelled' and v_is_driver) then
    if v_is_driver then
      -- منظورُ السائقِ: بطاقةُ الراكبِ — اسمٌ ومتوسِّطٌ وعددٌ. لا هاتفَ ولا معرِّفَ
      -- تلغرام: الاتّصالُ بندٌ له حكمُه لا يُشتَقُّ ههنا (مثل بطاقةِ السائقِ في
      -- منظورِ الراكبِ).
      select u.full_name,
             r.rating_average,
             coalesce(r.rating_count, 0)
        into v_full_name,
             v_rating_average,
             v_rating_count
      from orders o
      join riders r on r.id = o.rider_id
      join users u on u.id = r.user_id
      where o.id = v_order.id;

      v_counterpart_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
      v_direction := 'driver_to_rider';
    elsif v_order.assigned_driver_id is not null then
      -- منظورُ الراكبِ: بطاقةُ السائقِ كما كانت.
      select d.id,
             d.vehicle_type,
             d.plate_number,
             d.rating_average,
             coalesce(d.rating_count, 0),
             u.full_name
        into v_driver_id,
             v_vehicle_type,
             v_plate_number,
             v_rating_average,
             v_rating_count,
             v_full_name
      from drivers d
      join users u on u.id = d.user_id
      where d.id = v_order.assigned_driver_id;

      v_counterpart_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
      v_direction := 'rider_to_driver';
    end if;
  end if;

  -- نافذةُ التقييمِ من الإعدادِ، **وبديلُها مكتوبٌ ههنا وحدَه**:
  begin
    v_window_hours := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  exception when raise_exception then
    v_window_hours := 48;
  end;

  select exists (
    select 1
      from ratings rt
     where rt.order_id = v_order.id
       and rt.direction = v_direction
  ) into v_already_rated;

  -- (WR-31) نافذةُ المقطوعةِ من لحظةِ القطعِ (`updated_at`) لا من ختمِ إكمالٍ
  -- ليسَ لها؛ والراكبُ في الملغاةِ نافذتُهُ مغلقةٌ أصلًا (`can_rate`=false).
  v_window_closed := case
    when v_order.status = 'cancelled' and v_is_driver then
      v_order.updated_at + make_interval(hours => v_window_hours::integer) < now()
    when v_order.completed_at is null then true
    else v_order.completed_at + make_interval(hours => v_window_hours::integer) < now()
  end;

  v_can_rate := (v_order.status = 'completed'
                or (v_order.status = 'cancelled' and v_is_driver))
                and not v_already_rated
                and not v_window_closed;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'matched_at', v_order.matched_at,
    'started_at', v_order.started_at,
    'completed_at', v_order.completed_at,
    'duration_seconds', v_order.duration_seconds,
    'straight_line_meters', v_order.straight_line_meters,
    'driver', case
      when v_is_driver then null
      when v_driver_id is null then null
      else jsonb_build_object(
        'first_name', v_counterpart_name,
        'vehicle_type', v_vehicle_type,
        'plate_number', v_plate_number,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0)
      )
    end,
    'rider', case
      when not v_is_driver then null
      else jsonb_build_object(
        'first_name', v_counterpart_name,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0)
      )
    end,
    'rating', jsonb_build_object(
      'direction', v_direction::text,
      'already_rated', v_already_rated,
      'window_hours', v_window_hours,
      'window_closed', v_window_closed,
      'can_rate', v_can_rate
    )
  );
end;
$fn$;

comment on function completed_ride_summary(bigint, uuid) is
  'F2-07/F12-05/WR-31: ملخَّصُ رحلةٍ منتهيةٍ أو مقطوعةٍ لطرفِها — راكبٌ يرى بطاقةَ سائقِه، وسائقٌ يرى بطاقةَ راكبِه، والقطعُ يفتحُ التقييمَ للسائقِ وحدَه. مدّةٌ ووترُ خطٍّ مستقيمٍ وحالةُ تقييمٍ باتّجاهِه، بلا مالٍ وبلا موقعٍ.';

revoke execute on function completed_ride_summary(bigint, uuid) from public, anon, authenticated;
