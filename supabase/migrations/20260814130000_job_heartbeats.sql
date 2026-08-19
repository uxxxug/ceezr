-- =============================================================================
-- الغرض: نبضةُ كلّ مهمّة دورية في القاعدة، ليصير تدهورُ العامل مرئياً في `/ready`
--   باسم المهمّة بالضبط لا مستوراً خلف بوابةٍ تقول «Healthy».
-- الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.3 من أمر الإطلاق التجاري).
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: apps/workers/src/runner.ts (الكتابة)،
--   apps/gateway/src/job-health.ts (فحص الجهوزية)، ولوحة الإدارة إن أرادت عرض النبضات.
--
-- ## العلّة
--
-- العاملُ المضمَّن (`RUN_WORKER_IN_GATEWAY=true`) يعيش في عملية البوابة نفسها،
-- ويُشغّل المهامّ الحرجة: إنهاء العروض، إعادة التوزيع، إشعارات الاشتراك، النسخ
-- الاحتياطي. وإقلاعُه **لا يُسقط البوابة عند فشله** — وهذا قرارٌ صحيح (بوابةٌ بلا
-- مهامّ أفضل من انعدام البوتَين)، لكنّ ثمنَه أنّ `/ready` كان يقول `ready` وسجلُّ
-- الإقلاع وحده يعرف أنّ المهامّ ميّتة. تدهورٌ صامت: العروضُ لا تنتهي، والاشتراكاتُ
-- لا تُجدَّد، والنسخُ الاحتياطي لا يُؤخذ — ولا مؤشّر واحد يُرى من الخارج.
--
-- ## القرار
--
-- النبضةُ في القاعدة لا في الذاكرة: العاملُ قد يعيش في عمليةٍ أخرى (خدمة
-- `waslah-worker` المستقلّة)، فذاكرةُ البوابة لا تعرف عنه شيئاً. والقاعدةُ هي
-- الموضعُ الوحيد الذي يراه الطرفان.
--
-- وكتابةٌ واحدة (upsert) بعد كلّ شوطٍ كلفتُها إهمالية: أكثفُ مهمّة تواتراً
-- (`redispatch-searching` كلّ ٢٠ ثانية) تكتب ثلاث مرّات في الدقيقة للمدينة.
--
-- ولماذا صفٌّ واحد لكلّ مهمّة لا سجلٌّ تاريخي؟ لأنّ السؤال الذي يُجيب عنه `/ready`
-- هو «هل نبضت الآن» لا «كيف نبضت أمس». والتاريخُ يحتاج تقليماً دورياً، ومهمّةُ
-- تقليمٍ جديدة تحتاج نبضةً هي أيضاً — دورةٌ لا تنتهي. المقاييسُ التاريخية موضعُها
-- `/metrics` وسجلّات Render، لا هذا الجدول.
--
-- ### `city_id` غيرُ قابلٍ للعدم — والمهامّ العامّة تنبض لكلّ مدينة
--
-- القاعدة 0.4 لا تحتمل استثناءً، و`scripts/check-migrations.ts` يفرضها حرفياً:
-- `city_id uuid not null` بمفتاحٍ أجنبي إلى `cities`. والمهامّ العامّة (انتهاءُ
-- الاشتراكات، النسخُ الاحتياطي) لا مدينةَ لها في تنفيذها، لكنّها **تخدم كلَّ مدينة
-- مفعَّلة**: نسخةٌ احتياطية واحدة تحمي بيانات المدن جميعاً. فنبضتُها تُسجَّل صفّاً
-- لكلّ مدينة مفعَّلة بالوقت نفسه — لا حيلةً لإرضاء الفحص، بل لأنّ السؤالَ الذي
-- يُسأل فعلاً في التشغيل هو «مدينة جدة: هل كلُّ ما يخدمها حيّ؟»، وهذا الشكلُ يجيبه
-- مباشرةً. وخمسُ مدنٍ تعني خمسةَ صفوفٍ في اليوم للنسخ الاحتياطي — كلفةٌ لا تُذكر.
--
-- والبديلُ المرفوض: عمودٌ قابلٌ للعدم يفتح ثقباً في قاعدةٍ لا استثناء لها، أو مدينةٌ
-- وهميّة «عامّة» في `cities` — وهي بيانٌ كاذب في جدولٍ يُقرأ في كلّ مكان.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) الجدول
-- ---------------------------------------------------------------------------

create table if not exists job_heartbeats (
  -- الاسمُ الكامل كما يسجّله المشغّل: `expire-offers:<uuid>` للمدنية،
  -- `expire-subscriptions` للعامّة. يُحفظ كما هو ليُقرأ في `/ready` بلا ترجمة.
  job_name    text not null,
  city_id     uuid not null references cities(id) on delete cascade,
  last_run_at timestamptz not null,
  last_status text not null,
  detail      text,
  updated_at  timestamptz not null default now(),
  primary key (job_name, city_id),
  constraint job_heartbeats_status_known check (last_status in ('ok', 'failed', 'skipped')),
  constraint job_heartbeats_name_not_blank check (btrim(job_name) <> '')
);

