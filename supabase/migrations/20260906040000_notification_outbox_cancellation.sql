-- ============================================================================
-- الغرض: BUG-004 — نقلُ إخطارِ إلغاءِ صاحبِ الطلبِ إلى صندوقِ الصادرِ الموحَّدِ.
--   كان الإلغاءُ يُلغي العروضَ ويُغلقُ التفاوضَ ويكتبُ الأثرَ في معاملةٍ واحدةٍ، ثمّ
--   يُعيدُ قائمةَ من يجبُ إخطارُهم ليُرسِلَ لهم مسارُ البوتِ بعدَ الـcommit. فإن
--   تعطّلَ تيليجرامُ لحظتَها — أو مات العاملُ بينَ الـcommit والحلقةِ — بقيت بطاقةُ
--   العرضِ في محادثةِ السائقِ تدعوه إلى قبولِ طلبٍ لا وجودَ له، وبقيَ السائقُ
--   المُسنَدُ سائرًا إلى موعدٍ أُلغي: لا إعادةَ ولا أثرَ لِما لم يُرسَل. صارَ الإيداعُ
--   داخلَ معاملةِ الإلغاءِ نفسِها والتسليمُ للعاملِ بإعادةٍ محكومةٍ.
-- الحالة: منفّذ فعلياً — 2026-09-06.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: cancel_order_by_rider (الإيداعُ)، وclaim_notification_delivery
--   (الإغناءُ الحيُّ لمحادثةِ السائقِ ولغتِه).
-- ملاحظات مستقبلية: صفٌّ لكلِّ سائقٍ لا صفٌّ للحادثةِ — فلكلِّ رسالةٍ محاولاتُها
--   ومعرّفُها، ولا يُعيدُ فشلُ سائقٍ إرسالَ مَن وصلَه أصلًا. والمفتاحُ يجمعُ الطلبَ
--   والسائقَ فلا رسالتانِ لسائقٍ واحدٍ عن إلغاءٍ واحدٍ.
-- ============================================================================

-- 1) النوعُ يُضافُ إلى القيدِ، ومناديه يكتبُه في هذه الهجرةِ.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled'
  ));

-- ----------------------------------------------------------------------------
-- claim_notification_delivery: يُزادُ فرعُ الإغناءِ للنوعِ الجديدِ — محادثةُ السائقِ
--   ولغتُه كما هما في القاعدةِ لحظةَ الالتقاطِ لا لحظةَ الإيداعِ. أمّا `was_assigned`
--   فيبقى من الحمولةِ: هو وصفُ حالةِ السائقِ **حينَ أُلغيَ الطلبُ**، والصفُّ يُقرأُ
--   بعدَها فلا يُستخرَجُ من جدولٍ تغيّرَ. وما عدا هذا الفرعِ منسوخٌ حرفًا بحرفٍ.
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
  v_driver record;
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
  elsif v_delivery.kind = 'order_cancelled' then
    -- محادثةُ السائقِ ولغتُه حيّتانِ: سائقٌ غيّرَ لغتَه بينَ الإلغاءِ والتسليمِ يقرأُ
    -- الإخطارَ بلغتِه الجديدةِ، ولا نُجمِّدُ في الحمولةِ ما تملكُه القاعدةُ أصلًا.
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
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
-- cancel_order_by_rider: نفسُ الإلغاءِ ونفسُ فروعِه حرفًا بحرفٍ — القفلُ، وتمييزُ
--   سببِ التعذُّرِ، وإلغاءُ العروضِ، وإغلاقُ التفاوضِ، وتحديثُ الطلبِ، والأثرُ —
--   والزيادةُ إيداعُ إخطارِ الإلغاءِ لكلِّ سائقٍ يعنيه الأمرُ في المعاملةِ نفسِها،
--   ومردٌّ يقولُ كم صفًّا أُودِعَ. والحقولُ المُرجَعةُ تبقى كما هي ويُزادُ عليها
--   notifications_queued: لا يُنقَصُ من عقدٍ منشورٍ لتسهيلِ تنفيذٍ.
-- ----------------------------------------------------------------------------
create or replace function cancel_order_by_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_reason   text default 'rider_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_rider    riders%rowtype;
  v_now      timestamptz := now();
  v_offers   jsonb;
  v_assigned jsonb;
  v_negot    jsonb;
  v_target   record;
  v_queued   integer := 0;
