/**
 * # سجلُّ مساراتِ العودة — القائمةُ المغلقةُ الوحيدة
 *
 * **الغرض:** أن يكون في المستودعِ موضعٌ **واحدٌ** يُعلَن فيه، لكلِّ تغييرٍ في
 * المخطّطِ **يُضيِّق أو يُزيل** شيئاً كان قائماً قبلَه، أربعةُ أشياءَ لا يمرّ مدخلٌ
 * بلا واحدٍ منها: **سببُه**، و**هل يكسر نسخةً منشورةً سابقةً**، و**مسارُ العودةِ**
 * الذي يُعاد به النظامُ إن فشل النشرُ، و**مالكُه**. ثمّ **هل الشيفرةُ والمخطّطُ
 * ينشران معاً** (`coupledDeploy`)، وأينَ يُقرأ الإجراءُ في `docs/rollback.md`.
 *
 * **الحالة:** `OPS-010` — مُنفَّذ · مُختبَر (ADR 0047). والمداخلُ هي **بعينِها**
 * مجموعةُ الخطرِ التي تقرأها `findRollbackRisks` من هجراتِ المستودعِ — لا واحدةٌ
 * أقلَّ ولا واحدةٌ أكثرَ، والحاجزُ يفرضُ الاتجاهَين. ولا يُثبَتُ عددٌ هنا: رقمٌ
 * يُكتبُ في تعليقٍ يكذبُ عندَ أولِ هجرةٍ لاحقةٍ، والحاجزُ أصدقُ منه دائماً.
 *
 * **ينتمي إلى:** البند `OPS-010` · القسم 11-د · `F11-09` · البوابةَ H.
 *
 * **يُتوقع أن يستخدمه لاحقاً:** `scripts/check-rollback-safety.ts` (الحاجزُ
 * الساكنُ) · `scripts/rollback-schema-drill.ts` (التمرينُ على قاعدةٍ حقيقيةٍ) ·
 * اختباراتُ الوحدة.
 *
 * **ملاحظات مستقبلية:** كلُّ هجرةٍ جديدةٍ فيها تضييقٌ تُضاف ههنا أو يسقط البناءُ.
 * ومتى صار للنظامِ **إطلاقٌ إنتاجيٌّ أوّلُ** وجب مراجعةُ كلِّ
 * `breaksPreviousRelease: false` مرّةً واحدةً بعينِ «ما الذي كان منشوراً فعلاً؟»،
 * لأنّ معنى «النسخةِ السابقةِ» يتغيّر عندَ أوّلِ إطلاق.
 *
 * **ما لا يفعله هذا الملفُّ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **ليس إذناً بالتضييق.** التسجيلُ يُخرِج التضييقَ من الصمتِ إلى العلن؛ ولا
 *   يُبرِّره. ومدخلٌ يقول «يكسر نسخةً سابقةً» ولا إجراءَ موثَّقاً له **يُسقِط البناءَ**.
 * - **لا يُنشئ هجرةَ عودةٍ.** لا `down` في هذا المستودعِ ولا تُختلَق: القاعدةُ
 *   تمضي إلى الأمامِ، والعودةُ في **صورةِ الشيفرةِ** وحدَها. وذلك مكتوبٌ في
 *   `docs/rollback.md` لا مضمرٌ ههنا.
 * - **لا يقرأ قرصاً ولا يعرف بيئةً.** بياناتٌ مُجمَّدةٌ فقط.
 * - **لا يحرس شيئاً.** الفرضُ في الحاجزِ وحدَه.
 */

import { CRITICAL_PATHS, type CriticalPath } from "./skip-registry.ts";

export type { CriticalPath };
export { CRITICAL_PATHS };

/**
 * المالكُ: قائمةٌ **مغلقةٌ** من طرفَين. ومعنى المِلكيّةِ ههنا: **مَن يملك تنفيذَ
 * مسارِ العودةِ لحظةَ الفشل**.
 */
export const ROLLBACK_OWNERS = ["منفّذ المستودع", "مدير المشروع"] as const;
export type RollbackOwner = (typeof ROLLBACK_OWNERS)[number];

/**
 * مساراتُ العودةِ: قائمةٌ **مغلقةٌ** بثلاثةِ احتمالاتٍ لا رابعَ لها.
 * - `code-only`: يكفي إعادةُ نشرِ الصورةِ السابقةِ؛ المخطّطُ الجديدُ يحتملها.
 * - `expand-contract`: التوسيعُ نُشِر في دفعةٍ سابقةٍ والتقليصُ في لاحقةٍ، فالعودةُ
 *   خطوةٌ واحدةٌ إلى الوراءِ بلا كسرٍ. **ولا يجوز مع `breaksPreviousRelease: true`**.
 * - `forward-only`: لا عودةَ إلى الوراءِ؛ الإصلاحُ إلى الأمامِ بهجرةٍ جديدةٍ ونشرٍ
 *   جديدٍ. **ويلزمه إجراءٌ موثَّقٌ ونشرٌ مقرونٌ** إن كان يكسر نسخةً سابقةً.
 */
