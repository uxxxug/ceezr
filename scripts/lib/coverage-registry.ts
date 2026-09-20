/**
 * # سجلُّ أرضيّاتِ التغطيةِ على المسارات الحرجة — قائمةٌ مغلقةٌ مقيسةٌ
 *
 * **الغرض:** أن تكون كلُّ أرضيّةٍ **رقماً مقيساً يومَ التصنيفِ** لا رقماً مستحسَناً،
 * وأن يكون لكلِّ مسارٍ حرجٍ في القائمةِ المغلقةِ (`CRITICAL_PATHS` في
 * `scripts/lib/skip-registry.ts`) مدخلٌ واحدٌ لا أكثرَ ولا أقلَّ.
 *
 * **الحالة:** `OPS-005` — مُنفَّذ · مُختبَر · مبرهَنُ السقوط (ADR 0048).
 *
 * **ينتمي إلى:** البند `OPS-005` · القسم 11-د.
 *
 * ## كيف قِيسَت هذه الأرقامُ — وكيف تُحدَّث
 *
 * ```
 * bun test --coverage --coverage-reporter=lcov --coverage-dir=coverage
 * bun run scripts/check-coverage-gate.ts
 * ```
 *
 * تاريخُ القياسِ: **2026-08-30**. الإصدارانِ: `bun 1.3.14` (المُثبَّتُ في CI)
 * و`bun 1.4.0` — وقد أُخرِج الملفّانِ وقُوبِلا سطراً بسطرٍ فكانا **متطابقَين تماماً**
 * (381 ملفّاً · 18391/29584 سطراً · 62.165%)، فلا هامشَ إصدارٍ مضروبٌ ههنا.
 *
 * والمقيسُ في **وظيفةِ `verify`** حيثُ لا قاعدةَ بياناتٍ حقيقيّةً: اختباراتُ التكاملِ
 * تتجاوز نفسَها هناك، فتغطيةُ محوِّلاتِ البنيةِ التحتيّةِ (`packages/infrastructure/*`)
 * **أدنى من حقيقتِها** في هذا القياس. وذلك مُعلَنٌ لا مُصلَحٌ: قياسُ التغطيةِ في
 * وظيفةِ التكاملِ بندٌ آخرُ لم يُفتَح.
 *
 * ## قاعدةُ التحديثِ (مِرقاةٌ لا سقفٌ متحرّكٌ)
 *
 * - **تُرفَع** الأرضيّةُ ويُخفَض السقفُ متى تحسَّن المقيسُ — بقصدٍ في commit مستقلٍّ.
 * - **لا تُخفَّض** أرضيّةٌ ولا يُرفَع سقفٌ إلّا ببيانِ سببٍ في نصِّ الـcommit:
 *   الحاجزُ لا يُضعَّف لينجحَ بناءٌ، بل يُصلَح السببُ.
 * - انخفاضُ النسبةِ له سببانِ مشروعانِ: (١) نقصانُ تغطيةٍ حقيقيٌّ — يُصلَح، (٢) دخولُ
 *   ملفٍّ كان غائباً عن القياسِ إلى القياسِ بتغطيةٍ دونَ المتوسّطِ — وهو **تحسُّنٌ**
 *   يُقاس فيه المسارُ من جديدٍ ويُحدَّث المدخلانِ معاً (النسبةُ والسقفُ).
 */

import type { CriticalPathBar } from "./coverage-gate.ts";

/**
 * أدنى عددِ ملفّاتٍ في `lcov.info` يُقبَل قبلَ الحكم. المقيسُ يومَ التصنيفِ 381
 * ملفّاً، والحدُّ 340 هامشاً لحذفِ ملفّاتٍ أو نقلِها — **وليس هدفَ تغطيةٍ**، بل حرزٌ
 * من مخرجِ تغطيةٍ جزئيٍّ (`bun test <ملفٌّ واحدٌ> --coverage`) يُقرَأ نجاحاً.
 */
export const MIN_MEASURED_FILES = 340;

/**
 * مدخلٌ واحدٌ لكلِّ مسارٍ حرجٍ. `roots` **شريحةٌ رأسيّةٌ كاملةٌ** (نطاقٌ + تطبيقٌ +
 * بنيةٌ تحتيّةٌ) لا طبقةٌ واحدةٌ، لأنّ المسارَ الحرجَ في الخارطةِ رأسيٌّ.
 */
