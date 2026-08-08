-- المرحلة ٣ — تصحيح إغلاق سطح PostgREST
--
-- ⚠️ تصحيح للهجرة 20260809000000: كانت غير كافية ولم تُغلق شيئاً فعلياً.
--
-- سبب الفشل: افترضت تلك الهجرة أن الصلاحيات ممنوحة للدورين `anon` و
-- `authenticated` مباشرةً، فسحبتها منهما. لكن فحص قوائم ACL بعد التطبيق
-- أظهر أن المنح ليس لهما أصلاً بل للدور الزائف `PUBLIC`:
--
--   nspacl  = {pg_database_owner=UC/…, =U/pg_database_owner, postgres=U/…, service_role=U/…}
--   proacl  = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--
-- المدخل `=U` و`=X` (بلا اسم دور قبل علامة المساواة) يعني PUBLIC. وسحب
-- صلاحية من دور لا يملكها باسمه لا يؤثر في وراثته لها عبر PUBLIC، فبقيت
-- الدوال الـ٢٦ مكشوفة كما كانت. التحقق بعد التطبيق هو ما كشف ذلك:
-- has_function_privilege('anon', …, 'execute') ظلّت 26.
--
-- العلاج الصحيح: السحب من PUBLIC. وهو آمن هنا تحديداً لأن `postgres` و
-- `service_role` يملكان منحاً صريحاً باسميهما في القوائم أعلاه، فلا يتأثران.
-- واتصال التطبيق عبر `databaseUrl` يستعمل دور `postgres`.

-- ١) الدوال: إسقاط حق التنفيذ العام. هذا هو المدخل الذي جعل
--    grant_bootstrap_admin قابلة للنداء من الإنترنت.
revoke execute on all functions in schema public from public;
revoke execute on all routines in schema public from public;

-- ٢) الجداول والتسلسلات.
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;

-- ٣) القفل الجامع: بلا usage على المخطط لا يُحلّ اسم أي كائن داخله،
--    بما فيه spatial_ref_sys المملوك لامتداد postgis.
revoke usage on schema public from public;

-- ٤) منع عودة المشكلة مع أي كائن يُنشأ لاحقاً.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- ٥) تثبيت صريح لما يحتاجه التشغيل، حتى لا يعتمد على وراثة ضمنية.
grant usage on schema public to postgres, service_role;
grant all on all tables in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant execute on all functions in schema public to postgres, service_role;
