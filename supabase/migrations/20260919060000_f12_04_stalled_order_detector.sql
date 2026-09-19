-- migration-phase: expand
-- =============================================================================
-- الغرض: `F12-04` — **كاشفُ الحالاتِ العالقةِ**: الحكمُ الذي طلبَته هجرةُ
--   `20260918020000` نصّاً («وإغلاقُه يقتضي كاشفَ حالاتٍ عالقةٍ — بندٌ آخرُ لا
--   هذا») حتّى يُميَّزَ **طلبٌ جارٍ صادقٌ** من **طلبٍ عَلِقَ**.
-- الحالة: منفَّذٌ فعليّاً — والبندُ `F12-04` **يبقى `[~]`** (المانعُ الباقي قرارُ
--   مالكٍ، مشروحٌ في §٥ أدناه).
-- ينتمي إلى: supabase/migrations
-- يبني على: 20260814140000 (`is_active_order_status`) · 20260814150000 (السقفُ) ·
--   20260910200000 (`drivers.last_location_at` = زمنُ قبولِ الخادمِ · `F4-05`) ·
--   20260918020000 (`tracking_link_lifetime`).
-- يُستخدم من: `tracking_link_lifetime(uuid)` · `detect_stalled_orders(uuid,int)` ·
--   `apps/workers/src/jobs/detect-stalled-orders.ts`.
--
-- ## العطبُ: السقفُ الأعمى يحكمُ على الجاري والعالقِ بحكمٍ واحدٍ
--
-- `tracking_link_lifetime` تردُّ `LIVE_RIDE_ACTIVE` **بلا عدٍّ تنازليٍّ** لكلِّ
-- طلبٍ في حالةٍ جاريةٍ، والحدُّ الوحيدُ على العمرِ هوَ `expires_at`
-- (`tracking_link_max_lifetime_minutes` = 720 دقيقةً بذرةً). فالنتيجةُ وجهانِ
-- متضادّانِ من سببٍ واحدٍ — **أنَّ الحالةَ وحدَها لا تُنبئُ عن حياةٍ**:
--
--   ١. **رحلةٌ طويلةٌ صادقةٌ** (سائقٌ يبثُّ موقعَه والرحلةُ جاريةٌ فعلاً) يموتُ
--      رابطُها عندَ السقفِ **قبلَ انتهائِها** — خِلافُ حرفِ البندِ «حتّى انتهائِها».
--   ٢. **طلبٌ عَلِقَ** على `in_progress` (سائقٌ اختفى · جهازٌ انطفأ · عاملٌ ساقطٌ
--      لم يُغلِقْ) يبقى رابطُه حيّاً **إلى السقفِ** وهوَ لا يُنبئُ عن شيءٍ.
--
-- ## والعلاجُ: إشارةُ حياةٍ لا إشارةُ حالةٍ
--
-- `order_stall_state(p_order_id)` تُجيبُ: «هل هذا الطلبُ الجاري **حيٌّ**؟» بإشارةٍ
-- **مُقاسةٍ لا مُفترَضةٍ**: آخرُ ما جدَّ عليه (`greatest` على الطوابعِ المُعلَنةِ)
-- مقابلَ مهلةٍ **لكلِّ حالةٍ على حدةٍ** من `platform_settings`.
--
-- والمهلةُ تفترقُ بالحالةِ لأنَّ معناها يفترقُ: `searching` لا سائقَ فيها فإشارتُها
-- آخرُ كتابةٍ على الصفِّ؛ و`matched` انتظارُ وصولِ سائقٍ؛ و`in_progress` رحلةٌ
-- تحتَ التنفيذِ. وفي الحالتَينِ الأخيرتَينِ **إن كانَ سائقٌ مُسنَداً يبثُّ**
-- فالإشارةُ طابعُ قبولِ موقعِه **وحدَه** لا أحدثُ الطابعَينِ — والعلّةُ في §٢.
--
-- ## وما **لا** تفعلُه هذه الهجرةُ — وهذا حدٌّ مقصودٌ لا نقصٌ
--
-- **لا تُغيِّرُ حالةَ طلبٍ ولا تُلغي ولا تُفشِلُ ولا تُعاقِبُ**. الدالّتانِ
-- `stable` **قراءةٌ محضةٌ بلا كتابةٍ**. وإلغاءُ رحلةِ راكبٍ أو إفشالُها أو تحميلُ
-- أحدٍ تبعتَها **قرارٌ تجاريٌّ** يمسُّ `F2-05` (العقوبةُ بالسياقِ لا بالحدثِ)
-- ويمسُّ الراكبَ والسائقَ معاً — فلا يُخترَعُ ههنا. والكاشفُ **يكشفُ ويُصعِّدُ**،
-- والقرارُ في التصعيدِ لا في محرِّكِ القاعدةِ.
--
-- ## والمهلاتُ الثلاثُ قيمٌ تشغيليّةٌ افتراضيّةٌ لا سياسةٌ مُقنَّنةٌ
--
-- تُبذَرُ `is_provisional = true` **وهذا مقصودٌ**: هيَ صالحةٌ للكشفِ ولمّا
-- يُصادِقْ عليها المالكُ، وراية `is_provisional` هيَ الموضعُ الذي يُقرأُ فيه ذلكَ
-- آلياً لا تعليقاً في ملفٍّ. ومصدرُ كلِّ قراءةٍ يُنشَرُ باسمِه
-- (`SETTING` / `FALLBACK_DEFAULT`) فلا رقمَ بلا نسبٍ.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- (١) المهلاتُ — ثلاثُ مهلاتٍ لثلاثِ حالاتٍ، مبذورةٌ لكلِّ مدينةٍ
-- ----------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'stalled_order_searching_minutes',
       '30'::jsonb,
       'number',
       'F12-04: بعدَها يُعَدُّ طلبٌ في searching عالقاً — لا سائقَ فيه فإشارتُه عمرُه وحدَه. قيمةٌ تشغيليّةٌ مبدئيّةٌ لم يُصادِقْ عليها المالكُ',
       true
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.city_id = c.id and s.key = 'stalled_order_searching_minutes'
 );

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'stalled_order_matched_minutes',
       '45'::jsonb,
       'number',
       'F12-04: بعدَها يُعَدُّ طلبٌ في matched عالقاً — سائقٌ أُسنِدَ ولم يبدأْ. قيمةٌ تشغيليّةٌ مبدئيّةٌ لم يُصادِقْ عليها المالكُ',
       true
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.city_id = c.id and s.key = 'stalled_order_matched_minutes'
 );

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'stalled_order_in_progress_minutes',
       '20'::jsonb,
       'number',
       'F12-04: بعدَها يُعَدُّ طلبٌ في in_progress عالقاً — وإشارتُه أقوى الإشاراتِ: طابعُ قبولِ آخرِ موقعٍ للسائقِ. قيمةٌ تشغيليّةٌ مبدئيّةٌ لم يُصادِقْ عليها المالكُ',
       true
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.city_id = c.id and s.key = 'stalled_order_in_progress_minutes'
 );

