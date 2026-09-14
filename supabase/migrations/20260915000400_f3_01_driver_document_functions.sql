-- migration-phase: expand
-- =============================================================================
-- `F3-01` · `SD-01` + `SD-02` — دوالُّ وثائقِ السائقِ: خانةُ رفعٍ، وتسجيلٌ،
--   وإرسالٌ للمراجعةِ، ولوحُ حالاتٍ، **وأسبابُ حجبٍ تُحسَبُ ولا تُخزَّنُ**.
--
-- الحالة: منفَّذٌ فعليّاً — البند `F3-01` (ومعَه `F12-14` إنفاذاً).
-- ينتمي إلى: supabase/migrations
-- يحرسُه: tests/integration/driver-documents.test.ts
-- الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
--
-- ## القاعدةُ تحكمُ لا الشِفرةُ
--
-- «هل هذا السائقُ محجوبٌ؟» سؤالٌ يُسألُ في البوّابةِ وفي الموزِّعِ وفي اللوحةِ
-- وفي البوتِ. وجوابٌ مكتوبٌ في أربعةِ أمكنةٍ **أربعُ حقائقَ تختلفُ يومَ تُعدَّلُ
-- واحدةٌ منها**. فالجوابُ دالّةٌ واحدةٌ في القاعدةِ يقرؤها الجميعُ.
--
-- ## والمِلفُّ لا يمرُّ عبرَ الـAPI
--
-- `POST /v1/driver/documents/upload-url` **يُعطي خانةً** لا يستقبلُ بايتاً:
-- مسارَ كائنٍ وحدّاً للحجمِ وعمراً قصيراً للرابطِ. ورفعُ خمسةِ ميغابايتٍ عبرَ
-- البوّابةِ يشغلُ ذاكرتَها ويجعلُ كلَّ سائقٍ يرفعُ رخصتَه ضغطاً على مسارٍ
-- مسؤوليّتُه المطابقةُ لا النقلُ. **والقاعدةُ تُحدِّدُ المسارَ** فلا يختارُه
-- العميلُ: مسارٌ يختارُه العميلُ كتابةٌ فوقَ وثيقةِ غيرِه.
--
-- ## وما لا تفعلُه هذه الدوالُّ عن قصدٍ — (`ح-5`)
--
--   ــ **لا تُوقِّعُ رابطاً**: التوقيعُ فعلُ مخزنِ الكائناتِ بمفتاحِه،
--      والقاعدةُ لا تحملُ مفتاحَ مزوِّدٍ (`ADR 0115` §٤).
--   ــ **لا تقبلُ وثيقةً ولا ترفضُها**: القبولُ فعلُ إنسانٍ في اللوحةِ.
--   ــ **لا تُرسِلُ تنبيهاً**: المُنبِّهُ قبلَ الانتهاءِ **دَينٌ مُعلَنٌ**
--      يقرأُ `driver_documents_expiry_idx` — والبندُ يبقى ناقصاً لأجلِه.
-- =============================================================================

-- ── ١) الأنواعُ الإلزاميّةُ — من الإعداداتِ لا من الشِفرةِ ───────────────────
-- وإذا غابَ الإعدادُ **لا تُفتَحُ البوّابةُ**: الافتراضُ هو **كلُّ** قيمةٍ في
-- النوعِ المعدودِ، لا مصفوفةٌ فارغةٌ. مصفوفةٌ فارغةٌ تعني «لا وثيقةَ إلزاميّةً»
-- فتُحوِّلُ إعداداً ناقصاً إلى **إذنِ عملٍ بلا رخصةٍ**.
create or replace function driver_required_document_types(p_city_id uuid)
returns driver_document_type[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_value jsonb;
  v_types driver_document_type[];
begin
  select value into v_value
    from platform_settings
   where city_id = p_city_id
     and key = 'driver_required_document_types';

  if v_value is null or jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) = 0 then
    select array_agg(e.enumlabel::text::driver_document_type order by e.enumsortorder)
      into v_types
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'driver_document_type';
    return v_types;
  end if;

  -- قيمةٌ لا تُطابِقُ النوعَ المعدودَ **تُسقِطُ الإعدادَ كلَّه إلى الافتراضِ**
  -- ولا تُتجاهَلُ بصمتٍ: «رخصةٌ» مكتوبةً خطأً تعني وثيقةً إلزاميّةً سقطَت.
  begin
    select array_agg((x)::driver_document_type)
      into v_types
      from jsonb_array_elements_text(v_value) as x;
  exception when invalid_text_representation then
    select array_agg(e.enumlabel::text::driver_document_type order by e.enumsortorder)
      into v_types
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'driver_document_type';
  end;

  return v_types;
end;
$$;

