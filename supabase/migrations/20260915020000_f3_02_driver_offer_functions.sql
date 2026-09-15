-- migration-phase: expand
-- =============================================================================
-- `F3-02` · `SD-03` + `SD-04` — دوالُّ عروضِ السائقِ: لوحُ عروضٍ بمؤقّتٍ من
--   القاعدةِ، وتفاصيلُ عرضٍ واحدٍ، **وقبولٌ يُفوَّضُ إلى `claim_ride` القائمةِ**.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-offers.test.ts · scripts/check-driver-offers-contract.ts
-- الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
--
-- ## المؤقّتُ حقيقةُ خادمٍ لا ساعةُ جهازٍ
--
-- مهلةُ العرضِ مكتوبةٌ في `order_offers.expires_at`، ومَن يقرؤها يجبُ أن يقرأَ
-- معَها **زمنَ الخادمِ نفسِه**. فلو حسبَ الهاتفُ الباقيَ بساعتِه لكانَ سائقٌ
-- ساعتُه متأخّرةٌ دقيقتَينِ يرى عرضاً منتهياً «باقياً»، ويضغطُ قبولاً يُرَدُّ.
-- ولذا يُنشَرُ رقمانِ معاً — `seconds_left` و`server_time` — **ولا تُنشَرُ**
-- `expires_at` ألبتّةَ: لحظةٌ مُطلقةٌ في الحمولةِ دعوةٌ إلى مقارنتِها بساعةِ
-- الجهازِ، والباقي وحدَه يكفي. والعدُّ في الشاشةِ فرقُ **قراءتَينِ لساعةِ الجهازِ
-- نفسِها** يُنقَصُ من الباقي المنشورِ، فينحذفُ انحرافُها لأنّه في القراءتَينِ.
--
-- ## والقبولُ كاتبٌ واحدٌ (القاعدة 0.6)
--
-- `claim_ride(uuid, uuid)` قائمةٌ منذُ `20260814160000`: تقفلُ الطلبَ
-- `for update skip locked`، وتُلغي عروضَ المنافسينَ، وتكتبُ `audit_log`، وتحكمُ
-- على المدينةِ. **فلا ذرّيّةَ ثانيةً ههنا**: `driver_accept_offer` تحلُّ الهويّةَ
-- وتُسلِّمُ، ثمَّ تُنقِّي الجوابَ. وذرّيّةٌ ثانيةٌ لا تكونُ «تعزيزاً» بل تكونُ
-- صفَّينِ لطلبٍ واحدٍ يومَ يختلفُ الشرطانِ.
--
-- ## وما لا تفعلُه هذه الدوالُّ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تحملُ لفظَ أجرةٍ ولا وسيلةَ دفعٍ ولا خانةً لهما** (`ADR 0039` §٤ ·
--      `م13-7` · `DEC-11`): الطبقةُ الماليّةُ **غائبةٌ بإعلانٍ** لا مُهيَّأٌ لها
--      حقلٌ فارغٌ — والحاجزُ يُسقِطُ CI على لفظٍ منها في هذه الشريحةِ.
--   ــ **لا تُعيدُ قياسَ المسافةِ إلى الراكبِ**: المنشورُ `order_offers.distance_km`
--      كما قِيسَ **لحظةَ البثِّ** في طبقةِ التوزيعِ، موسوماً `STRAIGHT_LINE`.
--      ووترُ الرحلةِ يُقاسُ ههنا بـ`st_distance` على `geography` — وكلاهما
--      **خطٌّ مستقيمٌ لا مسافةُ طريقٍ** (`ADR 0024`).
--   ــ **لا تُعيدُ هويّةَ الراكبِ**: `claim_ride` تُعيدُ في جوابِها معرِّفَ
--      تلغرامَ ولغةَ الراكبِ، و`driver_accept_offer` **تُسقِطُهما**. وسطحُ
--      التواصلِ بعدَ المطابقةِ بندٌ آخرُ، ونشرُ معرِّفٍ لا تحتاجُه الشاشةُ
--      توسيعٌ للسطحِ بلا حاجةٍ.
--   ــ **لا ترفضُ عرضاً**: الرفضُ كاتبُه القائمُ `offers.reject` (`BUG-003`).
--   ــ **لا تُبدِّلُ التوفُّرَ**: كاتبُه القائمُ `record_attendance`.
-- =============================================================================

