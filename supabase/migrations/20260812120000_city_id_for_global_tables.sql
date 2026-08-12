-- =============================================================================
-- الغرض: إنفاذ القاعدة 0.4 (city_id في كل جدول) على الجدولين الوحيدين اللذين كانا
--   يحملان «استثناءً موثَّقاً»: db_backups و webhook_events. القاعدة مطلقة، والاستثناء
--   الموثَّق استثناءٌ لا مبرّرٌ له، وقد كان يُبقي حرس CI (scripts/check-migrations.ts)
--   أحمر — أي أن الحرس كان يقول الحقيقة والوثيقة كانت تُسكته بتعليق.
--
--   لماذا هجرتان لا واحدة: الهجرتان الأصليتان (20260811140000 و20260811150000) عُدِّلتا
--   ليحمل الجدولان city_id **من أول هجرة** كما تنصّ القاعدة، فأي قاعدة تُبنى من الصفر
--   (وهذا ما يفعله CI) تصل إلى المخطّط الصحيح مباشرة. لكن قاعدةً مطبَّقة فعلاً لن تُعيد
--   تنفيذ هجرةٍ مضت، فهذه الهجرة التقدّمية تُوصلها إلى المخطّط نفسه. المسارَان يتقاربان،
--   وهذه الهجرة عاجزة عن الضرر على قاعدة جديدة: كل خطوة فيها مشروطة بغياب أثرها.
--
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
--
-- ## القواعد المحرِّمة المطبَّقة هنا:
--   - لا حذف: لا drop table ولا drop column ولا drop function. الدالة ثلاثيّة الوسائط
--     تبقى موجودة باسمها، لكنّها تُصرّح بأنّها موقوفة بدل أن تُدخل صفّاً بلا مدينة.
--   - لا قيمة مُلفّقة: ما لا يمكن ردّه إلى مدينة حقيقية يُوقف الهجرة بخطأ صريح،
--     ولا يُملأ بمدينةٍ افتراضيّة تُخفي فقدان البيانات.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) db_backups — صفٌّ لكل مدينة يشهد أن ملف النسخة يضمّ بياناتها
-- ----------------------------------------------------------------------------
alter table db_backups add column if not exists city_id uuid;
alter table db_backups add column if not exists backup_run_id uuid;

do $$
declare
  v_orphans bigint;
  v_cities bigint;
begin
  -- معرّف التفريغ للصفوف القديمة: معرّف الصفّ نفسه — قيمة حقيقية موجودة، لا مولَّدة
  -- عشوائياً، وتُبقي كل صفٍّ قديم تفريغاً مستقلاً كما كان فعلاً.
  update db_backups set backup_run_id = id where backup_run_id is null;

  select count(*) into v_orphans from db_backups where city_id is null;
  if v_orphans > 0 then
    select count(*) into v_cities from cities;
    -- لا مدن ولا سبيل لقيمة صادقة: أوقف الهجرة بدل اختراع مدينة.
    if v_cities = 0 then
      raise exception
        'db_backups فيه % صفّاً ولا مدينة واحدة في cities: لا قيمة city_id صادقة. عالج البيانات أولاً.',
        v_orphans;
    end if;

    -- الصفّ القديم يُسند إلى أوّل مدينة، ثم تُستكمل بقيّة المدن صفوفاً — والمجموع
    -- يقول الحقيقة كاملة: هذا الملف يضمّ بيانات كل مدينة كانت موجودة.
    update db_backups
       set city_id = (select id from cities order by created_at, id limit 1)
     where city_id is null;

    insert into db_backups (city_id, backup_run_id, remote_file_id, file_name, bytes, status, created_at)
    select c.id, b.backup_run_id, b.remote_file_id, b.file_name, b.bytes, b.status, b.created_at
      from db_backups b
     cross join cities c
     where not exists (
       select 1 from db_backups x
        where x.backup_run_id = b.backup_run_id and x.city_id = c.id
     );
  end if;
end;
$$;

alter table db_backups alter column city_id set not null;
alter table db_backups alter column backup_run_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'db_backups_city_id_fkey' and conrelid = 'db_backups'::regclass
  ) then
    alter table db_backups
      add constraint db_backups_city_id_fkey foreign key (city_id) references cities(id);
  end if;
end;
$$;

create index if not exists db_backups_city_created_at_idx on db_backups (city_id, created_at desc);
create unique index if not exists db_backups_run_city_uniq on db_backups (backup_run_id, city_id);

-- ----------------------------------------------------------------------------
-- 2) webhook_events — المدينة من معاملة الدفع التي يخصّها الحدث
-- ----------------------------------------------------------------------------
alter table webhook_events add column if not exists city_id uuid;
alter table webhook_events add column if not exists transaction_id uuid;