begin
  -- القفل الذرّي: يمنع أن يقبل سائق الطلب في اللحظة نفسها التي يُلغى فيها.
  -- claim_ride تشترط status='searching' تحت قفل مماثل، فأحد الطرفين يخسر حتماً.
  select * into v_order
    from orders
   where id = p_order_id
     and rider_id = p_rider_id
     and status in ('searching', 'matched')
     for update;

  if not found then
    -- نميّز الأسباب: «لا يوجد طلب» و«فات أوان الإلغاء» ليسا شيئاً واحداً،
    -- وقول أحدهما مكان الآخر كذب على العميل.
    if exists (select 1 from orders where id = p_order_id and rider_id = p_rider_id) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CANCELLABLE');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select * into v_rider from riders where id = p_rider_id;

  -- 1) السائقون أصحاب العروض المعلّقة: يجب أن يعرفوا أن الطلب لم يعد معروضاً،
  --    وإلا ظلّت بطاقة العرض في محادثتهم تدعوهم إلى قبول ما لا يُقبل.
  with cancelled_offers as (
    update order_offers o
       set status = 'cancelled', responded_at = v_now
     where o.order_id = p_order_id and o.status = 'pending'
    returning o.driver_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)), '[]'::jsonb)
    into v_offers
    from cancelled_offers co
    join drivers d on d.id = co.driver_id
    join users u   on u.id = d.user_id;

  -- 2) السائق المُسنَد إن كان الطلب مطابَقاً: هو في طريقه فعلاً، وإخفاء الإلغاء
  --    عنه أسوأ من الإلغاء نفسه.
  if v_order.assigned_driver_id is not null then
    select jsonb_build_object(
             'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)
      into v_assigned
      from drivers d join users u on u.id = d.user_id
     where d.id = v_order.assigned_driver_id;
  end if;

  -- 3) بطاقات القروب: التفاوض المفتوح يُغلق، ويُعاد معرّف الرسالة لتُحرَّر البطاقة
  --    في القروب بدل أن تبقى معروضة لطلب انتهى.
  with closed as (
    update unsubscribed_negotiations n
       set status = 'cancelled', settled_at = v_now, updated_at = v_now
     where n.order_id = p_order_id and n.status in ('collecting', 'negotiating')
    returning n.group_message_id, n.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_message_id', c.group_message_id)) filter (where c.group_message_id is not null),
         '[]'::jsonb)
    into v_negot
    from closed c;

  -- 4) الطلب نفسه — بعد الفروع لا قبلها، حتى تُقرأ الحالة السابقة سليمة أعلاه
  update orders
     set status = 'cancelled',
         cancelled_reason = p_reason,
         updated_at = v_now
   where id = p_order_id;

  -- 5) الأثر الدائم: بغير هذا السطر يصبح الإلغاء حدثاً بلا ذاكرة
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rider.user_id, 'order.cancelled', 'order', p_order_id,
          jsonb_build_object('reason', p_reason,
                             'previous_status', v_order.status,
                             'service', v_order.service,
                             'assigned_driver_id', v_order.assigned_driver_id,
                             'notified_offers', jsonb_array_length(v_offers)));

  -- 6) إخطارُ السائقينِ يُودَعُ **هنا** — داخلَ معاملةِ الإلغاءِ نفسِها (BUG-004):
  --    فإن رجعت المعاملةُ رجعَ الصفُّ معها فلا يُخبَرُ سائقٌ بإلغاءٍ لم يقع؛ وإن
  --    نجحت لم يضعْ إخطارُه لو تعثّرَ تيليجرامُ لحظتَها — يُعادُ حتّى يصلَ. وصفٌّ
  --    لكلِّ سائقٍ لا صفٌّ للحادثةِ: مَن وصلَه لا يصلُه ثانيةً بإعادةِ غيرِه.
  --    و`bool_or` تجعلُ الإسنادَ يغلبُ: السائقُ المُسنَدُ قد يكونُ صاحبَ عرضٍ معلَّقٍ
  --    كذلك، ونصُّ «كنتَ في طريقِك» أصدقُ في حقِّه من نصِّ العرضِ الملغى.
  for v_target in
    select t.driver_id, bool_or(t.was_assigned) as was_assigned
      from (
        select (elem->>'driver_id')::uuid as driver_id, false as was_assigned
          from jsonb_array_elements(v_offers) elem
        union all
        select (v_assigned->>'driver_id')::uuid as driver_id, true as was_assigned
         where v_assigned is not null
      ) t
     group by t.driver_id
  loop
    if enqueue_notification(
         v_order.city_id,
         'order_cancelled',
         jsonb_build_object('order_id', p_order_id::text,
                            'driver_id', v_target.driver_id::text,
                            'was_assigned', v_target.was_assigned),
         'order_cancelled:' || p_order_id::text || ':' || v_target.driver_id::text
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'city_id', v_order.city_id,
    'service', v_order.service,
    'previous_status', v_order.status,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'offer_drivers', v_offers,
    'assigned_driver', coalesce(v_assigned, 'null'::jsonb),
    'group_cards', v_negot,
    'notifications_queued', v_queued
  );
end;
$$;

comment on function cancel_order_by_rider(uuid, uuid, text) is
  'إلغاء ذرّي يُلغي العروض ويُغلق التفاوض ويكتب في السجل ويُودِع إخطار السائقين في صندوق الصادر.';

revoke all on function cancel_order_by_rider(uuid, uuid, text) from public;
grant execute on function cancel_order_by_rider(uuid, uuid, text) to service_role;
