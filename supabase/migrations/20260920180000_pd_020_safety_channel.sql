-- migration-phase: expand
--
-- الغرض: قناةُ السلامةِ تُجيبُ أسئلتَها الثلاثةَ (البندُ `PD-020` · خارطةُ دَينِ
--   المنتَجِ §4 الصفُّ الأوّلُ): **أُنشئَ؟ سُلِّمَ؟ اطَّلعَ؟** — ثلاثةُ توسعاتٍ
--   بلا حالةِ قاعدةٍ جديدةٍ وبلا تغييرِ حالةِ رحلةٍ:
--   ١) عمودُ `reason` على `safety_incidents` يميِّزُ بلاغَ «تعذَّرَ الإكمالُ»
--      عن استغاثةِ السلامةِ — فريقُ الإسنادِ يقرأُ بلاغاً تشغيليّاً يستدعي
--      قراراً، لا طوارئَ تُستنفَرُ لها الاستجابةُ السريعةُ.
--   ٢) دالّةُ `trigger_sos` تُوسَّعُ بمعاملٍ رابعٍ (`p_reason`، افتراضيُّهُ `sos`)
--      **كتحميلٍ زائدٍ جديدٍ** لا استبدالاً: الدالّةُ الثلاثيّةُ القائمةُ
--      تبقى كما هيَ — تعريفُ التوقيعِ القديمِ تغييرٌ في العقدِ لا توسعةٌ فيه،
--      وكلُّ نادٍ قائمٍ (بوتُ `F8-05` · بوّابةُ الراكبِ) يبقى يصلُ إلى ما كانَ
--      يصلُ إليهِ بالمعنى نفسِه.
--   ٣) خرجُ `sos_surface_state` ينشرُ حالةَ تسليمِ البلاغِ
--      (`team_delivery_status`: `pending`/`delivered`) من صفِّ
--      `notification_outbox` القائمِ للبلاغِ ذاتِهِ — فصلُ «استُقبِلَ» (تسليمٌ
--      يُقاسُ بمعرِّفِ رسالةٍ) عن «اطَّلعَ» (مطالبةٌ بشريّةٌ تضبطُ `received`
--      منذُ `SEC12`).
--   ومعَها غلافٌ رابعٌ: `driver_cannot_complete` — فعلُ السائقِ الذي لا يملكُ
--   فعلاً يُعلِنُ عجزَهُ عن إكمالِ مهمّتِهِ.
-- الحالة: منفَّذٌ فعليّاً — 2026-09-20.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/safety/safety-adapters.ts` (التفعيلُ
--   بالسببِ) · `packages/infrastructure/safety/sos-surface-store.ts` (قراءةُ
--   حالةِ التسليمِ) · غلافُ السائقِ في `packages/infrastructure/driver/` .
-- الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
--
-- ## لماذا لا حالةَ خامسةً في `safety_incidents.status`
--
-- `received` عندنا **مطالبةٌ بشريّةٌ** منذُ `20260916210100` (تضبطُها معَ
-- `claimed_by_user_id`)، فإضافةُ حالةٍ «مسلَّم» كانت ستُعيدَ تسميةَ مفهومٍ
-- قائمٍ وتُكسِرَ كلَّ قارئٍ لهُ. التسليمُ **وقيعةٌ أخرى** لحادثٍ قائمٍ:
-- صفُّ صادرٍ في `notification_outbox` يُنشأُ معَ البلاغِ في العمليةِ
-- الذرّيّةِ نفسِها (لا حالةَ «لا صفَّ» تُعرَضُ)، ولهُ حالٌ يُقاسُ بمعرِّفِ
-- رسالةٍ فعليةٍ — فيُنشَرُ حقلًّا دلاليّاً مستقلًّا لا حالةً خامسةً.
--
-- ## ولماذا `driver_cannot_complete` لا يغيِّرُ حالةَ الطلبِ
--
-- جدولُ الانتقالاتِ يسمحُ نظريّاً بـ`matched→searching` و`in_progress→cancelled`،
-- لكن لا كاتبًا قائمًا يفتحُ الطلبَ من جديدٍ بإخطارِ الراكبِ، واختراعُ كاتبٍ
-- تحتَ بندِ سلامةٍ قرارُ سياسةٍ لا قرارُ قناةٍ. فالفعلُ **بلاغٌ مرتبطٌ
-- بالمهمّةِ** يصلُ قروبَ الإسنادِ ببطاقةٍ يقولُ ماذا حدث، والفريقُ البشريُّ
-- يتولّى الإسنادَ كما يتولّاهُ اليومَ — لا يُقصَّرُ النطاقُ ولا يُوسَّعُ.
--
-- ## وما لا يفعله هذا الترحيلُ عن قصدٍ
--
--   ــ **لا يغيِّرُ منطقَ المطالبةِ والإغلاقِ** (`SEC12`): `claim` وحدَها
--      تضبطُ `received`، والقرارُ البشريُّ يبقى كما هوَ.
--   ــ **لا يحذفُ الدالّةَ الثلاثيّةَ**: تحميلٌ زائدٌ رابعُ معاملاتِهِ يُضافُ،
--      والقديمُ يُبقى — توسيعٌ لا تقليصٌ (`ح-8`).
--   ــ **لا ينشرُ لغةَ صندوقِ الصادرِ خامًا**: `pending`/`delivered` قيمتانِ
--      دلاليّتانِ للسطحِ؛ حالُ `sending` العابرُ يُقرَأُ «لم يُسلَّمْ بعدُ»
--      لأنّهُ ما يزالَ كذلكَ فعلاً.
--
-- set local search_path = public; -- (تُدار المعاملةُ من مشغّلِ الهجراتِ)

-- ───────────────────────────────────────────────────────────────────────────
-- ١) عمودُ السببِ — توسيعٌ بلا حالةٍ قاعدةٍ جديدةٍ
-- ───────────────────────────────────────────────────────────────────────────
alter table safety_incidents
  add column if not exists reason text not null default 'sos'
    check (reason in ('sos', 'driver_cannot_complete'));

comment on column safety_incidents.reason is
  'جنسُ البلاغِ: استغاثةُ سلامةٍ (`sos`) أو تعذُّرُ إكمالٍ من السائقِ (`driver_cannot_complete`) — البطاقةُ المُرسَلةُ لقروبِ الإسنادِ تُميِّزُ بينَهما، فالأولى طوارئُ سلامةٍ والثانيةُ عملٌ تشغيليٌّ ينتظرُ قرارَ إسنادٍ (PD-020 · ADR 0159).';

-- ───────────────────────────────────────────────────────────────────────────
-- ٢) `trigger_sos` الرباعيّةُ — تحميلٌ زائدٌ بمعاملِ سببٍ افتراضيٍّ
--
-- الجسدُ منسوخٌ من الدالّةِ الثلاثيّةِ في `20260918010000` حرفاً بحرفٍ ما
-- عدا موضعَينِ: التحققِ من قيمةِ السببِ، وإيداعِهِ معَ الحادثِ. والقديمةُ
-- تبقى تعملُ بما كانت تعملُ بهِ.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function trigger_sos(
  p_order_id uuid,
  p_actor_telegram_id bigint,
  p_reporter_role text,
  p_reason text default 'sos'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_actor users%rowtype;
  v_incident safety_incidents%rowtype;
  v_window integer;
  v_post_ride_minutes integer;
  v_location geography(Point, 4326);
  /** `true` = بلاغٌ لا يُنسَبُ إلى طلبٍ. رايةٌ واحدةٌ لا فرعٌ مكرَّرٌ. */
  v_orderless boolean := false;
  /** المدينةُ الحاكمةُ: مدينةُ الطلبِ إن كانَ، وإلّا مدينةُ الحسابِ. */
  v_city uuid;
begin
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;
  if p_reason not in ('sos', 'driver_cannot_complete') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INCIDENT_REASON');
  end if;

  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;

  if p_order_id is null then
    if p_reporter_role = 'rider' then
      select o.* into v_order
        from orders o
        join riders r on r.id = o.rider_id
       where r.user_id = v_actor.id
         and is_active_order_status(o.status)
       order by o.created_at desc
       limit 1
         for update of o;
    else
      select o.* into v_order
        from orders o
        join drivers d on d.id = o.assigned_driver_id
       where d.user_id = v_actor.id
         and is_driver_engaged_order_status(o.status)
       order by o.created_at desc
       limit 1
         for update of o;
    end if;

    if not found then
      if p_reporter_role = 'rider' then
        select o.* into v_order
          from orders o
          join riders r on r.id = o.rider_id
         where r.user_id = v_actor.id
           and not is_active_order_status(o.status)
         order by coalesce(o.completed_at, o.updated_at) desc
         limit 1
           for update of o;
      else
        select o.* into v_order
          from orders o
          join drivers d on d.id = o.assigned_driver_id
         where d.user_id = v_actor.id
           and not is_driver_engaged_order_status(o.status)
         order by coalesce(o.completed_at, o.updated_at) desc
         limit 1
           for update of o;
      end if;
      -- **ههنا كانَ الرفضُ، وههنا صارَ الفرعُ الثالثُ.** ولا يُقرأُ `v_order`
      -- بعدَها في هذا الفرعِ: صفٌّ منتهٍ خارجَ النافذةِ يبقى في المتغيّرِ
      -- بحكمِ plpgsql، ونسبةُ بلاغٍ إليه كذبٌ في السياقِ.
      if not found then
        v_orderless := true;
      else
        v_post_ride_minutes := (sos_post_ride_window(v_order.city_id) ->> 'minutes')::integer;
        if coalesce(v_order.completed_at, v_order.updated_at)
             < now() - make_interval(mins => v_post_ride_minutes) then
          v_orderless := true;
        end if;
      end if;
    end if;
  else
    select * into v_order from orders where id = p_order_id for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); end if;
  end if;

  if v_orderless then
    v_city := v_actor.city_id;
  else
    -- الملكيّةُ تبقى حكماً مكتوباً لا ضمناً في شكلِ الاستعلامِ: في فرعِ الحلِّ
    -- يمرُّ الشرطُ بحكمِ الوصلِ، وفي فرعِ المُعرِّفِ الصريحِ هوَ الحاجزُ الوحيدُ.
    if p_reporter_role = 'rider' and not exists (
      select 1 from riders r where r.id = v_order.rider_id and r.user_id = v_actor.id
    ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_OWNED'); end if;
    if p_reporter_role = 'driver' and not exists (
      select 1 from drivers d where d.id = v_order.assigned_driver_id and d.user_id = v_actor.id
    ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ASSIGNED'); end if;
    v_city := v_order.city_id;
  end if;

  if not exists (
    select 1 from cities
     where id = v_city and is_active and telegram_escalation_group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'ESCALATION_GROUP_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_window
    from platform_settings where city_id = v_city and key = 'sos_dedup_window_seconds';
  if v_window is null then return jsonb_build_object('ok', false, 'error', 'SOS_DEDUP_SETTING_MISSING'); end if;

  -- قفلٌ استشاريٌّ لكلِّ فرعٍ بمفتاحِه: مفتاحُ «بلا طلبٍ» لا يُزاحِمُ نداءَ
  -- رحلةٍ قائمةٍ للشخصِ نفسِه، وهما بلاغانِ مختلفانِ لا بلاغٌ مكرَّرٌ.
  if v_orderless then
    perform pg_advisory_xact_lock(hashtext('sos:no-order:' || v_actor.id::text));
    select * into v_incident from safety_incidents
     where order_id is null and reporter_user_id = v_actor.id
       and created_at >= now() - make_interval(secs => v_window)
     order by created_at desc limit 1 for update;
  else
    perform pg_advisory_xact_lock(hashtext('sos:' || v_order.id::text || ':' || v_actor.id::text));
    select * into v_incident from safety_incidents
     where order_id = v_order.id and reporter_user_id = v_actor.id
       and created_at >= now() - make_interval(secs => v_window)
     order by created_at desc limit 1 for update;
  end if;
  if found then
    insert into notification_outbox (city_id, kind, dedup_key, payload)
      values (v_incident.city_id, 'safety_incident', 'safety_incident:' || v_incident.id::text,
              jsonb_build_object('incident_id', v_incident.id))
      on conflict (kind, dedup_key) do nothing;
    return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', false);
  end if;

  -- الموقعُ: **ما يُعرَفُ فعلاً** لا ما يُشتَهى. وبلا رحلةٍ لا نقطةَ التقاطٍ،
  -- فراكبٌ بلا طلبٍ يُبلِّغُ بلا موقعٍ — ويُفصَحُ عن ذلكَ قبلَ الضغطِ.
  if p_reporter_role = 'driver' then
    if v_orderless then
      select d.last_location into v_location from drivers d where d.user_id = v_actor.id;
    else
      select d.last_location into v_location from drivers d
        where d.id = v_order.assigned_driver_id;
    end if;
  elsif v_orderless then
    v_location := null;
  else
    v_location := v_order.pickup;
  end if;

  insert into safety_incidents(city_id, order_id, reporter_user_id, reporter_role, reason, last_known_location)
    values (v_city,
            case when v_orderless then null::uuid else v_order.id end,
            v_actor.id, p_reporter_role, p_reason, v_location)
    returning * into v_incident;
  insert into notification_outbox (city_id, kind, dedup_key, payload)
    values (v_city, 'safety_incident', 'safety_incident:' || v_incident.id::text,
            jsonb_build_object('incident_id', v_incident.id));
  return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', true);
end $$;

comment on function trigger_sos(uuid, bigint, text, text) is
  'يُقيِّدُ استغاثةً أو بلاغَ تعذُّرٍ ويُودِعُ تسليمَها في المعاملةِ نفسِها. و p_order_id = null معناهُ: حُلَّ الطلبَ القائمَ، فإن لم يكن فآخرُ رحلةٍ انتهت ضمنَ النافذةِ، فإن لم تكن فبلاغٌ بلا طلبٍ بمدينةِ الحسابِ. و p_reason يميِّزُ جنسَ البلاغِ (sos افتراضياً · driver_cannot_complete) فتُختارُ لهُ بطاقةُ الفريقِ المناسبةُ — والدالّةُ الثلاثيّةُ القائمةُ تُحاكي هذا النداءَ بـsos (F8-05 · F2-10 · F12-03 · PD-020 · ADR 0077 · ADR 0111 · ADR 0145 · ADR 0159).';

revoke execute on function trigger_sos(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function trigger_sos(uuid, bigint, text, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- ٣) `driver_cannot_complete` — فعلُ السائقِ: بلاغٌ لا انتقالُ حالةٍ
--
-- نمطُ إخوتهِ (`driver_start_ride`): تُحَلُّ الهويّةُ للتمييزِ بينَ الرموزِ،
-- وتُفحَصُ المِلكيّةُ والإسنادُ الجاريُ، ثمَّ يُفوَّضُ كلُّ الذرّيّةِ إلى
-- `trigger_sos` الرباعيّةِ ويُنقّى الجوابُ مما لا يحتاجُهُ السطحُ.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function driver_cannot_complete(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_result jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- مهمّةٌ جاريةٌ **لهذا السائقِ**: الفعلُ يظهرُ على سطحِ مهمّةٍ قائمة، فطلبهُ
  -- على مهمّةٍ انتهت أو ليست لهُ يُرَدُّ برمزِ المهمّةِ لا برمزِ مِلكيّةٍ —
  -- والفرقُ بينَهما يقرؤُهُ السائقُ «المهمّةُ لم تعد قائمةً» فيُحدِّثُ شاشَتَه.
  if not exists (
    select 1 from orders o
     where o.id = p_order_id
       and o.assigned_driver_id = v_driver.id
       and is_driver_engaged_order_status(o.status)
       for update of o
  ) then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- **ههنا يقفُ حدُّ هذا الغلافِ**: لا تحديثَ لحالةِ الطلبِ ولا سجلَّ
  -- إسنادٍ ولا إخطارَ راكبٍ — كلُّ ذلكَ قرارُ الفريقِ البشريِّ بعدَ أن يقرأَ
  -- البطاقةَ. الغلافُ يُوصِلُ الخبرَ لا يبتُّ بهِ.
  v_result := trigger_sos(p_order_id, p_telegram_id, 'driver', 'driver_cannot_complete');

  if coalesce((v_result->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'incident_id', v_result->>'incident_id',
      'created', (v_result->>'created')::boolean
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', case v_result->>'error'
      when 'ACTOR_NOT_FOUND' then 'USER_NOT_FOUND'
      when 'ACTOR_BLOCKED' then 'ACTOR_BLOCKED'
      when 'ESCALATION_GROUP_MISSING' then 'ESCALATION_GROUP_MISSING'
      when 'SOS_DEDUP_SETTING_MISSING' then 'SOS_DEDUP_SETTING_MISSING'
      else 'TRANSITION_REFUSED'
    end
  );
end;
$fn$;

comment on function driver_cannot_complete(bigint, uuid) is
  'فعلُ «تعذَّرَ الإكمالُ» من سطحِ مهمّةِ السائقِ: بلاغُ سلامةٍ مرتبطٌ بالمهمّةِ الجاريةِ بالدورِ driver وبالسببِ driver_cannot_complete — لا يغيِّرُ حالةَ الطلبِ ولا يُخطِرُ الراكبَ؛ بطاقةٌ تصلُ قروبَ الإسنادِ وقرارُ الإسنادِ يبقى للفريقِ البشريِّ (PD-020 · ADR 0159 · ADR 0118).';

revoke execute on function driver_cannot_complete(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_cannot_complete(bigint, uuid) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- ٤) `claim_safety_incident_delivery` — السببُ ينزلُ معَ البطاقةِ
--
-- المنطقُ كلُّه منسوخٌ حرفاً بحرفٍ من `20260918010000` وما تُغيِّرُهُ هذه
-- الجولةُ **حقلٌ واحدٌ** يُضافُ إلى الحمولةِ: `reason` من صفِّ الحادثِ.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function claim_safety_incident_delivery()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate record;
  v_token uuid := gen_random_uuid();
  v_group bigint;
  v_max integer;
  v_deferred jsonb := '[]'::jsonb;
  v_scanned integer := 0;
  c_scan_limit constant integer := 100;
begin
  for v_candidate in
    select n.id, n.city_id, (n.payload->>'incident_id')::uuid as incident_id
      from notification_outbox n
     where n.kind = 'safety_incident'
       and n.status = 'pending'
       and n.next_attempt_at <= now()
     order by n.created_at
       for update skip locked
     limit c_scan_limit
  loop
    v_scanned := v_scanned + 1;
    v_group := null;
    v_max := null;

    select c.telegram_escalation_group_id into v_group
      from cities c where c.id = v_candidate.city_id;
    if v_group is null then
      v_deferred := v_deferred || jsonb_build_object(
        'delivery_id', v_candidate.id, 'city_id', v_candidate.city_id,
        'reason', 'ESCALATION_GROUP_MISSING'
      );
      continue;
    end if;

    select greatest(1, (value #>> '{}')::integer) into v_max
      from platform_settings
     where city_id = v_candidate.city_id and key = 'sos_delivery_max_attempts';
    if v_max is null then
      v_deferred := v_deferred || jsonb_build_object(
        'delivery_id', v_candidate.id, 'city_id', v_candidate.city_id,
        'reason', 'SOS_RETRY_SETTING_MISSING'
      );
      continue;
    end if;

    update notification_outbox
       set status = 'sending', attempts = attempts + 1,
           claim_token = v_token, claimed_at = now()
     where id = v_candidate.id;

    return (
      select jsonb_build_object('ok', true, 'deferred', v_deferred, 'delivery', jsonb_build_object(
        'delivery_id', n.id, 'incident_id', i.id, 'claim_token', v_token,
        'group_id', v_group::text, 'order_id', o.id, 'service', o.service::text,
        'reporter_role', i.reporter_role, 'status', i.status, 'reason', i.reason,
        'location_wkt', case
          when i.last_known_location is null then null
          else st_astext(i.last_known_location::geometry) end,
        'max_attempts', v_max
      ))
      from notification_outbox n
      join safety_incidents i on i.id = (n.payload->>'incident_id')::uuid
      left join orders o on o.id = i.order_id
     where n.id = v_candidate.id
    );
  end loop;

  -- لا شيء صالحٌ للمطالبة: إمّا الطابور فارغ، وإمّا كلّ ما فيه ناقص الإعداد.
  return jsonb_build_object('ok', true, 'delivery', null, 'deferred', v_deferred);
end $$;

comment on function claim_safety_incident_delivery() is
  'يطالب بأقدم تسليم استغاثة مكتمل الإعداد من notification_outbox (kind=safety_incident)، ويُبلّغ عن كل صفٍّ تخطّاه لنقص إعداد مدينته في deferred بدل إسقاط الشوط كلّه. والوصلُ بـorders خارجيٌّ: بلاغٌ بلا طلبٍ (F12-03) يُسلَّمُ ولا يُخفى صمتاً. ومعَ الحادثِ ينزلُ سببُهُ `reason` فتُختارُ البطاقةُ المناسبةُ (PD-020 · ADR 0159).';

revoke execute on function claim_safety_incident_delivery() from public, anon, authenticated;
grant execute on function claim_safety_incident_delivery() to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- ٥) `sos_surface_state` — حالةُ التسليمِ تنزلُ معَ البلاغِ القائمِ
--
-- الجسدُ منسوخٌ من `20260918010000` حرفاً بحرفٍ ما عدا بناءَ `v_incident_json`:
-- يُضافُ `team_delivery_status` مشتقًّا من صفِّ التسليمِ القائمِ للحادثِ
-- ذاتِهِ. **مسلَّمٌ** وحدهُ يستحقُّ الاسمَ: صفٌّ `sending` ما يزالُ في
-- الطريقِ فيُقرَأُ «لم يُسلَّمْ بعدُ»، وصفٌّ لا وجودَ لهُ محالٌ (يُودَعُ معَ
-- الحادثِ في المعاملةِ نفسِها) فإن وقعَ قُرِئَ «لم يُسلَّمْ» — لا عطبًا.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function sos_surface_state(
  p_actor_telegram_id bigint,
  p_reporter_role text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_actor users%rowtype;
  v_order orders%rowtype;
  v_incident safety_incidents%rowtype;
  v_window jsonb;
  v_minutes integer;
  v_ended_at timestamptz;
  v_origin text;
  v_dedup integer;
  v_has_location boolean;
  v_reason text;
  v_eligible boolean;
  v_disclosure jsonb;
  v_incident_json jsonb;
  v_orderless boolean := false;
  v_city uuid;
begin
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;

  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;

  if p_reporter_role = 'rider' then
    select o.* into v_order
      from orders o
      join riders r on r.id = o.rider_id
     where r.user_id = v_actor.id
       and is_active_order_status(o.status)
     order by o.created_at desc
     limit 1;
  else
    select o.* into v_order
      from orders o
      join drivers d on d.id = o.assigned_driver_id
     where d.user_id = v_actor.id
       and is_driver_engaged_order_status(o.status)
     order by o.created_at desc
     limit 1;
  end if;

  if found then
    v_origin := 'ACTIVE_ORDER';
  else
    if p_reporter_role = 'rider' then
      select o.* into v_order
        from orders o
        join riders r on r.id = o.rider_id
       where r.user_id = v_actor.id
         and not is_active_order_status(o.status)
       order by coalesce(o.completed_at, o.updated_at) desc
       limit 1;
    else
      select o.* into v_order
        from orders o
        join drivers d on d.id = o.assigned_driver_id
       where d.user_id = v_actor.id
         and not is_driver_engaged_order_status(o.status)
       order by coalesce(o.completed_at, o.updated_at) desc
       limit 1;
    end if;
    if found then
      v_window := sos_post_ride_window(v_order.city_id);
      v_minutes := (v_window ->> 'minutes')::integer;
      v_ended_at := coalesce(v_order.completed_at, v_order.updated_at);
      if v_ended_at >= now() - make_interval(mins => v_minutes) then
        v_origin := 'RECENT_ORDER';
      else
        v_origin := null;
      end if;
    else
      v_origin := null;
    end if;
  end if;

  -- **ههنا كانت البطاقةُ تُخفي نفسَها، وههنا صارَ البابُ مفتوحاً.**
  if v_origin is null then
    v_origin := 'NO_ORDER';
    v_orderless := true;
    v_window := null;
  end if;

  if v_orderless then
    v_city := v_actor.city_id;
  else
    v_city := v_order.city_id;
    if v_window is null then
      v_window := sos_post_ride_window(v_order.city_id);
    end if;
  end if;

  -- الموانعُ تُفحَصُ بالترتيبِ الذي تفحصُه به `trigger_sos` نفسُها.
  v_eligible := true;
  v_reason := v_origin;
  if not exists (
    select 1 from cities
     where id = v_city and is_active and telegram_escalation_group_id is not null
  ) then
    v_eligible := false;
    v_reason := 'ESCALATION_GROUP_MISSING';
  else
    select greatest(1, (value #>> '{}')::integer) into v_dedup
      from platform_settings where city_id = v_city and key = 'sos_dedup_window_seconds';
    if v_dedup is null then
      v_eligible := false;
      v_reason := 'SOS_DEDUP_SETTING_MISSING';
    end if;
  end if;

  -- حادثُ **هذا الفرعِ** لهذا المُبلِّغِ وحدَه: بلاغُ رحلةٍ لا يُعرَضُ حالاً
  -- لبلاغٍ بلا رحلةٍ ولا العكسُ، فهما بلاغانِ لا واحدٌ.
  if v_orderless then
    select * into v_incident from safety_incidents
     where order_id is null and reporter_user_id = v_actor.id
     order by created_at desc limit 1;
  else
    select * into v_incident from safety_incidents
     where order_id = v_order.id and reporter_user_id = v_actor.id
     order by created_at desc limit 1;
  end if;
  if found then
    v_incident_json := jsonb_build_object(
      'id', v_incident.id,
      'status', v_incident.status,
      -- «استُقبِلَ» يُقاسُ بمعرِّفِ رسالةٍ فعليةٍ لا بوعدٍ: صفُّ التسليمِ
      -- يُودَعُ معَ الحادثِ في العمليةِ الذرّيّةِ نفسِها، فحالُهُ هنا
      -- وقيعةٌ مقروءةٌ لا وعدٌ.
      'team_delivery_status', case when exists (
        select 1 from notification_outbox n
         where n.kind = 'safety_incident'
           and (n.payload->>'incident_id')::uuid = v_incident.id
           and n.status = 'delivered'
      ) then 'delivered' else 'pending' end,
      'age_seconds', greatest(0, floor(extract(epoch from (now() - v_incident.created_at)))::integer)
    );
  else
    v_incident_json := null;
  end if;

  -- الإفصاحُ: ما **سيُكتَبُ فعلاً** لا ما يُقالُ عادةً. وبلا رحلةٍ يُنزَعُ
  -- «مرجعُ الرحلةِ» ويُقالُ صراحةً إنَّهُ لا يُرسَلُ، ويُسمّى **فريقُ مدينةِ
  -- الحسابِ** لا «مدينتُكَ» مبهمةً: مسافرٌ يظنُّها مدينتَه الحاليّةَ.
  if v_orderless then
    if p_reporter_role = 'driver' then
      select d.last_location is not null into v_has_location
        from drivers d where d.user_id = v_actor.id;
    else
      v_has_location := false;
    end if;
    v_disclosure := jsonb_build_array(
      case when coalesce(v_has_location, false)
        then 'SOS_SHARES_LAST_LOCATION' else 'SOS_NO_LOCATION_AVAILABLE' end,
      'SOS_NO_ORDER_REFERENCE',
      'SOS_SHARES_ROLE',
      'SOS_NOTIFIES_ACCOUNT_CITY_TEAM',
      'SOS_NO_PHONE_CALL'
    );
  else
    if p_reporter_role = 'driver' then
      select d.last_location is not null into v_has_location
        from drivers d where d.id = v_order.assigned_driver_id;
    else
      v_has_location := v_order.pickup is not null;
    end if;
    v_disclosure := jsonb_build_array(
      case when coalesce(v_has_location, false)
        then 'SOS_SHARES_LAST_LOCATION' else 'SOS_NO_LOCATION_AVAILABLE' end,
      'SOS_SHARES_ORDER_REFERENCE',
      'SOS_SHARES_ROLE',
      'SOS_NOTIFIES_CITY_TEAM',
      'SOS_NO_PHONE_CALL'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', p_reporter_role,
    'order_id', case when v_orderless then null::uuid else v_order.id end,
    'origin', v_origin,
    'eligible', v_eligible,
    'reason', v_reason,
    'post_ride_window_minutes', case when v_orderless then null::integer
      else (v_window ->> 'minutes')::integer end,
    'post_ride_window_source', case when v_orderless then null::text
      else v_window ->> 'source' end,
    'incident', v_incident_json,
    'disclosure', v_disclosure
  );
end;
$fn$;

comment on function sos_surface_state(bigint, text) is
  'حَكَمُ سطحِ الاستغاثةِ: جوازُ النداءِ وأصلُه (رحلةٌ قائمةٌ · رحلةٌ انتهت في النافذةِ · بلا رحلةٍ بمدينةِ الحسابِ)، وحالُ بلاغِ الفرعِ وعُمرُه بساعةِ القاعدةِ، وحالُ تسليمِهِ إلى الفريقِ (team_delivery_status: pending/delivered — «استُقبِلَ» يُفصَلُ عن «اطَّلعَ» التي تضبطُها المطالبةُ البشريّةُ وحدَها)، وقائمةُ الإفصاحِ رموزاً — قراءةٌ واحدةٌ ذرّيّةٌ (F2-10 · F12-03 · PD-020 · SR-14 · ADR 0111 · ADR 0145 · ADR 0159).';

revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;
grant execute on function sos_surface_state(bigint, text) to service_role;
