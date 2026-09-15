-- migration-phase: expand
-- =============================================================================
-- `F12-14` — **تضييقُ بابِ الحجبِ إلى ما نصَّت عليه الخارطةُ**: العرضُ يُحجَبُ
--   عن السائقِ حينَ تقولُ وثيقةٌ **قائمةٌ** كلمةً مُناقِضةً — انتهاءً أو رفضاً —
--   لا حينَ تسكتُ الوثائقُ كلُّها.
--
-- الحالة: تصحيحٌ بالإضافةِ على `20260915000500` (`ح-8`) — لا سطرَ يُمحى منها.
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-documents.test.ts (البنود ٢٣–٢٧)
-- الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
--
-- ## القياسُ الذي أوجبَ هذا التصحيحَ
--
-- الهجرةُ `20260915000500` صفَّت من `open_offer_round` كلَّ سائقٍ له **أيُّ**
-- سببِ حجبٍ، وفي القائمةِ `MISSING:` و`UNVERIFIED:`. وحكمُ CI على `PR #40`
-- قالَ الحقَّ بلا مواربةٍ: **46 اختبارَ تكاملٍ أخفقَ** في مساراتٍ لا علاقةَ لها
-- بالوثائقِ (`full-ride` · `notification_outbox` · `five-cities-launch` ·
-- `mutual-ratings` · `dispatch-*`)، لأنَّ سائقيها مزروعونَ
-- `verification_status = 'verified'` بلا صفِّ وثيقةٍ واحدٍ. وذاكَ ليسَ عيبَ
-- اختبارٍ **بل عيبُ الحاجزِ**: في القاعدةِ الحقيقيّةِ كلُّ سائقٍ اعتمدَته
-- الإدارةُ قبلَ `F3-01` **سيَخرُجُ من الإسنادِ في لحظةِ نشرِ الهجرةِ**، بلا
-- سطرِ ترحيلٍ ولا إشعارٍ ولا بابٍ يُصلِحُ بهِ حالَه. هذا انقطاعُ خدمةٍ لا إنفاذُ
-- لائحةٍ.
--
-- ## ولِمَ التضييقُ هوَ النصُّ لا التخفيفُ
--
--   ــ **نصُّ البندِ**: «حجبُ السائقِ تلقائيّاً **عندَ انتهاءِ صلاحيةِ** أيِّ
--      وثيقةٍ إلزاميّةٍ» — والقياسُ المكتوبُ في الخارطةِ نفسِها: «بتغييرِ
--      تاريخٍ وحدَه ثمَّ غيابِ العرضِ». فالانتهاءُ والرفضُ داخلَ النصِّ،
--      و«لم يرفعْ بعدُ» خارجَه.
--   ــ **أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ**: أهليّةُ سائقٍ لم يرفعْ وثيقةً بعدُ
--      محكومةٌ أصلاً بـ`drivers.verification_status` — وهوَ المصدرُ الذي يقيسُه
--      `tests/integration/driver-visibility-*` باسمِ «مصدرٌ واحدٌ للتوثيقِ».
--      وإضافةُ فحصٍ ثانٍ للغيابِ تجعلُ للأهليّةِ حاكمَينِ يختلفانِ.
--   ــ **الحاجزُ يبقى آخرَ بابٍ**: الشرطُ ما زالَ في الدالّةِ نفسِها، فلا
--      سكربتٌ ولا لوحةٌ تُدخِلُ عرضاً لسائقٍ وثيقتُه منتهيةٌ.
--
-- ## وما لا يُدَّعى (`ح-5`)
--
--   ــ **لا يُدَّعى أنَّ الإلزامَ صارَ مُنفَذاً**: منعُ سائقٍ **ناقصِ** الوثائقِ
--      من الاعتمادِ بابُه `verify_driver` في لوحِ المراجعةِ (`SD-02` · `F4-xx`)،
--      وهوَ **دَينٌ مُعلَنٌ** ههنا لا مُنجَزٌ. `driver_document_block_reasons`
--      تُعيدُ `MISSING:` كما كانَت، والشاشةُ تعرضُها، ولوحُ المراجعةِ سيقرؤها.
--   ــ **لا حرفَ في توقيعِ** `open_offer_round(uuid, integer, timestamptz, jsonb)`
--      ولا في مفاتيحِ جوابِها، و`blocked_by_documents` يبقى معنى واحداً:
--      «كم مرشَّحاً أسقطَته وثيقةٌ مُناقِضةٌ».
-- =============================================================================

