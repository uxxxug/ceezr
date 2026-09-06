-- ============================================================================
-- الغرض: BUG-004 — نقلُ إخطارَي صاحبِ الطلبِ العالقِ إلى صندوقِ الصادرِ الموحَّدِ:
--   «الانتقالُ إلى دائرةٍ أوسعَ» و«لا سائقَ». كانا يُرسَلانِ من مسارِ المسحِ بعدَ
--   عودةِ الدالّةِ الذرّيةِ، فإن تعطّلَ تيليجرامُ لحظتَها فُتحت الدورةُ أو سُلِّمت
--   بطاقةُ الإسنادِ وبقيَ صاحبُ الطلبِ صامتًا بلا كلمةٍ — وحارسُ التسليمِ يمنعُ كلَّ
--   إعادةٍ، فالصمتُ أبديٌّ. صارَ الإيداعُ داخلَ المعاملةِ والتسليمُ للعامل.
-- الحالة: منفّذ فعلياً — 2026-09-06.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: open_unsubscribed_cycle، mark_escalation_delivered (الإيداعُ)،
--   وclaim_notification_delivery (الإغناءُ الحيُّ من الطلبِ وصاحبِه).
-- ملاحظات مستقبلية: مُستلِمٌ واحدٌ لهذين النوعَينِ — صاحبُ الطلبِ وحدَه — فصفٌّ
--   واحدٌ لكلٍّ منهما، ومفتاحُ المنعِ بالطلبِ فلا رسالتانِ عن خبرٍ واحدٍ.
-- ============================================================================

-- 1) النوعانِ يُضافانِ إلى القيدِ، ولكلٍّ منهما منادٍ يكتبُه في هذه الهجرةِ.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found'
  ));

-- ----------------------------------------------------------------------------
-- enqueue_rider_order_notification: صفٌّ واحدٌ لصاحبِ الطلبِ بمفتاحِ منعٍ بالطلبِ
--   نفسِه. تُنادى داخلَ معاملةِ الدالّةِ الذرّيةِ فيرجعُ الصفُّ معها إن رجعت.
--   تُرجعُ true إن أُودِعَ فعلًا، وfalse إن كان مودَعًا سلفًا — لا خبرَ مكرَّرَ.
--   والحمولةُ معرّفٌ واحدٌ: المحادثةُ واللغةُ والخدمةُ تُقرأُ حيّةً في الالتقاطِ.
-- ----------------------------------------------------------------------------
create or replace function enqueue_rider_order_notification(
  p_city_id  uuid,
  p_kind     text,
  p_order_id uuid,
  p_extra    jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := enqueue_notification(
    p_city_id,
    p_kind,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object('order_id', p_order_id::text),
    p_kind || ':' || p_order_id::text
  );
  return v_id is not null;
end;
$$;

grant execute on function enqueue_rider_order_notification(uuid, text, uuid, jsonb)
  to service_role;
revoke execute on function enqueue_rider_order_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- claim_notification_delivery: يُزادُ فرعُ الإغناءِ للنوعَينِ — محادثةُ صاحبِ
--   الطلبِ ولغتُه ونوعُ خدمتِه كما هي في القاعدةِ لحظةَ الالتقاطِ.
-- ----------------------------------------------------------------------------
create or replace function claim_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery notification_outbox%rowtype;
  v_token uuid := gen_random_uuid();
  v_max integer;
  v_timeout integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
  v_claim record;
  v_rider record;
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  -- استرجاعُ الحجوزِ المتروكة: عاملٌ مات قبل أن يُعلن نتيجته ترك الصفَّ في sending.
  -- يُلغى رمزُ الحجز القديم فلو عاد العاملُ الميّت أعلنَ نتيجته ردّته finish بـNOT_CLAIMED.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
   order by n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  if v_delivery.kind = 'offer' then
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text
           )
      into v_payload
      from order_offers o where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    -- صنفُ صاحبِ التذكرةِ جزءٌ من الحمولةِ لا تفصيلٌ داخليٌّ: الرسالةُ الخاصّةُ يجبُ
    -- أن تصلَه من البوتِ الذي يحاورُه هو، فمن يُرسِلُ يُختارُ بصنفِه لا بواحدٍ ثابتٍ.
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end
      into v_owner_telegram, v_owner_language, v_owner_kind
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind
    );
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    select c.negotiation_id, c.order_id, c.position,
           du.telegram_id::text as driver_chat_id, du.language_code as driver_language,
           ru.telegram_id::text as rider_chat_id, ru.language_code as rider_language,
           get_setting_number(c.city_id, 'unsubscribed_negotiate_seconds')::integer as seconds
      into v_claim
      from unsubscribed_claims c
      join drivers d on d.id = c.driver_id
      join users du on du.id = d.user_id
      join orders o on o.id = c.order_id
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where c.id = (v_delivery.payload->>'claim_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'negotiation_id', v_claim.negotiation_id,
      'order_id', v_claim.order_id,
      'position', v_claim.position,
      'deadline_seconds', v_claim.seconds,
      'chat_id', case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end,
      'language', coalesce(
        case when v_delivery.payload->>'side' = 'driver'
             then v_claim.driver_language else v_claim.rider_language end,
        'ar'
      )
    );
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found') then
    -- صاحبُ الطلبِ يُقرأُ حيًّا: محادثتُه ولغتُه ونوعُ خدمتِه. ونصُّ «لا سائق» يختلفُ
    -- في التوصيلِ عنه في النقلِ، فالنوعُ جزءٌ من الحمولةِ لا اجتهادٌ في الطبقةِ.
    select ru.telegram_id::text as chat_id, ru.language_code as language,
           o.service::text     as service
      into v_rider
      from orders o
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where o.id = (v_delivery.payload->>'order_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar'),
      'service', v_rider.service
    );
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'payload', coalesce(v_payload, '{}'::jsonb)
    ))
    from notification_outbox n where n.id = v_delivery.id
  );
