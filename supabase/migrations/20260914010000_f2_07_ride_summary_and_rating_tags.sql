-- ============================================================================
-- migration-phase: expand
-- الغرض: ملخَّصُ الرحلةِ المنتهيةِ وتقييمُها بوسومٍ — دالّةُ قراءةٍ واحدةٌ
--   (`completed_ride_summary`) وعمودُ وسومٍ على `ratings` بمُعجَمٍ محصورٍ في
--   القاعدةِ، ونسخةٌ من منطقِ التقييمِ **تحملُ الوسومَ** والتوقيعُ القديمُ
--   يُفوِّضُ إليها (البند `F2-07` · `SR-07` · `SR-08`).
-- الحالة: منفَّذٌ فعليّاً — البند `F2-07`، ومقيسٌ على قاعدةٍ حقيقيّةٍ في
--   `tests/integration/ride-summary.test.ts`.
-- ينتمي إلى: supabase/migrations
-- يُستخدم من: `packages/infrastructure/transport/ride-summary-store.ts` عبرَ
--   `GET /v1/rides/:id/summary` و`POST /v1/rides/:id/rating`.
-- يُتوقع أن يستخدمه لاحقاً: `SD-09` (تقييمُ السائقِ للراكبِ) يُنادي
--   `submit_rating_with_tags` بالاتّجاهِ الآخرِ بلا حرفٍ جديدٍ ههنا، و`F12-16`
--   متى فُكَّ تجميدُ الأجرةِ **يُنشئُ إيصالَه في هجرتِه** ولا يُوسِّعُ هذه.
--
-- ## لماذا دالّةٌ ثانيةٌ للقراءةِ ولم يُوسَّعْ `active_ride_snapshot`
--
-- لأنَّ السؤالَينِ مختلفانِ **في لحظتِهما وفي حقولِهما**: لقطةُ الرحلةِ النشطةِ
-- تُسألُ كلَّ دقيقةٍ وتحملُ موقعَ السائقِ **بعُمرِه**، وملخَّصُ المنتهيةِ يُسألُ
-- مرّةً ويحملُ مدّةً ومسافةَ خطٍّ مستقيمٍ وحالةَ تقييمٍ **ولا موقعَ**. ولو جُمِعا
-- في دالّةٍ واحدةٍ لَصارَ نصفُ حقولِها `null` أبداً، ولَقرأَ عميلٌ موقعَ سائقٍ
-- لرحلةٍ انتهت فرسمَه حاضراً.
--
-- ## ولماذا المسافةُ تُسمّى `straight_line_meters` ولا تُسمّى «المسافةَ»
--
-- **لا أثرَ مسارٍ في المخطَّطِ**: `orders` فيها `pickup` و`dropoff` ولا سلسلةَ
-- نقاطٍ ولا عمودَ عدّادٍ. فالمقطوعُ **غيرُ مُقاسٍ**، ورقمٌ يُسمّى «المسافةَ» وهوَ
-- وترُ خطٍّ مستقيمٍ **شاهدٌ كاذبٌ** يُقرأُ في نزاعٍ. فالاسمُ يقولُ ما هوَ، وغيابُ
-- الوجهةِ يُنشَرُ `null` لا صفراً.
--
-- ## ولماذا المدّةُ بساعةِ القاعدةِ لا بساعةِ الشاشةِ
--
-- المدّةُ فرقُ ختمَينِ مكتوبَينِ في الصفِّ نفسِه، فحسابُها ههنا **لا يمرُّ على
-- ساعةٍ أُخرى**. ولو أُرسِلَ الختمانِ وحسبَ العميلُ الفرقَ لَصارَ انحرافُ ساعةِ
-- جهازٍ مدّةَ رحلةٍ. وغيابُ أحدِ الختمَينِ يُنشَرُ `null` — و**صفرُ ثوانٍ يعني
-- «رحلةً لحظيّةً»** وهوَ كذبٌ لو كانَ الأصلُ عَدَماً.
--
-- ## ولماذا مُعجَمُ الوسومِ في القاعدةِ بقيدٍ لا في التطبيقِ وحدَه
--
-- لأنَّ الوسمَ **بيانٌ يُقرأُ في تقريرٍ بعدَ سنةٍ**: قائمةٌ تُحرَسُ في طبقةِ
-- تطبيقٍ واحدةٍ تُخترَقُ من أوّلِ مُنادٍ آخرَ (سطحُ سائقٍ · مهمّةُ استيرادٍ)، ثمَّ
-- يُقرأُ وسمٌ لا يعرفُه أحدٌ فلا يُحصى ولا يُترجَمُ. والقيدُ ههنا هوَ الحكمُ،
-- والدالّةُ **تردُّ** الوسمَ المجهولَ برمزٍ مُصنَّفٍ ولا تُسقِطُه صامتةً.
--
-- ## ولماذا نُسِخَ منطقُ التقييمِ نقلاً لا تكراراً
--
-- القاعدةُ 0.6: مصدرُ حقيقةٍ واحدٌ. فالمنطقُ كلُّه انتقلَ إلى
-- `submit_rating_with_tags` بحرفِه (نفسُ رموزِ الخطأِ · نفسُ استنتاجِ الاتّجاهِ ·
-- نفسُ القيدِ الفريدِ حكماً على التكرارِ · نفسُ `recompute_ratee_averages` ·
-- نفسُ صفِّ `audit_log`)، و`submit_rating(uuid, bigint, smallint, text)`
-- **يُفوِّضُ** إليها بوسومٍ معدومةٍ. فمن نادى القديمَ لم يتغيَّرْ جوابُه، ولا
-- حِملَ زائدَ بتوقيعٍ ملتبسٍ: توقيعُ الوسومِ **خمسةُ مُعامِلاتٍ** وحدَه.
--
-- ## وما لا تفعلُه هذه الهجرةُ عن قصدٍ
--
-- ــ **لا تُنشئُ حقلَ مبلغٍ ولا أجرةٍ ولا وسيلةِ دفعٍ ولا خانةً لها** — مُجمَّدةٌ
--    بـ`ADR 0039` §٤ و`م13-7` و`DEC-11`. والملخَّصُ ههنا **ملخَّصُ رحلةٍ لا
--    فاتورةٌ**، وخانةُ مالٍ فارغةٌ في إيصالٍ تُقرأُ التزاماً.
-- ــ **لا تُنشئُ عمودَ مسافةٍ مقطوعةٍ ولا عدّادَ كيلومتراتٍ** — لا مصدرَ له.
-- ــ **لا تُعدِّلُ `submit_rating` سلوكاً** — تُعيدُ جسمَه تفويضاً وحدَه.
-- ــ **لا تلمسُ `flag_rating` ولا `open_support_ticket` ولا
--    `recompute_ratee_averages`** — قائمةٌ تُنادى ولا تُعادُ كتابتُها.
-- ــ **لا تنزعُ قيداً ولا عموداً** — طورُ `expand` لا يحذفُ شيئاً (`ح-1`).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (١) مُعجَمُ الوسومِ — دالّةُ حكمٍ نقيّةٌ يُستدعيها القيدُ.
--
-- ولماذا دالّةٌ لا تعبيرٌ مكتوبٌ في القيدِ: **منعُ التكرارِ** يحتاجُ عدَّ
-- المتمايزاتِ، وذلكَ استعلامٌ فرعيٌّ **لا يجوزُ في `check`**. فالحكمُ يُكتَبُ
-- مرّةً في دالّةٍ `immutable`، ويُقرأُ في القيدِ وفي رسالةِ الرفضِ سواءً.
-- ----------------------------------------------------------------------------
create or replace function public.rating_tags_are_valid(p_tags text[])
returns boolean
language sql
immutable
security invoker
set search_path = public
as $fn$
  select p_tags is null
      or (
        -- عددٌ محصورٌ: وسمٌ واحدٌ على الأقلِّ وثلاثةٌ على الأكثرِ. والسقفُ ليسَ
        -- ذوقاً: قائمةٌ بلا سقفٍ تُملأُ كلُّها فتستوي التقييماتُ ولا تُفرِّقُ.
        cardinality(p_tags) between 1 and 3
        -- لا وسمَ خارجَ المُعجَمِ. والمُعجَمُ مكتوبٌ ههنا حرفاً، ويُقابَلُ
        -- بنظيرِه في `packages/domain/transport/ride-summary.ts` بحاجزٍ ساكنٍ.
        and p_tags <@ array[
          'cleanliness',
          'politeness',
          'route_adherence',
          'punctuality',
          'driving_safety'
        ]::text[]
        -- ولا تكرارَ: «نظافةٌ · نظافةٌ» ليسَ رأياً أقوى، بل عدُّ وسمٍ مرّتَينِ.
        and cardinality(p_tags) = (select count(distinct t) from unnest(p_tags) as t)
      )
