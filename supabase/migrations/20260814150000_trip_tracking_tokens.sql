-- =============================================================================
-- الغرض: رموزُ تتبّعٍ مؤقّتة تُفتح بها صفحةُ خريطةٍ حيّة بلا تسجيل دخول — الراكب
--   أو مرسِلُ الطرد يُشارك رابطاً واحداً مع من ينتظره (وليّ أمر، زوجة، عميل)،
--   فيرى موقعَ السائق لحظةً بلحظة حتى تنتهي الرحلة ثمّ ينقضي الرابط تلقائياً.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه: packages/application/tracking/{issue,revoke}-tracking-token.ts
--   و get-live-position.ts، وحوارا البوتَين، ومهمّة expire-tracking-tokens.
--
-- ## ما هو موجودٌ أصلاً ولا يُكرَّر
--
-- موقعُ السائق مصدرُه الوحيد `drivers.last_location` (ADR-0015)، ويُكتب من مسارٍ
-- واحد بعد تقييم الإصلاحة. وهذه الترحيلة **لا تُنشئ مخزناً ثانياً للموقع** ولا
-- تكتب موقعاً قط: تُنشئ طبقةَ إذنٍ فوق ما هو مكتوب. وبثُّ الموقع في تلغرام
-- (ADR 0020/0021) يبقى كما هو — هذا رابطٌ لمن لا يملك محادثةً مع البوت.
--
-- ## معنى الصلاحية: الرحلةُ تُحدّده لا مؤقّتٌ أعمى
--
-- `expires_at` انقضاءٌ صارم يُقرأ في كلّ استعلام. وقيمتُه عند الإصدار سقفٌ من
-- `platform_settings` (`tracking_link_max_lifetime_minutes`) لا وقتُ انتهاء
-- الرحلة — لأنّ وقتَ انتهائها غيرُ معلومٍ عند إصدارِه. ثمّ حين تنتهي الرحلة
-- تسحب مهمّةُ `expire_tracking_tokens` الانقضاءَ إلى `completed_at + المهلة`
-- (`tracking_link_grace_minutes`). فالنتيجة: رابطٌ يعمل ما دامت الرحلة، ويبقى
-- ربعَ ساعةٍ بعدها ليرى المنتظِرُ آخرَ موقعٍ معروف، ثمّ يموت.
--
-- والسقفُ ليس زينة: رحلةٌ لم تُغلق أبداً (سائقٌ اختفى) كانت ستُبقي رابطاً حيّاً
-- إلى الأبد. والمهلةُ والسقفُ **قيمتان تجاريتان** فمكانُهما `platform_settings`
-- لا الكود (القاعدة 0.3)، ومفتاحتان بالمدينة لأنّ مدينةً قد تختار غير ما تختاره
-- أخرى.
--
-- ## لماذا الرمزُ يُولَّد في التطبيق لا في القاعدة
--
-- `crypto.randomBytes(32)` من العملية مُدقَّقٌ ومعروفُ المصدر، و`gen_random_bytes`
-- يحتاج pgcrypto وقد يكون مُعطَّلاً في مضيفٍ فتصير الترحيلةُ هشّة. والقاعدة تفرض
-- ما يهمّها: الطولَ الأدنى والتفرّد — فلا يُقبل رمزٌ قصير ولو أخطأ التطبيق.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الجدول
-- ---------------------------------------------------------------------------

create table if not exists trip_tracking_tokens (
  id         uuid primary key default gen_random_uuid(),
  -- القاعدة 0.4: مدينةُ الطلب تُنسخ هنا لا تُستنبط بوصلةٍ في كلّ قراءة.
  city_id    uuid not null references cities(id),
  order_id   uuid not null references orders(id) on delete cascade,
  -- الرمزُ نفسُه هو كلمةُ السرّ: لا مُعرِّفَ آخر يُخمَّن للوصول إلى الصفحة.
  token      text not null unique,
  -- معرّفُ تلغرام لمن أصدره — الراكب أو مرسِل الطرد. به وحده يُلغى الرمز.
  created_by bigint not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  -- ٦٤ محرفاً هي ٣٢ بايتاً بترميز hex. الحدّ أدنى لا يساوي: رمزٌ أطول مقبول،
  -- وأقصرُ من ذلك مرفوضٌ في القاعدة حتى لو أخطأ التطبيق في توليده.
  constraint trip_tracking_tokens_token_long_enough check (length(token) >= 64)
);

