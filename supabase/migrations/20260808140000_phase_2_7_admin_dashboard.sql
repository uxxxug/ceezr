-- =============================================================================
-- وَصْلة — المرحلة 2.7 — لوحة الإدارة: المصادقة الحقيقية وأفعال التشغيل
--
-- ما يضيفه هذا الملف، ولماذا كلٌّ منه في القاعدة لا في التطبيق:
--   1) admin_login_codes  — رمز دخول لمرّة واحدة يُرسَل على تلغرام. مخزَّن بصمته
--      (sha256) لا نصّه: تسريب نسخة من الجدول لا يمنح دخولاً.
--   2) admin_sessions     — جلسة اللوحة. البصمة أيضاً لا الرمز، وانتهاء صريح.
--   3) دوالّ ذرّية        — إصدار الرمز واستهلاكه وفتح الجلسة وإغلاقها، وثلاثة
--      أفعال إدارية تكتب (إعداد، حالة توثيق سائق، حظر مستخدم). كلها
--      `security definer` وكلها تكتب صفّ تدقيق: فعل إداري بلا أثر ليس فعلاً
--      إدارياً بل ثغرة مساءلة.
--
-- القاعدة 0.5 مطبَّقة حرفياً: كل ما فيه سباق أو حدّ محاولات هنا لا في TypeScript.
-- عدّ المحاولات مثلاً: لو فحصه التطبيق ثم كتبه، لمرّ ألف تخمين متوازٍ من نفس الفحص.
--
-- القاعدة 0.4 مطبَّقة: الجدولان يحملان city_id مرجعاً إلى cities، و RLS مفعّلة
-- على كليهما باسمهما صراحةً (لا حلقة عامة) كما يفرض scripts/check-migrations.ts.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) admin_login_codes — رمز الدخول لمرّة واحدة
-- ----------------------------------------------------------------------------
create table if not exists admin_login_codes (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities (id) on delete restrict,
  user_id      uuid not null references users (id) on delete cascade,
  -- بصمة الرمز لا الرمز: من قرأ الجدول لا يستطيع الدخول به
  code_hash    text not null,
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists admin_login_codes_user_idx
  on admin_login_codes (user_id, created_at desc);
-- الرمز الحيّ الوحيد لكل مسؤول: البحث عنه يجب أن يكون فورياً لا مسحاً كاملاً
create index if not exists admin_login_codes_live_idx
  on admin_login_codes (user_id, expires_at) where consumed_at is null;

alter table admin_login_codes enable row level security;
revoke all on table admin_login_codes from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2) admin_sessions — جلسة اللوحة
-- ----------------------------------------------------------------------------
create table if not exists admin_sessions (
  id           uuid primary key default gen_random_uuid(),
  city_id      uuid not null references cities (id) on delete restrict,
  user_id      uuid not null references users (id) on delete cascade,
  token_hash   text not null unique,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);

create index if not exists admin_sessions_user_idx
  on admin_sessions (user_id, created_at desc);
create index if not exists admin_sessions_live_idx
  on admin_sessions (expires_at) where revoked_at is null;

alter table admin_sessions enable row level security;
revoke all on table admin_sessions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3) issue_admin_login_code — إصدار رمز دخول
--
--    لا يكشف هذا الردّ وجود الحساب من عدمه للمتصل غير المخوَّل: الطبقة الأعلى
--    تُعيد نفس الرسالة في كل الحالات. لكن الردّ هنا مفصَّل لأن الطبقة الأعلى
--    تحتاج معرفة الوجهة (معرّف تلغرام) لترسل الرمز فعلاً.
--
--    الحدّ الزمني للإصدار في القاعدة: من يطلب رمزاً في حلقة لا يُغرق تلغرام
--    ولا يُغرق صندوق المسؤول، ولو كان الحدّ في الذاكرة لسقط مع كل إعادة تشغيل.
-- ----------------------------------------------------------------------------
create or replace function issue_admin_login_code(
  p_telegram_id   bigint,
  p_code_hash     text,
  p_ttl_seconds   integer,
  p_max_per_window integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   users%rowtype;
  v_recent integer;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.role <> 'admin' then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select count(*) into v_recent
  from admin_login_codes
  where user_id = v_user.id
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_recent >= p_max_per_window then
    return jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  end if;

  -- رمز جديد يُبطل ما قبله: وجود رمزين صالحين معاً يوسّع سطح التخمين بلا فائدة
  update admin_login_codes
     set consumed_at = now()
   where user_id = v_user.id and consumed_at is null;

  insert into admin_login_codes (city_id, user_id, code_hash, expires_at)
  values (v_user.city_id, v_user.id, p_code_hash,
          now() + make_interval(secs => p_ttl_seconds));

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.login_code_issued', 'user', v_user.id,
          jsonb_build_object('ttl_seconds', p_ttl_seconds));

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'city_id', v_user.city_id,
    'telegram_id', v_user.telegram_id::text,
    'language_code', v_user.language_code
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) consume_admin_login_code — استهلاك الرمز
--    `for update` على صفّ الرمز: محاولتان متزامنتان لا تُحتسبان واحدة، ولا
--    يُستهلك رمز واحد مرّتين.
-- ----------------------------------------------------------------------------
create or replace function consume_admin_login_code(
  p_telegram_id  bigint,
  p_code_hash    text,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_code admin_login_codes%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found or v_user.role <> 'admin' or v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  select * into v_code
  from admin_login_codes
  where user_id = v_user.id and consumed_at is null
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  if v_code.expires_at <= now() then
    update admin_login_codes set consumed_at = now() where id = v_code.id;
    return jsonb_build_object('ok', false, 'error', 'CODE_EXPIRED');
  end if;

  if v_code.attempts >= p_max_attempts then
    update admin_login_codes set consumed_at = now() where id = v_code.id;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  if v_code.code_hash <> p_code_hash then
    update admin_login_codes set attempts = attempts + 1 where id = v_code.id;
    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_user.city_id, v_user.id, 'admin.login_code_rejected', 'user', v_user.id,
            jsonb_build_object('attempt', v_code.attempts + 1));
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  update admin_login_codes set consumed_at = now() where id = v_code.id;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_user.id,
    'city_id', v_user.city_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) open_admin_session — فتح جلسة بعد رمز صحيح
