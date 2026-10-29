-- migration-phase: switch
-- =============================================================================
-- الغرض: نبضةُ المهمّةِ العامّةِ لا تضيعُ حينَ لا مدينةَ مفعَّلة.
-- الحالة: منفّذ فعلياً — 2026-10-29.
-- ينتمي إلى: supabase/migrations
-- يُستخدم في: apps/workers/src/runner.ts (الكتابة)، apps/gateway/src/job-health.ts (`/ready`).
--
-- ## العلّة (مقيسةٌ على نشرِ CasaOS بتاريخ 2026-10-29)
--
-- `record_job_heartbeat(p_city_id => null)` يكتبُ صفًّا لكلِّ مدينةٍ `is_active = true`.
-- وقبلَ الإطلاقِ المدنُ الخمسُ كلُّها `is_active = false`، فيعملُ
-- `expire-subscriptions` كلَّ 15 دقيقةً بنجاحٍ (`job.ran … expired=0` في السجلّ) ولا
-- يُكتبُ صفٌّ واحدٌ في `job_heartbeats`. وبعدَ نافذةِ الإمهالِ (3 دقائق) يُعلنُ `/ready`
-- `not_ready` بـ«لا نبضة لها: expire-subscriptions» — إنذارٌ كاذبٌ دائمٌ: العاملُ يعمل.
--
-- ## الإصلاح
--
-- المهمّةُ العامّةُ تنبضُ لكلِّ مدينةٍ مفعَّلةٍ كما كانت حرفًا. فإن **لم توجد مدينةٌ
-- مفعَّلةٌ قطّ** نبضت لكلِّ مدينةٍ معرَّفةٍ: الشاهدُ يبقى «العاملُ شغّلَ المهمّةَ»،
-- والقيدُ `city_id not null` والمفتاحُ الأجنبيُّ لا يتغيّران. ولا يُسترُ عطلٌ بذلك:
-- عاملٌ لا يعملُ لا يكتبُ صفًّا في الحالَين، فيبقى `missing` بعدَ الإمهالِ.
-- وحينَ تُفعَّلُ مدينةٌ يعودُ السلوكُ القديمُ، والقارئُ يأخذُ أحدثَ نبضةٍ لكلِّ اسمٍ
-- (`evaluateJobHealth`) فلا يُقرأُ صفُّ مدينةٍ غيرِ مفعَّلةٍ قديمٌ بياتًا.
--
-- التراجعُ: إعادةُ تعريفِ الدالّةِ بنصِّ `20260814130000` — بلا فقدِ بيانات.
-- =============================================================================

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
  v_any_active boolean;
begin
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'JOB_NAME_REQUIRED');
  end if;

  if p_status is null or p_status not in ('ok', 'failed', 'skipped') then
    return jsonb_build_object('ok', false, 'error', 'STATUS_UNKNOWN');
  end if;

  if p_city_id is null then
    -- مهمّةٌ عامّة: تنبض لكلّ مدينة مفعَّلة؛ وبلا مدينةٍ مفعَّلةٍ لكلّ مدينةٍ معرَّفة.
    select exists (select 1 from cities where is_active = true) into v_any_active;
    insert into job_heartbeats (job_name, city_id, last_run_at, last_status, detail, updated_at)
    select v_name, c.id, v_now, p_status, v_detail, v_now
    from cities c
    where c.is_active = true or not v_any_active
    on conflict (job_name, city_id) do update
      set last_run_at = excluded.last_run_at,
          last_status = excluded.last_status,
          detail      = excluded.detail,
          updated_at  = excluded.updated_at;
  else
    if not exists (select 1 from cities where id = p_city_id) then
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
  'يُثبّت نبضةَ مهمّة بوقت القاعدة؛ والمهمّةُ العامّة تنبض لكلّ مدينة مفعَّلة، وبلا مدينةٍ مفعَّلةٍ لكلّ مدينةٍ معرَّفة (§4.3).';

revoke all on function record_job_heartbeat(text, uuid, text, text) from public;
