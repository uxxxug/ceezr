-- migration-phase: expand
-- =============================================================================
-- الغرض: مشاركةُ الرحلةِ برابطٍ مؤقّتٍ من التطبيقِ المصغَّرِ (`F2-09` · `SR-13`) —
--   **حكمٌ واحدٌ لموقعِ السائقِ** تقرؤُه الصفحةُ العامّةُ ومعاينةُ المالكِ معاً،
--   وحالةُ مشاركةٍ للمالكِ (روابطُه الساريةُ ببقيّةِ صلاحيتِها) في نداءٍ واحدٍ.
-- الحالة: منفَّذٌ فعليّاً — البند `F2-09`. وحكمُ CI عليهِ **غيرُ مقروءٍ** يومَ
--   كتابتِه (الحاجز `B-CI-001`: شغلاتُ Actions لا تبدأُ لسببِ فوترةٍ).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/transport/ride-share-store.ts` و
--   `packages/infrastructure/tracking/tracking-token-adapters.ts`.
-- يُتوقع أن يستخدمه لاحقاً: `F2-10` (الطوارئُ) حينَ يحتاجُ موقعاً بحكمِه نفسِه
--   — فيُنادي `tracking_link_view` ولا يكتبُ تصنيفاً ثالثاً.
--
-- ## العطبُ الذي تُصلِحُه هذه الهجرةُ — مقيسٌ بالقراءةِ لا مُستنتَجٌ
--
-- `get_tracking_position(text)` (هجرةُ `20260814150000`) كانت تنشرُ `lat`/`lng`
-- لمن يحملُ الرابطَ **بلا حدِّ عُمرٍ**: نقطةٌ كُتِبَت قبلَ ساعتَينِ تُرسَمُ على
-- خريطةِ الصفحةِ كأنّها الآنَ، ومَن ينتظرُ ابنَتَه يقرأُ «هيَ هناكَ» عن مكانٍ
-- غادرَته. وفي الوقتِ نفسِه شاشةُ **المالكِ** (`F2-06`) تحجبُ كلَّ نقطةٍ فوقَ
-- تسعينَ ثانيةً وتُصنِّفُ سببَ الحجبِ (`NEVER_REPORTED` · `NO_TIMESTAMP` ·
-- `TOO_OLD`). فكانَ الغريبُ المجهولُ يُعطى ثقةً **أعلى** من صاحبِ الرحلةِ.
--
-- و`SR-13` يطلبُ «معاينةَ ما سيراهُ المستلمُ». ومعاينةٌ مبنيّةٌ فوقَ مصدرٍ
-- ثانٍ — ولو بمنطقٍ مُشابِهٍ — **كذبةٌ بالبناءِ**: شاشةٌ تُطمئنُ عن شاشةٍ لا
-- تعرفُها. فالحلُّ ليسَ «تكرارَ الحجبِ في مكانَينِ» بل **دالّةَ عرضٍ واحدةً**
-- يُنادِيها الطريقانِ، وتُعيدُ الحمولةَ نفسَها حرفاً.
--
-- ## ولماذا الحجبُ في القاعدةِ لا في الواجهةِ
--
-- لو خرجَت الإحداثيّةُ من القاعدةِ ثمّ أخفَتها الواجهةُ، لَكانت في السلكِ وفي
-- سجلِّ الوسيطِ وفي أدواتِ المتصفِّحِ. ومَن يفتحُ الصفحةَ العامّةَ **مجهولٌ**،
-- ولا طبقةَ ثقةٍ بينَه وبينَ الردِّ. فالحكمُ: **ما لا يُعرَضُ لا يُرسَلُ**، وما
-- يُرسَلُ يُرسَلُ **مقروناً بعُمرِه** لا عارياً.
--
-- ## ولماذا الحدُّ إعدادٌ لكلِّ مدينةٍ لا رقمٌ في الشِّفرةِ
--
-- «تسعونَ ثانيةً» قيمةُ عملٍ (القاعدة 0.3): مدينةٌ بتغطيةِ شبكةٍ رديئةٍ قد
-- تختارُ مئةً وعشرينَ، وأخرى ستّينَ. فيُبذَرُ `driver_position_max_age_seconds`
-- لكلِّ مدينةٍ **بقيمةِ ٩٠ نفسِها** — أي **لا يتغيَّرُ سلوكُ `F2-06` بحرفٍ** —
-- ويُحرَسُ تطابقُها معَ ثابتِ النطاقِ `DRIVER_POSITION_MAX_AGE_SECONDS` بحاجزٍ
-- ساكنٍ في CI، فلا تنزلقُ إحداهُما عن الأخرى بصمتٍ.
--
-- وإن غابَ الإعدادُ **لا تُرفَعُ استثناءٌ ولا يُفتَحُ البابُ**: يُؤخَذُ الحدُّ
-- الافتراضيُّ الأصرمُ (٩٠) و**يُنشَرُ مصدرُه** (`FALLBACK_DEFAULT`) في الردِّ
-- نفسِه — إعلانٌ لا صمتٌ، كما فعلَ `F2-08` بالمنطقةِ الزمنيّةِ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- - **لا جدولَ جديدٌ ولا عمودَ جديدٌ**: `trip_tracking_tokens` كما هيَ، والإصدارُ
--   والإلغاءُ دالّتاهُما القائمتانِ (القاعدة 0.6).
-- - **لا تكتبُ موقعاً ولا تمسُّ `drivers.last_location`**: كتابتُه غيرُ محروسةٍ
--   بترتيبٍ (`BUG-001`) وذاكَ بندٌ آخرُ باسمِه — وهذه قراءةٌ محضةٌ.
-- - **لا تنشرُ هويّةً في المسارِ العامِّ**: لا اسمَ سائقٍ ولا لوحةَ سيّارةٍ ولا
--   معرّفَ طلبٍ ولا وجهةً. مَن يحملُ الرابطَ يرى **نقطةً وعُمرَها وهل الرحلةُ
--   جاريةٌ** — وهذا كلُّ ما وُعِدَ بهِ.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- (١) الإعدادُ التجاريُّ — حدُّ عُمرِ النقطةِ، لكلِّ مدينةٍ.
-- ----------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'driver_position_max_age_seconds',
       '90'::jsonb,
       'number',
       'أقصى عُمرٍ بالثواني تُعرَضُ عندَه نقطةُ السائقِ (للمالكِ ولحاملِ رابطِ المشاركةِ معاً). فوقَه تُحجَبُ الإحداثيّةُ ويُنشَرُ السببُ TOO_OLD.',
       false
  from cities c
on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- (٢) دالّةُ العرضِ المشتركةُ — **الحَكَمُ الوحيدُ** لما يُرى عن موقعِ السائقِ.
--
-- تُنادى من موضعَينِ: `get_tracking_position(text)` بعدَ التحقّقِ من الرمزِ،
-- و`rider_ride_share_state(bigint, uuid)` بعدَ التحقّقِ من الملكيّةِ. **ولا
-- تتحقّقُ هيَ من إذنٍ قطُّ** — وهذا مقصودٌ: خلطُ الإذنِ بالعرضِ يجعلُ كلَّ
-- قارئٍ يرثُ حقوقَ الآخرِ. فالإذنُ عندَ البابَينِ، والجوابُ واحدٌ خلفَهما.
-- ولذلكَ نُزِعَ تنفيذُها عن الأدوارِ العامّةِ في القسمِ (٥).
-- ----------------------------------------------------------------------------

create or replace function tracking_link_view(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_order      record;
  v_age        integer;
  v_max_raw    jsonb;
  v_max_age    integer;
  v_max_source text;
  v_verdict    text;
begin
  select o.id,
         o.status,
         o.city_id,
         d.last_location,
         d.last_location_at
    into v_order
    from orders o
    left join drivers d on d.id = o.assigned_driver_id
   where o.id = p_order_id;

  if not found then
    return null;
  end if;

  -- الحدُّ: إعدادُ المدينةِ إن وُجِدَ، وإلّا الافتراضيُّ الأصرمُ **باسمِه**.
  v_max_raw := get_setting(v_order.city_id, 'driver_position_max_age_seconds');
  if v_max_raw is null then
    v_max_age := 90;
    v_max_source := 'FALLBACK_DEFAULT';
  else
    v_max_age := (v_max_raw #>> '{}')::numeric::integer;
    v_max_source := 'SETTING';
  end if;

  -- عُمرٌ سالبٌ مستحيلٌ منطقاً وممكنٌ بانحرافِ ساعةٍ: يُقصَرُ على الصفرِ ولا
  -- يُقرأُ «المستقبلَ» عُمراً صالحاً بلا حدٍّ.
  v_age := case
             when v_order.last_location_at is null then null
             else greatest(0, floor(extract(epoch from (now() - v_order.last_location_at)))::integer)
           end;

  v_verdict := case
                 when v_order.last_location is null then 'NEVER_REPORTED'
                 when v_age is null                 then 'NO_TIMESTAMP'
                 when v_age > v_max_age             then 'TOO_OLD'
                 else 'LOCATED'
               end;

  return jsonb_build_object(
    'active', is_active_order_status(v_order.status),
    'position', jsonb_build_object(
      'verdict', v_verdict,
      -- العُمرُ يُنشَرُ في كلِّ الأحوالِ التي لهُ فيها معنىً — حتّى معَ الحجبِ:
      -- «آخرُ موقعٍ قبلَ أربعِ دقائقَ» جوابٌ صادقٌ، والفراغُ ليسَ جواباً.
      'age_seconds', v_age,
      'max_age_seconds', v_max_age,
      'max_age_source', v_max_source
    ) || case
           when v_verdict = 'LOCATED' then jsonb_build_object(
             'lat', st_y(v_order.last_location::geometry),
             'lng', st_x(v_order.last_location::geometry)
           )
           -- **الإحداثيّةُ لا تُغادِرُ القاعدةَ متى حُجِبَت**: لا حقلٌ فارغٌ ولا
           -- `null` يُغري قارئاً بملئِه، بل **غيابُ المفتاحِ** أصلاً.
           else '{}'::jsonb
         end
  );
end;
$fn$;

comment on function tracking_link_view(uuid) is
  'F2-09: الحَكَمُ الوحيدُ لما يُرى عن موقعِ سائقِ طلبٍ — تصنيفٌ (LOCATED/NEVER_REPORTED/NO_TIMESTAMP/TOO_OLD) '
  'وعُمرٌ دائماً، والإحداثيّةُ **لا تُنشَرُ إلّا مع LOCATED**. بلا إذنٍ: البابُ عندَ مُنادِيها. '
  'تُنادَى من get_tracking_position (الصفحةُ العامّةُ) ومن rider_ride_share_state (معاينةُ المالكِ) فيتطابقانِ حرفاً.';

-- ----------------------------------------------------------------------------
-- (٣) حالةُ المشاركةِ للمالكِ — نداءٌ واحدٌ: أيُمكنُ؟ وما القائمُ؟ وماذا سيُرى؟
--
-- والملكيّةُ **قيدُ استعلامٍ لا فرعُ `if`**: مَن سألَ عن رحلةِ غيرِه يُجابُ
-- `ORDER_NOT_FOUND` لا `FORBIDDEN`، فلا يُستدَلُّ على وجودِ رحلةٍ بفرقِ رمزَينِ.
--
-- والبقيّةُ `seconds_remaining` **تُحسَبُ بساعةِ القاعدةِ** وتُنشَرُ عدداً: لو
-- أُرسِلَ ختمُ الانتهاءِ وحدَه لَطرحَه الجهازُ بساعتِه، فجهازٌ متأخِّرٌ دقيقتَينِ
-- يعرضُ رابطاً «حيّاً» وقد ماتَ. (نفسُ درسِ `F2-08` معَ المناطقِ الزمنيّةِ.)
-- ----------------------------------------------------------------------------

create or replace function rider_ride_share_state(
  p_telegram_id bigint,
  p_order_id uuid
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_order     record;
  v_links     jsonb;
  v_lifetime  jsonb;
  v_grace     jsonb;
begin
  if p_telegram_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select o.id, o.status, o.city_id
    into v_order
    from orders o
    join riders r on r.id = o.rider_id
    join users u on u.id = r.user_id
   where o.id = p_order_id
     and u.telegram_id = p_telegram_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- الروابطُ الساريةُ وحدَها: المُلغى والمنقضي **لا يُعرَضانِ** — قائمةٌ فيها
  -- «رابطٌ ميّتٌ» تُغري بالظنِّ أنَّ شيئاً ما زالَ مكشوفاً وليسَ كذلكَ.
  -- **ولا يُنشَرُ الرمزُ نفسُه ههنا**: هوَ كلمةُ السرِّ، ويُعادُ مرّةً واحدةً
  -- لحظةَ الإصدارِ. ومَن أضاعَهُ يُصدِرُ غيرَه ويُوقِفُ الكلَّ.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'created_at', t.created_at,
               'seconds_remaining', greatest(0, floor(extract(epoch from (t.expires_at - now())))::integer)
             )
             order by t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_links
    from trip_tracking_tokens t
   where t.order_id = v_order.id
     and t.revoked_at is null
     and t.expires_at > now();

  v_lifetime := get_setting(v_order.city_id, 'tracking_link_max_lifetime_minutes');
  v_grace    := get_setting(v_order.city_id, 'tracking_link_grace_minutes');

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status::text,
    -- الإصدارُ مسموحٌ بالشرطِ الذي تفرضُه `issue_tracking_token` نفسُها لا بشرطٍ
    -- مُوازٍ يُكتَبُ ههنا: رحلةٌ غيرُ جاريةٍ لا رابطَ لها.
    'can_share', is_active_order_status(v_order.status),
    'links', v_links,
    -- القيمتانِ **تُنشَرانِ ليُعرَضَا** لا لتُحسَبَ بهما مدّةٌ في الجهازِ:
    -- «الرابطُ يعملُ حتّى نهايةِ الرحلةِ وربعَ ساعةٍ بعدَها» جملةٌ يجبُ أن تُقالَ
    -- بالقيمةِ الفعليّةِ للمدينةِ لا برقمٍ مكتوبٍ في الواجهةِ.
    'max_lifetime_minutes', case when v_lifetime is null then null else (v_lifetime #>> '{}')::numeric::integer end,
    'grace_minutes', case when v_grace is null then null else (v_grace #>> '{}')::numeric::integer end,
    -- **المعاينةُ هيَ جوابُ المستلمِ نفسُه**، لا رسمٌ يُشبهُه.
    'preview', tracking_link_view(v_order.id)
  );
end;
$fn$;

comment on function rider_ride_share_state(bigint, uuid) is
  'F2-09 / SR-13: حالةُ مشاركةِ رحلةٍ لمالكِها في نداءٍ واحدٍ — أيُمكنُ الإصدارُ، والروابطُ الساريةُ ببقيّةِ '
  'صلاحيتِها محسوبةً بساعةِ القاعدةِ، ومعاينةُ ما سيراهُ المستلمُ من tracking_link_view نفسِها. '
  'ولا رمزَ منشورٌ (الرمزُ يُعطى مرّةً عندَ الإصدارِ) ولا أجرةَ ولا هويّةَ سائقٍ.';

-- ----------------------------------------------------------------------------
-- (٤) الصفحةُ العامّةُ — تُعادُ كتابتُها **غلافَ إذنٍ رقيقاً** فوقَ الحَكَمِ.
--
-- التوقيعُ كما هوَ (`text` → `jsonb`) فلا يُكسَرُ مُنادٍ، **والحمولةُ تتغيَّرُ
-- عن قصدٍ**: `has_position` المنطقيّةُ لا تكفي لتمييزِ «لم يُبلِّغْ قطُّ» من
-- «آخرُ نقطةٍ قبلَ ساعةٍ»، و`updated_at` ختمٌ مطلقٌ يطرحُه جهازُ الزائرِ بساعتِه.
-- فحلَّ محلَّهُما تصنيفٌ وعُمرٌ محسوبٌ في القاعدةِ. والمحوّلُ والصفحةُ يُحدَّثانِ
-- في الدفعةِ نفسِها.
--
-- **والسببُ الواحدُ لكلِّ فشلِ رمزٍ يبقى بحرفِه**: لا وجودَ، مُلغىً، منقضٍ —
-- كلُّها `TOKEN_NOT_FOUND`، فلا تصيرُ الصفحةُ أداةَ استكشافٍ لمن يُجرِّبُ رموزاً.
-- ----------------------------------------------------------------------------

create or replace function get_tracking_position(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_order_id uuid;
  v_view     jsonb;
begin
  select t.order_id
    into v_order_id
    from trip_tracking_tokens t
   where t.token = p_token
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_NOT_FOUND');
  end if;

  v_view := tracking_link_view(v_order_id);
  if v_view is null then
    -- طلبٌ حُذِفَ ورمزُه قائمٌ: مستحيلٌ عمليّاً (`on delete cascade`) ويُعامَلُ
    -- معاملةَ الرمزِ غيرِ الصالحِ لا معاملةَ عطبٍ يُفشي وجودَ صفٍّ.
    return jsonb_build_object('ok', false, 'error', 'TOKEN_NOT_FOUND');
  end if;

  return jsonb_build_object('ok', true) || v_view;
end;
$fn$;

comment on function get_tracking_position(text) is
  'F2-09: غلافُ إذنٍ رقيقٌ فوقَ tracking_link_view — يُحوِّلُ رمزاً إلى طلبٍ ثمّ يُعيدُ حكمَ العرضِ نفسَه '
  'الذي يراهُ المالكُ في معاينتِه. بلا هويّةٍ، وسببٌ واحدٌ لكلِّ فشلِ رمزٍ. (كانت تنشرُ إحداثيّةً بلا حدِّ عُمرٍ — أُصلِحَ في F2-09.)';

-- ----------------------------------------------------------------------------
-- (٥) نزعُ التنفيذِ — إلزاميٌّ لكلِّ دالّةٍ أُنشِئَت أو استُبدِلَت ههنا.
--
-- و**درسُ `F2-06` مكتوبٌ بثمنِه**: `postgres` يمنحُ `execute` لدورِ `public` على
-- كلِّ دالّةٍ جديدةٍ تلقائيّاً. و`tracking_link_view` بخاصّةٍ **لا إذنَ فيها**،
-- فتركُها مكشوفةً لدورٍ عامٍّ يعني قراءةَ موقعِ أيِّ طلبٍ بمعرّفِه بلا رمزٍ ولا
-- ملكيّةٍ — أخطرُ ما في هذه الهجرةِ لو أُهمِلَ.
-- ----------------------------------------------------------------------------

revoke execute on function tracking_link_view(uuid) from public, anon, authenticated;
revoke execute on function rider_ride_share_state(bigint, uuid) from public, anon, authenticated;
revoke execute on function get_tracking_position(text) from public, anon, authenticated;