comment on function driver_required_document_types(uuid) is
  'أنواعُ الوثائقِ الإلزاميّةُ لمدينةٍ من `platform_settings`، والافتراضُ عندَ غيابِ الإعدادِ **كلُّ** الأنواعِ لا لا شيءَ (F3-01).';

-- ── ٢) أسبابُ الحجبِ — تُحسَبُ من الساعةِ ولا تُخزَّنُ (`F12-14`) ────────────
-- كلُّ سببٍ نصٌّ `CODE:doc_type` كي تقرأَه الشاشةُ سطراً بعينِه لا رسالةً عامّةً.
create or replace function driver_document_block_reasons(
  p_driver_id uuid,
  p_today date default current_date
) returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(reason order by reason), array[]::text[])
    from (
      select case
               when d.id is null                     then 'MISSING:' || t.doc_type::text
               when d.status = 'rejected'            then 'REJECTED:' || t.doc_type::text
               when d.status <> 'accepted'           then 'UNVERIFIED:' || t.doc_type::text
               when d.expires_at < p_today           then 'EXPIRED:' || t.doc_type::text
             end as reason
        from drivers dr
        cross join unnest(driver_required_document_types(dr.city_id)) as t(doc_type)
        left join driver_documents d
               on d.driver_id = dr.id
              and d.doc_type = t.doc_type
       where dr.id = p_driver_id
    ) as computed
   where reason is not null;
$$;

comment on function driver_document_block_reasons(uuid, date) is
  'أسبابُ حجبِ السائقِ لوثائقِه، محسوبةً من الحالةِ وتاريخِ الانتهاءِ لا من رايةٍ يقلبُها أحدٌ (F12-14 · ADR 0115).';

-- ── ٣) خانةُ الرفعِ — مسارٌ تُحدِّدُه القاعدةُ وحدٌّ للحجمِ وعمرٌ قصيرٌ ──────
create or replace function driver_document_upload_slot(
  p_telegram_id  bigint,
  p_doc_type     driver_document_type,
  p_content_type text,
  p_size_bytes   bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_allowed jsonb;
  v_max bigint;
  v_ttl integer;
  v_ext text;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select value into v_allowed
    from platform_settings
   where city_id = v_user.city_id and key = 'driver_document_allowed_content_types';
  if v_allowed is null or jsonb_typeof(v_allowed) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'UPLOAD_POLICY_MISSING',
                              'setting', 'driver_document_allowed_content_types');
  end if;
  if not (v_allowed ? coalesce(btrim(lower(p_content_type)), '')) then
    return jsonb_build_object('ok', false, 'error', 'CONTENT_TYPE_NOT_ALLOWED',
                              'allowed', v_allowed);
  end if;

  v_max := get_setting_number(v_user.city_id, 'driver_document_max_bytes')::bigint;
  if v_max is null then
    return jsonb_build_object('ok', false, 'error', 'UPLOAD_POLICY_MISSING',
                              'setting', 'driver_document_max_bytes');
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    return jsonb_build_object('ok', false, 'error', 'SIZE_NOT_POSITIVE');
  end if;
  if p_size_bytes > v_max then
    return jsonb_build_object('ok', false, 'error', 'FILE_TOO_LARGE', 'max_bytes', v_max);
  end if;

  v_ttl := coalesce(
    get_setting_number(v_user.city_id, 'driver_document_upload_url_ttl_seconds')::integer, 900);

  v_ext := case btrim(lower(p_content_type))
             when 'image/jpeg' then 'jpg'
             when 'image/png' then 'png'
             when 'application/pdf' then 'pdf'
             else 'bin'
           end;

  -- **المسارُ من القاعدةِ**: بادئةٌ بمعرّفِ السائقِ ونوعِ الوثيقةِ، وقُرعةٌ
  -- تمنعُ التخمينَ وتمنعَ الكتابةَ فوقَ رفعٍ سابقٍ لم يُسجَّلْ بعدُ.
  return jsonb_build_object(
    'ok', true,
    'driver_id', v_driver_id,
    'doc_type', p_doc_type,
    'object_path', 'drivers/' || v_driver_id::text || '/' || p_doc_type::text || '/'
                   || gen_random_uuid()::text || '.' || v_ext,
    'content_type', btrim(lower(p_content_type)),
    'max_bytes', v_max,
    'ttl_seconds', v_ttl
  );
end;
$$;

comment on function driver_document_upload_slot(bigint, driver_document_type, text, bigint) is
  'خانةُ رفعِ وثيقةٍ: مسارُ الكائنِ **تُحدِّدُه القاعدةُ** وحدُّ الحجمِ ونوعُ المحتوى من الإعداداتِ. ولا توقيعَ ههنا — التوقيعُ للمخزنِ (F3-01).';

