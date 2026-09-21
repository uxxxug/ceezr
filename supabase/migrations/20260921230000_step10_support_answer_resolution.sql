-- ============================================================================
-- migration-phase: expand
-- الخطوةُ ١٠ — دعمٌ وشكاوى حقيقيّةٌ: الشكوى تُجاب، لا تُرفَض أو تُترَك.
--
-- ما كانَ قائماً قبلَ هذهِ الهجرةِ، مقروءاً لا مُقدَّراً:
--   resolve_support_ticket يقبلُ ثلاثةَ أفعالٍ فقط: activate · terminate · reject.
--   والأوّلانِ يسقطانِ بـTICKET_HAS_NO_DRIVER متى كانَ driver_id عدماً. فتذكرةُ
--   راكبٍ يشكو رحلةً لا فعلَ لها إلّا reject — ونصُّ رفضِها
--   «راجع فريق الدعم طلبك ولم يُقبل. أرسل /support مع تفاصيل أوضح».
--   فشكوى محقّةٌ لا مخرجَ لها إلّا أن تُرفَضَ ويُطلَبَ من صاحبِها أن يُعيدَ إرسالِها.
--
--   وعمودُ resolution يُكتَبُ ولا يُقرَأُ: التبليغُ يُبنى من p_action وحدَه، فملاحظةُ
--   موظّفِ الدعمِ المكتوبةُ تُخزَّنُ ولا تصلُ صاحبَها أبداً. وقد كانَ نصُّ الاستلامِ
--   support.ticket_created يَعِدُ: «⏳ سيصلك الردّ هنا في هذه المحادثة» — ووعدٌ بردٍّ
--   لا مسارَ له إيهامٌ لا حيادٌ، وهوَ صنفُ العطبِ نفسُه الذي عُولِجَ في الخطوةِ ٩.
--
-- المُنفَّذُ:
--   ١) فعلٌ رابعٌ answer: يُقفِلُ التذكرةَ resolved، **ويُوجِبُ ملاحظةً غيرَ فارغةٍ**
--      (ANSWER_NOTE_REQUIRED)، **ولا يقتضي سائقاً** فيصلحُ لتذكرةِ راكبٍ. ولا يمسُّ
--      اشتراكاً: هوَ ردٌّ مكتوبٌ لا تصرُّفٌ في مالٍ.
--   ٢) claim_notification_delivery يُلحِقُ support_tickets.resolution بالحمولةِ —
--      يُقرَأُ حيّاً من الجدولِ لحظةَ الالتقاطِ لا يُنسَخُ في الصفِّ: مصدرُ حقٍّ واحدٌ،
--      وتصحيحُ نصٍّ قبلَ التسليمِ يصلُ كما صُحِّحَ.
--
-- ولا يُدَّعى أنَّ الشكوى عُولِجَت: المقيسُ أنَّ ردّاً مكتوباً يصلُ صاحبَها. وجودةُ
-- الردِّ فعلُ بشرٍ لا يُقاسُ بحاجزٍ.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- resolve_support_ticket — يُعادُ إنشاؤها بفعلٍ رابعٍ. والثلاثةُ الأولى بحرفِها:
-- تعديلُ سلوكِ فعلٍ قائمٍ في هجرةٍ تَعِدُ بإضافةٍ انحدارٌ يُخفيهِ عنوانُها.
-- ----------------------------------------------------------------------------
create or replace function resolve_support_ticket(
  p_ticket_id uuid,
  p_actor_telegram_id bigint,
  p_action text,
  p_note text default null,
  p_days integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor jsonb;
  v_actor_id uuid;
  v_ticket support_tickets%rowtype;
  v_days integer;
  v_activated jsonb;
  v_status support_ticket_status;
  v_owner_telegram bigint;
  v_owner_language text;
  v_terminated integer := 0;
  v_enqueued boolean := false;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_action not in ('activate', 'terminate', 'reject', 'answer') then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ACTION');
  end if;

  -- الملاحظةُ شرطُ صحّةٍ للردِّ لا تزيينٌ: ردٌّ فارغٌ يُقفِلُ تذكرةً ويُرسِلُ إطاراً
  -- بلا مضمونٍ، وذاكَ أسوأُ من تركِها مفتوحةً — إذ يُسجَّلُ «مُجابةٌ» ولم يُجَبْ.
  -- والحكمُ قبلَ قراءةِ التذكرةِ: خطأُ نداءٍ لا يستحقُّ قفلَ صفٍّ.
  if p_action = 'answer' and v_note is null then
    return jsonb_build_object('ok', false, 'error', 'ANSWER_NOTE_REQUIRED');
  end if;

  v_actor := is_support_actor(p_actor_telegram_id);
  if not (v_actor->>'ok')::boolean then
    return v_actor;
  end if;
  v_actor_id := (v_actor->>'user_id')::uuid;

  select * into v_ticket from support_tickets where id = p_ticket_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'TICKET_NOT_FOUND');
  end if;
  if v_ticket.status in ('resolved', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'TICKET_ALREADY_SETTLED');
  end if;

  -- answer ليسَ ههنا عن قصدٍ: ردٌّ مكتوبٌ لا يقتضي اشتراكاً، وهوَ كلُّ الفائدةِ.
  if p_action in ('activate', 'terminate') and v_ticket.driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'TICKET_HAS_NO_DRIVER');
  end if;

  if p_action = 'activate' then
    v_days := coalesce(p_days, get_setting_number(v_ticket.city_id, 'support_activation_days')::integer);
    if v_days is null or v_days <= 0 then
      return jsonb_build_object('ok', false, 'error', 'ACTIVATION_DAYS_MISSING');
    end if;
    -- الخطّة: خطّة آخر اشتراك للسائق إن وُجدت، وإلا نقل. لا نخترع خطّة «both».
    v_activated := activate_subscription(
      v_ticket.driver_id,
      coalesce(
        (select plan from subscriptions where driver_id = v_ticket.driver_id
          order by created_at desc limit 1),
        'transport'::subscription_plan
      ),
      v_days
    );
    if not (v_activated->>'ok')::boolean then
      return v_activated;
    end if;
    v_status := 'resolved';

  elsif p_action = 'terminate' then
    update subscriptions
       set status = 'cancelled'
     where driver_id = v_ticket.driver_id and status in ('trialing', 'active');
    v_terminated := coalesce((select count(*) from subscriptions
                               where driver_id = v_ticket.driver_id
                                 and status = 'cancelled'), 0);
    v_status := 'resolved';

  elsif p_action = 'answer' then
    -- لا أثرَ على اشتراكٍ ولا مالٍ: الأثرُ نصٌّ يصلُ صاحبَ التذكرةِ وقفلُها.
    v_status := 'resolved';

  else
    v_status := 'rejected';
  end if;

  update support_tickets
     set status = v_status,
         resolved_by_user_id = v_actor_id,
         resolved_at = now(),
         resolution = v_note
   where id = p_ticket_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_ticket.city_id, v_actor_id, 'support.ticket_' || p_action, 'support_ticket', p_ticket_id,
          jsonb_build_object('role', v_actor->>'role', 'days', v_days, 'note', p_note));

  -- معرّف تلغرام لصاحب التذكرة ولغته: البوت يحتاجهما ليبلّغه بالقرار بلغته
  -- بلا استعلام ثانٍ، ولأن التبليغ بلغة النظام لمن لا يقرؤها إخطارٌ ضائع.
  if v_ticket.driver_id is not null then
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join drivers d on d.user_id = u.id where d.id = v_ticket.driver_id;
  else
    select u.telegram_id, u.language_code into v_owner_telegram, v_owner_language
      from users u join riders r on r.user_id = u.id where r.id = v_ticket.rider_id;
  end if;

  -- تبليغُ صاحبِ التذكرةِ يُودَعُ في صندوقِ الصادرِ **هنا** — داخلَ معاملةِ القرارِ
  -- نفسِها (BUG-004). والحمولةُ معرّفاتٌ فقط: النصُّ والمعرّفُ واللغةُ تُقرَأُ حيّةً
  -- في claim، فتصحيحُ ملاحظةٍ قبلَ التسليمِ يصلُ كما صُحِّحَ.
  v_enqueued := enqueue_notification(
    v_ticket.city_id,
    'dispute_resolution',
    jsonb_build_object('ticket_id', p_ticket_id, 'action', p_action),
    'dispute_resolution:' || p_ticket_id::text
  ) is not null;

  return jsonb_build_object(
    'ok', true,
    'ticket_id', p_ticket_id,
    'notification_enqueued', v_enqueued,
    'action', p_action,
    'status', v_status,
    'type', v_ticket.type,
    'owner_telegram_id', v_owner_telegram,
    'owner_language', v_owner_language,
    'subscription', v_activated,
    'terminated_count', v_terminated
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- claim_notification_delivery — يُعادُ إنشاؤها عن آخرِ تعريفٍ لها
-- (20260921000000_pd_021_decision_reason.sql) بزيادةٍ واحدةٍ: resolution في حمولةِ
-- dispute_resolution. تُقرَأُ من الجدولِ لحظةَ الالتقاطِ لا تُنسَخُ في الصفِّ:
-- نسخةٌ في الصفِّ مصدرُ حقٍّ ثانٍ يُخالِفُ الأوّلَ متى صُحِّحَ النصُّ.
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
  v_resolution text;
  v_claim record;
  v_rider record;
  v_driver record;
  v_batch_limit integer;
  v_concurrency integer;
  v_claimed bigint;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked'
  ];