$fn$;

comment on function public.rating_tags_are_valid(text[]) is
  'F2-07: حكمُ مُعجَمِ وسومِ التقييمِ — عددٌ محصورٌ ولا وسمَ مجهولاً ولا تكرارَ.';

-- ----------------------------------------------------------------------------
-- (٢) عمودُ الوسومِ وقيدُه.
--
-- والعمودُ يقبلُ العَدَمَ **ولا يُعطى قيمةً افتراضيّةً**: `'{}'` تعني «قيَّمَ
-- ولم يختر وسماً» و`null` تعني «لا وسومَ في هذا التقييمِ»، والفرقُ يُقرأُ في
-- أيِّ إحصاءٍ لاحقٍ. والدالّةُ تُحوِّلُ المصفوفةَ الفارغةَ إلى `null` فلا يُخزَّنُ
-- الوجهانِ لمعنىً واحدٍ.
-- ----------------------------------------------------------------------------
alter table ratings add column if not exists tags text[];

comment on column ratings.tags is
  'F2-07: وسومٌ سريعةٌ من مُعجَمٍ محصورٍ (`rating_tags_are_valid`) — `null` لا وسومَ.';

-- والقيدُ يُضافُ **مرّةً** ويُصادَقُ في العبارةِ نفسِها، ولذلكَ سببٌ:
--   ــ `not valid` مكتوبٌ نصّاً كما تفرضُ قواعدُ سلامةِ الهجراتِ (`CAP-007`):
--      لا مسحَ جدولٍ تحتَ قفلٍ حاجزٍ عندَ الإضافةِ.
--   ــ ثمَّ `validate constraint` **ههنا لا في ملفٍّ تالٍ**: العمودُ **جديدٌ**
--      فكلُّ صفٍّ قائمٍ يحملُ `null` وهوَ ما يقبلُه المُسنَدُ، والمصادقةُ تأخذُ
--      `share update exclusive` وحدَه (لا تمنعُ قراءةً ولا كتابةً). وتركُها
--      لملفٍّ لاحقٍ يُخلِّفُ قيداً **يُقرأُ أقوى مِمّا هوَ**.
--   ــ والغلافُ `do` **للاسترجاعِ** (idempotence): المُطبِّقُ يُعيدُ كلَّ ملفٍّ
--      في كلِّ تشغيلٍ، و`add constraint` لا تقبلُ `if not exists`، و`drop
--      constraint if exists` حذفٌ لا يجوزُ خارجَ طورِ `contract`.
do $do$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ratings'::regclass
       and conname = 'ratings_tags_vocabulary'
  ) then
    alter table ratings
      add constraint ratings_tags_vocabulary
      check (rating_tags_are_valid(tags)) not valid;
  end if;

  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.ratings'::regclass
       and conname = 'ratings_tags_vocabulary'
       and not convalidated
  ) then
    alter table ratings validate constraint ratings_tags_vocabulary;
  end if;