-- ── ١) سببُ الحجبِ في مسارِ الإسنادِ — مُشتقٌّ لا مكرَّرٌ ─────────────────────
-- **يُبنى على الدالّةِ الأمِّ** لا بنسخِ منطقِها: مصدرُ اشتقاقِ الأسبابِ واحدٌ،
-- وهذا لا يُصفّي إلّا ما هوَ مُناقِضٌ. فتغييرُ قاعدةِ الانتهاءِ يوماً واحداً
-- يسري على البابَينِ معاً بلا مُزامنةٍ يدويّةٍ.
create or replace function driver_document_dispatch_block_reasons(
  p_driver_id uuid,
  p_today date default current_date
) returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           array_agg(reason order by reason) filter (
             where reason like 'EXPIRED:%' or reason like 'REJECTED:%'
           ),
           array[]::text[]
         )
    from unnest(driver_document_block_reasons(p_driver_id, p_today)) as t(reason);
$$;
comment on function driver_document_dispatch_block_reasons(uuid, date) is
  'أسبابُ الحجبِ التي تُسقِطُ مرشَّحاً من دورةِ العرضِ: وثيقةٌ قائمةٌ منتهيةٌ أو مرفوضةٌ — لا وثيقةٌ لم تُرفَعْ بعدُ (F12-14).';

-- ── ٢) البابُ نفسُه — شرطٌ واحدٌ تغيَّرَ اسمُ دالّتِه ─────────────────────────
create or replace function open_offer_round(
  p_order_id   uuid,
  p_round      integer,
  p_expires_at timestamptz,
  p_entries    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_status   text;
  v_inserted integer;
  v_offer_ids jsonb;
  v_requested integer;
  v_eligible integer;
begin
  -- الحجزُ والحراسةُ في جملةٍ واحدةٍ: من تُصِب صفّاً فقد ظفرَ بالدورةِ وحدَه.
  -- (`BUG-005` — لا حرفَ تغيَّرَ ههنا.)
  update orders
     set broadcast_round = p_round,
         updated_at      = now()
   where id              = p_order_id
     and status          = 'searching'
     and broadcast_round = p_round - 1
  returning * into v_order;

  if not found then
    select status::text into v_status from orders where id = p_order_id;
    if v_status is null then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
    end if;
    if v_status <> 'searching' then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_SEARCHING',
                                'status', v_status);
    end if;
    return jsonb_build_object('ok', false, 'error', 'ROUND_ALREADY_OPENED',
                              'status', v_status);
  end if;

  -- `F12-14`: المدخلاتُ تُصفَّى **قبلَ** الإدراجِ، والعددانِ يُقاسانِ من
  -- المصدرِ نفسِه فلا فرقَ بينَ ما قِيسَ وما نُفِّذَ. والسببُ المُسقِطُ
  -- **مُناقِضٌ لا غائبٌ**: منتهيةٌ أو مرفوضةٌ (سببُ التضييقِ في رأسِ الملفِّ).
  with requested as (
    select (entry->>'driver_id')::uuid as driver_id,
           (entry->>'score')::numeric as score,
           (entry->>'distance_km')::numeric as distance_km
      from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
  ),
  eligible as (
    select r.*
      from requested r
     where cardinality(driver_document_dispatch_block_reasons(r.driver_id)) = 0
  ),
  inserted as (
    insert into order_offers
      (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
    select v_order.city_id, p_order_id, e.driver_id, p_round, e.score, e.distance_km,
           'pending', p_expires_at
      from eligible e
    on conflict (order_id, driver_id, round) do nothing
    returning id, driver_id
  ),
  outboxed as (
    insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id)
    select v_order.city_id, 'offer', id, p_order_id, driver_id
      from inserted
  )
  select (select count(*)::integer from requested),
         (select count(*)::integer from eligible),
         (select count(*)::integer from inserted),
         (select coalesce(jsonb_agg(jsonb_build_object('offer_id', id, 'driver_id', driver_id)),
                          '[]'::jsonb)
            from inserted)
    into v_requested, v_eligible, v_inserted, v_offer_ids;

  return jsonb_build_object('ok', true, 'round', p_round,
                           'offers', v_inserted,
                           'offer_ids', v_offer_ids,
                           'blocked_by_documents', v_requested - v_eligible);
end;
$$;

comment on function open_offer_round(uuid, integer, timestamptz, jsonb) is
  'فتحُ دورةِ بثٍّ ذرّيٌّ (BUG-005 + BUG-004 + BUG-003)، **ويُصفّي السائقَ المحجوبَ بوثيقةٍ منتهيةٍ أو مرفوضةٍ قبلَ الإدراجِ** ويُعيدُ عددَ المحجوبينَ (F12-14 · ADR 0115).';

revoke all on function open_offer_round(uuid, integer, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function open_offer_round(uuid, integer, timestamptz, jsonb) to service_role;

revoke all on function driver_document_dispatch_block_reasons(uuid, date)
  from public, anon, authenticated;
grant execute on function driver_document_dispatch_block_reasons(uuid, date) to service_role;