export const ROLLBACK_PATHS = ["code-only", "expand-contract", "forward-only"] as const;
export type RollbackPath = (typeof ROLLBACK_PATHS)[number];

/** مدخلٌ واحدٌ = تغييرٌ واحدٌ مُضيِّقٌ في هجرةٍ واحدةٍ. */
export interface RollbackDeclaration {
  /** اسمُ ملفِّ الهجرةِ كما هو في `supabase/migrations`. */
  readonly migration: string;
  /** وسمُ التغييرِ: `<نوع>:<هدف>` كما تُخرِجه `riskTag` بعدَ `::`. */
  readonly change: string;
  /** سببٌ يُقرأ وحدَه بلا رجوعٍ إلى الهجرة. */
  readonly why: string;
  /** هل نسخةُ الشيفرةِ التي كانت تعمل قبلَ هذه الهجرةِ تنكسر بعدَها؟ */
  readonly breaksPreviousRelease: boolean;
  readonly rollbackPath: RollbackPath;
  /** هل يجب أن تُنشَر الشيفرةُ والمخطّطُ معاً ولا يُفرَّق بينهما؟ */
  readonly coupledDeploy: boolean;
  readonly owner: RollbackOwner;
  /** المسارُ الحرجُ المتأثِّرُ، و`null` تعني: خارجَ القائمةِ لا «غيرَ مهمّ». */
  readonly criticalPath: CriticalPath | null;
  /** عنوانٌ حرفيٌّ يجب أن يُوجَد في `docs/rollback.md`، و`null` إن لا كسرَ. */
  readonly documentedIn: string | null;
}

/**
 * نصٌّ يتكرَّر: إحكامُ سطحِ `security definer`. النمطُ في المستودعِ واحدٌ —
 * `revoke all … from public` ثمّ `grant execute … to service_role` — والبوّابةُ
 * تنادي هذه الدوالَّ بمفتاحِ الخدمةِ لا بدورِ مستخدمٍ، فإزالةُ صلاحيةِ `public`
 * الافتراضيةِ **لا تمسّ نداءً قائماً**.
 */
const DEFINER_SEAL =
  "إحكامُ سطحِ definer: تُزال صلاحيةُ التنفيذِ الافتراضيةُ عن public ويُمنَح service_role وحدَه. والنداءُ القائمُ يمرّ بمفتاحِ الخدمةِ، فلا نداءَ سابقاً يفقد صلاحيتَه.";

/** إجراءُ العودةِ للهجرةِ التي تُلزِم أعمدةَ المدينةِ — عنوانٌ يُطابَق في الوثيقة. */
const HEADING_CITY_NOT_NULL = "عودةُ نشرٍ بعدَ إلزامِ أعمدةِ المدينةِ (20260812120000)";
/** إجراءُ العودةِ للهجرةِ التي حذفت التوقيعَ العابرَ للمدن. */
const HEADING_EXPIRING_SOON = "عودةُ نشرٍ بعدَ حذفِ التوقيعِ العابرِ للمدن (20260814020000)";

/** سببُ المحاولةِ الأولى — تُقرأ مع تصحيحِها. */
const WHY_SURFACE_ATTEMPT =
  "محاولةٌ أولى للسحبِ الجامعِ سحبت من `anon` و`authenticated` بأسمائهما، وهما لا يملكان المنحَ باسميهما بل يرثانه عن `PUBLIC` — فلم تُغلِق شيئاً فعلياً (وتمرينُ القاعدةِ الحقيقيةِ يقيس لها **صفرَ** فقدٍ). تُعلَن للقراءةِ لا لأنّها ضيّقت.";
/** سببُ التصحيحِ الذي أغلق السطحَ فعلاً. */
const WHY_SURFACE_FIX =
  "السحبُ الجامعُ عن `PUBLIC` هو ما أغلق سطحَ PostgREST فعلاً، وهو أوسعُ تضييقٍ في المستودعِ: يقيس التمرينُ 1674 صلاحيةً غائبةً بعدَه. وإعادةُ منحِها عودةً تُعيد فتحَ ما أُغلِق لعيبٍ أمنيٍّ، فالمسارُ إلى الأمامِ وحدَه.";