end
$do$;

-- ----------------------------------------------------------------------------
-- (٣) `completed_ride_summary` — ملخَّصُ الرحلةِ كما كُتِبَت، وحالةُ تقييمِها.
--
-- والمِلكيّةُ **قيدٌ في الاستفسارِ** لا فحصٌ في التطبيقِ: `users → riders →
-- orders`، وغيرُ المالكِ يُرَدُّ `ORDER_NOT_FOUND` **بالحرفِ نفسِه** الذي يُرَدُّ
-- به معرِّفٌ معدومٌ — فلا يصيرُ المسارُ عدَّادَ معرّفاتٍ صحيحةٍ لمن يجرِّبُها.
--
-- وحقولُ السائقِ **متغيّراتٌ مفردةٌ لا سجلٌّ** (`record`): سجلٌّ لم يُسنَدْ إليه
-- شيءٌ لا يجوزُ ذِكرُ حقلٍ منه في استعلامِ الإرجاعِ **ولو في فرعٍ لا يُسلَكُ**
-- فيسقطُ التخطيطُ بـ`55000`. وذاكَ عطبٌ **كشفَه قياسُ `F2-06` على قاعدةٍ
-- حقيقيّةٍ** لا مُصرِّفٌ ولا مزدوجٌ، وسببُه مكتوبٌ ههنا كي لا يُعيدَه «تنظيفٌ».
-- ----------------------------------------------------------------------------
create or replace function completed_ride_summary(
  p_telegram_id bigint,
  p_order_id    uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_user_id  uuid;
  v_rider_id uuid;
  v_order    record;
  v_driver_id      uuid;
  v_vehicle_type   text;
  v_plate_number   text;
  v_rating_average numeric;
  v_rating_count   integer;
  v_full_name      text;
  v_driver_name    text;
  v_window_hours   numeric;
  v_already_rated  boolean := false;
  v_window_closed  boolean := true;
  v_can_rate       boolean := false;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  select o.id,
         o.status,
         o.service,
         o.city_id,
         o.assigned_driver_id,
         o.pickup_label,
         o.dropoff_label,
         o.created_at,
         o.matched_at,
         o.started_at,
         o.completed_at,
         -- المدّةُ فرقُ ختمَينِ مكتوبَينِ، و`null` متى غابَ أحدُهما. والقصُّ
         -- عندَ الصفرِ لختمَينِ مقلوبَينِ **موافقٌ لِما في `F2-06`**: انقلابُ
         -- ختمَينِ عطبُ بياناتٍ لا مدّةٌ سالبةٌ تُعرَضُ.
         case
           when o.started_at is null or o.completed_at is null then null
           else greatest(
             0,
             floor(extract(epoch from (o.completed_at - o.started_at)))::bigint
           )
         end as duration_seconds,
         -- وترُ الخطِّ المستقيمِ بالأمتارِ على `geography` — **لا مقطوعٌ**.
         -- و`null` متى غابَت الوجهةُ: صفرُ أمتارٍ يعني «لم تتحرَّكْ».
         case
           when o.dropoff is null then null
           else round(st_distance(o.pickup, o.dropoff)::numeric, 1)
         end as straight_line_meters
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- بطاقةُ السائقِ تُقرأُ للرحلةِ **المنتهيةِ** وحدَها: رحلةٌ أُلغِيَت بعدَ
  -- إسنادٍ تبقى بسائقٍ مكتوبٍ، وعرضُ بطاقتِه في ملخَّصِ رحلةٍ لم تجرِ عرضٌ بلا
  -- معنىً. **ولا موقعَ ولا عُمرَ موقعٍ ههنا**: الرحلةُ انتهت فلا موضعَ يُتابَعُ.
  if v_order.assigned_driver_id is not null and v_order.status = 'completed' then
    select d.id,
           d.vehicle_type,
           d.plate_number,
           d.rating_average,
           coalesce(d.rating_count, 0),
           u.full_name
      into v_driver_id,
           v_vehicle_type,
           v_plate_number,
           v_rating_average,
           v_rating_count,
           v_full_name
    from drivers d
    join users u on u.id = d.user_id
    where d.id = v_order.assigned_driver_id;

    v_driver_name := nullif(split_part(coalesce(trim(v_full_name), ''), ' ', 1), '');
  end if;

  -- نافذةُ التقييمِ من الإعدادِ، **وبديلُها مكتوبٌ ههنا وحدَه**:
  -- `get_setting_number` تُطلِقُ `MISSING_SETTING` عندَ غيابِ الصفِّ، وسقوطُ
  -- **قراءةٍ** لأجلِ إعدادٍ ناقصٍ يحجبُ الملخَّصَ كلَّه عن راكبٍ لا شأنَ له
  -- بتهيئةِ مدينةٍ. فالقراءةُ تتساهلُ بثمانٍ وأربعينَ ساعةً — **وهيَ القيمةُ
  -- المبذورةُ نفسُها** في هجرةِ التقييماتِ لا رقمٌ مخترَعٌ — **والكتابةُ لا تتساهلُ**:
  -- `submit_rating_with_tags` تُطلِقُ كما كانَت.
  begin
    v_window_hours := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  exception when raise_exception then
    v_window_hours := 48;
  end;

  select exists (
    select 1
      from ratings rt
     where rt.order_id = v_order.id
       and rt.direction = 'rider_to_driver'
  ) into v_already_rated;

  -- النافذةُ تُقاسُ **بساعةِ القاعدةِ** (`now()`): لو قاسَها الجهازُ لَفتحَ
  -- راكبٌ نافذةً مُغلَقةً بتقديمِ ساعتِه، ثمَّ رُدَّ من القاعدةِ برمزٍ لا يفهمُه.
  v_window_closed := case
    when v_order.completed_at is null then true
    else v_order.completed_at + make_interval(hours => v_window_hours::integer) < now()
  end;

  v_can_rate := v_order.status = 'completed'
                and not v_already_rated
                and not v_window_closed;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'matched_at', v_order.matched_at,
    'started_at', v_order.started_at,
    'completed_at', v_order.completed_at,
    'duration_seconds', v_order.duration_seconds,
    'straight_line_meters', v_order.straight_line_meters,
    'driver', case
      when v_driver_id is null then null
      else jsonb_build_object(
        'first_name', v_driver_name,
        'vehicle_type', v_vehicle_type,
        'plate_number', v_plate_number,
        'rating_average', v_rating_average,
        'rating_count', coalesce(v_rating_count, 0)
      )
    end,
    'rating', jsonb_build_object(
      'already_rated', v_already_rated,
      'window_hours', v_window_hours,
      'window_closed', v_window_closed,
      'can_rate', v_can_rate
    )
  );