end $$;

grant execute on function claim_notification_delivery() to service_role;
revoke execute on function claim_notification_delivery() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- open_unsubscribed_cycle: نفسُ الحكمِ ونفسُ القيودِ حرفًا بحرفٍ، والزيادةُ إيداعُ
--   خبرِ الدائرةِ الأوسعِ للدورةِ الأولى وحدَها، ومردٌّ يقولُ أُودِعَ أم لا.
-- ----------------------------------------------------------------------------
create or replace function open_unsubscribed_cycle(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      orders%rowtype;
  v_now        timestamptz := now();
  v_cycle      integer;
  v_max_cycles integer;
  v_collect    integer;
  v_group      bigint;
  v_prev_id    uuid;
  v_excluded   uuid[] := array[]::uuid[];
  v_new_id     uuid;
  v_queued     boolean := false;
begin
  select * into v_order
    from orders
   where id = p_order_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- دورة القروب لا تُفتح إلا لطلب ما زال يبحث فعلاً
  if v_order.status <> 'searching' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_SEARCHING');
  end if;

  -- القروب شرط: مدينة بلا معرّف قروب غير مشتركين لا تُنشر فيها بطاقة
  select telegram_unsubscribed_drivers_group_id into v_group
    from cities where id = v_order.city_id;
  if v_group is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_GROUP_MISSING');
  end if;

  -- دورة حيّة قائمة؟ لا نفتح ثانية فوقها
  if exists (
    select 1 from unsubscribed_negotiations
     where order_id = p_order_id and status in ('collecting', 'negotiating')
  ) then
    return jsonb_build_object('ok', false, 'error', 'CYCLE_ALREADY_OPEN');
  end if;

  v_max_cycles := get_setting_number(v_order.city_id, 'unsubscribed_max_cycles')::integer;
  v_collect    := get_setting_number(v_order.city_id, 'unsubscribed_collect_seconds')::integer;

  select coalesce(max(cycle), 0) + 1 into v_cycle
    from unsubscribed_negotiations where order_id = p_order_id;

  -- نفدت الدورات: هذا هو مدخل قروب الإسناد، لا حلقة لا نهائية
  if v_cycle > v_max_cycles then
    return jsonb_build_object('ok', false, 'error', 'CYCLES_EXHAUSTED',
                              'cycles', v_cycle - 1);
  end if;

  -- سائقو الدورة المباشرة السابقة ممنوعون من التسجيل في هذه
  if v_cycle > 1 then
    select id into v_prev_id
      from unsubscribed_negotiations
     where order_id = p_order_id and cycle = v_cycle - 1;
    select coalesce(array_agg(driver_id), array[]::uuid[]) into v_excluded
      from unsubscribed_claims where negotiation_id = v_prev_id;
  end if;

  insert into unsubscribed_negotiations
    (city_id, order_id, cycle, status, collect_deadline)
  values
    (v_order.city_id, p_order_id, v_cycle, 'collecting',
     v_now + make_interval(secs => v_collect))
  returning id into v_new_id;

  -- الدورةُ الأولى وحدَها خبرٌ لصاحبِ الطلبِ (BUG-004): الانتقالُ إلى دائرةٍ أوسعَ
  -- يُودَعُ في معاملةِ فتحِ الدورةِ نفسِها، فلا تُفتحُ دورةٌ ويبقى صاحبُها صامتًا
  -- لتعطّلِ تيليجرامَ لحظتَها. وما بعدَ الأولى إعادةُ محاولةٍ لا خبرٌ جديدٌ.
  if v_cycle = 1 then
    v_queued := enqueue_rider_order_notification(
      v_order.city_id, 'wider_circle_opened', p_order_id
    );
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, null, 'unsubscribed.cycle_opened', 'order', p_order_id,
          jsonb_build_object('negotiation_id', v_new_id, 'cycle', v_cycle,
                             'excluded_driver_ids', to_jsonb(v_excluded)));

  return jsonb_build_object(
    'ok', true,
    'negotiation_id', v_new_id,
    'cycle', v_cycle,
    'city_id', v_order.city_id,
    'service', v_order.service,
    'group_id', v_group,
    'collect_deadline', v_now + make_interval(secs => v_collect),
    'excluded_driver_ids', to_jsonb(v_excluded),
    'notification_queued', v_queued
  );
