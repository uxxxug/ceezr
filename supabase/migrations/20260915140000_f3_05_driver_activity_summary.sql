-- migration-phase: expand
-- =============================================================================
-- `F3-05` — الأداءُ والحصيلةُ: **كلُّ رقمٍ لهُ مصدرٌ، وما لا مصدرَ لهُ يُقالُ
--   غائباً** — لا مالٌ يُخترَعُ، ولا ترتيبٌ يُهَدَّدُ بهِ.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-05` (`SD-06` + `SD-09`).
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `apps/gateway/src/routes/driver-activity.ts` عبرَ
--   `packages/infrastructure/driver/driver-activity-store.ts`
-- يحرسُه: tests/integration/driver-activity.test.ts ·
--   scripts/check-driver-activity-contract.ts
-- الحاكم: docs/adr/0120-transparency-is-a-denominator-not-a-slogan.md
--
-- ## لِمَ لا رقمَ مالِيَّ ههنا ألبتّةَ
--
-- نصُّ `SD-06` يقولُ «**بلا وعودٍ غيرِ محسوبةٍ**»، والمخطَّطُ يقولُ إنَّ الأجرةَ
-- **ليست فيه**: لا عمودَ أجرةٍ في `orders` ولا في `order_offers`، والمنصّةُ لا
-- تتوسّطُ نقداً (`ADR 0039` §٤ · `DEC-11`). فأيُّ «مجموعِ أرباحٍ» يُعرَضُ اليومَ
-- إمّا صفرٌ يُقرأُ إخفاقاً، أو حاصلُ ضربٍ في تعرفةٍ **متخيَّلةٍ**. وكلاهما وعدٌ
-- غيرُ محسوبٍ. فتُنشَرُ الحصيلةُ **عدَداً وساعةً**، ويُنشَرُ المالُ **مفتاحاً
-- مُعلَنَ الغيابِ بسببِه** (`money_basis = 'NOT_INTERMEDIATED'`) — كما فُعِلَ
-- بـ«التقديرِ» في `F3-02` (`ADR 0117` §٣). ومفتاحٌ يقولُ «لا أعلمُ» أصدقُ من
-- رقمٍ يقولُ ما لا يعلمُه أحدٌ.
--
-- ## ولِمَ النِسَبُ بمقاماتِها
--
-- `0%` من صفرِ عرضٍ ليسَ رفضاً، و`100%` من عرضٍ واحدٍ ليسَ انتظاماً. فكلُّ نسبةٍ
-- تُنشَرُ `{numerator, denominator, rate}` و`rate = null` عندَ مقامٍ صفرٍ — لا
-- يُقسَمُ على صفرٍ ولا يُستَرُ بصفرٍ.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُخزِّنُ مُجمَّعاً**: لا عمودَ عدَّادٍ ولا جدولَ ملخَّصٍ. الأرقامُ
--      **تُحسَبُ عندَ القراءةِ** من الصفوفِ الأصليّةِ، فلا كاتبَ ثانياً لحقيقةٍ
--      مُشتقّةٍ ولا رقمَ يبقى صحيحاً في نظرِ السائقِ وقد كذبَ عنهُ عدَّادٌ لم
--      يُحدَّثْ.
--   ــ **لا تُغيِّرُ معادلةَ الترتيبِ ولا تقرأُ نقاطاً محفوظةً**: الأوزانُ تُقرأُ
--      من `platform_settings` كما تقرأُها المطابَقةُ نفسُها، فمصدرُ الحقيقةِ
--      واحدٌ. ولو نُسِخَت الأوزانُ ههنا لَصارَ للشفافيّةِ نصٌّ وللإسنادِ نصٌّ.
--   ــ **لا تزعمُ أنَّ سلوكاً يُنقِصُ ترتيباً**: `behaviour_affects_ranking`
--      يُنشَرُ `false` **بحرفِه** لأنَّ المعادلةَ اليومَ ثلاثةُ عواملَ لا رابعَ
--      لها. ويومَ يُضافُ عاملٌ سلوكيٌّ، يُقلَبُ المفتاحُ في الخادمِ لا في نصٍّ
--      دعائيٍّ في شاشةٍ.
--   ــ **لا تكتبُ شيئاً**: `stable` لا `volatile`، ولا `insert` ولا `update` في
--      هذا الملفِّ إلّا بذرَ إعدادٍ واحدٍ.
--   ــ **لا تقرأُ هويّةَ راكبٍ**: لا اسمَ ولا هاتفَ ولا معرِّفَ تلغرامَ في أيِّ
--      مَخرَجٍ ههنا. جدولُ الرحلاتِ التفصيليُّ **مُلكُ السائقِ عن نفسِه** لا
--      سجلٌّ عن الناسِ.
-- =============================================================================

-- ── ١) منطقةُ زمنِ المدينةِ إعدادٌ لا ثابتٌ ────────────────────────────────────
--
-- «يوميٌّ» سؤالٌ لا يُجابُ بلا منطقةِ زمنٍ: منتصفُ ليلِ مَن؟ ومنطقةُ الزمنِ
-- **حقيقةُ مدينةٍ** لا حقيقةُ جهازٍ، وإلّا لَاختلفَ «يومُك» باختلافِ ضبطِ هاتفٍ.
-- فتُبذَرُ مفتاحاً لكلِّ مدينةٍ قائمةٍ، ويضبطُها المُشغِّلُ بلا نشرِ حزمةٍ.
insert into platform_settings (city_id, key, value, value_type, description_ar)
select c.id, 'city_timezone', to_jsonb('Asia/Riyadh'::text), 'string',
       'منطقة زمن المدينة — تُحسَب بها حدود اليوم والأسبوع والشهر في تقرير السائق'
  from cities c
on conflict (city_id, key) do nothing;

-- ── ٢) نافذةُ المُدّةِ دالّةٌ واحدةٌ تُقرأُ ومُختبَرةٌ ─────────────────────────
--
-- تُفرَدُ عن الملخَّصِ كي **يُقاسَ حدُّ النافذةِ وحدَه**: خطأُ يومٍ في حسابِ
-- الحدِّ يُفسِدُ كلَّ رقمٍ بعدَه، وهوَ أخفى ما يكونُ لو ذابَ في استعلامٍ كبيرٍ.
--
-- و`p_now` مُعطىً لا `now()` داخليّاً: نافذةٌ تُختبَرُ عندَ حدودِها (منتصفُ ليلٍ،
-- أوّلُ شهرٍ) لا تُختبَرُ إن كانَ زمنُها مخفيّاً في جسمِ الدالّةِ.
create or replace function driver_activity_window(
  p_period text,
  p_timezone text,
  p_now timestamptz
)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  v_local timestamp;
  v_start timestamp;
  v_unit text;
begin
  if p_period is null or p_period not in ('day', 'week', 'month') then
    return null;
  end if;
  if p_timezone is null or btrim(p_timezone) = '' then
    return null;
  end if;

  -- منطقةُ زمنٍ مجهولةٌ **لا تُستبدَلُ بـUTC** صامتةً: خطأٌ يُرمى فيُقرأُ في
  -- الحاجزِ وفي الاختبارِ، لأنَّ «يوماً» مُزاحاً ثلاثَ ساعاتٍ يبدو صحيحاً أبداً.
  begin
    v_local := (p_now at time zone p_timezone);
  exception
    when others then
      return null;
  end;

  v_unit := case p_period when 'day' then 'day' when 'week' then 'week' else 'month' end;
  v_start := date_trunc(v_unit, v_local);

  return jsonb_build_object(
    'period', p_period,
    'timezone', p_timezone,
    -- الحدُّ الأدنى داخلٌ والأعلى خارجٌ: `[from, to)` — فلا صفَّ يُعَدُّ مرّتينِ
    -- في نافذتَينِ متجاورتَينِ ولا يسقطُ بينَهما.
    'from', (v_start at time zone p_timezone),
    'to', ((v_start + case v_unit
                        when 'day' then interval '1 day'
                        when 'week' then interval '7 days'
                        else interval '1 month'
                      end) at time zone p_timezone)
  );
end;
$fn$;

comment on function driver_activity_window(text, text, timestamptz) is
  'حدودُ نافذةِ التقريرِ [from, to) للمُدّةِ day/week/month بمنطقةِ زمنِ المدينةِ. تُعيدُ null لمُدّةٍ أو منطقةٍ غيرِ معروفةٍ — ولا تستبدلُ منطقةً مجهولةً بـUTC صامتةً (F3-05).';

revoke all on function driver_activity_window(text, text, timestamptz) from public;
revoke all on function driver_activity_window(text, text, timestamptz) from anon;
revoke all on function driver_activity_window(text, text, timestamptz) from authenticated;
grant execute on function driver_activity_window(text, text, timestamptz) to service_role;

-- ── ٣) ساعاتُ التواجدِ: تُحسَبُ من أزواجِ التبديلِ لا من عدَّادٍ ───────────────
--
-- `attendance_log` سجلُّ **تبديلاتٍ** لا سجلُّ مُدَدٍ: كلُّ صفٍّ يقولُ «صارَ
-- متاحاً» أو «صارَ غيرَ متاحٍ» في لحظةٍ. فالمُدّةُ فَرقُ صفٍّ عن تاليهِ، ويجبُ:
--
--   ١) **القصُّ على النافذةِ**: فترةٌ بدأَت أمسَ وانتهَت اليومَ تُحسَبُ منها
--      حصّةُ اليومِ فحسبُ، لا كلُّها ولا صفرٌ.
--   ٢) **الفترةُ المفتوحةُ**: متاحٌ الآنَ ولم يُبدِّلْ بعدُ ⇒ تُقصُّ عندَ
--      `p_now`، ويُنشَرُ `open` علماً بأنَّ الرقمَ **ما زالَ يزيدُ** فلا يُقرأُ
--      نهائيّاً.
--   ٣) **حالةٌ سابقةٌ للنافذةِ**: مَن صارَ متاحاً قبلَ منتصفِ الليلِ ولم يُبدِّلْ
--      داخلَ النافذةِ **يُعَدُّ متواجداً منذُ أوّلِها** — وإلّا لَظهرَت ساعاتُ مَن
--      لا يُبدِّلُ صفراً وهوَ عاملٌ.
create or replace function driver_attendance_seconds(
  p_driver_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_now timestamptz
)
returns jsonb
language sql
stable
as $fn$
with bounded as (
  select p_from as w_from, least(p_to, p_now) as w_to
),
-- الحالُ عندَ حدِّ النافذةِ: آخرُ تبديلٍ **قبلَها** (٣).
prior_state as (
  select al.is_available
    from attendance_log al, bounded b
   where al.driver_id = p_driver_id
     and al.changed_at < b.w_from
   order by al.changed_at desc
   limit 1
),
inside as (
  select al.is_available, al.changed_at
    from attendance_log al, bounded b
   where al.driver_id = p_driver_id
     and al.changed_at >= b.w_from
     and al.changed_at < b.w_to
),
-- صفٌّ اصطناعيٌّ عندَ حدِّ النافذةِ يحملُ الحالَ السابقةَ، فتصيرُ كلُّ الفتراتِ
-- أزواجاً متجانسةً بلا حالةٍ خاصّةٍ في الحسابِ.
timeline as (
  select (select w_from from bounded) as changed_at,
         coalesce((select is_available from prior_state), false) as is_available
  union all
  select changed_at, is_available from inside
),
paired as (
  select is_available,
         changed_at,
         lead(changed_at, 1, (select w_to from bounded)) over (order by changed_at) as ends_at
    from timeline
)
select jsonb_build_object(
  'available_seconds',
    coalesce((select floor(sum(extract(epoch from (ends_at - changed_at))))::bigint
                from paired
               where is_available
                 and ends_at > changed_at), 0),
  -- **مفتوحةٌ** إن كانَ آخرُ حالٍ في المسارِ متاحاً والنافذةُ لم تُغلَقْ بعدَ الآنِ.
  'open',
    coalesce((select p.is_available
                from paired p
               order by p.changed_at desc
               limit 1), false)
    and p_to > p_now
);
$fn$;

comment on function driver_attendance_seconds(uuid, timestamptz, timestamptz, timestamptz) is
  'ثوانيُ تواجدِ السائقِ داخلَ [from, to) محسوبةً من أزواجِ تبديلِ attendance_log، مقصوصةً على النافذةِ وعلى الآنِ، ومعَها open علماً بأنَّ الفترةَ ما زالت جاريةً. لا عدَّادَ مخزوناً (F3-05).';

revoke all on function driver_attendance_seconds(uuid, timestamptz, timestamptz, timestamptz) from public;
revoke all on function driver_attendance_seconds(uuid, timestamptz, timestamptz, timestamptz) from anon;
revoke all on function driver_attendance_seconds(uuid, timestamptz, timestamptz, timestamptz) from authenticated;
grant execute on function driver_attendance_seconds(uuid, timestamptz, timestamptz, timestamptz) to service_role;

-- ── ٤) الملخَّصُ: قراءةٌ واحدةٌ لكلِّ ما يُعرَضُ ───────────────────────────────
create or replace function driver_activity_summary(
  p_telegram_id bigint,
  p_period text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_timezone text;
  v_window jsonb;
  v_from timestamptz;
  v_to timestamptz;
  v_completed bigint;
  v_offers bigint;
  v_accepted bigint;
  v_cancelled bigint;
  v_rating_avg numeric;
  v_rating_count bigint;
  v_trust_min numeric;
  v_weight_proximity numeric;
  v_weight_rating numeric;
  v_weight_area numeric;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select (value #>> '{}') into v_timezone
    from platform_settings
   where city_id = v_driver.city_id and key = 'city_timezone' and value_type = 'string';

  v_window := driver_activity_window(p_period, v_timezone, v_now);

  -- **فشلٌ مغلقٌ ومُسمّىً**: مُدّةٌ مجهولةٌ أو منطقةُ زمنٍ غيرُ مبذورةٍ ⇒ لا
  -- أرقامَ ألبتّةَ. ولا يُستبدَلُ الحدُّ بـUTC ولا بآخرِ أربعٍ وعشرينَ ساعةً:
  -- رقمٌ محسوبٌ على نافذةٍ خاطئةٍ يُقرأُ صحيحاً ولا يُكتشَفُ أبداً.
  if v_window is null then
    return jsonb_build_object('ok', false, 'error', 'WINDOW_UNRESOLVED');
  end if;

  v_from := (v_window ->> 'from')::timestamptz;
  v_to := (v_window ->> 'to')::timestamptz;

  -- الرحلاتُ المُكتمِلةُ: **بختمِ الإكمالِ** لا بلحظةِ الإسنادِ — رحلةٌ بدأَت
  -- أمسَ وانتهَت اليومَ حصيلةُ اليومِ، وهذا ما يعرفُه السائقُ عن نفسِه.
  select count(*) into v_completed
    from orders o
   where o.assigned_driver_id = v_driver.id
     and o.status = 'completed'
     and o.completed_at >= v_from
     and o.completed_at < v_to;

  -- العروضُ: ما وصلَه فعلاً، وما قبِلَه منها. والمقامُ **العروضُ الواصلةُ** لا
  -- الطلباتُ في المدينةِ: لا يُحاسَبُ على ما لم يُعرَضْ عليه.
  select count(*), count(*) filter (where oo.status = 'accepted')
    into v_offers, v_accepted
    from order_offers oo
   where oo.driver_id = v_driver.id
     and oo.created_at >= v_from
     and oo.created_at < v_to;

  -- الإلغاءُ **بعدَ الالتزامِ** وحدَه: طلبٌ أُسنِدَ إليه ثمَّ أُلغِيَ. ومقامُه
  -- ما قبِلَه لا ما عُرِضَ عليه، وإلّا لَخفَّت النسبةُ بكثرةِ العروضِ.
  select count(*) into v_cancelled
    from orders o
   where o.assigned_driver_id = v_driver.id
     and o.status = 'cancelled'
     and o.updated_at >= v_from
     and o.updated_at < v_to;

  -- التقييمُ **تراكميٌّ لا نافذيٌّ**: هوَ الرقمُ الذي تقرأُه معادلةُ الإسنادِ،
  -- وعرضُ متوسّطٍ أسبوعيٍّ بجانبِ ترتيبٍ يُحكَمُ بالتراكميِّ **حقيقتانِ**.
  -- ويُستثنى المَوسومُ (`is_flagged`) كما يستثنيهِ الإسنادُ نفسُه.
  select avg(r.stars)::numeric, count(*)
    into v_rating_avg, v_rating_count
    from ratings r
   where r.ratee_user_id = v_user.id
     and r.direction = 'rider_to_driver'
     and r.is_flagged = false;

  select (value #>> '{}')::numeric into v_trust_min
    from platform_settings
   where city_id = v_driver.city_id and key = 'rating_min_count_for_trust' and value_type = 'number';

  select (value #>> '{}')::numeric into v_weight_proximity
    from platform_settings
   where city_id = v_driver.city_id and key = 'match_weight_proximity' and value_type = 'number';

  select (value #>> '{}')::numeric into v_weight_rating
    from platform_settings
   where city_id = v_driver.city_id and key = 'match_weight_rating' and value_type = 'number';

  select (value #>> '{}')::numeric into v_weight_area
    from platform_settings
   where city_id = v_driver.city_id and key = 'match_weight_preferred_area' and value_type = 'number';

  return jsonb_build_object(
    'ok', true,
    'server_time', v_now,
    'window', v_window,
    'rides', jsonb_build_object('completed', v_completed),
    'attendance', driver_attendance_seconds(v_driver.id, v_from, v_to, v_now),
    -- **نسبةٌ بمقامِها**: `rate` نصٌّ عشريٌّ بدقّةٍ مُقيَّدةٍ، و`null` عندَ مقامٍ
    -- صفرٍ — فلا قسمةَ على صفرٍ ولا صفرٌ يُقرأُ حكماً على سائقٍ لم يُعرَضْ عليه.
    'acceptance', jsonb_build_object(
      'numerator', v_accepted,
      'denominator', v_offers,
      'rate', case when v_offers = 0 then null else round(v_accepted::numeric / v_offers, 4) end
    ),
    'cancellation', jsonb_build_object(
      'numerator', v_cancelled,
      'denominator', v_accepted,
      'rate', case when v_accepted = 0 then null else round(v_cancelled::numeric / v_accepted, 4) end
    ),
    'rating', jsonb_build_object(
      'average', case when v_rating_count = 0 then null else round(v_rating_avg, 2) end,
      'count', v_rating_count,
      'trust_min_count', v_trust_min,
      -- **دونَ حدِّ الثقةِ يُقالُ**: لا يُحجَبُ المتوسّطُ ولا يُزعَمُ نهائيّاً.
      'below_trust', case
        when v_trust_min is null then null
        else v_rating_count < v_trust_min
      end
    ),
    -- ── الشفافيّةُ: **عواملُ الترتيبِ الفعليّةُ بأوزانِها المقروءةِ** ──────────
    -- تُقرأُ من نفسِ الصفوفِ التي تقرأُها المطابَقةُ. ووزنٌ غائبٌ يُنشَرُ `null`
    -- لا صفراً: «لم يُضبَطْ» و«ضُبِطَ صفراً» حالانِ مختلفتانِ.
    'ranking', jsonb_build_object(
      'factors', jsonb_build_array(
        jsonb_build_object('key', 'PROXIMITY', 'weight', v_weight_proximity),
        jsonb_build_object('key', 'RATING', 'weight', v_weight_rating),
        jsonb_build_object('key', 'PREFERRED_AREA', 'weight', v_weight_area)
      ),
      -- **الحقيقةُ كما هيَ**: نسبتا القبولِ والإلغاءِ تُقاسانِ وتُعرَضانِ
      -- **ولا تدخلانِ** معادلةَ النقاطِ اليومَ. ويومَ تدخلانِ يُقلَبُ هذا المفتاحُ.
      'behaviour_affects_ranking', false
    ),
    -- ── المالُ: **طبقةٌ غائبةٌ بإعلانٍ** لا صفرٌ ولا وعدٌ ──────────────────────
    'money', jsonb_build_object('amount', null, 'basis', 'NOT_INTERMEDIATED')
  );
end;
$fn$;

comment on function driver_activity_summary(bigint, text) is
  'ملخَّصُ أداءِ السائقِ لمُدّةٍ (day/week/month): رحلاتٌ مُكتمِلةٌ وثوانيُ تواجدٍ ونسبتا قبولٍ وإلغاءٍ بمقاماتِهما وتقييمٌ تراكميٌّ بحدِّ ثقتِه، ومعَها عواملُ الترتيبِ الفعليّةُ بأوزانِها من platform_settings وإعلانٌ بأنَّ السلوكَ لا يُنقِصُ الترتيبَ اليومَ، والمالُ مفتاحٌ مُعلَنُ الغيابِ. لا مُجمَّعَ مخزوناً ولا هويّةَ راكبٍ (SD-06 · SD-09).';

revoke all on function driver_activity_summary(bigint, text) from public;
revoke all on function driver_activity_summary(bigint, text) from anon;
revoke all on function driver_activity_summary(bigint, text) from authenticated;
grant execute on function driver_activity_summary(bigint, text) to service_role;

-- ── ٥) الجدولُ التفصيليُّ: رحلاتُه هوَ، بلا أثرٍ من الناسِ ────────────────────
create or replace function driver_activity_entries(
  p_telegram_id bigint,
  p_period text,
  p_limit int
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_now timestamptz := now();
  v_timezone text;
  v_window jsonb;
  v_limit int;
  v_entries jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select (value #>> '{}') into v_timezone
    from platform_settings
   where city_id = v_driver.city_id and key = 'city_timezone' and value_type = 'string';

  v_window := driver_activity_window(p_period, v_timezone, v_now);
  if v_window is null then
    return jsonb_build_object('ok', false, 'error', 'WINDOW_UNRESOLVED');
  end if;

  -- سقفُ الصفحةِ **مقصورٌ في الخادمِ**: طلبٌ بلا سقفٍ أو بسقفٍ خرافيٍّ يُقرأُ
  -- خمسينَ، فلا يُحمَّلُ محرِّكٌ بألفِ صفٍّ بطلبِ عميلٍ.
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 50);

  select coalesce(jsonb_agg(e.entry order by e.completed_at desc), '[]'::jsonb)
    into v_entries
    from (
      select o.completed_at,
             jsonb_build_object(
               'order_id', o.id,
               'service', o.service,
               'matched_at', o.matched_at,
               'started_at', o.started_at,
               'completed_at', o.completed_at,
               -- مُدّةُ الرحلةِ **من بدئِها لا من إسنادِها**، وعَدَمٌ إن كانَ
               -- ختمُ البدءِ غائباً — لا صفرٌ يُقرأُ رحلةً لحظيّةً (`ADR 0023`).
               'duration_seconds', case
                 when o.started_at is null or o.completed_at is null then null
                 else floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
               end,
               -- المسافةُ **موسومةٌ بأساسِها**: هيَ مسافةُ خطٍّ مستقيمٍ حُسِبَت
               -- عندَ العرضِ، **لا مسافةُ طريقٍ مقطوعةٍ** — ووَسْمُها يمنعُ
               -- قراءتَها ما ليست (`ADR 0117` §٣). وغيابُها عَدَمٌ لا صفرٌ.
               'distance', case
                 when oo.distance_km is null then null
                 else jsonb_build_object('km', oo.distance_km, 'basis', 'STRAIGHT_LINE')
               end
             ) as entry
        from orders o
        left join order_offers oo
          on oo.order_id = o.id
         and oo.driver_id = v_driver.id
         and oo.status = 'accepted'
       where o.assigned_driver_id = v_driver.id
         and o.status = 'completed'
         and o.completed_at >= (v_window ->> 'from')::timestamptz
         and o.completed_at < (v_window ->> 'to')::timestamptz
       order by o.completed_at desc
       limit v_limit
    ) e;

  return jsonb_build_object(
    'ok', true,
    'server_time', v_now,
    'window', v_window,
    'limit', v_limit,
    'entries', v_entries
  );
end;
$fn$;

comment on function driver_activity_entries(bigint, text, int) is
  'جدولُ رحلاتِ السائقِ المُكتمِلةِ في النافذةِ: أختامُ الأطوارِ ومُدّةٌ من ختمِ البدءِ ومسافةٌ موسومةٌ STRAIGHT_LINE أو عَدَمٌ. السقفُ مقصورٌ في الخادمِ، ولا اسمَ راكبٍ ولا هاتفَ ولا أجرةَ (SD-06).';

revoke all on function driver_activity_entries(bigint, text, int) from public;
revoke all on function driver_activity_entries(bigint, text, int) from anon;
revoke all on function driver_activity_entries(bigint, text, int) from authenticated;
grant execute on function driver_activity_entries(bigint, text, int) to service_role;