begin
  select greatest(1, (value #>> '{}')::integer) into v_timeout from platform_settings
   where key = 'notification_claim_timeout_seconds' limit 1;
  if v_timeout is null then v_timeout := 300; end if;

  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind = any(v_ride_kinds)
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind = any(v_ride_kinds)
     and not exists (
       select 1 from notification_outbox o
        where o.order_id = n.order_id
          and o.status = 'pending'
          and o.kind = any(v_ride_kinds)
          and o.next_attempt_at <= now()
          and (o.created_at, o.id) < (n.created_at, n.id)
     )
   order by notification_kind_priority(n.kind), n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  v_concurrency := queue_limit_or_null(v_delivery.city_id, 'outbox_queue_consumer_concurrency');
  select count(*) into v_claimed from notification_outbox n
   where n.city_id = v_delivery.city_id and n.status = 'sending';

  if v_concurrency is null or v_concurrency <= 0 or coalesce(v_claimed, 0) >= v_concurrency then
    perform record_queue_backpressure_event(
      v_delivery.city_id, 'notification_outbox', 'CONSUMER_CONCURRENCY',
      jsonb_build_object('claimed', v_claimed, 'consumer_concurrency', v_concurrency)
    );
    return jsonb_build_object(
      'ok', true, 'delivery', null, 'backpressure', 'CONSUMER_CONCURRENCY',
      'claimed', coalesce(v_claimed, 0), 'consumer_concurrency', v_concurrency
    );
  end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  v_batch_limit := greatest(1, v_concurrency);

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
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end,
           tk.resolution
      into v_owner_telegram, v_owner_language, v_owner_kind, v_resolution
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind,
      'resolution', v_resolution
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
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind = 'lost_item_report' then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    -- `PD-021` — إشعارُ مآلٍ عامٌّ للمُبلِّغِ. محادثتُهُ ولغتُهُ كما هما في
    -- القاعدةِ لحظةَ الالتقاطِ، والحمولةُ تَحملُ القرارَ لا السببَ الداخليَّ.
    select ru.telegram_id::text as chat_id, ru.language_code as language
      into v_rider
      from safety_incidents si
      join users ru on ru.id = si.reporter_user_id
     where si.id = (v_delivery.payload->>'incident_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar')
    );
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'batch_limit', v_batch_limit,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

-- ----------------------------------------------------------------------------
-- نزعُ التنفيذِ: `create or replace` **يُعيدُ منحَ التنفيذِ ضمنيّاً**، فهجرةٌ
-- تُعيدُ كتابةَ دالّةٍ سابقةٍ ولا تنزعُ تنفيذَها تفتحُ بابَها من جديدٍ للمفتاحِ
-- العامِّ — وذاكَ ما تقيسُهُ القاعدةُ ٧ في حاجزِ عقدِ سطحِ الدعمِ.
-- ----------------------------------------------------------------------------
revoke execute on function public.resolve_support_ticket(uuid, bigint, text, text, integer) from public, anon, authenticated;
revoke execute on function claim_notification_delivery() from public, anon, authenticated;
