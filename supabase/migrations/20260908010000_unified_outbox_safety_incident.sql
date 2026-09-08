-- =============================================================================
-- F6-03 / BUG-004: توحيدُ صندوقِ صادرِ الاستغاثةِ في notification_outbox.
-- الحالة: منفّذ (مرحلةُ التوسيعِ). ينتمي إلى: supabase/migrations.
-- يبني على: ADR-0061 (صندوقُ الصادرِ الموحَّدُ لكلِّ التسليمات).
-- يُتوقع أن يستخدمه لاحقاً: apps/workers/src/jobs/deliver-safety-incidents.ts.
--
-- ## ما تُغيّره هذه الهجرة
--
-- `safety_incident_deliveries` كانت صندوقَ صادرٍ مستقلًّا لحوادثِ SOS: تُودَعُ فيه
-- الصفوفُ مباشرةً في trigger_sos، وتُطالَبُ بـclaim_safety_incident_delivery الذي
-- يفحصُ حتى 100 مرشّحاً ويتخطّى غيرَ المُهيّأة ويُرجِعُها في deferred، ويُنهيها
-- بـfinish_safety_incident_delivery. وهذا يكسرُ معيارَ F6-03: «موحّدٌ ظاهرٌ في
-- القاعدة» — فحالةُ التسليمِ كانت في جدولٍ رابعٍ مستقلٍّ.
--
-- الآن يصيرُ `notification_outbox` هو المصدرَ الوحيدَ لحالةِ تسليمِ الاستغاثةِ:
-- - يُضافُ نوعُ `safety_incident` إلى قيدِ النوعِ.
-- - trigger_sos يُودِعُ الصفَّ في notification_outbox بـdedup_key = 'safety_incident:'||incident_id.
-- - claim_safety_incident_delivery يصيرُ غلافًا يفحصُ notification_outbox حيث
--   kind='safety_incident'، محافظًا على سلوكِ scan-skip-defer حرفًا بحرفٍ.
-- - finish_safety_incident_delivery يُحدِّثُ notification_outbox.
--
-- ## ما لا تُغيّره
--
-- جدولُ `safety_incident_deliveries` لا يُسقَطُ ههنا: مرحلةُ التوسيعِ تُبقيه
-- (يُسقَطُ في هجرةِ التقليصِ اللاحقة بعدَ استقرارِ التسليمِ من المصدرِ الموحَّد).
-- trigger_sos لم يَعُدْ يكتبُ فيه، فيبقى فارغًا في المساراتِ الجديدةِ. والدوالُّ
-- القديمةُ (claim/finish) صارت أغلفةً على notification_outbox فلا تنكسرُ شيفرةُ
-- العاملِ ولا الاختباراتُ دفعةً واحدةً — لكنّ الاختباراتِ التي تُؤكِّدُ على
-- safety_incident_deliveries تُحدَّثُ لتُؤكِّدَ على notification_outbox.
--
-- ## العودة
--
-- توسيعٌ (expand) لا كسرٌ: إضافةُ نوعٍ وأعمدةٍ (لا أعمدةُ هنا) وأغلفةٍ. لا تُسقَطُ
-- مِلكيّةٌ ولا يُضيَّقُ شيءٌ. والعودةُ بالكودِ وحدَه: نسخةُ الشيفرةِ السابقةُ تُودِعُ
-- في safety_incident_deliveries فلا تجدُ الصفَّ في notification_outbox — فلا
-- تُنشَرُ الهجرةُ دونَ كودِها ولا يُرجَعُ الكودُ دونَ إرجاعِ الدوالِّ معه.
-- =============================================================================

-- ١. قيدُ النوعِ: إضافةُ safety_incident.
alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled',
    'safety_incident'
  ));

