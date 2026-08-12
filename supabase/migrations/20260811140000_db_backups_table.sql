-- =============================================================================
-- الغرض: جدول تاريخ النسخ الاحتياطي — البند 7.
--   ليست كل نسخة احتياطية مرفوعة إلى Google Drive مسجّلة هنا: فقط الناجحة منها،
--   لترى لوحة الإدارة آخر نسخة وحجمها بلا فحص يدويّ. والفشل يظهره سجلّ المهمّة
--   لا هذا الجدول — لأنّ نسخةً فاشلة ليست «نسخة احتياطية» بل غيابٌ لواحدة.
--
--   city_id (القاعدة 0.4): لا استثناء. النسخة الاحتياطية تفريغٌ للعنقود كله، وهذا يعني
--   بالضبط أنّها تحتوي بيانات كلّ مدينة موجودة وقت أخذها — فالصادق أن يُسجَّل صفٌّ
--   لكل مدينة يشهد أن ملف النسخة هذا يضمّ بياناتها، لا صفٌّ واحد بمدينةٍ مُختلقة
--   ولا استثناءٌ يُثقب به قاعدة معماريّة. `backup_run_id` يجمع صفوف التفريغ الواحد،
--   فيبقى «آخر نسخة» سؤالاً قابلاً للإجابة، ويصبح عزل RLS بالمدينة ذا معنى: مسؤول
--   مدينةٍ يرى أنّ بيانات مدينته مشمولة بنسخة، ولا يرى أكثر.
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- =============================================================================

create table if not exists db_backups (
  id              uuid primary key default gen_random_uuid(),
  city_id         uuid not null references cities(id),
  -- معرّف عمليّة التفريغ الواحدة: صفوف مدنٍ مختلفة بنفس هذا المعرّف = ملفٌ واحد.
  backup_run_id   uuid not null,
  remote_file_id  text not null,
  file_name       text not null,
  bytes           bigint not null,
  status          text not null default 'success',
  created_at      timestamptz not null default now()
);

create index if not exists db_backups_created_at_idx on db_backups (created_at desc);
create index if not exists db_backups_city_created_at_idx on db_backups (city_id, created_at desc);
-- مدينةٌ واحدة لا تُسجَّل مرّتين في تفريغٍ واحد.
create unique index if not exists db_backups_run_city_uniq on db_backups (backup_run_id, city_id);

-- عرض مناسب للاستعلام من لوحة الإدارة: آخر نسخة ناجحة.
-- دلالته لم تتغيّر بإضافة city_id: صفوف التفريغ الواحد تتشارك الملف والحجم
-- والوقت، فأيٌّ منها يمثّل الملف تمثيلاً صحيحاً، وlimit 1 تعيد سطراً واحداً كما كان.
-- من أراد الشمول بالمدينة يستعلم الجدول مباشرة بـcity_id.
create or replace view v_latest_backup as
select remote_file_id, file_name, bytes, created_at
  from db_backups
 where status = 'success'
 order by created_at desc
 limit 1;
