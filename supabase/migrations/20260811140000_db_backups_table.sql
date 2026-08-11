-- =============================================================================
-- الغرض: جدول تاريخ النسخ الاحتياطي — البند 7.
--   ليست كل نسخة احتياطية مرفوعة إلى Google Drive مسجّلة هنا: فقط الناجحة منها،
--   لترى لوحة الإدارة آخر نسخة وحجمها بلا فحص يدويّ. والفشل يظهره سجلّ المهمّة
--   لا هذا الجدول — لأنّ نسخةً فاشلة ليست «نسخة احتياطية» بل غيابٌ لواحدة.
--
--   جدول عام (global) — لا city_id: النسخة الاحتياطية للقاعدة كلها لا لمدينة.
--   استثناء موثَّق من قاعدة city_id في كل جدول.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- =============================================================================

create table if not exists db_backups (
  id              uuid primary key default gen_random_uuid(),
  remote_file_id  text not null,
  file_name       text not null,
  bytes           bigint not null,
  status          text not null default 'success',
  created_at      timestamptz not null default now()
);

create index if not exists db_backups_created_at_idx on db_backups (created_at desc);

-- عرض مناسب للاستعلام من لوحة الإدارة: آخر نسخة + مجموع الحجم.
create or replace view v_latest_backup as
select remote_file_id, file_name, bytes, created_at
  from db_backups
 where status = 'success'
 order by created_at desc
 limit 1;
