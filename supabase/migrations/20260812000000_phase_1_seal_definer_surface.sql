-- =============================================================================
-- المرحلة ١ — إحكام سطح الدوال والجداول الذي انفتح بعد هجرة ٢٠٢٦٠٨٠٩.
--
-- ما اكتشفه التدقيق على قاعدة حقيقية (لا على قراءة ملفات):
--
-- (١) هجرة `20260809000000_phase_3_close_postgrest_surface` أغلقت السطح على
--     الكائنات الموجودة يومها، واعتمدت على `alter default privileges ...
--     revoke all on functions from anon, authenticated` كي لا يعود الانفتاح
--     مع أي دالة جديدة. وهذا الاعتماد خاطئ تقنياً: `alter default privileges`
--     لا يلغي إلا منحاً موجَّهاً لدورٍ باسمه، بينما صلاحية تنفيذ الدوال تأتي
--     في PostgreSQL من منحة ضمنية لـ `PUBLIC` يصدرها المحرك نفسه لا الهجرة.
--     فكل دالة أُنشئت بعد ذلك التاريخ وُلدت مفتوحة لـ PUBLIC، و`anon` عضو في
--     PUBLIC. الدوال الخمس المتأثرة (proacl = NULL، أي الافتراضي المفتوح):
--       create_payment, confirm_payment, record_webhook_event,
--       update_driver_city, update_rider_city
--     أُنشئت في هجرتَي `payment_core` و`city_change_rpc` بتاريخ ٢٠٢٦٠٨١١.
--     برهان قبل الإصلاح:
--       has_function_privilege('anon', oid, 'EXECUTE') = true  للخمس جميعاً.
--
-- (٢) هجرة `20260811160000_payment_rls_policies` تبدأ بتعليق يقول إن الجداول
--     «لها RLS مُفعَّل لكن بلا سياسات». هذه المقدّمة غير صحيحة: الجداول الأربعة
--     payment_transactions, ledger_entries, webhook_events, db_backups لم
--     يُفعَّل عليها RLS قط. والسياسة على جدول بلا RLS سياسةٌ خاملة لا أثر لها.
--     برهان قبل الإصلاح: pg_class.relrowsecurity = false للأربعة، مع وجود
--     سياستين لكل جدول. أي أن الملف موجود والحماية غير موجودة.
--
-- هل كان الثقب مُستغَلاً اليوم؟ لا. البند (٣) من هجرة ٢٠٢٦٠٨٠٩ سحب
-- `usage on schema public` من `anon` و`authenticated`، وبلا USAGE لا يُبلَغ أي
-- كائن داخل المخطط. برهان: has_schema_privilege('anon','public','USAGE') = false.
-- لكن هذا يعني أن الحماية كلها صارت معلّقة على طبقة واحدة: أي منحة USAGE
-- لاحقة — من هجرة، أو من قالب Supabase، أو من لوحة التحكم — تفتح فوراً
-- «تأكيد دفعة» و«نقل سائق بين المدن» لأي حامل لمفتاح anon العلني.
-- الغرض من هذه الهجرة إعادة الطبقة الثانية والثالثة إلى مكانهما.
--
-- ما لا تفعله هذه الهجرة: لا تلمس دوال الامتدادات (postgis وغيره). سحب
-- التنفيذ من PUBLIC على دوال postgis يكسر التطبيق، لذلك يستثنيها المرشِّح
-- عبر pg_depend deptype='e' بدل `all functions in schema public`.
--
-- الحالة: منفّذ فعلياً.
-- ينتمي إلى: supabase/migrations
-- يحرسه: tests/integration/database-privilege-surface.test.ts
-- =============================================================================

-- ١) تفعيل RLS على الجداول الأربعة كي تصير سياساتها القائمة نافذة لا خاملة.
--    `enable row level security` عملية idempotent، وتكرارها بلا أثر.
alter table payment_transactions enable row level security;
alter table ledger_entries       enable row level security;
alter table webhook_events       enable row level security;
alter table db_backups           enable row level security;

-- ٢) سحب التنفيذ من PUBLIC عن كل دالة من دوالّنا في public، وإعادة منحه
--    لـ service_role وحده — وهو نفس الوضع الذي تركته هجرة ٢٠٢٦٠٨٠٩ على
--    الدوال الأربع والأربعين السابقة. الاستثناء: دوال الامتدادات.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid
          and d.classid = 'pg_proc'::regclass
          and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public', fn.sig);
    execute format('revoke all on function %s from anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end
$$;

-- ٣) إعادة تثبيت القفل الجامع (البند ٣ من هجرة ٢٠٢٦٠٨٠٩) صراحةً، حتى تبقى
--    هذه الهجرة كافية بذاتها إذا أُعيد بناء القاعدة من الصفر أو أُعيد منح
--    USAGE سهواً بين الهجرتين.
revoke usage on schema public from anon, authenticated;
