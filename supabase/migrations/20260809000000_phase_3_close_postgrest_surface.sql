-- المرحلة ٣ — إغلاق سطح PostgREST العام
--
-- السبب:
-- كُتبت كل الهجرات السابقة على افتراض نموذج اتصال واحد: التطبيق يتصل مباشرةً
-- بـ Postgres عبر `databaseUrl`. وهذا صحيح — لا يوجد في المستودع أي استخدام
-- لـ `@supabase/supabase-js` ولا لـ `createClient` ولا لأي مسار `/rest/v1`.
--
-- لكن Supabase تُشغّل PostgREST تلقائياً فوق مخطط `public` وتمنح الدورين
-- `anon` و`authenticated` صلاحية تنفيذ كل دالة فيه. ونتيجة ذلك أن الدوال
-- الـ ٢٦ المعرّفة بـ `security definer` صارت جميعها قابلة للنداء من الإنترنت
-- بمجرد امتلاك مفتاح anon (وهو مفتاح تُعامله Supabase على أنه علني).
--
-- أخطرها `grant_bootstrap_admin(p_telegram_id)`: لا تتحقق من هوية المنادي
-- إطلاقاً، وترفع أي مستخدم قائم إلى `admin` مباشرةً. أي أنها كانت مسار
-- تصعيد صلاحيات كامل لا يحتاج إلا معرفة telegram_id واحد.
--
-- العلاج: سحب صلاحية استعمال مخطط `public` من `anon` و`authenticated` كلياً.
-- الدوران غير مستخدَمين في هذا المشروع بتاتاً، فالأثر الوظيفي معدوم،
-- ويسقط بذلك سطح الهجوم كاملاً بدل ترقيع كل دالة على حدة.
--
-- ما لا تفعله هذه الهجرة: لا تلمس `service_role` ولا `postgres` ولا دور
-- التطبيق — اتصال `databaseUrl` يبقى كما هو تماماً.

-- ١) سحب الصلاحيات القائمة على الكائنات الموجودة.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;

-- ٢) منع توريث الصلاحيات لأي كائن يُنشأ لاحقاً، وإلا عادت المشكلة مع أول
--    هجرة قادمة تُنشئ جدولاً أو دالة جديدة.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- ٣) القفل الجامع: بلا `usage` على المخطط لا يصل الدوران إلى أي كائن فيه،
--    بما في ذلك `spatial_ref_sys` المملوك لامتداد postgis والذي لا يمكن
--    تفعيل RLS عليه من دور غير خارق.
revoke usage on schema public from anon, authenticated;

-- ٤) طريقة العرض `agent_effectiveness` كانت `security definer` ضمناً، فتُقرأ
--    بصلاحيات منشئها. تحويلها إلى `security invoker` يجعلها تحترم صلاحيات
--    القارئ وسياسات RLS، وهو السلوك الصحيح لطريقة عرض قياس.
alter view agent_effectiveness set (security_invoker = true);

-- ٥) تثبيت search_path على المُشغّل المشترك حتى لا يُخطف عبر مخطط مؤقت.
alter function set_updated_at() set search_path = public;
