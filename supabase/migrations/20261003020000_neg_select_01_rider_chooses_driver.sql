-- migration-phase: expand
-- ============================================================================
-- NEG-SELECT-01 · ORDER-TERMS-01 — طلبُ المالكِ 2026-10-03:
--
--  (1) الراكبُ **يختارُ** السائقَ قبلَ أن تُفتَحَ المحادثةُ. كانت أوّلُ ضغطةِ «قبول»
--      في قروبِ غيرِ المشتركينَ تفتحُ القناةَ فوراً، فلا يرى الراكبُ من يُحادِثُ ولا
--      يملكُ أن يتخطّاه قبلَ الكلامِ. صارَ للدورِ طَورانِ في الصفِّ نفسِه:
--        • معروضٌ  (`selected_at is null`)  — بطاقةُ السائقِ أمامَ الراكبِ: معلوماتُه،
--          اختيارُه، أو «السائقُ التالي».
--        • مُختارٌ (`selected_at is not null`) — المحادثةُ مفتوحةٌ والطلبُ «جاري الاتفاق»،
--          وفيها «تم الاتفاق» أو «إعادةُ فتحِ الطلبِ لسائقٍ آخر».
--      والتمريرُ (relay) لا يقعُ إلّا في الطورِ الثاني — يحرسُه التطبيقُ بقراءةِ العمودِ.
--
--  (2) المنتظرُ يملكُ أن يُنهيَ انتظارَه: `withdraw_unsubscribed_claim` تُغلِقُ مطالبتَه
--      المنتظِرةَ وحدَها (`cancelled`) ولا تمسُّ الدورَ النشطَ.
--
--  (3) وقتُ حضورِ السائقِ على البطاقةِ (أو «الآن» إن غابَ). عمودٌ معدومٌ افتراضاً، فكلُّ
--      طلبٍ قائمٍ وكلُّ مسارٍ لا يُرسِلُه يبقى كما كان حرفاً.
--      أمّا «المبلغُ الذي يدفعُه الراكبُ» فلا عمودَ له هنا ولا معامِلَ: آليّةُ الأجرةِ محجوبةٌ
--      بـ`ADR 0039` (ولا هياكلَ تمهيديّةً — م13-7) حتى يُغلَقَ `DEC-11` بسندٍ نظاميٍّ مكتوبٍ.
--
-- لا قيدَ CHECK هنا (القاعدةُ ٢ تقتضي `not valid` ثمَّ تصديقاً في هجرةٍ مستقلّةٍ):
-- الحدودُ تُفرَضُ في `request_ride_with_terms` نفسِها، وهي البابُ الوحيدُ للكتابةِ.
-- ============================================================================

alter table unsubscribed_claims add column if not exists selected_at timestamptz;

comment on column unsubscribed_claims.selected_at is
  'NEG-SELECT-01: لحظةُ اختيارِ الراكبِ لهذا السائقِ. null والدورُ نشطٌ ⇒ معروضٌ لم يُختَرْ بعدُ؛ والمحادثةُ لا تُفتَحُ قبلَه.';

alter table orders add column if not exists pickup_at timestamptz;

comment on column orders.pickup_at is
  'ORDER-TERMS-01: الوقتُ الذي يطلبُ الراكبُ أن يحضرَ فيه السائقُ. null ⇒ الآن.';