end;
$fn$;

comment on function completed_ride_summary(bigint, uuid) is
  'F2-07: ملخَّصُ رحلةٍ منتهيةٍ لمالكِها — مدّةٌ ووترُ خطٍّ مستقيمٍ وحالةُ تقييمٍ، بلا مالٍ وبلا موقعٍ.';

-- ----------------------------------------------------------------------------
-- (٤) `submit_rating_with_tags` — منطقُ التقييمِ **منقولاً بحرفِه** ومعَه الوسومُ.
--
-- ولماذا الوسومُ تُحكَمُ في الدالّةِ **قبلَ** القيدِ: القيدُ يُسقِطُ العبارةَ
-- بـ`23514` وهوَ نصٌّ لا يُترجَمُ للراكبِ؛ والدالّةُ تردُّ رمزاً مُصنَّفاً
-- (`UNKNOWN_RATING_TAG` · `TOO_MANY_RATING_TAGS` · `DUPLICATE_RATING_TAG`)
-- فيُقرأُ سببُ الرفضِ نصّاً. **والقيدُ يبقى** حاجزاً أخيراً لكلِّ مُنادٍ آخرَ.
-- ----------------------------------------------------------------------------
create or replace function public.submit_rating_with_tags(
  p_order_id uuid,
  p_rater_telegram_id bigint,
  p_stars smallint,
  p_comment text default null::text,
  p_tags text[] default null::text[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order     orders%rowtype;
  v_rater     users%rowtype;
  v_driver    drivers%rowtype;
  v_rider     riders%rowtype;
  v_driver_u  users%rowtype;
  v_rider_u   users%rowtype;
  v_direction rating_direction;
  v_ratee     uuid;
  v_window    numeric;
  v_now       timestamptz := now();
  v_rating_id uuid;
  v_tags      text[] := nullif(p_tags, '{}'::text[]);
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then
    return jsonb_build_object('ok', false, 'error', 'STARS_OUT_OF_RANGE');
  end if;

  -- الوسومُ تُحكَمُ **قبلَ أيِّ قراءةٍ**: رفضُ مُدخلٍ لا يحتاجُ صفّاً.
  if v_tags is not null then
    if cardinality(v_tags) > 3 then
      return jsonb_build_object('ok', false, 'error', 'TOO_MANY_RATING_TAGS');
    end if;
    if cardinality(v_tags) <> (select count(distinct t) from unnest(v_tags) as t) then
      return jsonb_build_object('ok', false, 'error', 'DUPLICATE_RATING_TAG');
    end if;
    if not (v_tags <@ array[
      'cleanliness', 'politeness', 'route_adherence', 'punctuality', 'driving_safety'
    ]::text[]) then
      -- الوسمُ المجهولُ **يُرَدُّ** ولا يُخزَّنُ صامتاً ولا يُحذَفُ من المصفوفةِ:
      -- حذفُه يجعلُ الراكبَ يظنُّ أنَّ رأيَه سُجِّلَ وقد أُسقِطَ.
      return jsonb_build_object('ok', false, 'error', 'UNKNOWN_RATING_TAG');
    end if;
  end if;

  select * into v_rater from users where telegram_id = p_rater_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_FOUND');
  end if;

  select * into v_order from orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'completed' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_COMPLETED');
  end if;

  select * into v_driver from drivers where id = v_order.assigned_driver_id;
  select * into v_driver_u from users where id = v_driver.user_id;
  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  -- الاتجاه يُستنتج من هوية المُقيِّم لا يُمرَّر من الخارج: من ليس طرفاً في الرحلة لا يقيّمها
  if v_rater.id = v_rider_u.id then
    v_direction := 'rider_to_driver';
    v_ratee := v_driver_u.id;
  elsif v_rater.id = v_driver_u.id then
    v_direction := 'driver_to_rider';
    v_ratee := v_rider_u.id;
  else
    return jsonb_build_object('ok', false, 'error', 'RATER_NOT_PARTY_TO_ORDER');
  end if;

  -- بلا رقم مرمَّز: get_setting_number تُطلق MISSING_SETTING عند غياب الصفّ،
  -- فإعدادٌ غائب خطأ تشغيليّ يُعلَن، لا سياسةٌ تُخترع في القاعدة.
  v_window := get_setting_number(v_order.city_id, 'rating_prompt_window_hours');
  if v_order.completed_at + make_interval(hours => v_window::integer) < v_now then
    return jsonb_build_object('ok', false, 'error', 'RATING_WINDOW_CLOSED');
  end if;

  begin
    insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id,
                         stars, comment, tags)
    values (v_order.city_id, p_order_id, v_direction, v_rater.id, v_ratee,
            p_stars, nullif(btrim(coalesce(p_comment, '')), ''), v_tags)
    returning id into v_rating_id;
  exception when unique_violation then
    -- القيد الفريد هو الحكم، لا فحص سابق في التطبيق: لا سباق ولا تقييم مكرَّر
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RATED');
  end;

  -- التحديث فوري ليُثمر التقييم في المطابقة التالية مباشرة، والمهمة الدورية
  -- تعيد الحساب من المصدر لتصحّح أي انحراف تراكمي. القفل داخل الدالّة المشتركة.
  perform recompute_ratee_averages(v_ratee, v_direction);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rater.id, 'rating.submitted', 'rating', v_rating_id,
          jsonb_build_object('order_id', p_order_id, 'direction', v_direction,
                             'stars', p_stars, 'ratee_user_id', v_ratee,
                             'tags', to_jsonb(coalesce(v_tags, array[]::text[]))));

  return jsonb_build_object('ok', true, 'rating_id', v_rating_id,
                            'direction', v_direction, 'stars', p_stars,
                            'tags', to_jsonb(coalesce(v_tags, array[]::text[])));