-- ── ٤) تسجيلُ وثيقةٍ — بعدَ الرفعِ لا قبلَه ─────────────────────────────────
create or replace function record_driver_document(
  p_telegram_id bigint,
  p_doc_type    driver_document_type,
  p_object_path text,
  p_expires_at  date
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_prefix text;
  v_id uuid;
  v_previous driver_documents%rowtype;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- **المسارُ يُطابَقُ بالبادئةِ**: بدونِ هذا يُسجِّلُ سائقٌ مسارَ وثيقةِ
  -- سائقٍ آخرَ فيُنسَبُ إليه قبولٌ ليسَ له. وهذا فحصُ ملكيّةٍ لا فحصُ صياغةٍ.
  v_prefix := 'drivers/' || v_driver_id::text || '/' || p_doc_type::text || '/';
  if p_object_path is null or left(p_object_path, length(v_prefix)) <> v_prefix
     or length(p_object_path) <= length(v_prefix) then
    return jsonb_build_object('ok', false, 'error', 'OBJECT_PATH_NOT_MINE',
                              'expected_prefix', v_prefix);
  end if;

  if p_expires_at is null then
    return jsonb_build_object('ok', false, 'error', 'EXPIRY_REQUIRED');
  end if;
  if p_expires_at <= current_date then
    return jsonb_build_object('ok', false, 'error', 'EXPIRY_IN_PAST');
  end if;
  -- عشرونَ سنةً حدٌّ للعبثِ لا لسياسةٍ: وثيقةٌ تنتهي سنةَ ٢١٠٠ خطأُ إدخالٍ
  -- يُبطِلُ الحجبَ عمليّاً.
  if p_expires_at > current_date + 7300 then
    return jsonb_build_object('ok', false, 'error', 'EXPIRY_TOO_FAR');
  end if;

  select * into v_previous
    from driver_documents
   where driver_id = v_driver_id and doc_type = p_doc_type;

  insert into driver_documents
    (city_id, driver_id, doc_type, status, object_path, expires_at,
     review_note, reviewed_at, submitted_at)
  values
    (v_user.city_id, v_driver_id, p_doc_type, 'received', p_object_path, p_expires_at,
     null, null, null)
  on conflict (driver_id, doc_type) do update
    set city_id      = excluded.city_id,
        status       = 'received',
        object_path  = excluded.object_path,
        expires_at   = excluded.expires_at,
        review_note  = null,
        reviewed_at  = null,
        submitted_at = null,
        updated_at   = now()
  returning id into v_id;

  -- **الإحلالُ يُكتَبُ أثراً**: الصفُّ واحدٌ للنوعِ، والتاريخُ يبقى في السجلِّ
  -- فلا يُمحى دليلٌ لأنَّ وثيقةً استُبدِلَت (`ح-8`).
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'driver.document_recorded', 'driver_document', v_id,
          jsonb_build_object(
            'doc_type', p_doc_type,
            'expires_at', p_expires_at,
            'replaced_status', v_previous.status,
            'replaced_object_path', v_previous.object_path));

  return jsonb_build_object(
    'ok', true,
    'document_id', v_id,
    'doc_type', p_doc_type,
    'status', 'received',
    'expires_at', p_expires_at,
    'replaced', v_previous.id is not null
  );
end;
$$;

comment on function record_driver_document(bigint, driver_document_type, text, date) is
  'تسجيلُ وثيقةٍ مرفوعةٍ بنوعِها وتاريخِ انتهائِها، والمسارُ يُطابَقُ ببادئةِ السائقِ فلا يُسجَّلُ مسارُ غيرِه (F3-01).';

-- ── ٥) «إرسالٌ للمراجعةِ» — الفعلُ الأساسيُّ في `SD-01` ─────────────────────
create or replace function submit_driver_documents_for_review(p_telegram_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver_id uuid;
  v_missing text[];
  v_moved integer;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;
  if v_user.is_blocked then
    return jsonb_build_object('ok', false, 'error', 'USER_BLOCKED');
  end if;

  select id into v_driver_id from drivers where user_id = v_user.id;
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  -- **الناقصُ يُسمَّى**: `SD-02` ينصُّ «ناقص (بتحديد الناقص)»، ورسالةٌ تقولُ
  -- «أكمِلْ وثائقَكَ» بلا تسميةٍ تجعلُ السائقَ يُخمِّنُ.
  select coalesce(array_agg(t.doc_type::text order by t.doc_type::text), array[]::text[])
    into v_missing
    from unnest(driver_required_document_types(v_user.city_id)) as t(doc_type)
   where not exists (
     select 1 from driver_documents d
      where d.driver_id = v_driver_id and d.doc_type = t.doc_type
   );

  if array_length(v_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'error', 'DOCUMENTS_INCOMPLETE',
                              'missing', to_jsonb(v_missing));
  end if;

  -- المقبولُ لا يُعادُ إلى المراجعةِ: إعادتُه تُبطِلُ قبولاً قائماً وتحجبُ
  -- سائقاً يعملُ بوثائقَ صحيحةٍ.
  update driver_documents
     set status = 'under_review',
         submitted_at = now(),
         updated_at = now()
   where driver_id = v_driver_id
     and status in ('received', 'incomplete', 'rejected');
  get diagnostics v_moved = row_count;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'driver.documents_submitted', 'driver', v_driver_id,
          jsonb_build_object('moved', v_moved));

  return jsonb_build_object(
    'ok', true,
    'submitted', v_moved,
    'block_reasons', to_jsonb(driver_document_block_reasons(v_driver_id))
  );
