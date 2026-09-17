-- migration-phase: expand
-- =============================================================================
-- الغرض: `F12-04` — «مشاركةُ الرحلةِ معَ قريبٍ/صديقٍ **حتّى انتهائِها**». تُنقَلُ
--   حياةُ رابطِ التتبّعِ من **رايةٍ مخزَّنةٍ تسحبُها وظيفةٌ دوريّةٌ** إلى **حَكَمٍ
--   يُحسَبُ لحظةَ القراءةِ**: `tracking_link_lifetime(uuid)` — ثلاثةُ أحكامٍ
--   مُسمّاةٌ ومهلةٌ من `platform_settings` بمصدرٍ مُعلَنٍ.
-- الحالة: منفَّذٌ فعليّاً — البند `F12-04`. راجِعْ `ADR 0146`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `get_tracking_position(text)` (الصفحةُ العامّةُ) ·
--   `rider_ride_share_state(bigint, uuid)` (سطحُ المالكةِ) ·
--   `packages/infrastructure/transport/ride-share-store.ts`.
--
-- ## العطبُ الذي يُغلَقُ ههنا — وجهانِ يُغلَقانِ ووجهٌ يُعلَنُ حدّاً
--
-- `trip_tracking_tokens.expires_at` تُضبَطُ عندَ الإصدارِ على
-- `now() + tracking_link_max_lifetime_minutes` (سقفٌ أعمى = 720 دقيقةً بذرةً)،
-- ثمَّ **تسحبُها** وظيفةُ `expire_tracking_tokens` إلى
-- `انتهاءُ الرحلةِ + tracking_link_grace_minutes`. وقارئا الرابطِ يحكمانِ بـ
-- `expires_at > now()` وحدَه. فالنتيجةُ:
--
--   ١. **لم تدُرْ الوظيفةُ لمدينةٍ** (عاملٌ ساقطٌ · مدينةٌ لم تُمسَحْ · مهمّةٌ
--      مُعطَّلةٌ · دفعةٌ بلغَت `p_limit`) ⇒ الرابطُ يبقى ينشرُ موقعَ السائقِ **إلى
--      اثنتَي عشرةَ ساعةً بعدَ انتهاءِ الرحلةِ**. ورابطٌ أُعطيَ «حتّى تنتهيَ
--      رحلتي» يصيرُ عيناً على السائقِ ليلَه كلَّه. وهوَ عينُ ما نقضَه
--      `ADR 0115`: **الحجبُ ساعةٌ لا رايةٌ**.
--   ٢. **العدُّ التنازليُّ يكذبُ**: `seconds_remaining` كانت تُطرَحُ من السقفِ،
--      فتُقالُ للمالكةِ «يبقى إحدى عشرةَ ساعةً» والحقُّ أنَّ الرابطَ يموتُ بعدَ
--      ربعِ ساعةٍ من نهايةِ الرحلةِ. عدٌّ نحوَ موعدٍ ليسَ هوَ الموعدَ.
--   ٣. **والسقفُ يقتلُ رحلةً جاريةً** — وهذا الوجهُ **لا يُغلَقُ ههنا ولا يُدَّعى**:
--      رحلةٌ جاوزَت سقفَ المدينةِ (720 دقيقةً بذرةً) وهيَ **جاريةٌ** يموتُ رابطُها
--      قبلَ انتهائِها، وذاكَ خِلافُ حرفِ البندِ. ويُبقى عن قصدٍ لأنَّ البديلَ
--      أسوأُ: حالةٌ عَلِقَت على `in_progress` (سائقٌ اختفى · عاملٌ ساقطٌ) تعني
--      رابطاً ينشرُ موقعَ السائقِ **بلا نهايةٍ**، ولا حَكَمَ في القاعدةِ يُميِّزُ
--      رحلةً طويلةً صادقةً من حالةٍ عَلِقَت. فالسقفُ يبقى **حدَّ سلامةٍ**
--      مُعلَناً، ويُنشَرُ للمالكةِ باسمِه (`ceiling_seconds_remaining`) لا صمتاً،
--      وإغلاقُه يقتضي كاشفَ حالاتٍ عالقةٍ — **بندٌ آخرُ لا هذا**.
--
-- ## والعلاجُ: الحياةُ **حكمٌ يُحسَبُ** لا عمودٌ يُقرأُ
--
-- `tracking_link_lifetime(p_order_id)` تُجيبُ سؤالاً واحداً: «إلى متى يعيشُ رابطُ
-- هذه الرحلةِ؟» بثلاثةِ أحكامٍ **مفصولةٍ لا حالٍ صمّاءَ**:
--
--   * `LIVE_RIDE_ACTIVE` — الرحلةُ جاريةٌ: **لا عدَّ تنازليّاً ألبتّةَ**
--     (`seconds_remaining` = `null`)، لأنَّ الموعدَ غيرُ معلومٍ وأيُّ رقمٍ ههنا
--     كذبٌ. وهذا هوَ حرفُ البندِ: «حتّى انتهائِها».
--   * `LIVE_GRACE` — انتهَت الرحلةُ ونحنُ في المهلةِ: عدٌّ تنازليٌّ **نحوَ الموعدِ
--     الحقيقيِّ** (`نهايةُ الرحلةِ + المهلةُ`) محسوبٌ بساعةِ القاعدةِ.
--   * `EXPIRED_RIDE_ENDED` — انقضَت المهلةُ: ميّتٌ **بلا حاجةٍ إلى وظيفةٍ تدورُ**.
--
-- ونهايةُ الرحلةِ `coalesce(completed_at, updated_at)` — الحرفُ نفسُه الذي تقرؤُه
-- `expire_tracking_tokens` منذُ 2026-08-14، فلا حكمانِ لنهايةٍ واحدةٍ.
--
-- ## وما يبقى على حالِه عن قصدٍ
--
-- * **`expires_at` يبقى سقفاً** لا موعداً: رحلةٌ لم تُغلَقْ أبداً (سائقٌ اختفى،
--   حالةٌ عَلِقَت) لا يعيشُ رابطُها إلى الأبدِ. ويُنشَرُ للمالكةِ **باسمِه**
--   `ceiling_seconds_remaining` لا عدّاً يُقرأُ موعداً.
-- * **الوظيفةُ الدوريّةُ تبقى** — لكنّها صارت **تقارُباً وتنظيفاً** لا مصدرَ
--   حقيقةٍ: تسحبُ العمودَ فتُصغِّرُ نافذةَ السقفِ وتُفيدُ الفهرسَ، وإن لم تدُرْ
--   قطُّ **فالحكمُ لا يتغيَّرُ**. وحذفُها بندٌ آخرُ إن أُرِيدَ.
-- * **حمولةُ الصفحةِ العامّةِ لا تُزادُ حقلاً**: ثلاثةُ مفاتيحَ لا رابعَ كما في
--   `F2-09`، فلا رمزَ إفصاحٍ جديدٌ يُوجِبُ نصّاً. والغريبُ يرى ما كانَ يرى، غيرَ
--   أنَّ رابطَه يموتُ في موعدِه لا بعدَ اثنتَي عشرةَ ساعةً.
-- * **لا توقيعَ يُغيَّرُ ولا دالّةَ تُحذَفُ**: القارئانِ يُعادُ تعريفُهما
--   بـ`create or replace` بالتوقيعِ نفسِه، فشِفرةُ الأمسِ تُنادي كما كانت.
--
-- ## ولماذا `security invoker` للحَكَمِ و`definer` للقارئَينِ
--
-- الحَكَمُ **لا يتحقّقُ من إذنٍ قطُّ** (كما `tracking_link_view`): البابُ عندَ
-- مُنادِيه، والجوابُ واحدٌ خلفَ البابَينِ. وخلطُ الإذنِ بالحكمِ يجعلُ كلَّ قارئٍ
-- يرثُ حقوقَ الآخرِ. ولذلكَ يُنزَعُ تنفيذُه عن الأدوارِ العامّةِ في القسمِ (٥).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- (١) حَكَمُ الحياةِ — الحكمُ الواحدُ لسؤالِ «إلى متى يعيشُ رابطُ هذه الرحلةِ؟»
-- ----------------------------------------------------------------------------