end;
$function$;

comment on function public.submit_rating_with_tags(uuid, bigint, smallint, text, text[]) is
  'F2-07: مصدرُ حقيقةِ التقييمِ — نجومٌ وملاحظةٌ ووسومٌ من مُعجَمٍ محصورٍ، ورموزُ الخطأِ كما كانت.';

-- ----------------------------------------------------------------------------
-- (٥) التوقيعُ القائمُ **يُفوِّضُ** ولا يُنسَخُ — ولا حِملَ زائدَ ملتبسٌ.
--
-- وجسمُ الدالّةِ صارَ سطراً واحداً عن قصدٍ: من قرأَه علمَ **أين المنطقُ**. ولو
-- بقيَ المنطقُ ههنا أيضاً لَصارَ في المستودعِ نسختانِ تفترقانِ عندَ أوّلِ تصحيحٍ،
-- فيُرَدُّ مُنادٍ بـ`RATING_WINDOW_CLOSED` ويُقبَلُ آخرُ للرحلةِ نفسِها.
-- ----------------------------------------------------------------------------
create or replace function public.submit_rating(
  p_order_id uuid,
  p_rater_telegram_id bigint,
  p_stars smallint,
  p_comment text default null::text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return submit_rating_with_tags(
    p_order_id, p_rater_telegram_id, p_stars, p_comment, null::text[]
  );
end;
$function$;

comment on function public.submit_rating(uuid, bigint, smallint, text) is
  'F2-07: تفويضٌ إلى submit_rating_with_tags بوسومٍ معدومةٍ — السلوكُ ورموزُ الخطأِ كما كانت.';

-- ----------------------------------------------------------------------------
-- (٦) نزعُ التنفيذِ — إلزاميٌّ لكلِّ دالّةٍ أُنشِئَت أو استُبدِلَت ههنا.
--
-- و**درسُ `F2-06` مكتوبٌ بثمنِه**: `postgres` يمنحُ `execute` لدورِ `public` على
-- كلِّ دالّةٍ جديدةٍ **تلقائيّاً**، فسقطَت شغلةُ التكاملِ في CI على طبقةِ
-- الصلاحيّاتِ لا على منطقٍ. والنزعُ ههنا ليسَ احتياطاً: `anon` و`authenticated`
-- يُستدَلُّ عليهما من `public`، وحاجزُ العقدِ الساكنُ يُسقِطُ كلَّ دالّةٍ في هذا
-- الملفِّ لا يُنزَعُ تنفيذُها بالأدوارِ الثلاثةِ مُسمّاةً.
-- ----------------------------------------------------------------------------
revoke execute on function rating_tags_are_valid(text[]) from public, anon, authenticated;
revoke execute on function completed_ride_summary(bigint, uuid) from public, anon, authenticated;
revoke execute on function submit_rating_with_tags(uuid, bigint, smallint, text, text[]) from public, anon, authenticated;
revoke execute on function submit_rating(uuid, bigint, smallint, text) from public, anon, authenticated;
