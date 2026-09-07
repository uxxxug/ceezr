-- =============================================================================
-- الغرض: SCL-001 — تنظيفٌ دوريّ لسجلّ استلام تحديثات تيليجرام (عمرٌ محدود).
--   دالّةٌ تُحذف الصفوف المختومة القديمة والمهجورة، تُستدعى يدويّاً أو من مهمّةٍ
--   مجدولةٍ (F5-10 عند جاهزيّته). وثّق القرار في ADR 0055.
-- الحالة: منفّذ فعلياً — أُضيف في 2026-09-08 لإغلاق SCL-001.
-- ينتمي إلى: supabase/migrations
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ١) دالّة التنظيف
-- ---------------------------------------------------------------------------

create or replace function cleanup_telegram_update_receipts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_sealed integer;
  v_deleted_abandoned integer;
begin
  -- المختوم الأقدم من ٧ أيّام: لا قيمةَ له بعد.
  delete from telegram_update_receipts
   where status = 'done'
     and completed_at is not null
     and completed_at < now() - interval '7 days';

  get diagnostics v_deleted_sealed = row_count;

  -- المهجور (pending/failed) الأقدم من ٢٤ ساعة: إمّا فشل ولم يُستأنف، أو مات الحاجز.
  delete from telegram_update_receipts
   where status in ('pending', 'failed')
     and first_seen_at < now() - interval '24 hours';

  get diagnostics v_deleted_abandoned = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_sealed', v_deleted_sealed,
    'deleted_abandoned', v_deleted_abandoned
  );
end;
$$;

comment on function cleanup_telegram_update_receipts() is
  'تنظيفٌ دوريّ لسجلّ استلام تحديثات تيليجرام: يحذف المختوم الأقدم من ٧ أيّام والمهجور الأقدم من ٢٤ ساعة (ADR 0055).';

-- ---------------------------------------------------------------------------
-- ٢) الصلاحيات
-- ---------------------------------------------------------------------------

revoke all on function cleanup_telegram_update_receipts() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function cleanup_telegram_update_receipts() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function cleanup_telegram_update_receipts() from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function cleanup_telegram_update_receipts() to service_role';
  end if;
end;
$$;
