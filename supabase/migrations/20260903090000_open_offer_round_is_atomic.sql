-- الغرض: دالّةٌ ذرّيّةٌ واحدةٌ تفتح دورةَ بثٍّ للطلبِ: تحرسُ حالَه وتحجزُ رقمَ
--   دورتِه وتُنشئ عروضَها — كلُّها في معاملةٍ واحدةٍ داخلَ القاعدةِ.
-- الحالة: منفّذٌ فعليّاً — أُضيف في 2026-09-03 تنفيذاً لـ`BUG-005`.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه: packages/infrastructure/dispatch/dispatch-adapters.ts
--   (`createOfferWriter.openRound`) وحدَه.
-- ملاحظات مستقبلية: أيُّ سببِ رفضٍ جديدٍ يُضاف في المغلَّفِ لا في التطبيقِ؛ قارئُ
--   المغلَّفِ يتعامَل مع ما لا يعرفُه رفضاً لا نجاحاً.
--
-- ## الخللُ الذي تُغلقُه
--
-- كان فتحُ الدورةِ يقعُ في خطوتَينِ متباعدتَينِ: `matchOrder` تقرأ `status` في
-- التطبيقِ وتقارنُه في JavaScript، ثمّ `openRound` تكتبُ الصفوفَ بعدَ ذلك بلا
-- حراسةٍ في القاعدةِ ولا قفلٍ للصفِّ. وبينَ القراءةِ والكتابةِ نافذةٌ كاملةٌ:
-- استدعاءانِ متزامنانِ يقرآنِ `searching` و`broadcast_round = N` معاً، فيفتحُ
-- كلاهما الدورةَ `N+1`، وتُكتبُ عروضٌ مرّتَينِ، ويُرفَع الرقمُ إلى القيمةِ نفسِها
-- مرّتَينِ — «جولةٌ مزدوجةٌ» بالضبطِ. وأسوأُ منها: طلبٌ أُسنِد أو أُلغيَ بينَهما
-- تُفتَح له دورةٌ وتُرسَل عروضُه إلى سائقينَ لطلبٍ لم يعُد يبحثُ.
--
-- ## لماذا `update … where` شرطيّةٌ لا `select … for update` ثمَّ فحصٌ
--
-- العقدُ يطلبُ قراراً ذرّيّاً داخلَ القاعدةِ، والقفلُ وسيلةٌ لا غايةٌ. والجملةُ
-- الشرطيّةُ الواحدةُ تُحقِّقُ الغايةَ بأقلَّ:
--
--   ١) هي نفسُها تأخُذ قفلَ الصفِّ الحصريَّ عندَ نجاحِها، فالفائزُ يُمسِكُ الصفَّ
--      حتّى نهايةِ المعاملةِ تماماً كما لو قَفَلَه صراحةً.
--   ٢) وتحتَ `read committed` — وهو مستوى العزلِ الافتراضيُّ هنا — تنتظرُ
--      المتنافسةُ الثانيةُ قفلَ الأولى، ثمَّ **تُعيدُ تقييمَ الشرطِ على الصورةِ
--      الجديدةِ للصفِّ** (`EvalPlanQual`). فبعدَ أن رفعَ الفائزُ `broadcast_round`
--      إلى `N+1` لا يعودُ شرطُ الخاسرةِ (`broadcast_round = N`) صادقاً، فتُصيبُ
--      صفراً من الصفوفِ وتخسرُ حسماً — بلا انتظارٍ ولا إعادةِ محاولةٍ ولا نومٍ.
--   ٣) وفي مسارِ **الرفضِ** لا تأخُذ قفلاً أصلاً، بخلافِ `select … for update`
--      الذي يقفلُ الصفَّ قبلَ أن يُعلَمَ أصلاً هل سيُكتَبُ فيه شيءٌ. وهذا فرقٌ
--      عمليٌّ لا تجميليٌّ: `claim_ride` القائمةُ تستعمل `for update skip locked`،
--      أي أنَّ صفَّاً مقفولاً عندَها ليس صفَّاً منتظِراً بل **سائقٌ يُبلَّغُ أنَّ
--      غيرَه سبقَه**. فكلُّ قفلٍ زائدٍ نأخُذُه هنا يتحوَّلُ عندَ السائقِ إلى رفضِ
--      قبولٍ كاذبٍ. فالأقلُّ قفلاً هنا هو الأصحُّ سلوكاً لا الأسرعُ فحسبُ.
--
-- ## ولماذا حراسةُ الرقمِ إلى جانبِ حراسةِ الحالةِ
--
-- حراسةُ `status = 'searching'` وحدَها **لا تمنعُ الجولةَ المزدوجةَ**: فتحُ
-- الدورةِ لا يُغيّرُ حالَ الطلبِ، فيبقى `searching` بعدَ الفائزِ، فتجدُ الخاسرةُ
-- شرطَها صادقاً وتفتحُ دورةً ثانيةً. الحارسُ الذي يمنعُ الازدواجَ فعلاً هو
-- مقارنةُ-وتبديلُ رقمِ الدورةِ: «لا أفتحُ `N+1` إلّا إن كان الطلبُ ما يزالُ عندَ
-- `N` الذي قرأتُه». والحالةُ تُحرَسُ معَه لا بدلاً منه، لأنَّها هي التي تمنعُ
-- العرضَ على طلبٍ أُسنِد أو أُلغيَ.
--
-- ## الذرّيّةُ الكاملةُ لا نصفُ الجولةِ
--
-- الحجزُ وإدخالُ العروضِ في جسمِ دالّةٍ واحدةٍ، ودالّةُ PL/pgSQL تجري كلُّها في
-- معاملةٍ واحدةٍ. فإن فشلَ إدخالُ أيِّ عرضٍ — قيدٌ، مفتاحٌ أجنبيٌّ، أيُّ شيءٍ —
-- تراجعَ معَه رفعُ `broadcast_round` نفسُه. فلا يبقى طلبٌ رُفِعَ رقمُه بلا عروضٍ،
-- ولا عروضٌ بلا رقمٍ: إمّا الجولةُ كاملةً أو لا شيءَ.
--
-- ## الرجوعُ
--
-- إضافةُ دالّةٍ جديدةٍ لا تُضيِّقُ مخطّطاً ولا تكسرُ نسخةً سابقةً: النسخةُ القديمةُ
-- لا تناديها فلا تتأثّرُ بوجودِها. والرجوعُ عنها `drop function` بلا فقدِ بياناتٍ.

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
begin
  -- الحجزُ والحراسةُ في جملةٍ واحدةٍ: من تُصِب صفّاً فقد ظفرَ بالدورةِ وحدَه.
  update orders
     set broadcast_round = p_round,
         updated_at      = now()
   where id              = p_order_id
     and status          = 'searching'
     and broadcast_round = p_round - 1
  returning * into v_order;

  if not found then
    -- الرفضُ يقولُ سببَه بدقّةٍ: «لم يعُد يبحثُ» غيرُ «سبقَني غيري إلى الدورةِ».
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

  -- المدينةُ تُؤخَذ من الصفِّ المحجوزِ لا من الوسيطِ: العرضُ يُكتَبُ في مدينةِ
  -- الطلبِ التي قُرئت داخلَ المعاملةِ نفسِها التي حجزَت الدورةَ.
  insert into order_offers
    (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
  select v_order.city_id,
         p_order_id,
         (entry->>'driver_id')::uuid,
         p_round,
         (entry->>'score')::numeric,
         (entry->>'distance_km')::numeric,
         'pending',
         p_expires_at
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) as entry
  on conflict (order_id, driver_id, round) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('ok', true, 'round', p_round, 'offers', v_inserted);
end;
$$;

comment on function open_offer_round(uuid, integer, timestamptz, jsonb) is
  'فتحُ دورةِ بثٍّ ذرّيٌّ: يحرسُ status=searching ويحجزُ رقمَ الدورةِ ويُنشئُ عروضَها في معاملةٍ واحدةٍ (BUG-005).';

-- سطحُ الصلاحياتِ مغلقٌ بالمرحلةِ الثالثةِ: والدالّةُ الجديدةُ تولدُ ممنوحةً
-- لـ`public` بحكمِ PostgreSQL، فيُسحَبُ منه صراحةً وُيُقصَرُ على دورِ الخدمةِ —
-- وإلّا صار فتحُ الدوراتِ قابلاً للنداءِ من `anon` عبرَ PostgREST.
revoke all on function open_offer_round(uuid, integer, timestamptz, jsonb) from public;
grant execute on function open_offer_round(uuid, integer, timestamptz, jsonb) to service_role;