create or replace function tracking_link_lifetime(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_order       record;
  v_grace_raw   jsonb;
  v_grace       integer;
  v_grace_src   text;
  v_ended_at    timestamptz;
  v_deadline    timestamptz;
  v_remaining   integer;
  v_verdict     text;
begin
  select o.id, o.status, o.city_id, o.completed_at, o.updated_at
    into v_order
    from orders o
   where o.id = p_order_id;

  if not found then
    -- طلبٌ معدومٌ: `null` حكمٌ لا حقلٌ فارغٌ — ومُنادِيه يترجِمُه رفضاً واحداً.
    return null;
  end if;

  -- المهلةُ: إعدادُ المدينةِ إن وُجِدَ، وإلّا الافتراضيُّ **باسمِه** لا صمتاً.
  v_grace_raw := get_setting(v_order.city_id, 'tracking_link_grace_minutes');
  if v_grace_raw is null then
    v_grace := 15;
    v_grace_src := 'FALLBACK_DEFAULT';
  else
    v_grace := (v_grace_raw #>> '{}')::numeric::integer;
    v_grace_src := 'SETTING';
  end if;

  if is_active_order_status(v_order.status) then
    -- **لا عدَّ تنازليّاً لرحلةٍ جاريةٍ**: موعدُها غيرُ معلومٍ، وأيُّ رقمٍ ههنا
    -- وعدٌ لم تقطعْه المنصّةُ. والحكمُ وحدَه يُنشَرُ.
    return jsonb_build_object(
      'verdict', 'LIVE_RIDE_ACTIVE',
      'seconds_remaining', null,
      'grace_minutes', v_grace,
      'grace_source', v_grace_src,
      'ride_ended_at', null
    );
  end if;

  -- نهايةُ الرحلةِ بالحرفِ الذي تقرؤُه `expire_tracking_tokens` نفسُها.
  v_ended_at := coalesce(v_order.completed_at, v_order.updated_at);
  v_deadline := v_ended_at + make_interval(mins => v_grace);
  v_remaining := greatest(0, floor(extract(epoch from (v_deadline - now())))::integer);
  v_verdict := case when v_remaining > 0 then 'LIVE_GRACE' else 'EXPIRED_RIDE_ENDED' end;

  return jsonb_build_object(
    'verdict', v_verdict,
    'seconds_remaining', v_remaining,
    'grace_minutes', v_grace,
    'grace_source', v_grace_src,
    'ride_ended_at', v_ended_at
  );
end;
$fn$;

comment on function tracking_link_lifetime(uuid) is
  'F12-04: الحَكَمُ الواحدُ لحياةِ رابطِ مشاركةِ رحلةٍ — LIVE_RIDE_ACTIVE (بلا عدٍّ تنازليٍّ) '
  'أو LIVE_GRACE (عدٌّ نحوَ نهايةِ الرحلةِ + المهلةِ) أو EXPIRED_RIDE_ENDED. '
  'يُحسَبُ لحظةَ القراءةِ فلا يعتمدُ على وظيفةٍ دوريّةٍ تدورُ. بلا إذنٍ: البابُ عندَ مُنادِيه.';

-- ----------------------------------------------------------------------------
-- (٢) تحويلُ رمزٍ إلى طلبٍ — **بحكمِ الحَكَمِ لا بالرايةِ وحدَها**
--
-- والسقفُ يبقى قيداً ههنا معَ الحكمِ: رحلةٌ لم تُغلَقْ أبداً لا يعيشُ رابطُها
-- إلى الأبدِ. فالشرطانِ **يجتمعانِ** ولا يُلغي أحدُهما الآخرَ.
-- ----------------------------------------------------------------------------

create or replace function tracking_link_token_order(p_token text)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_order_id uuid;
  v_lifetime jsonb;
begin
  if p_token is null then
    return null;
  end if;

  select t.order_id
    into v_order_id
    from trip_tracking_tokens t
   where t.token = p_token
     and t.revoked_at is null
     -- السقفُ: حمايةٌ من رحلةٍ لم تُغلَقْ، لا موعدُ الرابطِ.
     and t.expires_at > now();

  if v_order_id is null then
    return null;
  end if;

  v_lifetime := tracking_link_lifetime(v_order_id);
  if v_lifetime is null then
    return null;
  end if;

  -- **الحكمُ هوَ البوّابةُ**: انتهَت الرحلةُ ومهلتُها ⇒ الرمزُ ميّتٌ ولو كانَ
  -- العمودُ يقولُ إنَّ أمامَه ساعاتٍ، ولو لم تدُرْ وظيفةٌ قطُّ.
  if (v_lifetime ->> 'verdict') not in ('LIVE_RIDE_ACTIVE', 'LIVE_GRACE') then
    return null;
  end if;

  return v_order_id;
end;
$fn$;

comment on function tracking_link_token_order(text) is
  'F12-04: يُحوِّلُ رمزَ تتبّعٍ إلى معرِّفِ طلبِه متى كانَ الرمزُ حيّاً بحكمِ tracking_link_lifetime '
  '(لا بعمودِ expires_at وحدَه) — و null لكلِّ ما دونَ ذلكَ: معدومٌ أو مُلغىً أو جاوزَ السقفَ أو انقضَت مهلتُه.';

-- ----------------------------------------------------------------------------
-- (٣) الصفحةُ العامّةُ — يُعادُ تعريفُها فوقَ الحَكَمَينِ بلا مسِّ توقيعٍ
--
-- والحمولةُ **كما هيَ حرفاً**: `ok` وحكمُ الموضعِ من `tracking_link_view`. وسببُ
-- الفشلِ **واحدٌ** كما كانَ (`TOKEN_NOT_FOUND`) — لا وجودَ، مُلغىً، جاوزَ السقفَ،
-- انقضَت مهلتُه: كلُّها جوابٌ واحدٌ، فلا تصيرُ الصفحةُ أداةَ استكشافٍ.
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
  v_order_id := tracking_link_token_order(p_token);
  if v_order_id is null then
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
  'F2-09 + F12-04: غلافُ إذنٍ رقيقٌ فوقَ tracking_link_token_order ثمَّ tracking_link_view — '
  'حياةُ الرمزِ حكمٌ يُحسَبُ لا عمودٌ تسحبُه وظيفةٌ، والحمولةُ بلا هويّةٍ وسببُ الفشلِ واحدٌ.';

-- ----------------------------------------------------------------------------
-- (٤) سطحُ المالكةِ — الحكمُ يُنشَرُ، والسقفُ يُنشَرُ **باسمِه**
--
-- `seconds_remaining` لكلِّ رابطٍ **نُزِعَت**: كانت تُطرَحُ من السقفِ فتُعرَضُ
-- موعداً وليست موعداً (العطبُ ٢ أعلاه). ومحلَّها:
--   * `lifetime` — حكمُ الرحلةِ نفسِه: الحكمُ والعدُّ إن كانَ له معنىً.
--   * `ceiling_seconds_remaining` لكلِّ رابطٍ — السقفُ باسمِه، لا موعداً.
-- والروابطُ المعروضةُ **حيّةٌ بحكمِ الحَكَمِ**: انتهَت المهلةُ ⇒ القائمةُ فارغةٌ
-- ولو كانَ العمودُ يقولُ ساعاتٍ.
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
  v_ceiling   jsonb;
  v_grace     jsonb;
  v_alive     boolean;
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

  v_lifetime := tracking_link_lifetime(v_order.id);
  v_alive := (v_lifetime ->> 'verdict') in ('LIVE_RIDE_ACTIVE', 'LIVE_GRACE');

  -- الروابطُ الساريةُ وحدَها: المُلغى والمجاوِزُ السقفَ **لا يُعرَضانِ**، وكلُّها
  -- تُطوى متى قالَ الحَكَمُ إنَّ حياةَ رحلتِها انقضَت. **ولا يُنشَرُ الرمزُ**: هوَ
  -- كلمةُ السرِّ، ويُعادُ مرّةً واحدةً لحظةَ الإصدارِ.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'created_at', t.created_at,
               'ceiling_seconds_remaining',
                 greatest(0, floor(extract(epoch from (t.expires_at - now())))::integer)
             )
             order by t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_links
    from trip_tracking_tokens t
   where t.order_id = v_order.id
     and t.revoked_at is null
     and t.expires_at > now()
     and v_alive;

  v_ceiling := get_setting(v_order.city_id, 'tracking_link_max_lifetime_minutes');
  v_grace   := get_setting(v_order.city_id, 'tracking_link_grace_minutes');

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status::text,
    -- الإصدارُ مسموحٌ بالشرطِ الذي تفرضُه `issue_tracking_token` نفسُها.
    'can_share', is_active_order_status(v_order.status),
    'links', coalesce(v_links, '[]'::jsonb),
    -- **الحكمُ نفسُه** — به تُقالُ الجملةُ الصادقةُ: «يعملُ حتّى تنتهيَ رحلتُكِ»
    -- أو «انتهَت رحلتُكِ: يبقى س ثانيةً».
    'lifetime', v_lifetime,
    'max_lifetime_minutes', case when v_ceiling is null then null else (v_ceiling #>> '{}')::numeric::integer end,
    'grace_minutes', case when v_grace is null then null else (v_grace #>> '{}')::numeric::integer end,
    -- **المعاينةُ هيَ جوابُ المستلمِ نفسُه**، لا رسمٌ يُشبهُه.
    'preview', tracking_link_view(v_order.id)
  );
end;
$fn$;

comment on function rider_ride_share_state(bigint, uuid) is
  'F2-09 / SR-13 + F12-04: حالُ مشاركةِ رحلةٍ لمالكِها في نداءٍ واحدٍ — الروابطُ الحيّةُ بحكمِ '
  'tracking_link_lifetime لا بعمودٍ، وحكمُ الحياةِ منشورٌ (LIVE_RIDE_ACTIVE بلا عدٍّ · LIVE_GRACE بعدٍّ) '
  'والسقفُ باسمِه ceiling_seconds_remaining، ومعاينةُ ما سيراهُ المستلمُ من tracking_link_view نفسِها. '
  'ولا رمزَ منشورٌ ولا أجرةَ ولا هويّةَ سائقٍ.';

-- ----------------------------------------------------------------------------
-- (٥) سطحُ الصلاحيّاتِ — نزعٌ صريحٌ ثمَّ منحٌ لدورِ الخدمةِ وحدَه
--
-- `create or replace` تُعيدُ المنحَ المبدئيَّ لـ`public` في PostgreSQL، فلا
-- يُترَكُ ذلكَ لحُسنِ الظنِّ ولو كانَ السطحُ مقفولاً أمسِ.
-- ----------------------------------------------------------------------------

revoke execute on function tracking_link_lifetime(uuid) from public, anon, authenticated;
revoke execute on function tracking_link_token_order(text) from public, anon, authenticated;
revoke execute on function get_tracking_position(text) from public, anon, authenticated;
revoke execute on function rider_ride_share_state(bigint, uuid) from public, anon, authenticated;

grant execute on function tracking_link_lifetime(uuid) to service_role;
grant execute on function tracking_link_token_order(text) to service_role;
grant execute on function get_tracking_position(text) to service_role;
grant execute on function rider_ride_share_state(bigint, uuid) to service_role;
