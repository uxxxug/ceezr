-- =============================================================================
-- migration-phase: expand
-- الغرض: `PD-021` — **السببُ الداخليُّ الإلزاميُّ عندَ إغلاقِ حادثِ سلامةٍ أو
--   حظرِ مُبلِّغٍ، ورسالةُ حالةٍ عامّةٌ للمُبلِّغِ**.
--
-- العطبُ المقيسُ من الكودِ: `resolve_safety_incident` تأخذُ ثلاثةَ معاملاتٍ —
-- الحادثَ والفاعلَ والقرارَ — ولا تأخذُ سببًا. فالقاعدةُ تَحفظُ **ما** فُعلَ
-- (`decision`) لكنَّ **لماذا** يُتركُ للهواءِ. وأثرُ الحظرِ في `audit_log` يَخلو
-- من سببِ القرارِ. والمُبلِّغُ لا يَصلهُ إشعارٌ بالمآلِ: بلاغُهُ ذهبَ واختفى.
--
-- ثلاثةُ شقوقٍ تُنفَّذُ تحتَ حجزٍ واحد:
--
--   ١) عمودُ `decision_reason text` على `safety_incidents` — رمزُ سببٍ مغلقٌ
--      من مجموعةٍ محدَّدةٍ. القيدُ `NOT VALID` فلا يُكسِرُ الصفوفَ المغلقةَ
--      السابقةَ (لا سببَ لها ولا يُختَرَعُ لها واحدٌ).
--
--   ٢) `resolve_safety_incident` تُوسَّعُ بمعاملٍ رابعٍ `p_decision_reason text`
--      يُلزَمُ بلا سببٍ — وتُسقَطُ الدالّةُ القديمةُ صراحةً فلا يبقى مسارٌ
--      قديمٌ يُغلقُ بلا سببٍ. والسببُ يُكتَبُ في `audit_log` مع القرارِ.
--      والقرارُ `block_reporter` يَمرُّ بالسببِ إلى حمولةِ أثرِ `audit_log`.
--
--   ٣) إشعارُ المُبلِّغِ بالمآلِ عبرَ `notification_outbox` في معاملةِ الإغلاقِ
--      نفسِها — حمولتُها القرارُ (لا السببُ الداخليُّ)، والعاملُ يُسلِّمُها
--      كما يُسلِّمُ كلَّ إشعارٍ آخر.
--
-- وما لا تفعلهُ هذه الهجرةُ عن قصدٍ:
--   ــ لا تُمسُّ `trigger_sos` ولا `claim_safety_incident` ولا
--      `sos_surface_state`.
--   ــ لا تُغيِّرُ حالةَ البلاغِ (`open`/`received`/`closed`).
--   ــ لا تُمسُّ `admin_set_user_blocked` — سببُ الحظرِ يُخزَّنُ في
--      `safety_incidents` لا في دالّةِ الإدارةِ.
--   ــ لا تُضيفُ رسالةَ نصٍّ حرٍّ — الرموزُ مغلقةٌ.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) عمودُ السببِ الداخليِّ على `safety_incidents`.
--    `NOT VALID`: الصفوفُ المغلقةُ القديمةُ بلا سببٍ لا تُكسَرُ ولا يُختَرَعُ
--    لها سببٌ — القيدُ يُفرَضُ على الجديدِ فقط، ثم يُصدَّقُ لاحقًا.
-- ---------------------------------------------------------------------------
alter table safety_incidents add column if not exists decision_reason text;

alter table safety_incidents
  drop constraint if exists safety_incidents_closed_has_decision_reason;
alter table safety_incidents
  add constraint safety_incidents_closed_has_decision_reason
  check (status <> 'closed' or decision_reason is not null) not valid;

-- قائمةُ الرموزِ المغلقةُ — تُوسَّعُ بقرارٍ لا بالكتابةِ المباشرةِ.
alter table safety_incidents
  drop constraint if exists safety_incidents_decision_reason_domain;
alter table safety_incidents
  add constraint safety_incidents_decision_reason_domain
  check (
    decision_reason is null
    or decision_reason in (
      'resolved', 'false_report', 'duplicate', 'escalated',
      'safety_risk', 'policy_violation'
    )
  );

comment on column safety_incidents.decision_reason is
  'رمزُ السببِ الداخليِّ لقرارِ الإغلاقِ (`PD-021`). مُلزَمٌ عندَ الإغلاقِ، وحمولتُه رمزٌ مغلقٌ لا نصٌّ حرٌّ. لا يُنشَرُ للمُبلِّغِ — رسالةُ الحالةِ العامّةُ تُشتَقُّ من القرارِ لا من السببِ.';

-- ---------------------------------------------------------------------------
-- ٢) `resolve_safety_incident` — توقيعٌ رابعٌ جديدٌ، والدالّةُ القديمةُ تُسقَطُ.
--    المسارُ القديمُ بلا سببٍ يُغلقُ — لا يبقى مسارٌ بلا سببٍ.
--
--    `p_decision_reason` رمزٌ مغلقٌ من المجموعةِ نفسِها في قيدِ العمودِ، ويُلزَمُ
--    بلا سببٍ. والسببُ يُكتَبُ في `audit_log` مع القرارِ، ويُمرَّرُ في حمولةِ
--    أثرِ `block_reporter` صراحةً.
--
--    والإشعارُ العامُّ للمُبلِّغِ يُكتَبُ في `notification_outbox` في المعاملةِ
--    نفسِها — حمولتُها القرارُ (`close`/`block_reporter`) لا السببُ الداخليُّ،
--    فالعاملُ يُسلِّمُها كما يُسلِّمُ كلَّ إشعارٍ آخر، والمُبلِّغُ يَعرفُ المآلَ
--    بلا كشفِ الداخلِ.
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_safety_incident(uuid, bigint, text);