end;
$$;

comment on function submit_driver_documents_for_review(bigint) is
  'إرسالُ وثائقِ السائقِ للمراجعةِ، ويردُّ `DOCUMENTS_INCOMPLETE` **بتسميةِ الناقصِ** لا برسالةٍ عامّةٍ (SD-01 · SD-02).';

-- ── ٦) لوحُ الحالاتِ — `SD-02` كما يُعرَضُ على السائقِ ──────────────────────
create or replace function driver_document_dashboard(p_telegram_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_warning integer;
  v_rows jsonb;
  v_reasons text[];
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  v_warning := coalesce(
    get_setting_number(v_driver.city_id, 'driver_document_expiry_warning_days')::integer, 30);

  select coalesce(jsonb_agg(row order by ord), '[]'::jsonb)
    into v_rows
    from (
      select t.ord,
             jsonb_build_object(
               'doc_type', t.doc_type,
               'submitted', d.id is not null,
               -- الغيابُ **ليسَ حالةً مكتوبةً**: `status` يبقى `null` ولا
               -- يُختَرَعُ له `'not_submitted'` فيصيرَ قيمةً سادسةً في نوعٍ
               -- معدودٍ لا تعرفُها القاعدةُ.
               'status', d.status,
               'expires_at', d.expires_at,
               'days_left', case when d.expires_at is null then null
                                 else (d.expires_at - current_date) end,
               'expires_soon', case
                 when d.expires_at is null or d.status <> 'accepted' then false
                 else d.expires_at - current_date between 0 and v_warning end,
               'review_note', d.review_note,
               'submitted_at', d.submitted_at,
               'reviewed_at', d.reviewed_at
             ) as row
        from (
          select doc_type, row_number() over () as ord
            from unnest(driver_required_document_types(v_driver.city_id)) as u(doc_type)
        ) as t
        left join driver_documents d
               on d.driver_id = v_driver.id and d.doc_type = t.doc_type
    ) as built;

  v_reasons := driver_document_block_reasons(v_driver.id);

  return jsonb_build_object(
    'ok', true,
    'verification_status', v_driver.verification_status,
    'warning_days', v_warning,
    'documents', v_rows,
    'block_reasons', to_jsonb(v_reasons),
    -- **الحجبُ جوابٌ واحدٌ**: البوّابةُ لا تُعيدُ حسابَه من الصفوفِ.
    'is_blocked', array_length(v_reasons, 1) is not null
  );
end;
$$;

comment on function driver_document_dashboard(bigint) is
  'لوحُ وثائقِ السائقِ: صفٌّ لكلِّ نوعٍ إلزاميٍّ بحالتِه وتاريخِه وأيّامِه الباقيةِ، ومعَه أسبابُ الحجبِ محسوبةً (SD-02 · F12-14).';

-- ── ٧) الصلاحيّاتُ — لا شيءَ لـ`anon` ولا لـ`authenticated` ─────────────────
revoke all on function driver_required_document_types(uuid) from public, anon, authenticated;
revoke all on function driver_document_block_reasons(uuid, date) from public, anon, authenticated;
revoke all on function driver_document_upload_slot(bigint, driver_document_type, text, bigint)
  from public, anon, authenticated;
revoke all on function record_driver_document(bigint, driver_document_type, text, date)
  from public, anon, authenticated;
revoke all on function submit_driver_documents_for_review(bigint) from public, anon, authenticated;
revoke all on function driver_document_dashboard(bigint) from public, anon, authenticated;

grant execute on function driver_required_document_types(uuid) to service_role;
grant execute on function driver_document_block_reasons(uuid, date) to service_role;
grant execute on function driver_document_upload_slot(bigint, driver_document_type, text, bigint)
  to service_role;
grant execute on function record_driver_document(bigint, driver_document_type, text, date)
  to service_role;
grant execute on function submit_driver_documents_for_review(bigint) to service_role;
grant execute on function driver_document_dashboard(bigint) to service_role;
