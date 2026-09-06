-- ============================================================================
-- الغرض: BUG-004 — نقلُ إخطاراتِ دورةِ غيرِ المشتركينِ إلى صندوقِ الصادرِ
--   الموحَّدِ: فتحُ الدورِ وإغلاقُه والاتفاقُ. كانت هذه الثلاثةُ تُرسَلُ من مسارِ
--   التطبيقِ **بعدَ** عودةِ الدالّةِ الذرّيةِ، فإن تعطّلَ تيليجرامُ لحظتَها صارَ
--   للسائقِ دورٌ لا يعلمُ به ولعميلٍ اتفاقٌ لا يُبلَّغُ به، ولا شيءَ يُعيدُ
--   المحاولةَ. صارَ الإيداعُ داخلَ معاملةِ الدالّةِ نفسِها والتسليمُ للعامل.
-- الحالة: منفّذ فعلياً — 2026-09-06.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: register_unsubscribed_claim، advance_unsubscribed_negotiation،
--   settle_unsubscribed_negotiation (الإيداعُ)، وclaim_notification_delivery
--   (الإغناءُ الحيُّ لكلِّ نوعٍ من مصدرِه).
-- ملاحظات مستقبلية: صفٌّ لكلِّ مُستلِمٍ لا صفٌّ للحادثةِ: إخطارُ الدورِ يخصُّ
--   طرفَينِ، ورسالةٌ واحدةٌ لكلٍّ منهما. ولو جُمِعا في صفٍّ واحدٍ لكان فشلُ
--   إحداهما يُعيدُ إرسالَ الأخرى — أثرٌ مكرَّرٌ على مُستلِمٍ وصلَه أصلاً.
-- ============================================================================

-- 1) الأنواعُ الثلاثةُ تُضافُ إلى القيدِ، ولكلٍّ منها منادٍ يكتبُه في هذه الهجرةِ.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ));

