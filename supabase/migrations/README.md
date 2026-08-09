# المخططات (Migrations)

**الحالة: منفَّذة فعلياً — ١٣ هجرة مطبَّقة على الإنتاج.**

> هذا الملف كان متروكاً من قالب الأمر الأول ويقول «هيكل فقط، لا يُكتب أي
> `CREATE TABLE` فعلي» رغم وجود هجرات حقيقية بجانبه. صُحِّح في 2026-08-09.

الهجرات تُطبَّق **بترتيب أسمائها الأبجدي** (البادئة طابع زمني `YYYYMMDDHHMMSS`).
ولا تُطبَّق تلقائياً في البناء عن قصد: الهجرة قرارٌ لا أثرٌ جانبي للنشر. راجع
`docs/render-deployment-vars.md` §4 لأمر التطبيق الجاهز.

## الهجرات الحالية

| # | الملف | ما تفعله |
| - | ----- | -------- |
| 1 | `20260806120000_phase_2_1_core_schema` | الجداول الأساسية: `cities`, `users`, `drivers`, `orders`, `offers`, `platform_settings`, `audit_log` |
| 2 | `20260806120100_phase_2_1_atomic_rpcs` | دوال RPC الذرّية للمطابقة والاشتراك |
| 3 | `20260806120200_phase_2_1_seed_cities_and_settings` | بذر المدن الأربع والإعدادات |
| 4 | `20260807100000_phase_2_3_unsubscribed_negotiation` | مساومة غير المشتركين |
| 5 | `20260807130000_phase_2_4_support_tickets` | تذاكر الدعم ودخول اللوحة |
| 6 | `20260807170000_phase_2_5_mutual_ratings` | التقييم المتبادل |
| 7 | `20260807190000_phase_2_6_language_selection` | اختيار اللغة |
| 8 | `20260808040000_phase_2_6_scheduled_jobs` | المهام المجدولة |
| 9 | `20260808120000_phase_2_7_start_ride_parties` | أطراف بدء الرحلة |
| 10 | `20260808140000_phase_2_7_admin_dashboard` | لوحة الإدارة والجلسات |
| 11 | `20260808180000_phase_3_agent_measurement` | `agent_decisions` و`agent_outcomes` وقياس الوكيل |
| 12 | `20260809000000_phase_3_close_postgrest_surface` | محاولة أولى لإغلاق PostgREST — **لم تُغلق شيئاً**، أُبقيت موثَّقة |
| 13 | `20260809001000_phase_3_close_postgrest_surface_fix` | الإغلاق الفعّال (سحب من `PUBLIC`) — راجع ADR 0014 |

## القواعد الإلزامية — يفرضها `scripts/check-migrations.ts` في CI

1. **كل جدول بلا استثناء يحمل `city_id`** مرتبطاً بـ `cities(id)` — حتى الجداول
   التي تبدو محلية.
2. **RLS مفعّلة على كل جدول** منذ إنشائه، بسطر `alter table X enable row level
   security` صريح.
3. **العمليات الحرجة عبر دوال `RPC` ذرّية** بصيغة `verb_noun`. كل واحدة تستخدم
   `SELECT … FOR UPDATE SKIP LOCKED` أو ما يعادلها — لا منطق تزامن في التطبيق.
4. **جدول `platform_settings`** يحوي كل قيمة قابلة للتغيير.
   **ممنوع ترميز أي من هذه القيم داخل الكود** (يفرضه
   `scripts/check-business-constants.ts`).

## تنبيه أمني يخصّ Supabase تحديداً

Supabase تُشغّل PostgREST تلقائياً فوق مخطط `public`، والدور الزائف `PUBLIC`
يملك `usage` على المخطط و`execute` على كل دالة تُنشأ فيه. فأي دالة جديدة
`security definer` تُكتب هنا تصير **قابلة للنداء من الإنترنت** بمفتاح anon
العلني ما لم تُسحب الصلاحية. الهجرة 13 أضافت `alter default privileges` تمنع
ذلك تلقائياً لما يُنشأ لاحقاً، لكن انتبه للأمر عند أي تغيير في الصلاحيات.
التفصيل في `docs/adr/0014-postgrest-surface-was-open.md`.
