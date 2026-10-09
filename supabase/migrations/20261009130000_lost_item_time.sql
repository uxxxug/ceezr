-- migration-phase: expand
-- ============================================================================
-- LOST-AT — الوقتُ التقريبيُّ للفقدِ أو ملاحظتِه في بلاغِ المفقودات (ADR 0253)
--
-- قرارُ المالك (2026-10-09): «وسّع العقد ليشمل الوقت التقريبي للفقد أو ملاحظته، وتتبّع الحقل من
-- الواجهة إلى التحقق والتخزين والقراءة والعرض. اجعله متوافقًا رجعيًا، ولا تخترع وقتًا إذا لم يقدمه
-- المستخدم.»
--
-- ما تُضيفُه (توسّعٌ لا انكماش):
--   ١) `support_tickets.lost_at timestamptz` معدومٌ افتراضاً — لا قيمةَ تُملأُ للتذاكرِ القائمة.
--   ٢) `open_support_ticket_with_lost_at(...)` غلافٌ يتحقّقُ من الوقتِ ثمَّ يُنادي
--      `open_support_ticket` كما هي (لم تُمَسّ: الإصدارُ السابقُ من البوّابةِ يعملُ بلا تغيير)،
--      ويكتبُ الوقتَ على التذكرةِ نفسِها في المعاملةِ نفسِها. الأحكام:
--        · الوقتُ لصنفِ `lost_item` وحدَه، وإلّا `LOST_AT_NOT_ALLOWED`.
--        · لا مستقبلَ (هامشُ ساعةِ جهازٍ خمسُ دقائق)، وإلّا `LOST_AT_IN_FUTURE`.
--        · لا قبلَ إنشاءِ الرحلةِ المملوكةِ نفسِها، وإلّا `LOST_AT_BEFORE_RIDE` — حدٌّ من البيانات
--          لا رقمٌ مخترَع. ورحلةٌ ليست للمُبلِّغِ تُترَكُ لحكمِ `ORDER_NOT_YOURS` في الدالّةِ الأصل.
--   ٣) القراءات: `rider_support_tickets` (الراكب) و`get_support_ticket_context` (بطاقةُ الدعم)
--      و`export_my_data` (حقُّ الوصول) تُعيدُ `lost_at` كما هو أو `null`. لا تغييرَ آخر في نصِّها.
--
-- العودة: `drop function open_support_ticket_with_lost_at(...)` وإعادةُ القراءاتِ الثلاثِ من
-- هجراتِها السابقة، ثمَّ `alter table support_tickets drop column lost_at` في طورِ `contract`.
-- الحالة: منفّذ فعلياً · يحرسُه: tests/integration/lost-item-time.test.ts
-- ============================================================================

alter table support_tickets add column if not exists lost_at timestamptz;

comment on column support_tickets.lost_at is
  'الوقتُ التقريبيُّ للفقدِ أو ملاحظتِه كما قدّمَه صاحبُ بلاغِ `lost_item` (ADR 0253). `null` = لم يقدّمه — لا يُستنتَجُ ولا يُملأ.';

