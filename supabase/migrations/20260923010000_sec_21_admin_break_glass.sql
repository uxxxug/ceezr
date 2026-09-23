-- migration-phase: expand
-- ------------------------------------------------------------------------------
-- SEC-21 — بابُ دخولٍ إداريٍّ لا يمرُّ بتيليجرام (break-glass)
--
-- الفجوةُ المُسمّاةُ: مصادقةُ لوحةِ الإدارةِ تعتمدُ تيليجرام وحدَه (رمزٌ
-- لمرّةٍ يصلُ على تيليجرام) — فسقوطُ تيليجرام يُسقِطُ بابَ الإدارةِ معَه،
-- ولا يدَ تُنقِذُ النظامَ وقتَ العطبِ.
--
-- والعلاجُ (ADR 0176): جدولُ `admin_break_glass_credentials` يربطُ الاعتمادَ
-- بـ`users.id` الداخليِّ — لا هويةً موازيةً بل عاملُ دخولٍ ثانٍ على هويةٍ
-- قائمةٍ. التسجيلُ لا يكونُ إلّا من داخلِ جلسةِ مسؤولٍ مُوثَّقةٍ بتيليجرام
-- (إثباتُ الهويّةِ الأولُ يبقى القناةَ الأولى)، والتحقّقُ التشفيريُّ (scrypt
-- + RFC 6238 TOTP) في TypeScript لا في SQL: فالقاعدةُ تملكُ الحالةَ
-- الذرّيّةَ (عدّاداتُ الإقفالِ · فتحُ الجلسةِ · التدقيقُ) والخادمُ يملكُ
-- التشفيرَ، والسرُّ لا يعبرُ إلى SQL أصلًا. وسرُّ TOTP لا يُخزَّنُ ناقلًا:
-- مُشفَّرٌ AES-256-GCM بمفتاحِ بيئةٍ مستقلٍّ (`ADMIN_BREAK_GLASS_TOTP_KEY`)
-- لا بفِلفِلِ التجزئةِ (`ADR 0113` — للتجزئةِ لا للتشفيرِ).
--
-- الرفضُ العامُّ الموحَّدُ: كلُّ محاولاتِ الدخولِ العامةِ تُجيبُ بخطإٍ واحدٍ
-- (`INVALID_CREDENTIALS`) فلا يُكشَفُ وجودُ الاسمِ ولا حالُ الاعتمادِ.
-- والإقفالُ في صفِّ الاعتمادِ نفسِهِ (كحدِّ الإصدارِ في `issue_admin_login_code`)
-- فلا تفتحُهُ إعادةُ التشغيلِ. والجلسةُ تُفتَحُ موسومةً بالأصلِ (`origin`)
-- توسيعًا بقيمةٍ افتراضيّةٍ للجلساتِ القائمةِ — إضافةٌ لا محوٌ.
--
-- رجوعٌ آمنٌ (rollback-safe): جدولٌ ودوالٌ جديدةٌ وعمودٌ بمُعطًى افتراضيٍّ.
-- ولا عمودَ يُحذَفُ ولا قيدَ يُشدَّدُ ولا دالّةَ قائمةً تُبدَّلُ. الحاكم:
-- `ADR 0176` · `ADR 0080` (سجلُّ أفعالِ التدقيقِ) · `ح-7` · `ح-8`.
-- ------------------------------------------------------------------------------

-- ── ١) جدولُ الاعتمادِ — اعتمادٌ واحدٌ لكلِّ مسؤولٍ، واسمُ دخولٍ فريدٌ ────────

create table if not exists admin_break_glass_credentials (
  id                    uuid primary key default gen_random_uuid(),
  city_id               uuid not null references cities (id) on delete restrict,

  -- الهويّةُ الداخليّةُ الوحيدةُ (ADR 0008 · DEC-07) — اعتمادٌ واحدٌ لكلِّ مسؤولٍ
  user_id               uuid not null unique references users (id) on delete cascade,

  -- اسمُ الدخولِ الذي يُطبَعُ على البابِ — فريدٌ في المنصّةِ كلِّها
  login_name            text not null unique,

  -- كلمةُ السرِّ scrypt مُرمَّزةً نصًّا واحدًا (N:r:p:ملح:هضم) — لا يُفكُّ في SQL
  password_hash         text not null,

  -- سرُّ TOTP مُشفَّرًا AES-256-GCM بمفتاحِ بيئةٍ (v1:iv:وسم:شيفرة) — ناقلًا لا يُقرأ
  totp_secret_encrypted text not null,

  -- آخرُ عدّادِ TOTP مُستهلَكٍ — رمزُ النافذةِ نفسِها لا يُقبَلُ مرّتَينِ
  last_totp_counter     bigint,

  -- عدّاداتُ الإقفالِ في القاعدةِ لا في الذاكرةِ: إعادةُ التشغيلِ لا تفتحُ ما أُقفل
  failed_attempts       integer not null default 0,
  locked_until          timestamptz,

  enrolled_at           timestamptz not null default now(),
  rotated_at            timestamptz,
  last_used_at          timestamptz,

  -- تعطيلٌ ذاتيٌّ صريحٌ — لا حذفَ: الأثرُ التدقيقيُّ يبقى والبابُ يُطفأ
  is_active            boolean not null default true
);