export const COVERAGE_BARS: readonly CriticalPathBar[] = [
  {
    criticalPath: "الهويةُ والجلسةُ والصلاحيات",
    roots: [
      "packages/domain/identity",
      "packages/application/identity",
      "packages/infrastructure/identity",
    ],
    minLineCoverage: 72,
    maxUnmeasuredFiles: 13,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    criticalPath: "دورةُ الرحلةِ والإسناد",
    roots: [
      "packages/domain/dispatch",
      "packages/application/dispatch",
      "packages/infrastructure/dispatch",
    ],
    minLineCoverage: 44,
    maxUnmeasuredFiles: 10,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    criticalPath: "التتبّعُ وموقعُ السائق",
    roots: [
      "packages/domain/tracking",
      "packages/application/tracking",
      "packages/infrastructure/tracking",
    ],
    minLineCoverage: 47,
    maxUnmeasuredFiles: 1,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    criticalPath: "الدفعُ والاشتراك",
    roots: [
      "packages/domain/financial",
      "packages/application/financial",
      "packages/infrastructure/financial",
      "packages/domain/subscription",
      "packages/application/subscription",
      "packages/infrastructure/subscription",
    ],
    minLineCoverage: 57,
    maxUnmeasuredFiles: 19,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    criticalPath: "السلامةُ والاستغاثة",
    roots: [
      "packages/domain/safety",
      "packages/application/safety",
      "packages/infrastructure/safety",
    ],
    minLineCoverage: 59,
    maxUnmeasuredFiles: 10,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    /**
     * أرضيّةٌ 100% على **ملفَّين مقيسَين من 23**، فهي أرضيّةٌ هشّةٌ بالبناءِ: أوّلُ
     * ملفٍّ يدخل القياسَ بتغطيةٍ دونَ التامِّ يُسقِط البناءَ. وذلك مقصودٌ ومُعلَنٌ:
     * السقوطُ حينَها **إشعارُ تحسُّنٍ** يُعاد فيه القياسُ ويُحدَّث المدخلُ، لا خطأً
     * يُداوى بتخفيضِ الأرضيّة.
     */
    criticalPath: "توثيقُ السائق",
    roots: [
      "packages/domain/kyc",
      "packages/application/kyc",
      "packages/infrastructure/kyc",
      "packages/domain/documents",
      "packages/application/documents",
      "packages/infrastructure/documents",
    ],
    minLineCoverage: 100,
    maxUnmeasuredFiles: 21,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    /**
     * زيادةٌ يومَ 2026-09-15 معَ `F3-05`: المسارُ الحرجُ «شفافيّةُ الأداءِ
     * والحصيلة» زِيدَ في القائمةِ المغلقةِ، ولكلِّ مسارٍ مدخلٌ واحدٌ ههنا بحكمِ
     * `coverage-gate.test.ts`. والجذورُ **ملفّاتٌ لا مجلّداتٌ** لأنَّ شريحةَ
     * الحصيلةِ تسكنُ مجلّداتِ `driver/` معَ بنودٍ أخرى (`F3-02`/`F3-03`/`F3-04`)
     * ولها مساراتُها الحرجةُ، فجذرٌ بمجلّدٍ يخلِطُ القياسَينِ.
     *
     * والأرقامُ **مقيسةٌ** يومَ 2026-09-15 من `coverage/lcov.info`: النطاقُ
     * 24/25 والتطبيقُ 4/4 و69/69 — أي 97/98 (98.98%) فالأرضيّةُ 98. والمحوِّلُ
     * `driver-activity-store.ts` **خارجَ القياسِ** في وظيفةِ `verify` لأنَّ
     * إثباتَه على قاعدةٍ حقيقيّةٍ (23 حالةَ تكاملٍ) وهيَ لا تُشغَّلُ هناك — وذاكَ
     * مُعلَنٌ بسقفٍ قدرُه واحدٌ لا مُداوىً بأرضيّةٍ مخفوضةٍ.
     */
    criticalPath: "شفافيّةُ الأداءِ والحصيلة",
    roots: [
      "packages/domain/driver/activity.ts",
      "packages/application/driver/activity-ports.ts",
      "packages/application/driver/driver-activity.ts",
      "packages/infrastructure/driver/driver-activity-store.ts",
    ],
    minLineCoverage: 98,
    maxUnmeasuredFiles: 1,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    /**
     * زيادةٌ يومَ 2026-09-20 معَ `ECO-002`: المسارُ الحرجُ «الاستدامةُ
     * الاقتصاديّةُ» زِيدَ في القائمةِ المغلقةِ، ولكلِّ مسارٍ مدخلٌ واحدٌ ههنا
     * بحكمِ `coverage-gate.test.ts`.
     *
     * **ولِمَ جذرانِ في `scripts/` لا شريحةٌ في `packages/`**: مِلفّا التخزينِ
     * (`route-cache.ts` و`cached-routing-provider.ts`) يسكنانِ
     * `packages/application/tracking` وهوَ **جذرٌ قائمٌ** للمسارِ «التتبّعُ
     * وموقعُ السائق»، فإدراجُهما ههنا يعُدُّ السطرَ مرّتَينِ في حاجزَينِ —
     * وذاكَ مصدرُ حقيقةٍ مُكرَّرٌ (الأولويّةُ الثانيةُ في الملحقِ الحاكمِ). أمّا
     * حَكَمُ العددِ وحاجزُه فلا يُقاسانِ في أيِّ مدخلٍ آخرَ، وهُما **كلُّ ما
     * يحكمُ على هذا المسارِ اليومَ** (`ADR 0151`).
     *
     * والأرقامُ **مقيسةٌ** يومَ 2026-09-20 من `coverage/lcov.info` بمِخرَجِ
     * `bun run test:coverage` (712 مِلفّاً): الحَكَمُ 121/122 والحاجزُ 143/180
     * — أي 264/302 (87.42%) فالأرضيّةُ 87. والمِلفّانِ **مقيسانِ كلاهُما** فسقفُ
     * غيرِ المقيسِ صفرٌ: هذا المسارُ لا شيءَ فيه يُعتَذَرُ عنه بقاعدةٍ غائبةٍ
     * في وظيفةِ `verify`، إذ الحَكَمُ نقيٌّ والحاجزُ ساكنٌ. وما نقصَ من الحاجزِ
     * مسالكُ `main()` — قراءةُ قرصٍ وطبعٌ وخروجٌ — تُقاسُ بتشغيلِه في `CI` لا
     * بتغطيةِ وحدةٍ.
     */
    criticalPath: "الاستدامةُ الاقتصاديّةُ",
    roots: ["scripts/lib/routing-call-budget.ts", "scripts/check-routing-call-budget.ts"],
    minLineCoverage: 87,
    maxUnmeasuredFiles: 0,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    criticalPath: "المهامُّ الدوريةُ والقفلُ الموزَّع",
    roots: [
      "packages/domain/scheduling",
      "packages/application/scheduling",
      "packages/infrastructure/scheduling",
    ],
    minLineCoverage: 48,
    maxUnmeasuredFiles: 11,
    reason: null,
    owner: "فريق المنصّة",
  },
  {
    /**
     * 7% ليست حكماً بالكفايةِ: كلُّ مسالكِ النسخِ تحتاج قاعدةً حقيقيّةً وأداةَ
     * `pg_dump`، فما يُقاس في `verify` هو التحقّقُ من الإعدادِ والاختيارُ للتقليمِ
     * لا النسخُ نفسُه. الأرضيّةُ ههنا **حرزٌ من انحدارٍ** لا شهادةُ تغطيةٍ.
     */
    criticalPath: "النسخُ والاستعادة",
    roots: ["packages/infrastructure/backup"],
    minLineCoverage: 7,
    maxUnmeasuredFiles: 0,
    reason: null,
    owner: "فريق العمليّات",
  },
  {
    /**
     * المخطّطُ نفسُه SQL في `db/migrations` ولا تقيسه أداةُ تغطيةٍ لـTypeScript؛
     * حراستُه في `check-migrations.ts` و`check-schema-contract.ts` و`check-rollback-safety.ts`.
     * المقيسُ ههنا شيفرةُ الوصولِ وتفعيلُ المدنِ فقط.
     */
    criticalPath: "المخطّطُ وتفعيلُ المدن",
    roots: ["packages/infrastructure/db", "scripts/activate-launch-cities.ts"],
    minLineCoverage: 60,
    maxUnmeasuredFiles: 0,
    reason: null,
    owner: "فريق العمليّات",
  },
];