-- القراءةُ الحارّة كلُّها بالرمز (وهو `unique` فله فهرسٌ أصلاً). وهذان الفهرسان
-- للكتابتين الأخريين: مهمّةُ الانقضاء تسأل بالمدينة، والبوت يسأل عن رمز الطلب.
create index if not exists trip_tracking_tokens_city_expires_idx
  on trip_tracking_tokens (city_id, expires_at);
create index if not exists trip_tracking_tokens_order_idx
  on trip_tracking_tokens (order_id);

comment on table trip_tracking_tokens is
  'رموزُ تتبّعٍ مؤقّتة تفتح صفحةَ موقعٍ حيّ بلا تسجيل دخول — تُلغى بطلب مالكها وتنقضي بعد انتهاء الرحلة (§4.2).';

-- RLS مفعّلة بلا سياسةٍ عن قصد: كلُّ وصولٍ عبر الدوالّ أدناه من اتصال الخدمة
-- (ADR 0006). وفتحُ «قراءةٍ بالتوكن» لدور anon كان سيعني كشفَ الجدول لمن يجرّب
-- رموزاً، وكشفَ `created_by` و`order_id` معه — والصفحةُ لا تحتاج منه شيئاً.
alter table trip_tracking_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- ٢) الإعدادان التجاريان
-- ---------------------------------------------------------------------------

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'tracking_link_grace_minutes',
       '15'::jsonb,
       'number',
       'كم دقيقةً يبقى رابطُ التتبّع صالحاً بعد انتهاء الرحلة — ليرى المنتظِرُ آخرَ موقعٍ معروف',
       false
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.city_id = c.id and s.key = 'tracking_link_grace_minutes'
 );

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id,
       'tracking_link_max_lifetime_minutes',
       '720'::jsonb,
       'number',
       'السقفُ المطلق لعمر رابط التتبّع من إصداره — يحمي من رحلةٍ لم تُغلق أبداً فيبقى رابطُها حيّاً',
       false
  from cities c
 where not exists (
   select 1 from platform_settings s
    where s.key = 'tracking_link_max_lifetime_minutes' and s.city_id = c.id
 );

-- ---------------------------------------------------------------------------
-- ٣) الإصدار
-- ---------------------------------------------------------------------------
--
-- الملكيةُ تُتحقَّق في القاعدة لا في التطبيق: الدالّةُ تصل من الرمز إلى الطلب إلى
-- الراكب إلى مستخدمه إلى معرّف تلغرامه في عبارةٍ واحدة، فلا نافذةَ بين «تحقّقتُ»
-- و«أصدرتُ» يُغيَّر فيها شيء. ولو كان التحقّقُ في التطبيق لكان استعلاماً ثمّ
-- كتابةً — وهو ما تمنعه القاعدة 0.5.
--
-- ورمزان لطلبٍ واحد يعملان معاً بالتصميم: الراكب قد يشارك رابطاً مع أمّه وآخر مع
-- عميلٍ ينتظر طردَه، وإلغاءُ أحدهما لا يمسّ الآخر. ولا حدَّ أعلى مصطنَعاً هنا:
-- من يُصدر عشرةً يكشف موقعَ سائقه لعشرةٍ اختارهم بنفسه، والحدُّ التقنيّ الحقيقي
-- في حدّ معدّل البوابة لا في هذا الجدول.