-- ── ١) لوحُ العروضِ — العرضُ ومهلتُه وقياساتُه، وسببُ الفراغِ إن كانَ ──────────
-- والفراغُ ههنا **مفسَّرٌ**: قائمةٌ خاليةٌ لأنَّ لا عرضَ ليسَت كقائمةٍ خاليةٍ
-- لأنَّ وثيقةً منتهيةٌ تحجبُ السائقَ عن البثِّ (`F12-14`). فيُنشَرُ الحجبُ معَ
-- القائمةِ لتقولَ الشاشةُ السببَ لا «لا عروضَ الآنَ» وحدَها.
create or replace function driver_offer_board(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_availability driver_availability%rowtype;
  v_reasons text[];
  v_offers jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_availability from driver_availability where driver_id = v_driver.id;

  v_reasons := driver_document_dispatch_block_reasons(v_driver.id);

  select coalesce(jsonb_agg(entry order by expires_at), '[]'::jsonb)
    into v_offers
    from (
      select o.expires_at,
             jsonb_build_object(
               'offer_id', o.id,
               'order_id', o.order_id,
               'round', o.round,
               'service', r.service,
               -- **ولا تُنشَرُ لحظةُ الانتهاءِ نفسُها**: قيمةٌ مُطلقةٌ في الحمولةِ
               -- دعوةٌ إلى مقارنتِها بساعةِ الجهازِ، وساعةُ هاتفٍ منحرفةٌ دقيقةً
               -- تُخفي عرضاً صالحاً أو تُبقي منتهياً. فالباقي وحدَه يُنشَرُ
               -- ولحظةُ الخادمِ معَه، فيكونُ العدُّ فرقاً لا مقارنةً.
               -- الباقي بساعةِ القاعدةِ، ولا سالبَ يُنشَرُ: صفرٌ يعني «انتهَت».
               'seconds_left',
               greatest(0, floor(extract(epoch from (o.expires_at - v_now)))::integer),
               -- المسافةُ **موسومةٌ في نوعِها** لا رقمٌ عارياً (`ADR 0024`):
               -- نسبةُ الانعراجِ المقيسةُ هناكَ تجعلُ رقماً بلا وسمٍ كذباً.
               'rider_distance', case
                 when o.distance_km is null then null
                 else jsonb_build_object(
                        'kind', 'STRAIGHT_LINE',
                        'meters', round(o.distance_km * 1000, 1))
               end,
               'trip_distance', case
                 when r.dropoff is null then null
                 else jsonb_build_object(
                        'kind', 'STRAIGHT_LINE',
                        'meters', round(st_distance(r.pickup, r.dropoff)::numeric, 1))
               end,
               'pickup_label', r.pickup_label,
               'dropoff_label', r.dropoff_label
             ) as entry
        from order_offers o
        join orders r on r.id = o.order_id
       where o.driver_id = v_driver.id
         and o.status = 'pending'
         and o.expires_at > v_now
         -- طلبٌ خرجَ من البحثِ لا يُعرَضُ ولو بقيَ صفُّ عرضِه معلَّقاً.
         and r.status = 'searching'
    ) as built;

  return jsonb_build_object(
    'ok', true,
    -- **زمنُ الخادمِ يُنشَرُ صريحاً**: بغيرِه لا يقدرُ العميلُ أن يعرفَ فرقَ
    -- ساعتِه، فيصيرُ عدُّه التنازليُّ زينةً.
    'server_time', v_now,
    'is_available', coalesce(v_availability.is_available, false),
    'availability_changed_at', v_availability.changed_at,
    'block_reasons', to_jsonb(v_reasons),
    'is_blocked', array_length(v_reasons, 1) is not null,
    'offers', v_offers
  );
end;
$$;

comment on function driver_offer_board(bigint) is
  'لوحُ عروضِ السائقِ: العروضُ المعلَّقةُ غيرُ المنتهيةِ بمؤقّتٍ من ساعةِ القاعدةِ ومسافاتٍ موسومةٍ، ومعَها حالةُ التوفُّرِ وأسبابُ الحجبِ (SD-03).';

-- ── ٢) تفاصيلُ عرضٍ واحدٍ — الانطلاقُ والوجهةُ وملاحظةُ الراكبِ ──────────────
-- والمِلكيّةُ **قيدُ استعلامٍ** لا فحصٌ في الطبقةِ: عرضُ سائقٍ آخرَ يُرَدُّ
-- بالرمزِ نفسِه الذي يُرَدُّ به معرِّفٌ معدومٌ، فلا يُكشَفُ وجودُ صفٍّ لمَن لا
-- يملكُه.
create or replace function driver_offer_detail(
  p_telegram_id bigint,
  p_offer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_offer order_offers%rowtype;
  v_order orders%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_offer
    from order_offers
   where id = p_offer_id and driver_id = v_driver.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_FOUND');
  end if;

  select * into v_order from orders where id = v_offer.order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'server_time', v_now,
    'offer_id', v_offer.id,
    'order_id', v_order.id,
    'round', v_offer.round,
    'service', v_order.service,
    'offer_status', v_offer.status,
    'order_status', v_order.status,
    -- **لا لحظةَ انتهاءٍ مُطلقةً** لعينِ ما عُلِّلَ في اللوحِ أعلاه.
    'seconds_left',
    greatest(0, floor(extract(epoch from (v_offer.expires_at - v_now)))::integer),
    -- **القبولُ حكمُ خادمٍ**: تُنشَرُ صلاحيّتُه ههنا لتُخفي الشاشةُ زرّاً لا
    -- يعملُ، ولا تحكمُ الشاشةُ عليها بنفسِها — وبابٌ تفتحُه الشاشةُ وترفضُه
    -- القاعدةُ عطبُ منتَجٍ.
    'is_claimable', v_offer.status = 'pending'
                    and v_offer.expires_at > v_now
                    and v_order.status = 'searching',
    'pickup', jsonb_build_object(
      'label', v_order.pickup_label,
      'latitude', st_y(v_order.pickup::geometry),
      'longitude', st_x(v_order.pickup::geometry)
    ),
    -- ورحلةٌ بلا وجهةٍ **عَدَمٌ لا صفرٌ** (`ADR 0023`): «٠ متراً» تُقرأُ
    -- «لم تتحرَّكْ» لا «لم تُحدَّدْ».
    'dropoff', case
      when v_order.dropoff is null then null
      else jsonb_build_object(
             'label', v_order.dropoff_label,
             'latitude', st_y(v_order.dropoff::geometry),
             'longitude', st_x(v_order.dropoff::geometry))
    end,
    'rider_distance', case
      when v_offer.distance_km is null then null
      else jsonb_build_object(
             'kind', 'STRAIGHT_LINE',
             'meters', round(v_offer.distance_km * 1000, 1))
    end,
    'trip_distance', case
      when v_order.dropoff is null then null
      else jsonb_build_object(
             'kind', 'STRAIGHT_LINE',
             'meters', round(st_distance(v_order.pickup, v_order.dropoff)::numeric, 1))
    end,
    'notes', v_order.notes
  );