alter table admin_break_glass_credentials enable row level security;
revoke all on table admin_break_glass_credentials from anon, authenticated;

-- ── ٢) وسمُ جلساتِ الإدارةِ بالأصلِ — توسيعًا لا استبدالًا ──────────────────
-- الجلساتُ القائمةُ كلُّها من القناةِ الأولى بلا استثناءٍ، فالقيمةُ
-- الافتراضيّةُ هي الحقيقةُ الكاملةُ للصفوفِ الموجودةِ (`ح-8`: إضافةٌ لا محوٌ).

alter table admin_sessions
  add column if not exists origin text not null default 'telegram_code';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_sessions_origin_check'
  ) then
    alter table admin_sessions
      add constraint admin_sessions_origin_check
      check (origin in ('telegram_code', 'break_glass')) not valid;
  end if;
end
$$;

-- ── ٣) تحميلُ محاولةِ دخولٍ — قراءةٌ للتحقّقِ في الخادمِ لا كشفَ وجودٍ ──────
--    تُقرأُ بنصِّ الاسمِ وتُعيدُ ما يحتاجُهُ الخادمُ للتحقّقِ (الهضمَ والسرَّ
--    المُشفَّرَ والعدّاداتِ). نداؤها لا يُغيّرُ حالةً ولا يكتبُ أثرًا — فالإتمامُ
--    (نجاحًا أو فشلًا) في دالّتَي الإتمامِ الذرّيّتَينِ أدناه. ولأنَّ الاسمَ
--    غيرَ المعروفِ يُجيبُ بما يُجيبُ بهِ كلمةُ السرِّ الخاطئةُ، فالمتصلُ العامُّ
--    لا يفرّقُ بينَ الحالَينِ.

create or replace function admin_break_glass_load_attempt(p_login_name text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'user_id', c.user_id,
    'city_id', c.city_id,
    'password_hash', c.password_hash,
    'totp_secret_encrypted', c.totp_secret_encrypted,
    'last_totp_counter', c.last_totp_counter,
    'failed_attempts', c.failed_attempts,
    'locked_until', c.locked_until,
    'is_active', c.is_active
  )
  from admin_break_glass_credentials c
  where c.login_name = p_login_name
  union all
  select jsonb_build_object('ok', false, 'error', 'INVALID_CREDENTIALS')
  where not exists (
    select 1 from admin_break_glass_credentials c where c.login_name = p_login_name
  )
  limit 1;
$$;

revoke execute on function admin_break_glass_load_attempt(text) from public, anon, authenticated;

-- ── ٤) إتمامُ النجاحِ ذرّيًّا — عدّاداتٌ وجلسةٌ وتدقيقٌ في معاملةٍ واحدةٍ ────
--    الخادمُ تحقّقَ من كلمةِ السرِّ ورمزِ TOTP بنفسِهِ؛ هذه الدالّةُ تُقفِلُ
--    الصفَّ فتتأكَّدُ أنَّ الاعتمادَ ما زالَ فعّالًا غيرَ مقفلٍ وأنَّ العدّادَ
--    لم يستهلكِ الرمزَ، ثمَّ تُحدِّثُ وتفتحُ الجلسةَ وتُدقِّقُ — أو تُعيدُ
--    الرفضَ العامَّ. وصاحبُ الاعتمادِ يُعادُ فحصُهُ لحظةَ الفتحِ لا لحظةَ
--    التسجيلِ: من زالَت عنهُ صفةُ المسؤولِ أو حُظرَ لا يفتحُ بابًا قديمًا.