-- ----------------------------------------------------------------------------
create or replace function open_admin_session(
  p_user_id      uuid,
  p_token_hash   text,
  p_ttl_seconds  integer,
  p_user_agent   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select * into v_user from users where id = p_user_id;
  if not found or v_user.role <> 'admin' or v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  insert into admin_sessions (city_id, user_id, token_hash, user_agent, expires_at)
  values (v_user.city_id, v_user.id, p_token_hash, p_user_agent,
          now() + make_interval(secs => p_ttl_seconds));

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.session_opened', 'user', v_user.id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'user_id', v_user.id, 'city_id', v_user.city_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) touch_admin_session — تحقّق الجلسة وتمديدها الانزلاقي في نداء واحد
--    التحقّق والتمديد معاً عمداً: نداءان يعنيان نافذة يُقبل فيها ما انتهى.
--    يُعيد صفة صاحبها الآن لا وقت فتحها: من نُزعت عنه صفة المسؤول أو حُظر
--    يسقط في الطلب التالي مباشرة بلا انتظار انتهاء الجلسة.
-- ----------------------------------------------------------------------------
create or replace function touch_admin_session(
  p_token_hash  text,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session admin_sessions%rowtype;
  v_user    users%rowtype;
begin
  select * into v_session from admin_sessions where token_hash = p_token_hash for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_SESSION');
  end if;
  if v_session.revoked_at is not null then
    return jsonb_build_object('ok', false, 'error', 'SESSION_REVOKED');
  end if;
  if v_session.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'SESSION_EXPIRED');
  end if;

  select * into v_user from users where id = v_session.user_id;
  if not found or v_user.role <> 'admin' or v_user.is_blocked then
    update admin_sessions set revoked_at = now() where id = v_session.id;
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  update admin_sessions
     set last_seen_at = now(),
         expires_at   = now() + make_interval(secs => p_ttl_seconds)
   where id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session.id,
    'user_id', v_user.id,
    'city_id', v_user.city_id,
    'telegram_id', v_user.telegram_id::text,
    'full_name', v_user.full_name,
    'language_code', v_user.language_code
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) close_admin_session — خروج صريح
-- ----------------------------------------------------------------------------
create or replace function close_admin_session(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session admin_sessions%rowtype;
begin
  select * into v_session from admin_sessions where token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('ok', true, 'closed', false);
  end if;

  update admin_sessions set revoked_at = now()
   where id = v_session.id and revoked_at is null;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_session.city_id, v_session.user_id, 'admin.session_closed', 'user',
          v_session.user_id, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'closed', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) admin_update_setting — تعديل قيمة تشغيلية بلا نشر كود
--    نوع القيمة يُفرض من value_type المسجَّل: من كتب نصّاً مكان رقم يُرفض هنا،
--    لا بعد ساعتين حين يقرأ محرّك المطابقة قيمة لا يفهمها فيتوقف عن العمل.
-- ----------------------------------------------------------------------------
create or replace function admin_update_setting(
  p_actor_user_id uuid,
  p_city_id       uuid,
  p_key           text,
  p_value         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   users%rowtype;
  v_setting platform_settings%rowtype;
  v_kind    text;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  select * into v_setting
  from platform_settings
  where city_id = p_city_id and key = p_key
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SETTING_NOT_FOUND');
  end if;

  v_kind := jsonb_typeof(p_value);
  if (v_setting.value_type = 'number'  and v_kind <> 'number')
  or (v_setting.value_type = 'string'  and v_kind <> 'string')
  or (v_setting.value_type = 'boolean' and v_kind <> 'boolean')
  or (v_setting.value_type = 'array'   and v_kind <> 'array') then
    return jsonb_build_object('ok', false, 'error', 'VALUE_TYPE_MISMATCH',
                              'expected', v_setting.value_type, 'received', v_kind);
  end if;

  if v_setting.value = p_value then
    return jsonb_build_object('ok', true, 'changed', false, 'value', v_setting.value);
  end if;

  update platform_settings
     set value = p_value,
         -- قيمة راجعها مسؤول ووافق عليها لم تعد مبدئية بانتظار مراجعة
         is_provisional = false
   where id = v_setting.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (p_city_id, v_actor.id, 'admin.setting_updated', 'platform_setting', v_setting.id,
          jsonb_build_object('key', p_key, 'from', v_setting.value, 'to', p_value));

  return jsonb_build_object('ok', true, 'changed', true, 'value', p_value);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) admin_set_driver_verification — تفعيل سائق أو تعليقه