create or replace function issue_tracking_token(
  p_order_id uuid,
  p_telegram_id bigint,
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order       record;
  v_owner_tg    bigint;
  v_max_minutes numeric;
  v_expires_at  timestamptz;
begin
  if p_token is null or length(p_token) < 64 then
    return jsonb_build_object('ok', false, 'error', 'TOKEN_TOO_SHORT');
  end if;

  select o.id, o.city_id, o.status, o.rider_id
    into v_order
    from orders o
   where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- مالكُ الطلب هو من يُصدر رابطَه: السائقُ لا يُصدر رابطاً لموقعِ نفسه يُشارَك
  -- بلا علم الراكب، ولا راكبٌ آخر يُصدر رابطاً لرحلةٍ ليست له.
  select u.telegram_id
    into v_owner_tg
    from riders r
    join users u on u.id = r.user_id
   where r.id = v_order.rider_id;
  if v_owner_tg is null or v_owner_tg <> p_telegram_id then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  -- رابطُ رحلةٍ منتهية لا يُصدَر: لا موقعَ حيّاً يُتابَع، وإصدارُه يوهم المشارَك
  -- معه أنّ ثمّة ما يُرى.
  if not is_active_order_status(v_order.status) then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_ACTIVE');
  end if;

  v_max_minutes := get_setting_number(v_order.city_id, 'tracking_link_max_lifetime_minutes');
  v_expires_at := now() + make_interval(mins => v_max_minutes::integer);

  insert into trip_tracking_tokens (city_id, order_id, token, created_by, expires_at)
  values (v_order.city_id, v_order.id, p_token, p_telegram_id, v_expires_at);

  return jsonb_build_object(
    'ok', true,
    'token', p_token,
    'order_id', v_order.id,
    'city_id', v_order.city_id,
    'expires_at', v_expires_at
  );
exception
  when unique_violation then
    -- تصادمُ رمزٍ من ٣٢ بايتاً عشوائياً غيرُ محتملٍ عملياً، لكنّ إخفاءَه خلف
    -- استثناءٍ عامّ كان سيُظهره للراكب «حدث خطأ» بلا معنى. يُسمّى ليُعاد التوليد.
    return jsonb_build_object('ok', false, 'error', 'TOKEN_COLLISION');
end;
$$;

comment on function issue_tracking_token(uuid, bigint, text) is
  'يُصدر رمزَ تتبّعٍ لطلبٍ قائم بعد التحقّق من ملكيته ذرّياً — المهلة من platform_settings (§4.2).';

-- ---------------------------------------------------------------------------
-- ٤) الإلغاء
-- ---------------------------------------------------------------------------
--
-- عبارةُ تحديثٍ واحدة بشروطها كلّها في `where`: من ألغى مرّتين بضغطتين متسارعتين
-- يُصيب الثانية «غيرَ موجود» لا حالةً وسطى. ولا تُقرأ الحالةُ قبل الكتابة أبداً.

create or replace function revoke_tracking_token(
  p_token text,
  p_telegram_id bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update trip_tracking_tokens
     set revoked_at = now()
   where token = p_token
     and created_by = p_telegram_id
     and revoked_at is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- سببٌ واحد لثلاث حالات (لا وجود، ليس لك، مُلغى سابقاً) عن قصد: تمييزُها
    -- للمنادي يجعل الدالّة أداةَ استكشافٍ لمن يجرّب رموزاً ومعرّفات.
    return jsonb_build_object('ok', false, 'error', 'TOKEN_NOT_REVOCABLE');
  end if;

  return jsonb_build_object('ok', true, 'revoked', v_rows);
end;
$$;

comment on function revoke_tracking_token(text, bigint) is
  'يُلغي رمزَ تتبّعٍ بطلب مُصدِره ذرّياً — سببٌ واحد لكلّ فشلٍ فلا يصير أداةَ استكشاف (§4.2).';

-- ---------------------------------------------------------------------------
-- ٥) القراءة العامّة — موقعٌ فقط، لا هوية
-- ---------------------------------------------------------------------------
--
-- ما تُعيده هذه الدالّة يُرى في متصفّحٍ مجهولٍ على الإنترنت. فلا اسمَ سائقٍ ولا
-- لوحةَ سيارةٍ ولا معرّفَ راكبٍ ولا معرّفَ طلبٍ فيه: من عنده الرابط يرى نقطةً
-- تتحرّك ووقتَ آخر تحديث، وهذا كلُّ ما وُعِد به.
--
-- و`active` مشتقٌّ من حالة الطلب لا من الانقضاء: الرحلةُ المنتهية ترجع
-- `active=false` مع آخر موقعٍ معروف (ما دامت المهلةُ لم تنقضِ)، فتقول الصفحةُ
-- «انتهت الرحلة» بدل أن تُظهر نقطةً ساكنةً يظنّها الناظرُ عطلاً.

