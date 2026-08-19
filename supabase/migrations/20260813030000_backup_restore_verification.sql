-- =============================================================================
-- الغرض: تمييز النسخة المثبتة باستعادة فعلية عن المرفوعة فقط، وحفظ مرافق الأدوار
--   اللازم لاستعادة عنقود PostgreSQL دون وضع كلمات مرور في الأثر.
-- الحالة: منفّذ فعلياً — تديره مهمة verify-backup-restore.
-- ينتمي إلى: supabase/migrations
-- يُتوقع أن يستخدمه لاحقاً: لوحة الإدارة والتنبيه التشغيلي على النسخ غير المتحققة.
-- ملاحظات مستقبلية: الحالة تخص التفريغ كله؛ تتكرر في صفوف المدن لأن الجدول
--   يمثل شهادة شمول كل مدينة في التفريغ الواحد.
-- =============================================================================

alter table db_backups
  add column if not exists role_remote_file_id text,
  add column if not exists role_file_name text,
  add column if not exists role_bytes bigint,
  add column if not exists restore_verification_status text not null default 'unverified',
  add column if not exists restore_verified_at timestamptz,
  add column if not exists restore_verified_database text,
  add column if not exists restore_verification_detail jsonb;

alter table db_backups
  drop constraint if exists db_backups_restore_verification_status_check;

alter table db_backups
  add constraint db_backups_restore_verification_status_check
  check (restore_verification_status in ('unverified', 'verified', 'verification_failed'));

create index if not exists db_backups_restore_verification_idx
  on db_backups (restore_verification_status, created_at desc);

-- لا توصف النسخة لواجهة التشغيل بأنها آخر نسخة صالحة قبل أن تنجح استعادة مستقلة.
create or replace view v_latest_backup as
select remote_file_id, file_name, bytes, created_at
  from db_backups
 where status = 'success'
   and restore_verification_status = 'verified'
 order by created_at desc
 limit 1;