create or replace function admin_break_glass_finish_success(
  p_login_name    text,
  p_totp_counter  bigint,
  p_token_hash    text,
  p_ttl_seconds   integer,
  p_user_agent    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credential_user_id uuid;
  v_user               users%rowtype;
begin
  update admin_break_glass_credentials c
     set last_totp_counter = p_totp_counter,
         last_used_at = now(),
         failed_attempts = 0,
         locked_until = null
   where c.login_name = p_login_name
     and c.is_active
     and (c.locked_until is null or c.locked_until < now())
     and (c.last_totp_counter is null or c.last_totp_counter < p_totp_counter)
  returning c.user_id into v_credential_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CREDENTIALS');
  end if;

  select * into v_user from users where id = v_credential_user_id;
  if not found or v_user.role <> 'admin' or v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CREDENTIALS');
  end if;

  insert into admin_sessions (city_id, user_id, token_hash, user_agent, expires_at, origin)
  values (v_user.city_id, v_user.id, p_token_hash, p_user_agent,
          now() + make_interval(secs => p_ttl_seconds), 'break_glass');

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.break_glass_session_opened', 'user', v_user.id,
          jsonb_build_object('origin', 'break_glass'));

  return jsonb_build_object('ok', true, 'user_id', v_user.id, 'city_id', v_user.city_id);
end;
$$;

revoke execute on function admin_break_glass_finish_success(text, bigint, text, integer, text) from public, anon, authenticated;

-- ── ٥) إتمامُ الفشلِ ذرّيًّا — عدّادٌ وإقفالٌ وتدقيقٌ بلا أسرارٍ ─────────────
--    التحقّقُ التشفيريُّ في الخادمِ رفضَ قبلَ أن يصلَ إلى القاعدةِ شيءٌ من
--    القيمِ الحسّاسةِ (لا كلمةَ سرٍّ ولا رمزًا ولا سرًّا يمرّ هنا أصلًا).
--    والإقفالُ هنا لا في الذاكرةِ: حدُّ المحاولاتِ ونافذتُهُ يمرّانِ من
--    الخادمِ (قيمٌ أمنيّةٌ تقنيّةٌ لا تجاريّةٌ كسابقتِها في شيفرةِ الرموزِ).
--    وأثرُ الرفضِ في التدقيقِ يخلو من القيمِ الحسّاسةِ بالبناءِ.

create or replace function admin_break_glass_finish_failure(
  p_login_name       text,
  p_lockout_max      integer,
  p_lockout_seconds  integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_now_locked boolean;
begin
  -- العدُّ لاعتمادٍ فعّالٍ لصاحبٍ ما زالَ مسؤولًا غيرَ محظورٍ فحسبُ: اعتمادُ
  -- مُنحلِّ الصلاحيةِ ميتٌ لا يُعدُّ لهِ فشلٌ (هو مرفوضٌ رفضًا جذريًّا في
  -- إتمامِ النجاحِ)، فلا يُغرقُ التدقيقَ بأثرٍ لاعبثَ فيهِ.
  update admin_break_glass_credentials c
     set failed_attempts = c.failed_attempts + 1,
         locked_until = case
           when c.failed_attempts + 1 >= p_lockout_max
             then now() + make_interval(secs => p_lockout_seconds)
           else c.locked_until
         end
   where c.login_name = p_login_name
     and exists (
       select 1 from users u
        where u.id = c.user_id
          and u.role = 'admin'
          and u.is_blocked = false
     )
  returning c.user_id, (c.locked_until is not null and c.locked_until >= now()) into v_user.id, v_now_locked;

  if not found then
    -- اسمٌ غيرُ معروفٍ: لا صفَّ لهُ هنا ولا مُنتَحَلَ مستخدمٍ في التدقيقِ —
    -- عدُّهُ وتقييدُهُ على البوّابةِ (حدُّ المعدّلِ) لا بانتحالِ هويةٍ.
    return jsonb_build_object('ok', false, 'error', 'INVALID_CREDENTIALS');
  end if;

  select * into v_user from users where id = v_user.id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.break_glass_login_rejected', 'user', v_user.id,
          jsonb_build_object('origin', 'break_glass', 'now_locked', v_now_locked));

  return jsonb_build_object('ok', true, 'now_locked', v_now_locked);
end;
$$;

revoke execute on function admin_break_glass_finish_failure(text, integer, integer) from public, anon, authenticated;

-- ── ٦) التسجيلُ والتدويرُ — من داخلِ جلسةِ مسؤولٍ قائمةٍ فحسبُ ───────────────
--    إثباتُ الهويّةِ الأولُ يبقى تيليجرام (ADR 0176 §٢): لا يُنشأُ اعتمادٌ
--    إلّا لمسؤولٍ فتحَ جلستَهُ برمزِ القناةِ الأولى. والتدويرُ هو النداءُ
--    نفسُهُ على اعتمادٍ قائمٍ — يستبدلُ السرَّينِ معًا (لا نصفَ تبديلٍ) ويُدقَّقُ
--    أثرُهُ باسمٍ يفرّقُ الإنشاءَ من التدويرِ.

