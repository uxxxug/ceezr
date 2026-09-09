# المخططات (Migrations)

**الحالة: منفَّذة فعلياً — ١٣ هجرة مطبَّقة على الإنتاج.**

> هذا الملف كان متروكاً من قالب الأمر الأول ويقول «هيكل فقط، لا يُكتب أي
> `CREATE TABLE` فعلي» رغم وجود هجرات حقيقية بجانبه. صُحِّح في 2026-08-09.

الهجرات تُطبَّق **بترتيب أسمائها الأبجدي** (البادئة طابع زمني `YYYYMMDDHHMMSS`).
ولا تُطبَّق تلقائياً في البناء عن قصد: الهجرة قرارٌ لا أثرٌ جانبي للنشر. راجع
`docs/render-deployment-vars.md` §4 لأمر التطبيق الجاهز.

## طريق التطبيق الوحيد — `scripts/migrate.ts` (F7-07 · ADR-0068)

```bash
export DATABASE_URL='postgresql://…'          # اتصال مباشر لا pooler
bun run scripts/migrate.ts                    # قاعدة فارغة: السلسلة كلها
bun run scripts/migrate.ts --from 20260909040000   # قاعدة مُهاجَرة: ما بعد الطابع
bun run scripts/migrate.ts --dry-run          # الخطة بلا اتصال
```

> **`--from` ليس تحسيناً بل شرطٌ على قاعدةٍ فيها المخطَّط أصلاً.** الهجرات الـ٧٨
> الموروثة ليست مُسترجَعة (كُتِبت قبل فرض القاعدة الخامسة)، فإعادة تطبيقها تسقط
> بـ`42710 … already exists` — **قاسه CI** في التشغيل `34315907516`، وانظر
> ADR-0068 §«تصحيحٌ بالقياس». وأما ما يُكتَب بعد اليوم فمُسترجَعٌ يفرضه الحاجز.

ولا يُطبَّق شيءٌ بحلقة `psql` عارية بعد اليوم: المُطبِّق يحكم على كل ملفٍّ بقواعد
السلامة الست قبل أن يتصل، ويضبط `lock_timeout`، ويملك المعاملة (ملفٌّ يسقط لا
يُخلِّف نصفَ مخطَّط)، وهو **نفسه** ما تُشغِّله CI في وظيفتي التكامل.

### القواعد الست لكل هجرة تُكتَب بعد اليوم — يفرضها `scripts/check-migration-safety.ts`

يبدأ كل ملفٍّ جديد بتصريح طوره:

```sql
-- migration-phase: expand
```

والأطوار المعروفة: `expand` · `backfill` · `validate` · `switch` · `contract` · `index`.

| # | القاعدة | البديل المُعتمَد |
| - | ------- | ---------------- |
| ١ | `create index` تكون `concurrently`، ووحدها في ملفها، وفي طور `index` | ملفٌّ مستقلٌّ لكل فهرس |
| ٢ | `add constraint … check\|foreign key` تكون `not valid` | `validate constraint` في هجرة طور `validate` |
| ٣ | `alter column … set not null` ممنوعة منعاً مطلقاً | `check (v is not null) not valid` ثم تصديق |
| ٤ | `drop`/`rename` في طور `contract` وحده | توسيعٌ ثم تحويلٌ ثم تقليصٌ في هجرات منفصلة |
| ٥ | كل عبارة مُسترجَعة | `if not exists` · `if exists` · `on conflict` · `where not exists` |
| ٦ | لا `begin`/`commit` في الملف | المعاملة يملكها المُطبِّق |

**والهجرات الـ٧٨ السابقة دَينٌ مُعلَنٌ مُجمَّدٌ** في `scripts/lib/migration-baseline.ts`:
لا يُعاد كتابة حرفٍ منها (ضررها وقع عند تطبيقها الأول ولا يتكرّر)، والعدد **مقفل
عند ٧٨** فلا يُضاف إليه ملفٌّ جديد — والحاجز يرفض ذلك صراحة.

## الهجرات الحالية

| # | الملف | ما تفعله |
| - | ----- | -------- |
| 1 | `20260806120000_phase_2_1_core_schema` | الجداول الأساسية: `cities`, `users`, `drivers`, `orders`, `offers`, `platform_settings`, `audit_log` |
| 2 | `20260806120100_phase_2_1_atomic_rpcs` | دوال RPC الذرّية للمطابقة والاشتراك |
| 3 | `20260806120200_phase_2_1_seed_cities_and_settings` | بذر مدن الإطلاق الخمس (`JED` جدة، `MKK` مكة، `RUH` الرياض، `TIF` الطائف، `MED` المدينة المنورة) وإعداداتها |
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