/** إجراءُ العودةِ لإغلاقِ سطحِ PostgREST — السحبُ الجامعُ عن `public`. */
const HEADING_POSTGREST_SURFACE = "عودةُ نشرٍ بعدَ إغلاقِ سطحِ PostgREST (20260809001000)";

export const ROLLBACK_DECLARATIONS: readonly RollbackDeclaration[] = [
  {
    migration: "20260810160000_phase_6_fix_login_code_race.sql",
    change: "revoke_function:issue_admin_login_code(5)",
    why: "إعادةُ تثبيتِ الصلاحياتِ كما كانت بعدَ `create or replace` — وهي لا تُسقِط المنِحَ أصلاً، فالتصريحُ ههنا للقراءةِ لا للتضييق.",
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260812000000_phase_1_seal_definer_surface.sql",
    change: "revoke_schema:public",
    why: "إعادةُ تثبيتِ قفلِ `usage on schema public` الذي ثُبِّت في هجرةٍ سابقةٍ، حتى تكفي هذه الهجرةُ بذاتِها إن أُعيد بناءُ القاعدةِ من الصفرِ أو أُعيد المنحُ سهواً.",
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260812120000_city_id_for_global_tables.sql",
    change: "set_not_null:db_backups.city_id",
    why: "العمودُ يُملأ ثمّ يُلزَم. وإدخالٌ من نسخةٍ سابقةٍ لا يكتب `city_id` يُرفَض بعدَ ذلك، فالكسرُ حقيقيٌّ لا نظريٌّ.",
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "النسخُ والاستعادة",
    documentedIn: HEADING_CITY_NOT_NULL,
  },
  {
    migration: "20260812120000_city_id_for_global_tables.sql",
    change: "set_not_null:db_backups.backup_run_id",
    why: "يُلزَم مع `city_id` في الهجرةِ نفسِها ليصير مفتاحُ الشوطِ مقروءاً لكلِّ مدينةٍ؛ وإدخالٌ سابقٌ بلا مفتاحِ شوطٍ يُرفَض.",
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "النسخُ والاستعادة",
    documentedIn: HEADING_CITY_NOT_NULL,
  },
  {
    migration: "20260812120000_city_id_for_global_tables.sql",
    change: "set_not_null:webhook_events.city_id",
    why: "حدثُ الدفعِ صار مربوطاً بمدينةٍ إلزاماً؛ ونسخةٌ سابقةٌ تُدخِل حدثاً بلا مدينةٍ تُرفَض.",
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الدفعُ والاشتراك",
    documentedIn: HEADING_CITY_NOT_NULL,
  },
  {
    migration: "20260812120000_city_id_for_global_tables.sql",
    change: "set_not_null:webhook_events.transaction_id",
    why: "المعاملةُ هي مصدرُ المدينةِ في حدثِ الدفعِ، فإلزامُها لازمٌ لإلزامِ المدينةِ؛ والكسرُ نفسُه.",
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الدفعُ والاشتراك",
    documentedIn: HEADING_CITY_NOT_NULL,
  },
  {
    migration: "20260812120000_city_id_for_global_tables.sql",
    change: "revoke_function:record_webhook_event(4)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الدفعُ والاشتراك",
    documentedIn: null,
  },
  {
    migration: "20260813070000_safety_delivery_skip_misconfigured.sql",
    change: "revoke_function:claim_safety_incident_delivery(0)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "السلامةُ والاستغاثة",
    documentedIn: null,
  },
  {
    migration: "20260814020000_expiring_soon_is_per_city.sql",
    change: "drop_function:subscriptions_expiring_soon(1)",
    why: "التوقيعُ العابرُ للمدنِ يُحذَف ولا يُترَك: بقاؤه يعني أنّ نداءً ناسياً للمدينةِ يُترجَم صامتاً إلى النسخةِ العابرةِ فيعود العيبُ. والحذفُ والإنشاءُ في دفعةٍ واحدةٍ، فنسخةٌ سابقةٌ تنادي التوقيعَ القديمَ تفشل.",
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الدفعُ والاشتراك",
    documentedIn: HEADING_EXPIRING_SOON,
  },
  {
    migration: "20260814030000_admin_setting_accepts_plain_text.sql",
    change: "revoke_function:admin_update_setting(4)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260814040000_reclaim_abandoned_outbox_claims.sql",
    change: "revoke_function:claim_broadcast_recipients(1)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "المهامُّ الدوريةُ والقفلُ الموزَّع",
    documentedIn: null,
  },
  {
    migration: "20260814040000_reclaim_abandoned_outbox_claims.sql",
    change: "revoke_function:finish_broadcast_delivery(6)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "المهامُّ الدوريةُ والقفلُ الموزَّع",
    documentedIn: null,
  },
  {
    migration: "20260814040000_reclaim_abandoned_outbox_claims.sql",
    change: "revoke_function:claim_subscription_notices(1)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "المهامُّ الدوريةُ والقفلُ الموزَّع",
    documentedIn: null,
  },
  {
    migration: "20260814040000_reclaim_abandoned_outbox_claims.sql",
    change: "revoke_function:finish_subscription_notice(6)",
    why: DEFINER_SEAL,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "المهامُّ الدوريةُ والقفلُ الموزَّع",
    documentedIn: null,
  },
  {
    migration: "20260809000000_phase_3_close_postgrest_surface.sql",
    change: "revoke_all_in_schema:tables:public",
    why: WHY_SURFACE_ATTEMPT,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260809000000_phase_3_close_postgrest_surface.sql",
    change: "revoke_all_in_schema:sequences:public",
    why: WHY_SURFACE_ATTEMPT,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260809000000_phase_3_close_postgrest_surface.sql",
    change: "revoke_all_in_schema:functions:public",
    why: WHY_SURFACE_ATTEMPT,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260809000000_phase_3_close_postgrest_surface.sql",
    change: "revoke_all_in_schema:routines:public",
    why: WHY_SURFACE_ATTEMPT,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260809000000_phase_3_close_postgrest_surface.sql",
    change: "revoke_schema:public",
    why: WHY_SURFACE_ATTEMPT,
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: null,
  },
  {
    migration: "20260809001000_phase_3_close_postgrest_surface_fix.sql",
    change: "revoke_all_in_schema:functions:public",
    why: WHY_SURFACE_FIX,
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: HEADING_POSTGREST_SURFACE,
  },
  {
    migration: "20260809001000_phase_3_close_postgrest_surface_fix.sql",
    change: "revoke_all_in_schema:routines:public",
    why: WHY_SURFACE_FIX,
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: HEADING_POSTGREST_SURFACE,
  },
  {
    migration: "20260809001000_phase_3_close_postgrest_surface_fix.sql",
    change: "revoke_all_in_schema:tables:public",
    why: WHY_SURFACE_FIX,
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: HEADING_POSTGREST_SURFACE,
  },
  {
    migration: "20260809001000_phase_3_close_postgrest_surface_fix.sql",
    change: "revoke_all_in_schema:sequences:public",
    why: WHY_SURFACE_FIX,
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: HEADING_POSTGREST_SURFACE,
  },
  {
    migration: "20260809001000_phase_3_close_postgrest_surface_fix.sql",
    change: "revoke_schema:public",
    why: WHY_SURFACE_FIX,
    breaksPreviousRelease: true,
    rollbackPath: "forward-only",
    coupledDeploy: true,
    owner: "منفّذ المستودع",
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    documentedIn: HEADING_POSTGREST_SURFACE,
  },
  {
    migration: "20260905020000_open_offer_round_returns_offer_ids.sql",
    change: "revoke_function:open_offer_round(4)",
    why: "إعادةُ تثبيتِ الصلاحياتِ كما كانت بعدَ `create or replace` للدالّةِ التي غُيّرَ مردُّها — وهي لا تُضيِّقُ منحةً جديدةً بل تُعيدُ قفلَ السطحِ الذي كان قائماً قبلها، فالتصريحُ للقراءةِ لا للتضييق. و`open_offer_round` كانت ممنوحةً لـ`service_role` وحدها قبلَ التغييرِ، وتبقى كذلك بعده.",
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "دورةُ الرحلةِ والإسناد",
    documentedIn: null,
  },
  {
    migration: "20260905030001_open_offer_round_writes_outbox.sql",
    change: "revoke_function:open_offer_round(4)",
    why: "الهجرةُ تُعيدُ تعريفَ `open_offer_round` بـ`create or replace` لتُدرجَ صفوفَ notification_outbox في معاملةِ العروضِ نفسِها (BUG-004)، والسحبُ بعده ليس تضييقاً بل إعادةُ قفلِ السطحِ كما كان: `open_offer_round` كانت ممنوحةً لـ`service_role` وحدها قبلَ التغييرِ وتبقى كذلك بعده. والتوقيعُ ومفتاحُ العودةِ (`offer_ids`) لم يتغيرا، فالصورةُ السابقةُ تناديها كما كانت تفعل.",
    breaksPreviousRelease: false,
    rollbackPath: "code-only",
    coupledDeploy: false,
    owner: "منفّذ المستودع",
    criticalPath: "دورةُ الرحلةِ والإسناد",
    documentedIn: null,
  },
];

/** وسمُ المدخلِ بالصورةِ التي تُطابِق `riskTag`. */
export function declarationTag(declaration: RollbackDeclaration): string {
  return `${declaration.migration}::${declaration.change}`;
}
