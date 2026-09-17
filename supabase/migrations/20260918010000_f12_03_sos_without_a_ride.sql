-- =============================================================================
-- migration-phase: expand
-- الغرض: `F12-03` — **أيقونةُ الطوارئِ لا تشترطُ رحلةً**. يُرخى قيدُ
--   `safety_incidents.order_id` إلى `null`، ويُزادُ أصلٌ ثالثٌ `NO_ORDER` إلى
--   حَكَمِ السطحِ وحاكمِه، ويُصلَحُ وصلٌ داخليٌّ في مطالبةِ التسليمِ كانَ
--   سيُخفي بلاغاً بلا طلبٍ صمتاً.
-- الحالة: منفّذ فعلياً — 2026-09-18.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: packages/infrastructure/safety/sos-surface-store.ts
--             · packages/infrastructure/safety/safety-adapters.ts
--             ← packages/application/safety/*
--             ← apps/gateway/src/routes/safety.ts · apps/workers (تسليمُ الإخطارِ)
-- الحاكم: docs/adr/0145-an-emergency-does-not-require-a-ride.md
--         وسابقاه القائمانِ: docs/adr/0077-sos-intake-resolves-its-own-order.md
--         و docs/adr/0111-sos-surface-is-a-judged-card-not-a-button.md
--
-- ## العطبُ الأوّلُ: البابُ كانَ مشروطاً برحلةٍ، والخطرُ ليسَ مشروطاً بها
--
-- `F2-10` فتحَ **نافذةَ ما بعدَ الرحلةِ**، وصرَّحَ في حجزِه أنَّ «حادثاً بلا
-- طلبٍ ألبتّةَ» يبقى ديناً باسمِ `F12-03`. والدَّينُ ليسَ حالةً نظريّةً: راكبٌ
-- يُهدَّدُ في الطريقِ إلى موعدِ ركوبِه، وسائقٌ يُعتدى عليه بينَ رحلتَينِ،
-- وراكبٌ انقضَت نافذتُه بساعةٍ — كلُّ هؤلاءِ يقرؤونَ اليومَ `NO_ACTIVE_ORDER`
-- **وهم في الخطرِ الذي بُنيَ الزرُّ له**. فالشرطُ الذي جعلَ البلاغَ يُنسَبُ إلى
-- رحلةٍ كانَ **راحةَ تنفيذٍ** (المدينةُ وقروبُ التصعيدِ يُقرآنِ من الطلبِ)، وقد
-- صارَ اليومَ حاجزاً أمامَ صاحبِ الحقِّ.
--
-- ### ومصدرُ المدينةِ **قائمٌ لا مُختَرَعٌ**
--
-- حُجّةُ `F2-10` على تأخيرِ هذا البندِ أنَّ حادثاً بلا طلبٍ «يُوجِبُ مصدرَ
-- مدينةٍ ثانياً». والقراءةُ اليومَ تقولُ إنَّ المصدرَ **موجودٌ منذُ المخطَّطِ
-- الأوّلِ**: `users.city_id uuid not null references cities(id)`. فلا عمودَ
-- يُضافُ، ولا جدولَ، ولا تخمينَ من إحداثيّاتٍ: مدينةُ الحسابِ هيَ المدينةُ،
-- **ويُفصَحُ عن ذلكَ صراحةً** برمزِ `SOS_NOTIFIES_ACCOUNT_CITY_TEAM` كي لا يظنَّ
-- مسافرٌ أنَّ فريقَ المدينةِ التي هوَ فيها الآنَ هوَ الذي سيصلُه.
--
-- ## العطبُ الثاني وهوَ الأخطرُ: بلاغٌ يُقيَّدُ ولا يُسلَّمُ **صمتاً**
--
-- `claim_safety_incident_delivery` كانت تقولُ `join orders o on o.id = i.order_id`
-- — **وصلٌ داخليٌّ**. وما دامَ العمودُ `not null` فالوصلُ يُطابِقُ دائماً،
-- فالعطبُ كانَ **كامناً لا واقعاً**. ولحظةَ يُرخى القيدُ يصيرُ واقعاً وبأسوأِ
-- صورةٍ: الدالّةُ تُحدِّثُ الصفَّ إلى `sending` **قبلَ** جملةِ الإرجاعِ، فلو
-- لم يُطابِقِ الوصلُ عادَ `null` وبقيَ صفُّ الصندوقِ عالقاً في `sending`
-- بختمِ مطالبةٍ لا يحملُها أحدٌ — لا `pending` يُعادُ، ولا خطأٌ يُرى، ولا
-- إنسانٌ يعرفُ أنَّ نداءَه لم يُسلَّمْ. فيُقلَبُ إلى `left join`، ويُنشَرُ
-- `order_id`/`service` **`null` صريحاً** لا فراغاً مُلفَّقاً.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
--   ــ **لا تربطُ بمركزِ البلاغاتِ الموحَّدِ**: لا مزوِّدَ ولا واجهةَ جهةٍ، وذاكَ
--      شقُّ `F12-01`/`F12-02` بيدِ المالكِ. وهذه الهجرةُ تُبقي البابَ مفتوحاً
--      وتُخطِرُ فريقَ المدينةِ، ولا تدَّعي مكالمةً.
--   ــ **لا تُلغي نافذةَ ما بعدَ الرحلةِ**: الأصلانِ الأوّلانِ يُجرَّبانِ أوّلاً
--      بالترتيبِ نفسِه، وبلاغٌ يُنسَبُ إلى رحلةٍ أصدقُ من بلاغٍ بلا سياقٍ.
--   ــ **لا تمسُّ سطحَ الدعمِ**: `claim_safety_incident`/`resolve_safety_incident`
--      كما هما، وقرارُ الإغلاقِ والحجبِ بشريٌّ كما كانَ.
--   ــ **لا تعرفُ مالاً ولا أجرةً** (`DEC-11`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ١) إرخاءُ القيدِ. **توسيعٌ لا تضييقٌ**: كلُّ صفٍّ قائمٍ يبقى صالحاً، وكلُّ
--    قارئٍ يشترطُ طلباً يُصلَحُ في هذه الدفعةِ نفسِها (نشرٌ مقرونٌ).
-- -----------------------------------------------------------------------------
alter table safety_incidents alter column order_id drop not null;

-- والفهرسُ الجزئيُّ لمسارِ منعِ التكرارِ بلا طلبٍ في **ملفٍّ وحدَه**
-- (`20260918010100_f12_03_orderless_sos_index.sql`): `create index concurrently`
-- لا تُقبَلُ داخلَ معاملةٍ، وفهرسٌ بقفلٍ مانعٍ للكتابةِ على جدولِ الاستغاثةِ
-- توقُّفُ خدمةٍ (`CAP-007`).

-- -----------------------------------------------------------------------------
-- ٢) `trigger_sos` — التوقيعُ نفسُه والرموزُ نفسُها، ويُزادُ فرعُ «بلا طلبٍ».
--
-- الترتيبُ محفوظٌ حرفاً: طلبٌ قائمٌ، ثمَّ منتهٍ داخلَ النافذةِ، ثمَّ — وهذا
-- الجديدُ — **الحسابُ نفسُه**. والمِلكيّةُ لا تُفحَصُ في الفرعِ الثالثِ لأنَّه
-- لا يُنسَبُ إلى شيءٍ يُملَكُ: المُبلِّغُ يُبلِّغُ عن نفسِه، والحجبُ
-- (`is_blocked`) و«منعُ التكرارِ» و`block_reporter` هيَ حواجزُ الإساءةِ ههنا.
-- -----------------------------------------------------------------------------
create or replace function trigger_sos(
  p_order_id uuid,
  p_actor_telegram_id bigint,
  p_reporter_role text
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

  insert into safety_incidents(city_id, order_id, reporter_user_id, reporter_role, last_known_location)
    values (v_city,
            case when v_orderless then null::uuid else v_order.id end,
            v_actor.id, p_reporter_role, v_location)
    returning * into v_incident;
  insert into notification_outbox (city_id, kind, dedup_key, payload)
    values (v_city, 'safety_incident', 'safety_incident:' || v_incident.id::text,
            jsonb_build_object('incident_id', v_incident.id));
  return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', true);
end $$;

comment on function trigger_sos(uuid, bigint, text) is
  'يُقيِّدُ استغاثةً ويُودِعُ تسليمَها في المعاملةِ نفسِها. و p_order_id = null معناهُ: حُلَّ الطلبَ القائمَ، فإن لم يكن فآخرُ رحلةٍ انتهت ضمنَ النافذةِ، فإن لم تكن فبلاغٌ بلا طلبٍ بمدينةِ الحسابِ (F8-05 · F2-10 · F12-03 · ADR 0077 · ADR 0111 · ADR 0145).';

revoke execute on function trigger_sos(uuid, bigint, text) from public, anon, authenticated;
grant execute on function trigger_sos(uuid, bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- ٣) `sos_surface_state` — الحَكَمُ يوافقُ الحاكمَ حرفاً، فيُزادُ فيه الأصلُ
--    الثالثُ نفسُه. **وأيُّ افتراقٍ ههنا زرٌّ يظهرُ ثمَّ يُرفَضُ.**
--
-- و`NO_ACTIVE_ORDER` **يبقى في مجالِ الأسبابِ ولا يُحذَفُ** (`ح-8`): الدالّةُ
-- لم تعُدْ تنشرُه بعدَ هذه الهجرةِ، وحذفُ الرمزِ من النطاقِ كانَ سيُسقِطُ
-- قراءةَ صفٍّ من قاعدةٍ لم تُهاجَرْ بعدُ. والمُعلَنُ: ما يُنشَرُ اليومَ ثلاثةٌ
-- (`NO_ORDER` جوازاً · `ESCALATION_GROUP_MISSING` · `SOS_DEDUP_SETTING_MISSING`).
-- -----------------------------------------------------------------------------
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
      'age_seconds', greatest(0, floor(extract(epoch from (now() - v_incident.created_at)))::integer)
    );
  else
    v_incident_json := null;
  end if;

  -- الإفصاحُ: ما **سيُكتَبُ فعلاً** لا ما يُقالُ عادةً. وبلا رحلةٍ يُنزَعُ
  -- «مرجعُ الرحلةِ» ويُقالُ صراحةً إنَّه لا يُرسَلُ، ويُسمّى **فريقُ مدينةِ
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
  'حَكَمُ سطحِ الاستغاثةِ: جوازُ النداءِ وأصلُه (رحلةٌ قائمةٌ · رحلةٌ انتهت في النافذةِ · بلا رحلةٍ بمدينةِ الحسابِ)، وحالُ بلاغِ الفرعِ وعُمرُه بساعةِ القاعدةِ، وقائمةُ الإفصاحِ رموزاً — قراءةٌ واحدةٌ ذرّيّةٌ (F2-10 · F12-03 · SR-14 · ADR 0111 · ADR 0145).';

revoke execute on function sos_surface_state(bigint, text) from public, anon, authenticated;
grant execute on function sos_surface_state(bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- ٤) `claim_safety_incident_delivery` — **`left join` لا `join`**.
--
-- المنطقُ كلُّه منسوخٌ حرفاً بحرفٍ من `20260908010000` (المسحُ والتخطّي
-- والتأجيلُ وحدُّ المسحِ والختمُ) ولم يُمَسَّ منه شرطٌ ولا حدٌّ. والتغييرُ
-- **كلمةٌ واحدةٌ**: `left join` مكانَ `join`. وبها يصيرُ `order_id`/`service`
-- في الحمولةِ `null` بحكمِ الوصلِ الخارجيِّ نفسِه — لا نصّاً مُلفَّقاً ولا صفّاً
-- عالقاً. وقد تُحقَّقُ هذه الدعوى آليّاً بقاعدةٍ سابعةٍ في حاجزِ العقدِ.
-- -----------------------------------------------------------------------------
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
        'reporter_role', i.reporter_role, 'status', i.status,
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
  'يطالب بأقدم تسليم استغاثة مكتمل الإعداد من notification_outbox (kind=safety_incident)، ويُبلّغ عن كل صفٍّ تخطّاه لنقص إعداد مدينته في deferred بدل إسقاط الشوط كلّه. والوصلُ بـorders خارجيٌّ: بلاغٌ بلا طلبٍ (F12-03) يُسلَّمُ ولا يُخفى صمتاً.';

revoke execute on function claim_safety_incident_delivery() from public, anon, authenticated;
grant execute on function claim_safety_incident_delivery() to service_role;