do $$
declare
  v_unresolved bigint;
begin
  -- الصفوف القديمة لم تحفظ معرّف المعاملة عموداً، لكنّه موجود فعلاً في نصّ الحمولة
  -- المخزَّنة — فهذا استخراج من بيانات محفوظة لا تخمين. الحمولة غير الصالحة كـjson
  -- لا تُسقط الهجرة هنا: تُترك بلا قيمة ليكشفها الفحص بعد قليل باسمها لا بخطأ نوعٍ غامض.
  update webhook_events e
     set transaction_id = t.id,
         city_id = t.city_id
    from payment_transactions t
   where e.transaction_id is null
     and jsonb_typeof(
           case when e.payload ~ '^\s*\{' then e.payload::jsonb else null end
         ) = 'object'
     and (e.payload::jsonb ->> 'transactionId')::uuid = t.id;

  select count(*) into v_unresolved from webhook_events where city_id is null;
  if v_unresolved > 0 then
    -- حدثٌ محفوظ لا يمكن ردّه إلى معاملة قائمة: لا مدينة صادقة له. أوقف الهجرة
    -- ليقرّر المالك، ولا تُملأ الفجوة بقيمة تُخفيها.
    raise exception
      'webhook_events فيه % صفّاً لا يمكن ردّه إلى معاملة دفع قائمة: لا قيمة city_id صادقة له. راجع الصفوف قبل الترقية.',
      v_unresolved;
  end if;
end;
$$;

alter table webhook_events alter column city_id set not null;
alter table webhook_events alter column transaction_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'webhook_events_city_id_fkey' and conrelid = 'webhook_events'::regclass
  ) then
    alter table webhook_events
      add constraint webhook_events_city_id_fkey foreign key (city_id) references cities(id);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'webhook_events_transaction_id_fkey' and conrelid = 'webhook_events'::regclass
  ) then
    alter table webhook_events
      add constraint webhook_events_transaction_id_fkey
      foreign key (transaction_id) references payment_transactions(id);
  end if;
end;
$$;

create index if not exists webhook_events_city_idx on webhook_events (city_id);
create index if not exists webhook_events_transaction_idx on webhook_events (transaction_id);

-- ----------------------------------------------------------------------------
-- 3) record_webhook_event — النسخة الرباعية هي المعتمدة
-- ----------------------------------------------------------------------------
create or replace function record_webhook_event(
  p_event_id text,
  p_provider text,
  p_payload text,
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city_id uuid;
begin
  select city_id into v_city_id
    from payment_transactions
   where id = p_transaction_id;

  if v_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'TRANSACTION_NOT_FOUND');
  end if;

  insert into webhook_events (city_id, transaction_id, event_id, provider, payload)
  values (v_city_id, p_transaction_id, p_event_id, p_provider, p_payload)
  on conflict (provider, event_id) do nothing;
  return jsonb_build_object('ok', true, 'is_new', found);
end;
$$;

-- النسخة ثلاثيّة الوسائط موجودة في كل قاعدة مطبَّقة قبل هذه الهجرة، ولا تُحذف (لا drop).
-- لكن جسمها لم يعد قادراً على الوفاء: إدخالٌ بلا city_id مرفوض بـnot null. فبدل أن تفشل
-- بخطأ قيدٍ غامض، تُصرّح بسبب توقّفها وبالبديل. ولا تُنشَأ إن لم تكن موجودة: قاعدةٌ
-- تُبنى من الصفر لا تستحقّ سطحاً ميّتاً تولَد به — وهذا ما يحدث في CI.
do $$
begin
  -- المطابقة على التوقيع نفسه (regprocedure) لا على
  -- pg_get_function_identity_arguments: تلك تُعيد أسماء الوسائط مع أنواعها
  -- ('p_event_id text, …') فمقارنتها بـ'text, text, text' تفشل صامتةً وتترك الدالة
  -- القديمة عاملة — وهذا ما حدث فعلاً وكشفه تشغيلٌ على قاعدة حقيقية لا قراءة ملف.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.oid::regprocedure::text = 'record_webhook_event(text,text,text)'
  ) then
    execute $fn$
      create or replace function record_webhook_event(
        p_event_id text,
        p_provider text,
        p_payload text
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        raise exception
          'record_webhook_event(text,text,text) موقوفة: webhook_events تتطلّب city_id مقروءة من المعاملة. استخدم record_webhook_event(text,text,text,uuid).';
      end;
      $body$;
    $fn$;
  end if;
end;
$$;

-- منح التنفيذ للنسخة الرباعية على نفس نمط أخواتها في سطح definer المُقفل.
revoke all on function record_webhook_event(text, text, text, uuid) from public;
grant execute on function record_webhook_event(text, text, text, uuid) to service_role;