-- ----------------------------------------------------------------------------
-- (٢) الحَكَمُ الواحدُ — `order_stall_state(uuid)`
--
-- وهوَ **المصدرُ الوحيدُ** لمعنى «عالقٌ»: لا تُكتَبُ العتبةُ ولا الإشارةُ نصّاً
-- في موضعٍ ثانٍ، على سُنّةِ `is_active_order_status` في تعليقِها.
-- ----------------------------------------------------------------------------

create or replace function order_stall_state(p_order_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_order        record;
  v_threshold    integer;
  v_thr_src      text;
  v_thr_key      text;
  v_default      integer;
  v_raw          jsonb;
  v_last_signal  timestamptz;
  v_signal_src   text;
  v_idle_seconds integer;
  v_verdict      text;
begin
  select o.id,
         o.status,
         o.city_id,
         o.updated_at,
         o.assigned_driver_id,
         d.last_location_at
    into v_order
    from orders o
    left join drivers d on d.id = o.assigned_driver_id
   where o.id = p_order_id;

  if not found then
    -- طلبٌ معدومٌ: `null` حكمٌ لا حقلٌ فارغٌ — ومُنادِيه يترجِمُه رفضاً واحداً.
    return null;
  end if;

  -- طلبٌ منتهٍ لا يَعلَقُ: المعنى لا ينطبقُ، ولا يُقالُ «حيٌّ» عن منتهٍ.
  if not is_active_order_status(v_order.status) then
    return jsonb_build_object(
      'verdict', 'NOT_ACTIVE',
      'status', v_order.status,
      'idle_seconds', null,
      'threshold_minutes', null,
      'threshold_source', null,
      'signal_source', null,
      'last_signal_at', null
    );
  end if;

  -- المهلةُ والإشارةُ: **لكلِّ حالةٍ حكمُها**، والإشارةُ أقوى ما يُنبئُ عنها.
  --
  -- ### ولِمَ **ليسَ** `greatest(updated_at, last_location_at)`
  --
  -- كانَ الحكمُ أوّلَ ما كُتِبَ يأخذُ **أحدثَ** الطابعَينِ، وكانَ ذلكَ عطباً
  -- يُبطِلُ البندَ من أصلِه: `orders.updated_at` يفرضُه محرِّكٌ
  -- (`orders_set_updated_at` · `set_updated_at()`) إلى `now()` عندَ **كلِّ**
  -- كتابةٍ على الصفِّ. فأيُّ لمسةٍ لا تُنبئُ عن حركةٍ — تحديثُ ملاحظةٍ، إعادةُ
  -- توزيعٍ، كتابةُ حقلٍ إداريٍّ — كانت **تُقنِّعُ سائقاً ميّتاً** وتردُّ الطلبَ
  -- «حيّاً» ساعاتٍ. وهذا بالحرفِ هوَ العطبُ الذي جاءَ البندُ ليكشفَه.
  --
  -- فالإشارةُ متى كانَ سائقٌ مُسنَداً يبثُّ: **طابعُ قبولِ موقعِه وحدَه**، لا
  -- أحدثُ الطابعَينِ. ولا يُرجَعُ إلى `updated_at` إلّا حيثُ لا موقعَ ألبتّةَ.
  case v_order.status
    when 'searching' then
      v_thr_key := 'stalled_order_searching_minutes';
      v_default := 30;
      -- لا سائقَ فيها، فأقوى ما يُنبئُ آخرُ كتابةٍ على الصفِّ. و`created_at` لا
      -- يُضَمُّ: `updated_at` لا ينزلُ تحتَه أبداً فضَمُّه حسابٌ لا أثرَ له.
      v_last_signal := v_order.updated_at;
      v_signal_src := 'ORDER_TOUCHED';
    else -- 'matched' و 'in_progress'
      v_thr_key := case v_order.status
                     when 'matched' then 'stalled_order_matched_minutes'
                     else 'stalled_order_in_progress_minutes'
                   end;
      v_default := case v_order.status when 'matched' then 45 else 20 end;
      if v_order.assigned_driver_id is not null and v_order.last_location_at is not null then
        -- زمنُ **قبولِ الخادمِ** لا زمنُ الجهازِ ولا زمنُ الإفراغِ (`F4-05` · ADR 0076).
        v_last_signal := v_order.last_location_at;
        v_signal_src := 'DRIVER_LOCATION';
      else
        -- لا موقعَ ألبتّةَ: لا تُدَّعى إشارةُ سائقٍ، ويُصرَّحُ بالمرجعِ الأضعفِ
        -- باسمِه — فقارئُ السطرِ يعلمُ أنَّ الحكمَ على لمسةِ صفٍّ لا على حركةٍ.
        v_last_signal := v_order.updated_at;
        v_signal_src := 'ORDER_TOUCHED';
      end if;
  end case;

  v_raw := get_setting(v_order.city_id, v_thr_key);
  if v_raw is null then
    v_threshold := v_default;
    v_thr_src := 'FALLBACK_DEFAULT';
  else
    v_threshold := (v_raw #>> '{}')::numeric::integer;
    v_thr_src := 'SETTING';
  end if;

  -- عُمرٌ سالبٌ مستحيلٌ منطقاً وممكنٌ بانحرافِ ساعةٍ: يُقصَرُ على الصفرِ ولا
  -- يُقرأُ «المستقبلَ» سكوناً صالحاً (سُنّةُ `tracking_link_view`).
  v_idle_seconds := greatest(0, floor(extract(epoch from (now() - v_last_signal)))::integer);

  v_verdict := case
                 when v_idle_seconds > v_threshold * 60 then 'STALLED'
                 else 'LIVE'
               end;

  return jsonb_build_object(
    'verdict', v_verdict,
    'status', v_order.status,
    'idle_seconds', v_idle_seconds,
    'threshold_minutes', v_threshold,
    'threshold_source', v_thr_src,
    'signal_source', v_signal_src,
    'last_signal_at', v_last_signal
  );
end;
$fn$;

comment on function order_stall_state(uuid) is
  'F12-04: الحَكَمُ الواحدُ لمعنى «طلبٌ عَلِقَ» — LIVE أو STALLED أو NOT_ACTIVE، بإشارةِ حياةٍ مُقاسةٍ '
  '(طابعُ قبولِ آخرِ موقعٍ للسائقِ في in_progress/matched، وعمرُ الصفِّ في searching) ومهلةٍ لكلِّ حالةٍ '
  'من platform_settings بمصدرٍ مُعلَنٍ. قراءةٌ محضةٌ: لا يُغيِّرُ حالةً ولا يُلغي ولا يُعاقِبُ.';

-- ----------------------------------------------------------------------------
-- (٣) الكاشفُ الدوريُّ — `detect_stalled_orders(uuid, int)`
--
-- قراءةٌ محضةٌ تُصعِّدُ لا تُصلِحُ. ومُرتَّبٌ بأطولِ سكونٍ أوّلاً: من عَلِقَ منذُ
-- ساعتَينِ أحقُّ بنظرِ المُشغِّلِ من عَلِقَ منذُ دقيقةٍ زائدةٍ.
-- ----------------------------------------------------------------------------

create or replace function detect_stalled_orders(p_city_id uuid, p_limit integer default 100)
returns table (
  order_id        uuid,
  status          order_status,
  idle_seconds    integer,
  threshold_minutes integer,
  signal_source   text,
  last_signal_at  timestamptz
)
language sql
stable
security invoker
set search_path = public
as $fn$
  select o.id,
         o.status,
         (s.state ->> 'idle_seconds')::integer,
         (s.state ->> 'threshold_minutes')::integer,
         s.state ->> 'signal_source',
         (s.state ->> 'last_signal_at')::timestamptz
    from orders o
    cross join lateral (select order_stall_state(o.id) as state) s
   where o.city_id = p_city_id
     and is_active_order_status(o.status)
     and (s.state ->> 'verdict') = 'STALLED'
   order by (s.state ->> 'idle_seconds')::integer desc
   limit greatest(1, coalesce(p_limit, 100));
$fn$;

comment on function detect_stalled_orders(uuid, integer) is
  'F12-04: يُحصي طلباتَ مدينةٍ العالقةَ بحكمِ order_stall_state، أطولَ سكوناً أوّلاً. '
  'قراءةٌ محضةٌ تُصعِّدُ ولا تُصلِحُ: تغييرُ حالةِ الطلبِ قرارٌ تجاريٌّ (F2-05) لا يُخترَعُ في محرِّكٍ.';

-- ----------------------------------------------------------------------------
-- (٤) الحَكَمُ يُبنى فوقَ الحَكَمِ — `tracking_link_lifetime` تُميِّزُ العالقَ
--
-- وهذا **يُضيِّقُ الكشفَ ولا يُوسِّعُه**: طلبٌ عَلِقَ كانَ رابطُه يبقى حيّاً إلى
-- السقفِ (٧٢٠ دقيقةً)، وصارَ يموتُ بانقضاءِ مهلةِ حالتِه. ولا تُمَسُّ حياةُ
-- رابطِ رحلةٍ **حيّةٍ** ولا يُرفَعُ السقفُ ولا يُخفَّفُ — فالوجهُ الأوّلُ
-- (رحلةٌ طويلةٌ صادقةٌ يموتُ رابطُها بالسقفِ) **يبقى مفتوحاً ولا يُدَّعى إغلاقُه**،
-- لأنَّ رفعَ السقفِ حدُّ سلامةٍ يمسُّ البندَ `F2-06` وقرارَ المالكِ فيه.
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
  v_stall       jsonb;
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
    -- `F12-04` — **الحالةُ الجاريةُ لا تكفي**: طلبٌ عَلِقَ لا يُنشَرُ موضعُه
    -- بحجّةِ أنَّ حالتَه جاريةٌ. والحكمُ من `order_stall_state` لا من عتبةٍ
    -- مكتوبةٍ ههنا ثانيةً.
    v_stall := order_stall_state(p_order_id);
    if v_stall is not null and (v_stall ->> 'verdict') = 'STALLED' then
      return jsonb_build_object(
        'verdict', 'EXPIRED_RIDE_STALLED',
        'seconds_remaining', 0,
        'grace_minutes', v_grace,
        'grace_source', v_grace_src,
        'ride_ended_at', null,
        'stall', v_stall
      );
    end if;

    -- **لا عدَّ تنازليّاً لرحلةٍ جاريةٍ حيّةٍ**: موعدُها غيرُ معلومٍ، وأيُّ رقمٍ
    -- ههنا وعدٌ لم تقطعْه المنصّةُ. والحكمُ وحدَه يُنشَرُ.
    return jsonb_build_object(
      'verdict', 'LIVE_RIDE_ACTIVE',
      'seconds_remaining', null,
      'grace_minutes', v_grace,
      'grace_source', v_grace_src,
      'ride_ended_at', null,
      'stall', v_stall
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
  'أو EXPIRED_RIDE_STALLED (حالةٌ جاريةٌ عَلِقَت بحكمِ order_stall_state) '
  'أو LIVE_GRACE (عدٌّ نحوَ نهايةِ الرحلةِ + المهلةِ) أو EXPIRED_RIDE_ENDED. '
  'يُحسَبُ لحظةَ القراءةِ فلا يعتمدُ على وظيفةٍ دوريّةٍ تدورُ. بلا إذنٍ: البابُ عندَ مُنادِيه.';

-- ----------------------------------------------------------------------------
-- (٥) الإذنُ — على سُنّةِ أخواتِها: لا `public` ولا `anon` ولا `authenticated`
-- ----------------------------------------------------------------------------

revoke execute on function order_stall_state(uuid) from public, anon, authenticated;
revoke execute on function detect_stalled_orders(uuid, integer) from public, anon, authenticated;