-- ٢. trigger_sos: الإيداعُ في notification_outbox بدلَ safety_incident_deliveries.
--    بقيةُ المنطقِ (for update على orders، التحقّقُ من المُبلِّغ، قفلُ النافذةِ
--    الاستشاريُّ، إنشاءُ الحادثِ) منسوخٌ حرفًا بحرفٍ ولم يُمَسَّ مفتاحٌ من مفاتيحِ
--    المُرجَعِ القديمةِ (ok/incident_id/created/error).
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
  v_location geography(Point, 4326);
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); end if;
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_FOUND'); end if;
  if v_actor.is_blocked then return jsonb_build_object('ok', false, 'error', 'ACTOR_BLOCKED'); end if;
  if p_reporter_role not in ('rider', 'driver') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_REPORTER_ROLE');
  end if;
  if p_reporter_role = 'rider' and not exists (
    select 1 from riders r where r.id = v_order.rider_id and r.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_OWNED'); end if;
  if p_reporter_role = 'driver' and not exists (
    select 1 from drivers d where d.id = v_order.assigned_driver_id and d.user_id = v_actor.id
  ) then return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ASSIGNED'); end if;
  if not exists (
    select 1 from cities
     where id = v_order.city_id and is_active and telegram_escalation_group_id is not null
  ) then
    return jsonb_build_object('ok', false, 'error', 'ESCALATION_GROUP_MISSING');
  end if;
  select greatest(1, (value #>> '{}')::integer) into v_window
    from platform_settings where city_id = v_order.city_id and key = 'sos_dedup_window_seconds';
  if v_window is null then return jsonb_build_object('ok', false, 'error', 'SOS_DEDUP_SETTING_MISSING'); end if;
  perform pg_advisory_xact_lock(hashtext('sos:' || p_order_id::text || ':' || v_actor.id::text));
  select * into v_incident from safety_incidents
   where order_id = v_order.id and reporter_user_id = v_actor.id
     and created_at >= now() - make_interval(secs => v_window)
   order by created_at desc limit 1 for update;
  if found then
    -- إعادةُ التسليمِ ضمنَ النافذةِ: إن وُجدَ صفُّ تسليمٍ للحادثِ فلا شيءَ (on conflict)،
    -- وإلّا يُودَعُ صفٌّ جديدٌ في الصندوقِ الموحَّد.
    insert into notification_outbox (city_id, kind, dedup_key, payload)
      values (v_incident.city_id, 'safety_incident', 'safety_incident:' || v_incident.id::text,
              jsonb_build_object('incident_id', v_incident.id))
      on conflict (kind, dedup_key) do nothing;
    return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', false);
  end if;
  if p_reporter_role = 'driver' then
    select d.last_location into v_location from drivers d
      where d.id = v_order.assigned_driver_id;
  else
    v_location := v_order.pickup;
  end if;
  insert into safety_incidents(city_id, order_id, reporter_user_id, reporter_role, last_known_location)
    values (v_order.city_id, v_order.id, v_actor.id, p_reporter_role, v_location)
    returning * into v_incident;
  insert into notification_outbox (city_id, kind, dedup_key, payload)
    values (v_order.city_id, 'safety_incident', 'safety_incident:' || v_incident.id::text,
            jsonb_build_object('incident_id', v_incident.id));
  return jsonb_build_object('ok', true, 'incident_id', v_incident.id, 'created', true);
end $$;

-- ٣. claim_safety_incident_delivery: غلافٌ يفحصُ notification_outbox حيث
--    kind='safety_incident'، محافظًا على سلوكِ scan-skip-defer حرفًا بحرفٍ.
--    المُرجَعُ كما كان: {ok, deferred, delivery} بنفسِ الحقولِ (delivery_id,
--    incident_id, claim_token, group_id, order_id, service, reporter_role, status,
--    location_wkt, max_attempts).
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
      join orders o on o.id = i.order_id
     where n.id = v_candidate.id
    );
  end loop;

  -- لا شيء صالحٌ للمطالبة: إمّا الطابور فارغ، وإمّا كلّ ما فيه ناقص الإعداد.
  return jsonb_build_object('ok', true, 'delivery', null, 'deferred', v_deferred);
end $$;

comment on function claim_safety_incident_delivery() is
  'يطالب بأقدم تسليم استغاثة مكتمل الإعداد من notification_outbox (kind=safety_incident)، ويُبلّغ عن كل صفٍّ تخطّاه لنقص إعداد مدينته في deferred بدل إسقاط الشوط كلّه.';

-- ٤. finish_safety_incident_delivery: يُحدِّثُ notification_outbox. معرّفُ الرسالةِ
--    bigint يُمرَّرُ كما هو (delivered_message_id نصٌّ فيُخزَنُ بصريحِه). السلوكُ
--    محفوظٌ: النجاحُ يُثبِّتُ delivered، والفشلُ يُعيدُ الصفَّ pending بموعدٍ جديد.
create or replace function finish_safety_incident_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_message_id bigint, p_delivered boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_retry integer;
begin
  if p_delivered then
    update notification_outbox
       set status = 'delivered', delivered_message_id = p_message_id::text,
           delivered_at = now(), claim_token = null, claimed_at = null
     where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  else
    select greatest(1, (s.value #>> '{}')::integer) into v_retry
      from notification_outbox n join platform_settings s on s.city_id = n.city_id
     where n.id = p_delivery_id and s.key = 'sos_delivery_retry_seconds';
    if v_retry is null then return jsonb_build_object('ok', false, 'error', 'SOS_RETRY_SETTING_MISSING'); end if;
    update notification_outbox
       set status = 'pending', claim_token = null, claimed_at = null,
           next_attempt_at = now() + make_interval(secs => v_retry)
      where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;
  end if;
  return jsonb_build_object('ok', found);
end $$;

-- ٥. إعادةُ قفلِ سطحِ definer بعدَ create or replace لكلِّ دالّةٍ مُعادَةِ التعريف.
revoke execute on function trigger_sos(uuid, bigint, text) from public, anon, authenticated;
grant execute on function trigger_sos(uuid, bigint, text) to service_role;
revoke execute on function claim_safety_incident_delivery() from public, anon, authenticated;
grant execute on function claim_safety_incident_delivery() to service_role;
revoke execute on function finish_safety_incident_delivery(uuid, uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function finish_safety_incident_delivery(uuid, uuid, bigint, boolean) to service_role;