create or replace function get_tracking_position(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select t.order_id,
         o.status,
         d.last_location,
         d.last_location_at
    into v_row
    from trip_tracking_tokens t
    join orders o on o.id = t.order_id
    left join drivers d on d.id = o.assigned_driver_id
   where t.token = p_token
     and t.revoked_at is null
     and t.expires_at > now();

  if not found then
    -- سببٌ واحد لكلّ حالة (لا وجود، مُلغى، منتهٍ): البوابةُ تُترجمه 404 واحداً،
    -- فلا يستطيع من يجرّب رموزاً أن يفرّق بين «خطأ» و«كان صحيحاً وانتهى».
    return jsonb_build_object('ok', false, 'error', 'TOKEN_NOT_FOUND');
  end if;

  if v_row.last_location is null or v_row.last_location_at is null then
    -- سائقٌ لم يُرسل موقعاً بعد: ليس خطأً — الرابطُ صالحٌ والانتظارُ مشروع،
    -- والصفحةُ تقول «بانتظار أوّل موقع» لا «انتهى الرابط».
    return jsonb_build_object(
      'ok', true,
      'has_position', false,
      'active', is_active_order_status(v_row.status)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'has_position', true,
    'lat', st_y(v_row.last_location::geometry),
    'lng', st_x(v_row.last_location::geometry),
    'updated_at', v_row.last_location_at,
    'active', is_active_order_status(v_row.status)
  );
end;
$$;

comment on function get_tracking_position(text) is
  'موقعُ سائقِ الطلب بالرمز — بلا أيّ هويّة، وسببٌ واحد لكلّ فشل. تُنادى بلا مصادقة عبر البوابة (§4.2).';

-- ---------------------------------------------------------------------------
-- ٦) الانقضاء بعد انتهاء الرحلة
-- ---------------------------------------------------------------------------
--
-- تُشغّلها مهمّةٌ دورية كلّ دقيقة لكلّ مدينة. والسحبُ إلى `least(...)` لا الضبطُ
-- المباشر: رمزٌ سحبَته دورةٌ سابقة لا يُمدَّد بدورةٍ لاحقة — والعملية لا تُنقض
-- إلغاءَ مالكٍ ولا تُطيل عمرَ رمزٍ قصّره تعديلُ إعدادٍ.

create or replace function expire_tracking_tokens(
  p_city_id uuid,
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace   numeric;
  v_pulled  integer;
begin
  v_grace := get_setting_number(p_city_id, 'tracking_link_grace_minutes');

  with ended as (
    select t.id,
           coalesce(o.completed_at, o.updated_at) + make_interval(mins => v_grace::integer) as due_at
      from trip_tracking_tokens t
      join orders o on o.id = t.order_id
     where t.city_id = p_city_id
       and t.revoked_at is null
       and t.expires_at > now()
       and not is_active_order_status(o.status)
     order by t.expires_at
     limit p_limit
  )
  update trip_tracking_tokens t
     set expires_at = least(t.expires_at, ended.due_at)
    from ended
   where t.id = ended.id
     and t.expires_at > ended.due_at;

  get diagnostics v_pulled = row_count;
  return jsonb_build_object('ok', true, 'pulled', v_pulled);
end;
$$;

comment on function expire_tracking_tokens(uuid, integer) is
  'يسحب انقضاءَ رموزِ الرحلات المنتهية إلى وقت الانتهاء + المهلة — تُشغّلها مهمّة expire-tracking-tokens كلّ دقيقة (§4.2).';

-- ---------------------------------------------------------------------------
-- ٧) سطحُ الصلاحيات
-- ---------------------------------------------------------------------------
--
-- `get_tracking_position` **لا تُمنح لـanon** مع أنّها تُنادى بلا مصادقة: النداءُ
-- يجري من البوابة باتصال الخدمة، والبوابةُ هي ما يفرض `no-store` ولا CORS وحدّ
-- المعدّل. ومنحُها لـanon كان سيفتح REST مباشراً بلا شيءٍ من ذلك.

revoke all on table trip_tracking_tokens from public;

do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'issue_tracking_token(uuid, bigint, text)',
    'revoke_tracking_token(text, bigint)',
    'get_tracking_position(text)',
    'expire_tracking_tokens(uuid, integer)'
  ] loop
    execute format('revoke all on function %s from public', v_sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', v_sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', v_sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_sig);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table trip_tracking_tokens from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table trip_tracking_tokens from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on table trip_tracking_tokens to service_role';
  end if;
end $$;