create or replace function public.resolve_safety_incident(
  p_incident_id uuid,
  p_actor_telegram_id bigint,
  p_decision text,
  p_decision_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_incident safety_incidents%rowtype;
  v_actor users%rowtype;
  v_block jsonb;
  v_public_kind text;
  v_public_dedup text;
begin
  select * into v_actor from users where telegram_id = p_actor_telegram_id;
  if not found or v_actor.is_blocked or v_actor.role not in ('support', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'ACTOR_NOT_AUTHORIZED');
  end if;
  if p_decision not in ('close', 'block_reporter') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;
  -- السببُ الداخليُّ مُلزَمٌ — لا إغلاقُ بلا سببٍ.
  if p_decision_reason is null or btrim(p_decision_reason) = '' then
    return jsonb_build_object('ok', false, 'error', 'DECISION_REASON_REQUIRED');
  end if;
  -- الرمزُ مغلقٌ — قيمةٌ خارجُ المجموعةِ عطبُ عقدٍ لا حالةٌ تُطوى.
  if p_decision_reason not in (
    'resolved', 'false_report', 'duplicate', 'escalated',
    'safety_risk', 'policy_violation'
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION_REASON');
  end if;
  select * into v_incident from safety_incidents where id = p_incident_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_FOUND');
  end if;
  if v_incident.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_ALREADY_CLOSED');
  end if;
  if v_incident.status <> 'received' or v_incident.claimed_by_user_id <> v_actor.id then
    return jsonb_build_object('ok', false, 'error', 'INCIDENT_NOT_CLAIMED_BY_ACTOR');
  end if;
  if p_decision = 'block_reporter' then
    select admin_set_user_blocked(v_actor.id, v_incident.reporter_user_id, true) into v_block;
    if coalesce((v_block->>'ok')::boolean, false) is not true then
      return jsonb_build_object('ok', false, 'error', coalesce(v_block->>'error', 'BLOCK_REJECTED'));
    end if;
  end if;
  update safety_incidents
     set status = 'closed',
         decision = p_decision,
         decision_reason = p_decision_reason,
         decided_by_user_id = v_actor.id,
         decided_at = now()
   where id = p_incident_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_incident.city_id, v_actor.id, 'safety.incident_resolved', 'safety_incident', v_incident.id,
          jsonb_build_object(
            'decision', p_decision,
            'decision_reason', p_decision_reason,
            'order_id', v_incident.order_id,
            'reporter_blocked', p_decision = 'block_reporter'
          ));

  -- إشعارُ المُبلِّغِ بالمآلِ — حمولتُه القرارُ لا السببُ الداخليُّ.
  -- `close` ⇐ `safety_resolution_closed` · `block_reporter` ⇐ `safety_resolution_blocked`
  v_public_kind := case when p_decision = 'block_reporter'
    then 'safety_resolution_blocked'
    else 'safety_resolution_closed'
  end;
  v_public_dedup := 'safety_resolution:' || v_incident.id::text;
  insert into notification_outbox (city_id, kind, dedup_key, payload)
  values (v_incident.city_id, v_public_kind, v_public_dedup,
          jsonb_build_object('incident_id', v_incident.id::text, 'decision', p_decision))
  on conflict (kind, dedup_key) do nothing;

  return jsonb_build_object('ok', true, 'decision', p_decision, 'decision_reason', p_decision_reason);
end $function$;

comment on function public.resolve_safety_incident(uuid, bigint, text, text) is
  'تُغلقُ بلاغَ سلامةٍ بقرارٍ بشريٍّ وسببٍ داخليٍّ إلزاميٍّ (`PD-021`). السببُ رمزٌ مغلقٌ من مجموعةٍ محدَّدةٍ، ويُكتَبُ في `audit_log` مع القرارِ. والمُبلِّغُ يَصلهُ إشعارُ مآلٍ عامٌّ عبرَ `notification_outbox` في المعاملةِ نفسِها — حمولتُه القرارُ لا السببُ الداخليُّ. و`block_reporter` يَستدعي مسارَ الإدارةِ القائمَ كما كانَ.';

revoke execute on function public.resolve_safety_incident(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.resolve_safety_incident(uuid, bigint, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- ٣) توسيعُ قيدِ أنواعِ `notification_outbox` لاستقبالِ إشعاراتِ المآلِ العامّةِ.
--    الأنواعُ الجديدةُ لا تَكشفُ السببَ الداخليَّ — حمولتُها القرارُ فقط.
-- ---------------------------------------------------------------------------
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked'
  )) not valid;

-- ---------------------------------------------------------------------------
-- ٤) `claim_notification_delivery` — توسيعُ مصفوفةِ الأنواعِ وإثراءُ المآلِ العامِّ.
--    الأنواعُ الجديدةُ تُلتقطُ وتُغنى بمحادثةِ المُبلِّغِ ولغتِهِ من `safety_incidents`.
--    الدالّةُ تُعادُ تعريفُها بالكاملِ لأنَّ `create or replace` لا يُضيفُ فرعاً —
--    يَستبدِلُ الجسمَ. فتُنسَخُ الفروعُ القائمةُ كما هي، ويُضافُ الفرعُ الجديدُ.
-- ---------------------------------------------------------------------------
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

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