-- ----------------------------------------------------------------------------
-- request_ride_with_terms: غلافٌ فوقَ `request_ride_labeled` حرفاً (فلا يتغيّرُ حكمُ
--   التكرارِ ولا الرفضِ ولا المدينةِ ولا الاسمَين)، ثمَّ يكتبُ وقتَ الحضورِ في الصفِّ الذي
--   أُنشِئَ للتوِّ في المعاملةِ نفسِها — قبلَ أن يُسلِّمَ العاملُ أيَّ بطاقةٍ، فالبطاقةُ
--   تقرؤه لحظةَ الإرسالِ. والطلبُ المُعادُ (`reused`) لا يُمَسُّ.
--   الحدُّ: لا يسبقُ الآنَ بأكثرَ من 10 دقائقَ ولا يتجاوزُه بأكثرَ من 14 يوماً؛ وما خرجَ
--   عنه يسقطُ null (إخباريٌّ لا حكميٌّ).
-- ----------------------------------------------------------------------------
create or replace function request_ride_with_terms(
  p_telegram_id     bigint,
  p_key             text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text,
  p_pickup_label    text,
  p_dropoff_label   text,
  p_pickup_at       timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_at     timestamptz := case
    when p_pickup_at is not null
         and p_pickup_at >= now() - interval '10 minutes'
         and p_pickup_at <= now() + interval '14 days'
      then p_pickup_at end;
begin
  v_result := request_ride_labeled(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label
  );

  if (v_result->>'ok')::boolean is true
     and coalesce((v_result->>'reused')::boolean, false) is false
     and v_at is not null then
    update orders
       set pickup_at = coalesce(pickup_at, v_at)
     where id = (v_result->>'order_id')::uuid;
  end if;

  return v_result;
end;
$$;

revoke execute on function request_ride_with_terms(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function request_ride_with_terms(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz)
  to service_role;

-- ----------------------------------------------------------------------------
-- select_unsubscribed_claim: الراكبُ يختارُ السائقَ المعروضَ. `p_position` حارسُ
--   البطاقةِ القديمةِ: زرٌّ على بطاقةِ السائقِ (1) ضُغِطَ بعدَ أن صارَ الدورُ للسائقِ (2)
--   يُرَدُّ `STALE_CARD` ولا يختارُ غيرَ من رآه الراكبُ. والاختيارُ يُجدِّدُ مهلةَ التفاوضِ
--   (المحادثةُ تبدأُ الآنَ لا عندَ العرضِ)، ويُودِعُ إخطارَ الطرفَينِ في المعاملةِ نفسِها
--   (BUG-004) بالنوعِ `negotiation_turn_opened` وطَورِ `selected` في الحمولةِ — فلا
--   نوعَ صادرٍ جديدٌ ولا فرعَ إغناءٍ جديدٌ، ومفتاحُ منعِ التكرارِ مستقلٌّ عن العرضِ.
-- ----------------------------------------------------------------------------
create or replace function select_unsubscribed_claim(
  p_negotiation_id uuid,
  p_position       integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg       unsubscribed_negotiations%rowtype;
  v_claim     unsubscribed_claims%rowtype;
  v_now       timestamptz := now();
  v_negotiate integer;
  v_side      text;
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

  select * into v_claim from unsubscribed_claims where id = v_neg.active_claim_id for update;
  if v_claim.position <> p_position then
    return jsonb_build_object('ok', false, 'error', 'STALE_CARD');
  end if;
  if v_claim.selected_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'claim_id', v_claim.id,
                              'position', v_claim.position, 'notifications_queued', 0,
                              'order_id', v_neg.order_id);
  end if;

  v_negotiate := get_setting_number(v_neg.city_id, 'unsubscribed_negotiate_seconds')::integer;

  update unsubscribed_claims set selected_at = v_now where id = v_claim.id;
  update unsubscribed_negotiations
     set negotiate_deadline = v_now + make_interval(secs => v_negotiate)
   where id = p_negotiation_id;

  foreach v_side in array array['driver', 'rider'] loop
    if enqueue_notification(
         v_neg.city_id,
         'negotiation_turn_opened',
         jsonb_build_object('claim_id', v_claim.id::text, 'side', v_side, 'phase', 'selected'),
         'negotiation_turn_opened:selected:' || v_claim.id::text || ':' || v_side
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, null, 'unsubscribed.driver_selected', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', v_claim.driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'already', false, 'claim_id', v_claim.id,
                            'position', v_claim.position, 'notifications_queued', v_queued,
                            'order_id', v_neg.order_id);
end;
$$;

revoke execute on function select_unsubscribed_claim(uuid, integer) from public, anon, authenticated;
grant execute on function select_unsubscribed_claim(uuid, integer) to service_role;

-- ----------------------------------------------------------------------------
-- advance_unsubscribed_negotiation_at: «السائقُ التالي» و«إعادةُ فتحِ الطلبِ» بحارسِ
--   البطاقةِ نفسِه — ثمَّ التدويرُ القائمُ **حرفاً** (فلا يتغيّرُ ترتيبٌ ولا نفادٌ ولا إخطارٌ).
-- ----------------------------------------------------------------------------
create or replace function advance_unsubscribed_negotiation_at(
  p_negotiation_id uuid,
  p_position       integer,
  p_reason         text default 'declined'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg   unsubscribed_negotiations%rowtype;
  v_pos   integer;
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

  select position into v_pos from unsubscribed_claims where id = v_neg.active_claim_id;
  if v_pos <> p_position then
    return jsonb_build_object('ok', false, 'error', 'STALE_CARD');
  end if;

  return advance_unsubscribed_negotiation(p_negotiation_id, p_reason);
end;
$$;

revoke execute on function advance_unsubscribed_negotiation_at(uuid, integer, text) from public, anon, authenticated;
grant execute on function advance_unsubscribed_negotiation_at(uuid, integer, text) to service_role;

-- ----------------------------------------------------------------------------
-- withdraw_unsubscribed_claim: «إنهاءُ الانتظارِ والبحثُ عن عروضٍ أخرى». يُغلِقُ مطالبةَ
--   السائقِ **المنتظِرةَ** وحدَها؛ ومن صارَ دورُه نشطاً يُرَدُّ `CLAIM_ACTIVE` (قرارُه
--   الآنَ بيدِ الراكبِ أو المهلةِ). والمقعدُ لا يُعادُ فتحُه: المقاعدُ تُعَدُّ بالمطالباتِ
--   كلِّها، فالانسحابُ لا يُدخِلُ رابعاً في دورةٍ قائمةٍ — يُعادُ النشرُ بدورةٍ تاليةٍ.
-- ----------------------------------------------------------------------------
create or replace function withdraw_unsubscribed_claim(
  p_negotiation_id uuid,
  p_driver_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg    unsubscribed_negotiations%rowtype;
  v_claim  unsubscribed_claims%rowtype;
  v_user   uuid;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;

  select * into v_claim
    from unsubscribed_claims
   where negotiation_id = p_negotiation_id and driver_id = p_driver_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_FOUND');
  end if;
  if v_claim.id = v_neg.active_claim_id then
    return jsonb_build_object('ok', false, 'error', 'CLAIM_ACTIVE');
  end if;
  if v_claim.outcome <> 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'CLAIM_NOT_WAITING');
  end if;

  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = now()
   where id = v_claim.id;

  select user_id into v_user from drivers where id = p_driver_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_user, 'unsubscribed.claim_withdrawn', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', p_driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'claim_id', v_claim.id, 'position', v_claim.position,
                            'order_id', v_neg.order_id);
end;
$$;

revoke execute on function withdraw_unsubscribed_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function withdraw_unsubscribed_claim(uuid, uuid) to service_role;