create or replace function admin_break_glass_enroll(
  p_session_token_hash    text,
  p_login_name            text,
  p_password_hash         text,
  p_totp_secret_encrypted text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_existing_login text;
  v_was_rotation boolean := false;
begin
  -- الجلسةُ الحيّةُ للمسؤولِ هي وحدها بابُ التسجيلِ: باطلاً ذاكَ إثباتُ
  -- الهويّةِ، وبطلانُهُ هنا يُدقَّقُ ولا يُسكَتُ عنهُ.
  select u.* into v_user
    from admin_sessions s
    join users u on u.id = s.user_id
   where s.token_hash = p_session_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     -- إثباتُ الهويّةِ الأولُ (ADR 0176 §٢): التسجيلُ لا يُقبَلُ إلّا من جلسةٍ
     -- فتحَها رمزُ القناةِ الأولى — فجلسةُ البابِ الموازي لا تُنشئُ بابًا موازيًا.
     and s.origin = 'telegram_code'
   order by s.created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  end if;
  if v_user.role <> 'admin' or v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  if p_login_name is null or length(btrim(p_login_name)) < 3
     or p_login_name <> btrim(p_login_name)
     or p_login_name !~ '^[a-z0-9_-]+$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LOGIN_NAME');
  end if;
  if p_password_hash is null or p_totp_secret_encrypted is null then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_CREDENTIAL');
  end if;

  -- اسمُ الدخولِ محجوزٌ لمسؤولٍ آخر؟ الرفضُ صريحٌ ههنا لأنَّ المتصلَ مسؤولٌ
  -- مُوثَّقٌ في جلستِهِ — لا كتمانَ ولا كشفًا: هو يرى اسمَهُ ويرى الرفضَ.
  select c.login_name into v_existing_login
    from admin_break_glass_credentials c
   where c.login_name = p_login_name and c.user_id <> v_user.id;
  if found then
    return jsonb_build_object('ok', false, 'error', 'LOGIN_NAME_TAKEN');
  end if;

  -- التدويرُ يُعلَمُ قبلَ الكتابةِ لا يُستنتَجُ بعدها: الجملةُ القادمةُ تُنشئُ أو
  -- تُحدِّثُ، وذاكَ سؤالٌ يُجابُ عنهُ قبلَها في متغيّرٍ واحدٍ صريحٍ.
  if exists (select 1 from admin_break_glass_credentials e where e.user_id = v_user.id) then
    v_was_rotation := true;
  end if;

  insert into admin_break_glass_credentials
    (city_id, user_id, login_name, password_hash, totp_secret_encrypted,
     last_totp_counter, failed_attempts, locked_until, enrolled_at, rotated_at, is_active)
  values
    (v_user.city_id, v_user.id, p_login_name, p_password_hash, p_totp_secret_encrypted,
     null, 0, null, now(), null, true)
  on conflict (user_id) do update
    set login_name = excluded.login_name,
        password_hash = excluded.password_hash,
        totp_secret_encrypted = excluded.totp_secret_encrypted,
        last_totp_counter = null,
        failed_attempts = 0,
        locked_until = null,
        rotated_at = now(),
        is_active = true;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.break_glass_enrolled', 'user', v_user.id,
          jsonb_build_object('login_name', p_login_name, 'rotated', v_was_rotation));

  return jsonb_build_object('ok', true, 'user_id', v_user.id);
end;
$$;

revoke execute on function admin_break_glass_enroll(text, text, text, text) from public, anon, authenticated;

-- ── ٧) التعطيلُ الذاتيُّ — لا حذفَ: البابُ يُطفأ والأثرُ يبقى ────────────────

create or replace function admin_break_glass_disable(p_session_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  select u.* into v_user
    from admin_sessions s
    join users u on u.id = s.user_id
   where s.token_hash = p_session_token_hash
     and s.revoked_at is null
     and s.expires_at > now()
     -- إثباتُ الهويّةِ الأولُ (ADR 0176 §٢): التسجيلُ لا يُقبَلُ إلّا من جلسةٍ
     -- فتحَها رمزُ القناةِ الأولى — فجلسةُ البابِ الموازي لا تُنشئُ بابًا موازيًا.
     and s.origin = 'telegram_code'
   order by s.created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND');
  end if;
  if v_user.role <> 'admin' or v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'NOT_ADMIN');
  end if;

  update admin_break_glass_credentials c
     set is_active = false
   where c.user_id = v_user.id and c.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NO_CREDENTIAL');
  end if;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'admin.break_glass_disabled', 'user', v_user.id,
          jsonb_build_object('origin', 'telegram_code'));

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function admin_break_glass_disable(text) from public, anon, authenticated;