end;
$$;

comment on function driver_offer_detail(bigint, uuid) is
  'تفاصيلُ عرضٍ واحدٍ للسائقِ صاحبِه: انطلاقٌ ووجهةٌ وملاحظةُ الراكبِ وقياساتٌ موسومةٌ ومؤقّتٌ وصلاحيّةُ قبولٍ (SD-04).';

-- ── ٣) القبولُ — تفويضٌ إلى `claim_ride` ثمَّ تنقيةُ الجوابِ ──────────────────
create or replace function driver_accept_offer(
  p_telegram_id bigint,
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_offer order_offers%rowtype;
  v_claim jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_offer
    from order_offers
   where id = p_offer_id and driver_id = v_driver.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_FOUND');
  end if;

  -- **ههنا يقفُ حدُّ هذه الدالّةِ**: لا قفلَ ولا تحديثَ حالةٍ ولا إلغاءَ
  -- منافسٍ — كلُّ ذاكَ في `claim_ride` وحدَها، ورموزُها تُمرَّرُ كما هيَ
  -- (`ORDER_NOT_CLAIMABLE` · `OFFER_NOT_VALID` · `CITY_MISMATCH`).
  v_claim := claim_ride(v_offer.order_id, v_driver.id);

  if coalesce((v_claim->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_claim->>'order_id',
      'matched_at', v_claim->>'matched_at'
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', coalesce(v_claim->>'error', 'CLAIM_REFUSED')
  );
end;
$$;

comment on function driver_accept_offer(bigint, uuid) is
  'قبولُ عرضٍ من سطحِ السائقِ: يحلُّ الهويّةَ ثمَّ يُفوِّضُ الذرّيّةَ إلى claim_ride ويُنقّي الجوابَ من هويّةِ الراكبِ (SD-03 · SD-04).';

-- ── ٤) الصلاحيّاتُ — لا شيءَ لـ`anon` ولا لـ`authenticated` ─────────────────
revoke all on function driver_offer_board(bigint) from public, anon, authenticated;
revoke all on function driver_offer_detail(bigint, uuid) from public, anon, authenticated;
revoke all on function driver_accept_offer(bigint, uuid) from public, anon, authenticated;

grant execute on function driver_offer_board(bigint) to service_role;
grant execute on function driver_offer_detail(bigint, uuid) to service_role;
grant execute on function driver_accept_offer(bigint, uuid) to service_role;
