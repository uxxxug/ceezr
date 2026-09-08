-- =============================================================================
-- F6-03 / ADR-0061: تحديدُ مطالبةِ العاملِ الأساسيِّ بأنواعِ دورةِ الرحلةِ وحدَها.
-- الحالة: منفّذ (مرحلةُ التوسيعِ — شطرٌ مكمِّلٌ للمرحلةِ الثانية).
-- يبني على: 20260906010000 (صندوقُ الصادرِ الموحَّد)، 20260906040000 (إلغاءُ الراكب)،
--   20260908010000 (safety)، 20260908020000 (subscription).
-- ينتمي إلى: supabase/migrations.
--
-- ## ما تُغيّره هذه الهجرة
--
-- `claim_notification_delivery` (عاملُ تسليمِ دورةِ الرحلةِ) كان يطالبُ أيَّ صفٍّ
-- pending في notification_outbox دونَ تمييزٍ بينَ الأنواع. ما دامَ الصندوقُ يحملُ
-- أنواعَ العرضِ وحدَها كان ذلك صحيحاً. لكن بعدَ توحيدِ safety_incident و
-- subscription_notice في الصندوقِ نفسِه، صارَ العاملُ الأساسيُّ يلتقطُ صفوفاً لا
-- معالجَ لها (لا تُثرى chat_id/language_code حيًّا كما في الأنواعِ الأصليةِ، بل
-- مُلتقَطةٌ لحظةَ الإدراجِ)، فيُخطئ العاملُ ولا يُسلِّمُ شيئاً — أو يُرسلُ نصاً
-- ناقصاً. وكلُّ نوعٍ موحَّدٍ له عاملُهُ ومطالِبُهُ الخاصُّ:
--   - safety_incident      ← claim_safety_incident_delivery (العاملُ المخصَّص)
--   - subscription_notice   ← claim_subscription_notices (العاملُ المخصَّص)
--   - (لاحقاً) broadcast_recipient ← claim_broadcast_recipients
--
-- لذا يُحدَّدُ مطالِمُ العاملِ الأساسيِّ بأنواعِ دورةِ الرحلةِ الثمانيةِ وحدَها،
-- فلا يسرِقُ صفوفاً من عواملَ أخرى، وتبقى الأنواعُ الموحَّدةُ لعوّالِها.
--
-- ## ما لا تُغيّره
--
-- البنيةُ كما هي: استرجاعُ المتروكِ ثمّ FOR UPDATE SKIP LOCKED ورمزُ حجزٍ، والإغناءُ
-- الحيُّ لكلِّ نوعٍ من مصدرِه. التغييرُ الوحيدُ قيدُ `kind in (...)` في مطالبةِ
-- الـpending واسترجاعِ المتروكِ. وجميعُ فروعِ الإغناءِ (offer، dispute_resolution،
-- negotiation_*، wider_circle_opened، no_driver_found، order_cancelled) محفوظةٌ
-- كما كانت في هجرةِ الإلغاءِ 20260906040000.
--
-- ## العودة
--
-- توسيعٌ (expand) لا كسرٌ: إعادةُ تعريفٍ بـcreate or replace يُضيفُ قيدَ النوعِ.
-- والعودةُ بالكودِ وحدَه: النسخةُ السابقةُ تطالبُ كلَّ الأنواعِ فلا تجدُ صفوفاً
-- أودَعَتْها النسخةُ الجديدةُ بأنواعٍ موحَّدةٍ (فهي تتجاوزُها)، فيبقى التسليمُ
-- متّسقاً بينَ النسختينِ على أنواعِ دورةِ الرحلةِ.
-- =============================================================================

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

  -- استرجاعُ الحجوزِ المتروكةِ لأنواعِ دورةِ الرحلةِ وحدَها — ما للعاملِ الأساسيِّ
  -- معالجُه. الأنواعُ الموحَّدةُ (safety_incident، subscription_notice) لها
  -- عوّالُها ومطالِبُها الخاصُّ فلا يُمسُّها هذا الاسترجاعُ.
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind in ('offer', 'dispute_resolution',
                   'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
                   'wider_circle_opened', 'no_driver_found', 'order_cancelled')
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => v_timeout);

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind in ('offer', 'dispute_resolution',
                   'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
                   'wider_circle_opened', 'no_driver_found', 'order_cancelled')
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
  else
    v_payload := v_delivery.payload;
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