-- ----------------------------------------------------------------------------
create or replace function admin_set_driver_verification(
  p_actor_user_id uuid,
  p_driver_id     uuid,
  p_status        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  users%rowtype;
  v_driver drivers%rowtype;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_status not in ('pending', 'verified', 'rejected', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  if v_driver.verification_status::text = p_status then
    return jsonb_build_object('ok', true, 'changed', false, 'status', p_status);
  end if;

  update drivers
     set verification_status = p_status::verification_status
   where id = v_driver.id;

  -- سائق لم يعد موثَّقاً لا يبقى «متاحاً» في جدول الإتاحة: بقاؤه متاحاً يعني
  -- أن محرّك المطابقة سيرشّحه بعد لحظة من تعليقه.
  if p_status <> 'verified' then
    update driver_availability
       set is_available = false, changed_at = now()
     where driver_id = v_driver.id and is_available = true;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_actor.id, 'admin.driver_verification_changed', 'driver',
          v_driver.id,
          jsonb_build_object('from', v_driver.verification_status, 'to', p_status));

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_status);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10) admin_set_user_blocked — حظر مستخدم أو رفع الحظر
--     مسؤول لا يحظر نفسه: النظام الذي يسمح بذلك يُنتج لوحة بلا صاحب.
-- ----------------------------------------------------------------------------
create or replace function admin_set_user_blocked(
  p_actor_user_id  uuid,
  p_target_user_id uuid,
  p_blocked        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  users%rowtype;
  v_target users%rowtype;
begin
  select * into v_actor from users where id = p_actor_user_id;
  if not found or v_actor.role <> 'admin' or v_actor.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_actor_user_id = p_target_user_id then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_BLOCK_SELF');
  end if;

  select * into v_target from users where id = p_target_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  if v_target.is_blocked = p_blocked then
    return jsonb_build_object('ok', true, 'changed', false, 'blocked', p_blocked);
  end if;

  update users set is_blocked = p_blocked where id = v_target.id;

  -- الحظر يُنهي جلسات اللوحة فوراً: من حُظر لا ينتظر انتهاء صلاحية جلسته
  if p_blocked then
    update admin_sessions set revoked_at = now()
     where user_id = v_target.id and revoked_at is null;

    update driver_availability da
       set is_available = false, changed_at = now()
      from drivers d
     where d.id = da.driver_id and d.user_id = v_target.id and da.is_available = true;
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_target.city_id, v_actor.id, 'admin.user_blocked_changed', 'user', v_target.id,
          jsonb_build_object('blocked', p_blocked));

  return jsonb_build_object('ok', true, 'changed', true, 'blocked', p_blocked);
end;
$$;

-- ----------------------------------------------------------------------------
-- 11) إعدادات اللوحة لكل مدينة — القاعدة 0.3: ما يقرأه العرض قيمةٌ لا رقم مكتوب
--     حجم خلية الخريطة الحرارية: 0.01 درجة ≈ كيلومتر واحد تقريباً عند خطّ عرض
--     مدننا الأربع. مبدئية بإذن المالك: تُضبط بعد رؤية أول خريطة حقيقية.
--     حدّ التقييم المنخفض: تقييم عنده أو دونه يُعرض محمَّراً ويُعدّ مؤشّر إنذار.
-- ----------------------------------------------------------------------------
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, s.key, s.value, s.value_type, s.description_ar, s.is_provisional
from cities c
cross join (values
  ('admin_heatmap_cell_degrees', '0.01'::jsonb, 'number',
   'ضلع خلية الخريطة الحرارية بالدرجات الجغرافية', true),
  ('admin_low_rating_threshold', '2'::jsonb, 'number',
   'التقييم الذي عنده أو دونه يُعدّ منخفضاً في لوحة الإدارة', true)
) as s(key, value, value_type, description_ar, is_provisional)
on conflict (city_id, key) do nothing;

-- ----------------------------------------------------------------------------
-- 12) الصلاحيات: دوالّ اللوحة تعمل بدور الخادم وحده
-- ----------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'issue_admin_login_code(bigint, text, integer, integer, integer)',
    'consume_admin_login_code(bigint, text, integer)',
    'open_admin_session(uuid, text, integer, text)',
    'touch_admin_session(text, integer)',
    'close_admin_session(text)',
    'admin_update_setting(uuid, uuid, text, jsonb)',
    'admin_set_driver_verification(uuid, uuid, text)',
    'admin_set_user_blocked(uuid, uuid, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