-- ----------------------------------------------------------------------------
-- enqueue_negotiation_notification: صفٌّ لكلِّ طرفٍ من طرفَي القناةِ بمفتاحِ منعِ
--   تكرارٍ يخصُّه. تُنادى داخلَ معاملةِ الدالّةِ الذرّيةِ فيرجعُ الصفّانِ معها إن
--   رجعت. تُرجعُ عددَ ما أُودِعَ فعلاً (0 إن كان مودَعاً سلفاً).
--   والحمولةُ معرّفاتٌ: كلُّ ما يُقرأُ لحظةَ الإرسالِ يُقرأُ حيًّا في الالتقاطِ.
-- ----------------------------------------------------------------------------
create or replace function enqueue_negotiation_notification(
  p_city_id uuid, p_kind text, p_claim_id uuid, p_extra jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_side text;
  v_queued integer := 0;
begin
  foreach v_side in array array['driver', 'rider'] loop
    if enqueue_notification(
         p_city_id,
         p_kind,
         coalesce(p_extra, '{}'::jsonb)
           || jsonb_build_object('claim_id', p_claim_id::text, 'side', v_side),
         p_kind || ':' || p_claim_id::text || ':' || v_side
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;
  return v_queued;
end $$;

grant execute on function enqueue_negotiation_notification(uuid, text, uuid, jsonb) to service_role;
revoke execute on function enqueue_negotiation_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- claim_notification_delivery: يُزادُ فرعُ الإغناءِ لأنواعِ الدورةِ الثلاثةِ.
--   والقراءةُ بمعرّفِ المطالبةِ لا بـ«المطالبةِ النشطةِ»: الإغلاقُ والاتفاقُ
--   يُخرِجانِ المطالبةَ من النشاطِ، فقراءةُ النشطِ كانت ستُخطِرَ الطرفَ الخطأَ أو
--   لا تجدَ أحداً. وثوانيَ المهلةِ تُقرأُ من platform_settings لا من الصفِّ.
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
-- register_unsubscribed_claim: نفسُ الحكمِ ونفسُ القيودِ، والتغييرُ الوحيدُ أنَّ
--   إخطارَ فتحِ الدورِ للأولِ صارَ صفَّينِ مودَعَينِ في المعاملةِ نفسِها بدلَ
--   إرسالٍ من مسارِ التطبيقِ بعدَها. الحقولُ المُرجَعةُ كما كانت ويُزادُ عليها
--   notifications_queued.
-- ----------------------------------------------------------------------------
create or replace function register_unsubscribed_claim(
  p_negotiation_id uuid,
  p_driver_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg       unsubscribed_negotiations%rowtype;
  v_driver    drivers%rowtype;
  v_now       timestamptz := now();
  v_slots     integer;
  v_negotiate integer;
  v_taken     integer;
  v_position  integer;
  v_claim_id  uuid;
  v_prev_id   uuid;
  v_is_active boolean := false;
  v_queued    integer := 0;
begin
  -- القفل على صفّ الدورة هو ما يجعل «أول ثلاث ضغطات» صحيحاً تحت التزامن
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;

  if v_neg.status not in ('collecting', 'negotiating') then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_CLOSED');
  end if;

  if v_neg.collect_deadline <= v_now then
    return jsonb_build_object('ok', false, 'error', 'COLLECT_WINDOW_CLOSED');
  end if;

  select * into v_driver from drivers where id = p_driver_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;
  if v_driver.city_id <> v_neg.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;
  if v_driver.verification_status <> 'verified' then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_VERIFIED');
  end if;

  if exists (
    select 1 from unsubscribed_claims
     where negotiation_id = p_negotiation_id and driver_id = p_driver_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  end if;

  -- الممنوعون: سائقو الدورة المباشرة السابقة لنفس الطلب
  if v_neg.cycle > 1 then
    select id into v_prev_id
      from unsubscribed_negotiations
     where order_id = v_neg.order_id and cycle = v_neg.cycle - 1;
    if exists (
      select 1 from unsubscribed_claims
       where negotiation_id = v_prev_id and driver_id = p_driver_id
    ) then
      return jsonb_build_object('ok', false, 'error', 'EXCLUDED_PREVIOUS_CYCLE');
    end if;
  end if;

  v_slots := get_setting_number(v_neg.city_id, 'unsubscribed_claim_slots')::integer;

  select count(*) into v_taken
    from unsubscribed_claims where negotiation_id = p_negotiation_id;

  if v_taken >= v_slots then
    return jsonb_build_object('ok', false, 'error', 'SLOTS_FULL', 'slots', v_slots);
  end if;

  v_position := v_taken + 1;
  v_is_active := (v_position = 1);

  insert into unsubscribed_claims
    (city_id, negotiation_id, order_id, driver_id, position, outcome, opened_at)
  values
    (v_neg.city_id, p_negotiation_id, v_neg.order_id, p_driver_id, v_position,
     case when v_is_active then 'negotiating'::claim_outcome else 'waiting'::claim_outcome end,
     case when v_is_active then v_now else null end)
  returning id into v_claim_id;

  -- الأول يفتح التفاوض فوراً؛ من بعده ينتظر دوره بلا أن يُعطَّل جمع البقية
  if v_is_active then
    v_negotiate := get_setting_number(v_neg.city_id, 'unsubscribed_negotiate_seconds')::integer;
    update unsubscribed_negotiations
       set status = 'negotiating',
           active_claim_id = v_claim_id,
           negotiate_deadline = v_now + make_interval(secs => v_negotiate)
     where id = p_negotiation_id;

    -- إخطارُ الطرفَينِ يُودَعُ **هنا** (BUG-004): دورٌ مفتوحٌ في القاعدةِ وسائقٌ
    -- لا يعلمُ به كان الأثرَ الحقيقيَّ لتعطّلِ تيليجرامَ لحظةَ الضغطةِ، والمهلةُ
    -- تمضي عليه وهو ساكتٌ. الصفُّ يبقى فيُعادُ حتى يصل.
    v_queued := enqueue_negotiation_notification(
      v_neg.city_id, 'negotiation_turn_opened', v_claim_id
    );
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.claim_registered', 'order',
          v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim_id,
                             'driver_id', p_driver_id, 'position', v_position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'position', v_position,
                            'slots', v_slots, 'is_active', v_is_active,
                            'notifications_queued', v_queued,
                            'order_id', v_neg.order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- advance_unsubscribed_negotiation: نفسُ التدويرِ، ويُودَعُ فيه إخطارانِ: إغلاقُ
--   دورِ من أُغلِقَ دورُه، وفتحُ دورِ من فُتِحَ له. الترتيبُ في الصندوقِ هو
--   ترتيبُ الإيداعِ (created_at) فيُسلَّمُ الإغلاقُ قبلَ الفتحِ كما كان.
-- ----------------------------------------------------------------------------
create or replace function advance_unsubscribed_negotiation(
  p_negotiation_id uuid,
  p_reason         text default 'declined'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg       unsubscribed_negotiations%rowtype;
  v_active    unsubscribed_claims%rowtype;
  v_next      unsubscribed_claims%rowtype;
  v_now       timestamptz := now();
  v_negotiate integer;
  v_outcome   claim_outcome;
  v_queued    integer := 0;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  v_outcome := case when p_reason = 'expired' then 'expired'::claim_outcome
                    else 'declined'::claim_outcome end;

  select * into v_active from unsubscribed_claims where id = v_neg.active_claim_id;

  update unsubscribed_claims
     set outcome = v_outcome, closed_at = v_now
   where id = v_neg.active_claim_id;

  -- سببُ الإغلاقِ جزءٌ من الحمولةِ لا يُستنتَجُ لحظةَ الإرسالِ: `outcome` يتغيّرُ
  -- بدوراتٍ تالية، والرسالةُ يجبُ أن تُصدُقَ عن الحادثةِ التي أُودِعت لها.
  v_queued := enqueue_negotiation_notification(
    v_neg.city_id, 'negotiation_turn_closed', v_active.id,
    jsonb_build_object('reason', p_reason)
  );

  -- التالي في الترتيب، لا الأقرب ولا الأعلى تقييماً: الترتيب هو العدل هنا
  select * into v_next
    from unsubscribed_claims
   where negotiation_id = p_negotiation_id
     and outcome = 'waiting'
   order by position
   limit 1
     for update;

  if not found then
    update unsubscribed_negotiations
       set status = 'exhausted', active_claim_id = null, negotiate_deadline = null
     where id = p_negotiation_id;

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_neg.city_id, null, 'unsubscribed.cycle_exhausted', 'order', v_neg.order_id,
            jsonb_build_object('negotiation_id', p_negotiation_id, 'cycle', v_neg.cycle,
                               'last_position', v_active.position, 'reason', p_reason));

    return jsonb_build_object('ok', true, 'exhausted', true,
                              'notifications_queued', v_queued,
                              'order_id', v_neg.order_id, 'cycle', v_neg.cycle);
  end if;

  v_negotiate := get_setting_number(v_neg.city_id, 'unsubscribed_negotiate_seconds')::integer;

  update unsubscribed_claims
     set outcome = 'negotiating', opened_at = v_now
   where id = v_next.id;

  update unsubscribed_negotiations
     set active_claim_id = v_next.id,
         negotiate_deadline = v_now + make_interval(secs => v_negotiate)
   where id = p_negotiation_id;

  v_queued := v_queued + enqueue_negotiation_notification(
    v_neg.city_id, 'negotiation_turn_opened', v_next.id
  );

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, null, 'unsubscribed.negotiation_advanced', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id,
                             'from_position', v_active.position,
                             'to_position', v_next.position, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'exhausted', false,
                            'claim_id', v_next.id, 'position', v_next.position,
                            'notifications_queued', v_queued,
                            'driver_id', v_next.driver_id, 'order_id', v_neg.order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- settle_unsubscribed_negotiation: نفسُ الإسنادِ الذرّيِّ، ويُودَعُ فيه إخطارُ
--   الاتفاقِ للطرفَينِ. وهذا أخطرُ الثلاثةِ: الطلبُ يصيرُ matched في المعاملةِ،
--   فلو ضاعت الرسالةُ لكان لعميلٍ سائقٌ لا يعلمُ أنّه اتُّفِقَ عليه.
-- ----------------------------------------------------------------------------
create or replace function settle_unsubscribed_negotiation(p_negotiation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg    unsubscribed_negotiations%rowtype;
  v_claim  unsubscribed_claims%rowtype;
  v_order  orders%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_queued integer := 0;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  select * into v_order
    from orders
   where id = v_neg.order_id and status = 'searching'
     for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  select * into v_claim from unsubscribed_claims where id = v_neg.active_claim_id;
  select * into v_driver from drivers where id = v_claim.driver_id;

  update unsubscribed_claims
     set outcome = 'agreed', closed_at = v_now
   where id = v_claim.id;

  -- من لم يصل دوره لا يبقى معلَّقاً: الاتفاق يُغلق الدورة كلّها
  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = v_now
   where negotiation_id = p_negotiation_id and outcome = 'waiting';

  update unsubscribed_negotiations
     set status = 'agreed', settled_at = v_now, negotiate_deadline = null
   where id = p_negotiation_id;

  -- أي عرض معلَّق في المسار المشترك يُلغى: لا مسارا إسناد لطلب واحد
  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = v_neg.order_id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = v_claim.driver_id, matched_at = v_now
   where id = v_neg.order_id;

  v_queued := enqueue_negotiation_notification(
    v_neg.city_id, 'negotiation_agreed', v_claim.id
  );

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.agreed', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', v_claim.driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'order_id', v_neg.order_id,
                            'notifications_queued', v_queued,
                            'driver_id', v_claim.driver_id, 'matched_at', v_now);
end;
$$;