create or replace function public.open_support_ticket_with_lost_at(
  p_telegram_id bigint,
  p_type support_ticket_type,
  p_message text,
  p_file_id text default null::text,
  p_order_id uuid default null::uuid,
  p_lost_at timestamptz default null::timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ride_created timestamptz;
  v_result jsonb;
begin
  if p_lost_at is not null then
    if p_type <> 'lost_item' then
      return jsonb_build_object('ok', false, 'error', 'LOST_AT_NOT_ALLOWED');
    end if;
    if p_lost_at > now() + interval '5 minutes' then
      return jsonb_build_object('ok', false, 'error', 'LOST_AT_IN_FUTURE');
    end if;
    if p_order_id is not null then
      select o.created_at into v_ride_created
        from orders o
        join riders r on r.id = o.rider_id
        join users u on u.id = r.user_id
       where o.id = p_order_id and u.telegram_id = p_telegram_id;
      if v_ride_created is not null and p_lost_at < v_ride_created then
        return jsonb_build_object('ok', false, 'error', 'LOST_AT_BEFORE_RIDE');
      end if;
    end if;
  end if;

  v_result := open_support_ticket(p_telegram_id, p_type, p_message, p_file_id, p_order_id);

  if p_lost_at is not null and (v_result ->> 'ok')::boolean then
    update support_tickets set lost_at = p_lost_at where id = (v_result ->> 'ticket_id')::uuid;
  end if;

  return v_result;
end;
$function$;

comment on function public.open_support_ticket_with_lost_at(bigint, support_ticket_type, text, text, uuid, timestamptz) is
  'غلافُ `open_support_ticket` بوقتِ فقدٍ تقريبيٍّ اختياريّ لصنفِ `lost_item` وحدَه (ADR 0253). بلا وقتٍ = الدالّةُ الأصلُ حرفاً.';

revoke execute on function public.open_support_ticket_with_lost_at(bigint, support_ticket_type, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.open_support_ticket_with_lost_at(bigint, support_ticket_type, text, text, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- القراءات — نصُّها كما في هجراتِها السابقةِ مع حقلِ `lost_at` وحدَه.
-- ---------------------------------------------------------------------------
create or replace function public.rider_support_tickets(p_telegram_id bigint, p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user users%rowtype;
  v_rider_id uuid;
  v_limit integer;
  v_rows jsonb;
  v_count integer;
  v_expected integer;
begin
  -- الحدُّ يُرَدُّ خارجاً لا يُقصَرُ صامتاً (درسُ `F2-08`): طالبُ ألفِ صفٍّ
  -- يُجابُ بعطبٍ يُقرأُ لا بعشرينَ صفّاً يظنُّها ألفاً.
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_OUT_OF_RANGE');
  end if;
  v_limit := p_limit;

  -- مؤشِّرٌ نصفُه ليسَ مؤشِّراً: شطرٌ بلا شطرٍ يُنتِجُ صفحةً غيرَ حتميّةٍ.
  if (p_before_created_at is null) <> (p_before_id is null) then
    return jsonb_build_object('ok', false, 'error', 'CURSOR_INCOMPLETE');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select id into v_rider_id from riders where user_id = v_user.id;
  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_RIDER');
  end if;

  -- **`get_setting` لا `get_setting_number`** عن قصدٍ: الثانيةُ تُطلِقُ
  -- `MISSING_SETTING` فتُسقِطُ القراءةَ كلَّها. وزمنُ الاستجابةِ **قيمةُ عرضٍ**
  -- لا حكمٌ؛ فمدينةٌ فُعِّلَت ولم يُوضَعْ لها الإعدادُ بعدُ تُظهِرُ تذاكرَ
  -- صاحبِها بلا سطرِ زمنٍ — ولا تُحجَبُ تذاكرُه لأجلِ سطرٍ إعلاميٍّ.
  -- وأمّا التهدئةُ فتبقى على `get_setting_number` في `open_support_ticket`:
  -- إعدادٌ **حاكمٌ** غيابُه يجبُ أن يُسقِطَ الفعلَ لا أن يُفتَرَضَ صفراً.
  v_expected := nullif(get_setting(v_user.city_id, 'support_expected_response_minutes') #>> '{}', '')::integer;

  with page as (
    select t.id,
           t.reference,
           t.type::text        as type,
           t.status::text      as status,
           t.message,
           t.resolution,
           t.order_id,
           t.created_at,
           t.resolved_at,
           t.lost_at
      from support_tickets t
     where t.rider_id = v_rider_id
       and (
         p_before_created_at is null
         or (t.created_at, t.id) < (p_before_created_at, p_before_id)
       )
     order by t.created_at desc, t.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc, p.id desc), '[]'::jsonb),
         count(*)::integer
    into v_rows, v_count
    from page p;

  return jsonb_build_object(
    'ok', true,
    'expected_response_minutes', v_expected,
    -- «مزيدٌ» يُعرَفُ بصفٍّ زائدٍ قُرِئَ ولا يُعادُ — لا بعدٍّ ثانٍ للجدولِ.
    'has_more', v_count > v_limit,
    'next_cursor',
      case when v_count > v_limit then jsonb_build_object(
        'created_at', (v_rows -> (v_limit - 1) -> 'created_at'),
        'id',         (v_rows -> (v_limit - 1) -> 'id')
      ) else null end,
    'tickets', case when v_count > v_limit
                    then (select jsonb_agg(e) from jsonb_array_elements(v_rows) with ordinality as x(e, i) where i <= v_limit)
                    else v_rows end
  );
end;
$function$;

create or replace function public.get_support_ticket_context(p_ticket_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ticket support_tickets%rowtype;
  v_user users%rowtype;
  v_city cities%rowtype;
  v_sub subscriptions%rowtype;
begin
  select * into v_ticket from support_tickets where id = p_ticket_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;

  select * into v_city from cities where id = v_ticket.city_id;

  -- صاحب التذكرة: السائق إن وُجد، وإلا العميل
  if v_ticket.driver_id is not null then
    select u.* into v_user from users u join drivers d on d.user_id = u.id
     where d.id = v_ticket.driver_id;
    -- الاشتراك السارِي إن وُجد، وإلا آخر اشتراك مسجَّل ليرى الموظّف السياق كاملاً
    select * into v_sub from subscriptions
     where driver_id = v_ticket.driver_id
     order by (status in ('trialing', 'active')) desc, created_at desc
     limit 1;
  else
    select u.* into v_user from users u join riders r on r.user_id = u.id
     where r.id = v_ticket.rider_id;
  end if;

  if v_user.id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_OWNER_MISSING');
  end if;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', v_ticket.id,
    'type', v_ticket.type,
    'status', v_ticket.status,
    'message', v_ticket.message,
    'attachment_file_id', v_ticket.attachment_file_id,
    'order_id', v_ticket.order_id,
    'group_id', v_city.telegram_support_group_id,
    'city_id', v_ticket.city_id,
    'city_name', v_city.name_ar,
    'created_at', v_ticket.created_at,
    -- LOST-AT · ADR 0253: الوقتُ التقريبيُّ كما قدّمَه صاحبُ البلاغ، أو `null` (لا يُخترَع).
    'lost_at', v_ticket.lost_at,
    -- الهوية: الاسم والهاتف ومعرّف تلغرام دائماً، والمعرّف النصّي إن وُجد فقط
    'full_name', v_user.full_name,
    'phone', v_user.phone,
    'telegram_id', v_user.telegram_id,
    'telegram_username', v_user.telegram_username,
    'language_code', v_user.language_code,
    'driver_id', v_ticket.driver_id,
    'rider_id', v_ticket.rider_id,
    -- حالة الاشتراك لحظةَ القراءة
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'plan', v_sub.plan,
      'status', v_sub.status,
      'current_period_end', v_sub.current_period_end,
      'trial_ends_at', v_sub.trial_ends_at,
      'is_live', v_sub.status in ('trialing', 'active')
                 and (v_sub.current_period_end is null or v_sub.current_period_end > now())
    ) end
  );
end;
$function$;

create or replace function public.export_my_data(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user       users;
  v_rider      riders;
  v_driver     drivers;
  v_city_name  text;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_ERASED');
  end if;

  select * into v_rider from riders where user_id = v_user.id;
  -- **يُقرأُ للدورَينِ**: قد يكونُ لصاحبِ الحسابِ صفُّ سياقةٍ وإن لم يكن دورُه
  -- `driver` (حسابٌ حُوِّلَ)، والحزمةُ تقولُ ما في القاعدةِ لا ما في الدورِ.
  select * into v_driver from drivers where user_id = v_user.id;
  select c.name_ar into v_city_name from cities c where c.id = v_user.city_id;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    -- **الدورُ يُقرأُ من الصفِّ لا يُثبَّتُ نصّاً**: كانَ `'rider'` حرفاً، وحينَ
    -- صارَت الحزمةُ للسائقِ كذلكَ (`SD-12`) لَكانَ نصّاً كاذباً في حزمتِه.
    'subject', v_user.role,
    'sections', jsonb_build_object(

      -- profile ← users. لا `id` ولا `city_id`: معرّفاتٌ داخليّةٌ لا بيانةُ
      -- إنسانٍ، واسمُ المدينةِ هوَ ما يعني صاحبَها.
      'profile', jsonb_build_object(
        'telegram_id', v_user.telegram_id,
        'telegram_username', v_user.telegram_username,
        'full_name', v_user.full_name,
        'phone', v_user.phone,
        'language_code', v_user.language_code,
        'role', v_user.role,
        'city', v_city_name,
        'is_blocked', v_user.is_blocked,
        'created_at', v_user.created_at
      ),

      'riderProfile', case when v_rider.id is null then '{}'::jsonb else jsonb_build_object(
        'rating_average', v_rider.rating_average,
        'rating_count', v_rider.rating_count,
        'created_at', v_rider.created_at
      ) end,

      'savedPlaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sp.kind,
          'label', sp.label,
          'latitude', st_y(sp.point::geometry),
          'longitude', st_x(sp.point::geometry),
          'created_at', sp.created_at
        ) order by sp.created_at)
        from saved_places sp where sp.user_id = v_user.id
      ), '[]'::jsonb),

      -- orders: بلا `assigned_driver_id` ولا اسمِ سائقٍ — حقُّ الوصولِ في
      -- بيانتِه لا نافذةٌ على الطرفِ الآخرِ. ويُنزَّلُ **أنَّ سائقاً أُسنِدَ**
      -- لأنَّ ذاكَ واقعةُ رحلتِه، لا **مَن هوَ**.
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', o.service,
          'status', o.status,
          'pickup_label', o.pickup_label,
          'dropoff_label', o.dropoff_label,
          'pickup_latitude', st_y(o.pickup::geometry),
          'pickup_longitude', st_x(o.pickup::geometry),
          'dropoff_latitude', st_y(o.dropoff::geometry),
          'dropoff_longitude', st_x(o.dropoff::geometry),
          'notes', o.notes,
          'driver_was_assigned', (o.assigned_driver_id is not null),
          'matched_at', o.matched_at,
          'started_at', o.started_at,
          'completed_at', o.completed_at,
          'cancelled_reason', o.cancelled_reason,
          'created_at', o.created_at
        ) order by o.created_at)
        from orders o
        where v_rider.id is not null and o.rider_id = v_rider.id
      ), '[]'::jsonb),

      -- ratings: ما أعطاه وما نالَه. وفي المنالِ **لا مَن كتبَه**.
      'ratings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'role', case when r.rater_user_id = v_user.id then 'given' else 'received' end,
          'stars', r.stars,
          'comment', r.comment,
          'is_flagged', r.is_flagged,
          'created_at', r.created_at
        ) order by r.created_at)
        from ratings r
        where r.rater_user_id = v_user.id or r.ratee_user_id = v_user.id
      ), '[]'::jsonb),

      'consents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', uc.kind,
          'version', uc.version,
          'accepted_at', uc.accepted_at
        ) order by uc.accepted_at)
        from user_consents uc where uc.user_id = v_user.id
      ), '[]'::jsonb),

      'notificationsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', un.kind,
          'channel', un.channel,
          'payload', un.payload,
          'created_at', un.created_at,
          'read_at', un.read_at
        ) order by un.created_at)
        from user_notifications un where un.user_id = v_user.id
      ), '[]'::jsonb),

      -- supportTickets: نصُّ شكواه والرَدُّ عليها. بلا `claimed_by_user_id`
      -- ولا `resolved_by_user_id`: هُويّةُ موظَّفِ الدعمِ ليست بيانتَه.
      'supportTickets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', st.type,
          'message', st.message,
          'status', st.status,
          'resolution', st.resolution,
          'created_at', st.created_at,
          'resolved_at', st.resolved_at,
          'lost_at', st.lost_at
        ) order by st.created_at)
        from support_tickets st
        where st.rider_id is not null and v_rider.id is not null and st.rider_id = v_rider.id
      ), '[]'::jsonb),

      'safetyIncidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reporter_role', si.reporter_role,
          'status', si.status,
          'decision', si.decision,
          'last_known_latitude', st_y(si.last_known_location::geometry),
          'last_known_longitude', st_x(si.last_known_location::geometry),
          'created_at', si.created_at,
          'decided_at', si.decided_at
        ) order by si.created_at)
        from safety_incidents si where si.reporter_user_id = v_user.id
      ), '[]'::jsonb),

      -- auditTrail: الفعلُ وختمُه. **بلا `payload`** — قد يحملُ بيانةَ غيرِه،
      -- ومصدرُ حقيقةِ بيانتِه هوَ الأقسامُ أعلاه لا حِمْلُ سجلٍّ.
      'auditTrail', coalesce((
        select jsonb_agg(jsonb_build_object(
          'action', al.action,
          'entity_type', al.entity_type,
          'created_at', al.created_at
        ) order by al.created_at)
        from audit_log al where al.actor_user_id = v_user.id
      ), '[]'::jsonb),

      -- broadcastsReceived: بلا `chat_id` ولا `claim_token` — معرّفُ محادثةٍ
      -- ورمزٌ نافذٌ. ويُنزَّلُ أنَّه بُلِّغَ ومتى.
      'broadcastsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', br.status,
          'language_code', br.language_code,
          'sent_at', br.sent_at,
          'created_at', br.created_at
        ) order by br.created_at)
        from broadcast_recipients br where br.user_id = v_user.id
      ), '[]'::jsonb),

      -- tripTrackingTokens: **وجودُ** رابطِ مشاركةٍ لا قيمتُه. رمزٌ نافذٌ في
      -- ملفٍّ يُنزَّلُ على جهازٍ هوَ مفتاحٌ عاملٌ بيدِ مَن يقرأُ الملفَّ.
      'tripTrackingTokens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'created_at', tt.created_at,
          'expires_at', tt.expires_at,
          'revoked_at', tt.revoked_at,
          'token_disclosed', false
        ) order by tt.created_at)
        from trip_tracking_tokens tt where tt.created_by_user_id = v_user.id or (tt.created_by_user_id is null and tt.created_by = p_telegram_id)
      ), '[]'::jsonb),

      -- identityBar: **أثرُ حذفٍ سابقٍ إن كانَ**. ولا تُنزَّلُ التجزئةُ نفسُها:
      -- سِلسِلةُ ستّينَ خانةً لا تُفيدُ صاحبَها شيئاً، وإخراجُها يُسلِّمُ لمَن
      -- يقرأُ الملفَّ **مفتاحَ مطابقةٍ** يُثبِتُ به أنَّ فلاناً هوَ فلانٌ.
      -- والمُنزَّلُ هوَ الحكمُ الذي يمسُّه: أمحظورٌ هوَ، وكم مرّةً حُذِفَ،
      -- وهل حُمِلَ تقييمُه (ADR 0113).
      'identityBar', coalesce((
        select jsonb_build_object(
          'is_blocked', im.is_blocked,
          'erasure_count', im.erasure_count,
          'rating_count_carried', im.rating_count,
          'first_marked_at', im.first_marked_at,
          'last_marked_at', im.last_marked_at,
          'hash_disclosed', false
        )
        from identity_marks im
        where im.telegram_hash = identity_hash(p_telegram_id::text)
      ), 'null'::jsonb),

      -- ═══ أقسامُ السائقِ (`SD-12`) ═══════════════════════════════════════
      -- **تُبنى للدورَينِ ولا تُخفى بشرطٍ**: قسمٌ يظهرُ لدورٍ ويغيبُ لدورٍ يجعلُ
      -- شكلَ الحزمةِ مُتغيِّراً، فيكسرُ كلَّ قارئٍ آليٍّ لها. وللراكبِ تُقرأُ
      -- فارغةً — وذاكَ **قولٌ صادقٌ**: لا صفَّ سياقةٍ له.

      'driverProfile', case when v_driver.id is null then '{}'::jsonb else jsonb_build_object(
        'verification_status', v_driver.verification_status,
        'vehicle_type', v_driver.vehicle_type,
        'vehicle_year', v_driver.vehicle_year,
        'plate_number', v_driver.plate_number,
        'national_id_present', (v_driver.national_id is not null),
        'preferred_area_label', v_driver.preferred_area_label,
        'rating_average', v_driver.rating_average,
        'rating_count', v_driver.rating_count,
        'created_at', v_driver.created_at
      ) end,

      -- **رقمُ الهويّةِ لا يُنزَّلُ نصّاً**: صاحبُه يعرفُه، وحزمةُ تنزيلٍ تُرسَلُ
      -- في محادثةٍ تُقرأُ في هاتفٍ مسروقٍ. فيُقالُ **أمُسجَّلٌ هوَ** لا ما هوَ.

      'driverDocuments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'doc_type', dd.doc_type,
          'status', dd.status,
          'expires_at', dd.expires_at,
          'review_note', dd.review_note,
          'submitted_at', dd.submitted_at,
          'reviewed_at', dd.reviewed_at,
          'file_disclosed', false
        ) order by dd.submitted_at)
        from driver_documents dd
        where v_driver.id is not null and dd.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAvailability', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', da.is_available,
          'changed_at', da.changed_at
        ) order by da.changed_at)
        from driver_availability da
        where v_driver.id is not null and da.driver_id = v_driver.id
      ), '[]'::jsonb),

      'groupMemberships', coalesce((
        select jsonb_agg(jsonb_build_object(
          'chat_id', gm.chat_id,
          'status', gm.status,
          'source', gm.source,
          'reason', gm.reason,
          'requested_at', gm.requested_at,
          'decided_at', gm.decided_at
        ) order by gm.requested_at)
        from group_memberships gm
        where v_driver.id is not null and gm.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverCapabilities', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', dc.service,
          'is_enabled', dc.is_enabled,
          'updated_at', dc.updated_at
        ) order by dc.service)
        from driver_capabilities dc
        where v_driver.id is not null and dc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAttendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', al.is_available,
          'source', al.source,
          'changed_at', al.changed_at
        ) order by al.changed_at)
        from attendance_log al
        where v_driver.id is not null and al.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **تاريخُ الموضعِ مُسقَّفٌ والسقفُ مُعلَنٌ في الحزمةِ نفسِها**: صفوفُه
      -- تُكتَبُ كلَّ ثوانٍ، فسائقٌ عملَ شهراً قد يُخرِجُ مئاتَ الآلافِ من
      -- الصفوفِ في `jsonb` واحدٍ — فتسقطُ الدالّةُ بالذاكرةِ ولا يَنزِلُ شيءٌ.
      -- والصادقُ أن يُقالَ للإنسانِ **كم أُخرِجَ وما السقفُ ومن أيِّ طرفٍ**، لا
      -- أن يُقطَعَ صامتاً (`ح-5`).
      'driverLocationHistory', jsonb_build_object(
        'cap', 5000,
        'newest_first', true,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'latitude', st_y(h.position::geometry),
            'longitude', st_x(h.position::geometry),
            'accuracy_m', h.accuracy_m,
            'quality', h.quality,
            'source', h.source,
            'recorded_at', h.recorded_at
          ) order by h.recorded_at desc)
          from (
            select dlh.position, dlh.accuracy_m, dlh.quality, dlh.source, dlh.recorded_at
              from driver_location_history dlh
             where v_driver.id is not null and dlh.driver_id = v_driver.id
             order by dlh.recorded_at desc
             limit 5000
          ) h
        ), '[]'::jsonb)
      ),

      'trackingSessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'started_at', ts.started_at,
          'last_fix_at', ts.last_fix_at,
          'ended_at', ts.ended_at,
          'end_reason', ts.end_reason,
          'fixes', ts.last_sequence
        ) order by ts.started_at)
        from tracking_sessions ts
        where v_driver.id is not null and ts.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **العرضُ يُنزَّلُ ولا يُنزَّلُ معَه طلبُ راكبٍ**: القرارُ واقعةُ السائقِ،
      -- وموضعُ الراكبِ ووجهتُه بيانةُ غيرِه.
      'orderOffers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'round', oo.round,
          'status', oo.status,
          'distance_km', oo.distance_km,
          'expires_at', oo.expires_at,
          'responded_at', oo.responded_at,
          'created_at', oo.created_at
        ) order by oo.created_at)
        from order_offers oo
        where v_driver.id is not null and oo.driver_id = v_driver.id
      ), '[]'::jsonb),

      'unsubscribedClaims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', uc.position,
          'outcome', uc.outcome,
          'opened_at', uc.opened_at,
          'closed_at', uc.closed_at
        ) order by uc.opened_at)
        from unsubscribed_claims uc
        where v_driver.id is not null and uc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'plan', s.plan,
          'status', s.status,
          'trial_ends_at', s.trial_ends_at,
          'current_period_end', s.current_period_end,
          'price_amount', s.price_amount,
          'currency', s.currency,
          'cancel_at_period_end', s.cancel_at_period_end,
          'cancellation_requested_at', s.cancellation_requested_at,
          'cancellation_reason', s.cancellation_reason,
          'created_at', s.created_at
        ) order by s.created_at)
        from subscriptions s
        where v_driver.id is not null and s.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionInvoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'invoice_number', si.invoice_number,
          'invoice_year', si.invoice_year,
          'amount_minor', si.amount_minor,
          'currency', si.currency,
          'plan', si.plan,
          'issued_at', si.issued_at
        ) order by si.issued_at)
        from subscription_invoices si
        where v_driver.id is not null and si.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionRefunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'amount_minor', sr.amount_minor,
          'currency', sr.currency,
          'destination', sr.destination,
          'reason', sr.reason,
          'reference', sr.reference,
          'created_at', sr.created_at
        ) order by sr.created_at)
        from subscription_refunds sr
        where v_driver.id is not null and sr.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الرصيدُ لا يُحسَبُ ههنا**: مصدرُ حقيقتِه `subscription_wallet_balance`،
      -- وجمعٌ ثانٍ في دالّةِ تنزيلٍ يجعلُ للمالِ حسابَينِ (القاعدة 0.6).
      'subscriptionWallets', case when v_driver.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', sw.currency,
          'created_at', sw.created_at,
          'balance', subscription_wallet_balance(sw.driver_id)
        ))
        from subscription_wallets sw
        where sw.driver_id = v_driver.id
      ), '[]'::jsonb) end,

      'subscriptionWalletEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_kind', swe.entry_kind,
          'direction', swe.direction,
          'amount_minor', swe.amount_minor,
          'currency', swe.currency,
          'reason', swe.reason,
          'reference', swe.reference,
          'created_at', swe.created_at
        ) order by swe.created_at)
        from subscription_wallet_entries swe
        where v_driver.id is not null and swe.driver_id = v_driver.id
      ), '[]'::jsonb),

      'paymentTransactions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'purpose', pt.purpose,
          'amount_minor', pt.amount_minor,
          'currency', pt.currency,
          'provider', pt.provider,
          'status', pt.status,
          'created_at', pt.created_at
        ) order by pt.created_at)
        from payment_transactions pt
        where v_driver.id is not null and pt.payer_driver_id = v_driver.id
      ), '[]'::jsonb),

      'ledgerEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_type', le.entry_type,
          'amount_minor', le.amount_minor,
          'currency', le.currency,
          'created_at', le.created_at
        ) order by le.created_at)
        from ledger_entries le
        where v_driver.id is not null and le.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الصادرُ يُنزَّلُ حالاً لا مضموناً**: `payload` فيه بيانةُ طلبٍ لراكبٍ
      -- ونصُّ رسالةٍ، وإخراجُه يجعلُ حزمةَ السائقِ نافذةً على غيرِه.
      'notificationsSent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', no2.kind,
          'status', no2.status,
          'attempts', no2.attempts,
          'delivered_at', no2.delivered_at,
          'error_code', no2.error_code,
          'created_at', no2.created_at,
          'payload_disclosed', false
        ) order by no2.created_at)
        from notification_outbox no2
        where (v_driver.id is not null and no2.driver_id = v_driver.id)
           or no2.recipient_user_id = v_user.id
      ), '[]'::jsonb),

      'subscriptionNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sn.kind,
          'status', sn.status,
          'attempts', sn.attempts,
          'sent_at', sn.sent_at,
          'error_code', sn.error_code,
          'created_at', sn.created_at
        ) order by sn.created_at)
        from subscription_notices sn
        where v_driver.id is not null and sn.driver_id = v_driver.id
      ), '[]'::jsonb)
    )
  );
end;
$function$;