-- فحصُ الجهوزية يقرأ الجدول كلّه (عشراتُ صفوف لا آلاف)، فلا فهرسَ إضافيّ يُبرَّر
-- سوى فهرس المدينة الذي تحتاجه لوحةُ الإدارة يوم تعرض نبضات مدينةٍ بعينها.
create index if not exists job_heartbeats_city_idx on job_heartbeats (city_id);

comment on table job_heartbeats is
  'نبضةُ آخر شوطٍ لكلّ مهمّة دورية لكلّ مدينة تخدمها — مصدرُ الحقيقة الذي يقرأه /ready (§4.3).';

-- ---------------------------------------------------------------------------
-- ٢) الكتابة — دالّة ذرّية واحدة
-- ---------------------------------------------------------------------------
--
-- لماذا دالّة لا `insert … on conflict` من التطبيق؟ لسببين:
--
-- ١) الوقتُ الذي يُسجَّل يجب أن يكون وقتَ القاعدة لا وقتَ العملية: ساعةُ حاويةٍ
--    منزلقة كانت ستُظهر مهمّةً عاملةً بائتةً أو بائتةً عاملة — أي فحصاً كاذباً في
--    الاتجاهين، وهو أسوأ من انعدام الفحص.
-- ٢) المهمّةُ العامّة تُترجَم إلى صفٍّ لكلّ مدينة مفعَّلة، وقائمةُ المدن في القاعدة:
--    كتابتُها من التطبيق كانت ستحتاج استعلاماً ثانياً ونافذةً بينهما تُفعَّل فيها
--    مدينةٌ فتفوتها النبضة.

create or replace function record_job_heartbeat(
  p_job_name text,
  p_city_id uuid default null,
  p_status text default 'ok',
  p_detail text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now    timestamptz := now();
  v_detail text := nullif(btrim(coalesce(p_detail, '')), '');
  v_name   text := btrim(coalesce(p_job_name, ''));
  v_rows   integer;
begin
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'JOB_NAME_REQUIRED');
  end if;

  if p_status is null or p_status not in ('ok', 'failed', 'skipped') then
    return jsonb_build_object('ok', false, 'error', 'STATUS_UNKNOWN');
  end if;

  if p_city_id is null then
    -- مهمّةٌ عامّة: تخدم كلَّ مدينة مفعَّلة، فتنبض لكلّ واحدةٍ منها بالوقت نفسه.
    insert into job_heartbeats (job_name, city_id, last_run_at, last_status, detail, updated_at)
    select v_name, c.id, v_now, p_status, v_detail, v_now
    from cities c
    where c.is_active = true
    on conflict (job_name, city_id) do update
      set last_run_at = excluded.last_run_at,
          last_status = excluded.last_status,
          detail      = excluded.detail,
          updated_at  = excluded.updated_at;
  else
    if not exists (select 1 from cities where id = p_city_id) then
      -- مدينةٌ محذوفة لا تُفشل شوطاً ناجحاً: النبضةُ رصدٌ لا محاسبة، ورفضُها بخطأ
      -- مفتاحٍ أجنبي كان سيُلوّن المهمّة فاشلةً وهي عاملة.
      return jsonb_build_object('ok', false, 'error', 'CITY_NOT_FOUND');
    end if;

    insert into job_heartbeats (job_name, city_id, last_run_at, last_status, detail, updated_at)
    values (v_name, p_city_id, v_now, p_status, v_detail, v_now)
    on conflict (job_name, city_id) do update
      set last_run_at = excluded.last_run_at,
          last_status = excluded.last_status,
          detail      = excluded.detail,
          updated_at  = excluded.updated_at;
  end if;

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'job_name', v_name, 'rows', v_rows, 'last_run_at', v_now);
end;
$$;

comment on function record_job_heartbeat(text, uuid, text, text) is
  'يُثبّت نبضةَ مهمّة بوقت القاعدة لا بوقت العملية؛ والمهمّةُ العامّة تنبض لكلّ مدينة مفعَّلة (§4.3).';

-- ---------------------------------------------------------------------------
-- ٣) الصلاحيات — النمط القائم: لا شيء للعموم
-- ---------------------------------------------------------------------------

revoke all on table job_heartbeats from public;
revoke all on function record_job_heartbeat(text, uuid, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table job_heartbeats from anon';
    execute 'revoke all on function record_job_heartbeat(text, uuid, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table job_heartbeats from authenticated';
    execute 'revoke all on function record_job_heartbeat(text, uuid, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update on table job_heartbeats to service_role';
    execute 'grant execute on function record_job_heartbeat(text, uuid, text, text) to service_role';
  end if;
end;
$$;

-- RLS مفعّلة بلا سياسةٍ عن قصد: الوصولُ عبر الاتصال المباشر للخدمة (ADR 0006)،
-- ولا واجهةَ عامّة تقرأ هذا الجدول. `/ready` يقرؤه من اتصال الخدمة نفسه.
alter table job_heartbeats enable row level security;