end;
$$;

grant execute on function open_unsubscribed_cycle(uuid) to service_role;
revoke execute on function open_unsubscribed_cycle(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- mark_escalation_delivered: نفسُ الحارسِ حرفًا بحرفٍ — أوّلُ تسليمٍ يقعُ مرّةً
--   واحدةً داخلَ صفٍّ مقفولٍ — والزيادةُ إيداعُ إخطارِ «لا سائقَ» في المعاملةِ
--   نفسِها. وعليه لا يُعَدُّ التسليمُ تامًّا وصاحبُ الطلبِ لم يُخبَر.
-- ----------------------------------------------------------------------------
create or replace function mark_escalation_delivered(
  p_order_id   uuid,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_city   uuid;
  v_queued boolean := false;
begin
  select id into v_id
    from audit_log
   where entity_type = 'order' and entity_id = p_order_id
     and action = 'order.escalated'
     and coalesce((payload->>'delivered')::boolean, true) = false
   order by created_at asc
   limit 1
     for update;

  if v_id is null then
    -- لا أثرَ غيرَ مسلَّم: إمّا سُلِّم في شوطٍ سابق وإمّا لم يُصعَّد الطلبُ قطّ.
    -- الحالتان لا تُخبران الراكب ثانياً، والفرقُ بينهما لا يغيّر تصرّفَ النداء.
    return jsonb_build_object('ok', true, 'first_delivery', false);
  end if;

  update audit_log
     set payload = payload
                 || jsonb_build_object('delivered', true)
                 || case when p_message_id is null then '{}'::jsonb
                         else jsonb_build_object('message_id', p_message_id) end
   where id = v_id;

  -- أوّلُ تسليمٍ للبطاقةِ هو الموضعُ الوحيدُ الذي يُخبَرُ فيه صاحبُ الطلبِ، فيُودَعُ
  -- إخطارُه في معاملةِ هذا الانتقالِ نفسِها (BUG-004): كان الإخطارُ يُرسَلُ بعدَها من
  -- مسارِ المسحِ، فإن تعطّلَ تيليجرامُ لحظتَها بقيَ الأثرُ «مسلَّمًا» والحارسُ يمنعُ
  -- كلَّ إعادةٍ — طلبٌ يتيمٌ صامتٌ إلى الأبد.
  select city_id into v_city from orders where id = p_order_id;
  if v_city is not null then
    v_queued := enqueue_rider_order_notification(v_city, 'no_driver_found', p_order_id);
  end if;

  return jsonb_build_object('ok', true, 'first_delivery', true,
                            'notification_queued', v_queued);
end;
$$;

grant execute on function mark_escalation_delivered(uuid, text) to service_role;
revoke execute on function mark_escalation_delivered(uuid, text)
  from public, anon, authenticated;
