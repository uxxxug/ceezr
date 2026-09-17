/**
 * الغرض: سِجلٌّ **مغلقٌ** لأطوارِ دورةِ حياةِ الدفعِ (`F8-06`)، وقواعدُ نقيّةٌ تُحاسِبُه.
 * الحالة: منفَّذٌ فعليّاً — مِعيارُ شمولٍ، لا منطقُ أعمالٍ ولا اختبارٌ بنفسِه.
 * ينتمي إلى: scripts/lib
 * يُستخدَمُ من: scripts/check-payment-lifecycle-matrix.ts ·
 *   tests/unit/check-payment-lifecycle-matrix.test.ts
 * الحاكم: ADR 0133 (عددٌ بلا قائمةٍ ليسَ مِعيارَ إغلاقٍ) · ADR 0135 (الاكتشافُ قبلَ
 *   المطابقةِ) · البند `F8-06`
 *
 * ## لِمَ سِجلٌّ، والاختباراتُ موجودةٌ
 *
 * نصُّ `F8-06` حرفاً: «مصفوفة اختبار دورة حياة الدفع (نجاح، فشل، معلّق، مكرّر،
 * استرجاع، تناقض)». واختباراتُ الدفعِ **قائمةٌ ومتفرِّقةٌ** في خمسةِ ملفّاتٍ.
 * **والعِلَّةُ أنَّ العددَ ليسَ برهاناً**: لا نصَّ يقولُ **أيَّ** أطوارِ الدفعِ يجبُ
 * أن تُقاسَ، فمَن أضافَ كاتباً جديداً لحالةِ دفعٍ — أو حالةً جديدةً في قيدِ
 * المخطَّطِ — **لم يُخفِقْ اختباراً ولم يُخالِفْ نمطاً مكتوباً**، ويبقى الحاجزُ
 * أخضرَ حتّى يومَ يُسألُ «أينَ ذهبَ المالُ؟».
 *
 * ## وما لا يفعلُه هذا الملفُّ
 *
 * **لا يقيسُ شيئاً بنفسِه ولا يُصلِحُ دفعةً.** الحالةُ المذكورةُ ههنا لا تصيرُ
 * مقيسةً بذِكرِها؛ المُدَّعى أنَّ **الشمولَ صارَ قابلاً للطعنِ آليّاً**: كاتبٌ بلا
 * حالةٍ يُسقِطُ البناءَ، وحالةٌ تُحيلُ إلى اختبارٍ لا وجودَ لهُ تُسقِطُه.
 *
 * ## والكُتّابُ **مُكتشَفونَ** لا مكتوبونَ
 *
 * قائمةُ الكُتّابِ لا تُحفَظُ ههنا: تُقرأُ من نصِّ الهجراتِ (آخرُ تعريفٍ لكلِّ
 * اسمٍ، إذ `create or replace` يُبطِلُ ما قبلَه). ولو كُتِبَت يداً لَحَرَسَ
 * السِجلُّ نفسَه، **وهوَ عينُ الثقبِ** الذي سدَّهُ `ADR 0135`.
 */

/** أصنافُ الطورِ الستّةُ بأسمائها في نصِّ البندِ — لا يُزادُ عليها ولا يُنقَصُ. */
export type LifecycleClass = "نجاح" | "فشل" | "معلّق" | "مكرّر" | "استرجاع" | "تناقض";

/**
 * الأصنافُ كما تُقرأُ من **نصِّ البندِ** في `docs/ROADMAP-MASTER.md` §12.
 * تُستخرَجُ بقاعدةٍ لا تُحفَظُ عن ظهرِ قلبٍ، فلو غُيِّرَ نصُّ البندِ (وذاكَ ممنوعٌ
 * بـ`ح-1`) ظهرَ الافتراقُ حالاً بدلاً من أن يمرَّ صامتاً.
 */
const ITEM_ROW_RE = /^\|\s*F8-06\s*\|\s*([^|]+?)\s*\|\s*`(\[[ x~!]\])`\s*\|/m;

export function readF8_06ClassesFromItemText(roadmapText: string): string[] | null {
  const row = ITEM_ROW_RE.exec(roadmapText);
  if (row === null) return null;
  const inside = /\(([^)]*)\)/.exec(row[1] ?? "");
  if (inside === null) return null;
  return (inside[1] ?? "")
    .split("،")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function readF8_06Symbol(roadmapText: string): string | null {
  return ITEM_ROW_RE.exec(roadmapText)?.[2] ?? null;
}

/** أثرٌ مقيسٌ: ما يُفتَّشُ عنهُ في القاعدةِ بعدَ الطورِ، لا ما يُرجى منه. */
export interface LifecycleCase {
  /** معرِّفٌ ثابتٌ يُحالُ إليهِ من الأدلّةِ فلا يُعادُ ترقيمُه. */
  readonly id: string;
  readonly lifecycleClass: LifecycleClass;
  /**
   * اسمُ الكاتبِ في القاعدةِ الذي يُمارِسُه هذا الطورُ — **يُطابَقُ بالمُكتشَفِ من
   * الهجراتِ**، فاسمٌ لا دالَّةَ لهُ يُسقِطُ البناءَ (مُدخلٌ ميّتٌ).
   */
  readonly writer: string;
  /** حالُ الصفِّ بعدَ الطورِ، أو `null` متى كانَ الطورُ رفضاً لا يُغيِّرُ حالاً. */
  readonly resultingStatus: string | null;
  /** مسارُ ملفِّ الاختبارِ على القرصِ. */
  readonly testFile: string;
  /** اسمُ الحالةِ **حرفاً** كما هوَ في `it(...)` — يُفتَّشُ عنهُ في الملفِّ. */
  readonly testName: string;
  /** الأثرُ المقيسُ: أيُّ صفٍّ أو عمودٍ يُقرأُ للحُكمِ. لا يُقبَلُ نثرٌ عامٌّ. */
  readonly measuredEffect: string;
}

/**
 * حالةٌ في قيدِ المخطَّطِ لا يُنتِجُها كاتبٌ مقيسٌ: تُعلَنُ دَيناً **بسببٍ مكتوبٍ**
 * لا تُترَكُ صامتةً. والقائمةُ مغلقةٌ، فتوسيعُها تعديلُ ملفٍّ يُقرأُ في مراجعةٍ.
 */
export interface UnmeasuredStatus {
  readonly status: string;
  readonly reason: string;
}

export const PAYMENT_LIFECYCLE_CASES: readonly LifecycleCase[] = [
  {
    id: "PLC-01",
    lifecycleClass: "معلّق",
    writer: "create_payment",
    resultingStatus: "pending",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect:
      "صفُّ payment_transactions يُنشَأُ بحالةِ pending وبلا provider_transaction_id، ولا سطرَ في ledger_entries",
    testName: "الطورُ معلّقٌ: إنشاءُ دفعةٍ يكتبُ pending بلا دفترٍ ولا مرجعِ مزوّدٍ",
  },
  {
    id: "PLC-02",
    lifecycleClass: "نجاح",
    writer: "confirm_payment",
    resultingStatus: "active",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "الحالُ active وسطرُ ledger_entries واحدٌ واشتراكٌ فاعلٌ واحدٌ — يُعَدُّ عدّاً لا يُفترَضُ",
    testName: "الطورُ ناجحٌ: التأكيدُ يكتبُ active ودفتراً واحداً واشتراكاً فاعلاً واحداً",
  },
  {
    id: "PLC-03",
    lifecycleClass: "فشل",
    writer: "confirm_payment",
    resultingStatus: "failed",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "الحالُ failed، و**لا سطرَ دفترٍ ولا اشتراكَ فاعلٌ** — الغيابُ مقيسٌ بعدٍّ صِفريٍّ",
    testName: "الطورُ فاشلٌ: failed لا يفتحُ اشتراكاً ولا يكتبُ دفتراً",
  },
  {
    id: "PLC-04",
    lifecycleClass: "مكرّر",
    writer: "confirm_payment",
    resultingStatus: "active",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect:
      "تأكيدانِ متزامنانِ على الدفعةِ عينِها: سطرُ دفترٍ واحدٌ واشتراكٌ واحدٌ وأحدُ الجوابَينِ already_confirmed",
    testName: "الطورُ مكرّرٌ: تأكيدانِ متزامنانِ يُنتِجانِ دفتراً واحداً واشتراكاً واحداً",
  },
  {
    id: "PLC-05",
    lifecycleClass: "استرجاع",
    writer: "refund_subscription_payment",
    resultingStatus: "refunded",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect:
      "صفُّ subscription_refunds واحدٌ، وحالُ الدفعةِ refunded، وائتمانُ محفظةٍ بالمبلغِ عينِه",
    testName: "الطورُ استرجاعٌ: استردادٌ كاملٌ يكتبُ صفّاً واحداً ويضعُ refunded ويُقيِّدُ المحفظةَ",
  },
  {
    id: "PLC-06",
    lifecycleClass: "استرجاع",
    writer: "refund_subscription_payment",
    resultingStatus: null,
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect:
      "مبلغٌ أقلُّ من المدفوعِ يُرفَضُ بـREFUND_PARTIAL_UNSUPPORTED، والحالُ يبقى active ولا صفَّ استردادٍ ولا قيدَ محفظةٍ",
    testName: "الاستردادُ الجزئيُّ مرفوضٌ صريحاً: لا refunded كاملٌ لمبلغٍ ناقصٍ",
  },
  {
    id: "PLC-07",
    lifecycleClass: "تناقض",
    writer: "record_payment_provider_reference",
    resultingStatus: null,
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "مرجعُ مزوّدٍ ثانٍ مختلفٌ يُرفَضُ ولا يُستبدَلُ المحفوظُ — يُقرأُ العمودُ بعدَ الرفضِ",
    testName: "الطورُ تناقضٌ: مرجعُ مزوّدٍ ثانٍ مختلفٌ لا يُستبدِلُ الأوّلَ",
  },
  {
    id: "PLC-08",
    lifecycleClass: "تناقض",
    writer: "confirm_payment",
    resultingStatus: null,
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect:
      "حالٌ نهائيّةٌ (active) لا تُقبَلُ إعادةَ تصنيفٍ إلى failed: الجوابُ رفضٌ والحالُ يبقى active والدفترُ سطرٌ واحدٌ",
    testName: "الطورُ تناقضٌ: دفعةٌ محسومةٌ لا تُعادُ إلى فاشلةٍ",
  },
  {
    id: "PLC-09",
    lifecycleClass: "معلّق",
    writer: "record_payment_checkout",
    resultingStatus: null,
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "رابطُ الدفعِ يُحفَظُ للمعلّقةِ وحدَها: نداءٌ على غيرِ pending يُرفَضُ ولا يُغيِّرُ عموداً",
    testName: "الطورُ معلّقٌ: رابطُ الدفعِ يُحفَظُ للمعلّقةِ وحدَها",
  },
  {
    id: "PLC-10",
    lifecycleClass: "فشل",
    writer: "confirm_payment",
    resultingStatus: "past_due",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "past_due لا يفتحُ اشتراكاً ويبقى قابلاً للحسمِ لاحقاً — يُقاسُ بحسمٍ بعدَه",
    testName: "الطورُ فاشلٌ: past_due يبقى قابلاً للحسمِ ولا يفتحُ اشتراكاً",
  },
  {
    id: "PLC-11",
    lifecycleClass: "فشل",
    writer: "confirm_payment",
    resultingStatus: "canceled",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "canceled حالٌ نهائيّةٌ: لا اشتراكَ ولا دفترَ، ولا حسمَ بعدَها",
    testName: "الطورُ فاشلٌ: canceled نهائيّةٌ لا تُحسَمُ بعدَها",
  },
  {
    id: "PLC-12",
    lifecycleClass: "فشل",
    writer: "confirm_payment",
    resultingStatus: "expired",
    testFile: "tests/integration/payment-lifecycle-matrix.test.ts",
    measuredEffect: "expired حالٌ نهائيّةٌ: لا اشتراكَ ولا دفترَ، ولا حسمَ بعدَها",
    testName: "الطورُ فاشلٌ: expired نهائيّةٌ لا تُحسَمُ بعدَها",
  },
];

/**
 * لا حالةَ في القيدِ بلا قياسٍ اليومَ — والقائمةُ تبقى قائمةً لأنَّ إفراغَها
 * ليسَ إبطالَها: حالةٌ جديدةٌ تُضافُ إلى القيدِ غداً إمّا تُقاسُ أو تُعلَنُ ههنا.
 */
export const UNMEASURED_STATUSES: readonly UnmeasuredStatus[] = [];

export interface MatrixViolation {
  readonly rule: string;
  readonly detail: string;
}

export interface MatrixInputs {
  /** نصُّ `docs/ROADMAP-MASTER.md` — منهُ تُقرأُ الأصنافُ لا من نوعٍ في شِفرةٍ. */
  readonly roadmapText: string;
  /** أسماءُ كُتّابِ حالةِ الدفعِ **مُكتشَفةً من الهجراتِ**. */
  readonly discoveredWriters: readonly string[];
  /** حالاتُ الدفعِ كما يُصرِّحُها قيدُ المخطَّطِ، مُكتشَفةً لا محفوظةً. */
  readonly declaredStatuses: readonly string[];
  /** يُجيبُ: أيوجدُ هذا المسارُ؟ يُحقَنُ لِيُقاسَ الحاجزُ بلا قرصٍ. */
  readonly pathExists: (path: string) => boolean;
  /** يُعيدُ نصَّ ملفِّ اختبارٍ، أو `null` إن لم يوجَد. */
  readonly readTestFile: (path: string) => string | null;
  /** المصفوفةُ المقيسةُ — تُحقَنُ لِتُزرَعَ السوالبُ. */
  readonly cases?: readonly LifecycleCase[];
  /** الدَينُ المُعلَنُ — يُحقَنُ كذلكَ. */
  readonly unmeasured?: readonly UnmeasuredStatus[];
}

export function paymentLifecycleViolations(inputs: MatrixInputs): MatrixViolation[] {
  const cases = inputs.cases ?? PAYMENT_LIFECYCLE_CASES;
  const unmeasured = inputs.unmeasured ?? UNMEASURED_STATUSES;
  const violations: MatrixViolation[] = [];

  // ١) الأصنافُ من **نصِّ البندِ** لا من نوعٍ في شِفرةٍ: لو قُرِئَت من الشِفرةِ
  //    لَطابَقَت نفسَها دائماً ولم تحرُس شيئاً.
  const declaredClasses = readF8_06ClassesFromItemText(inputs.roadmapText);
  if (declaredClasses === null) {
    violations.push({
      rule: "classes.readable-from-item-text",
      detail: "صفُّ F8-06 في §12 غيرُ مقروءٍ بالقاعدةِ — والمِعيارُ يُقرأُ من نصِّ البندِ لا يُفترَضُ",
    });
  } else {
    const covered = new Set(cases.map((c) => c.lifecycleClass as string));
    for (const cls of declaredClasses) {
      if (!covered.has(cls)) {
        violations.push({
          rule: "classes.every-one-covered",
          detail: `صنفُ «${cls}» في نصِّ البندِ بلا حالةٍ واحدةٍ في المصفوفةِ`,
        });
      }
    }
    for (const cls of covered) {
      if (!declaredClasses.includes(cls)) {
        violations.push({
          rule: "classes.no-invented-class",
          detail: `صنفُ «${cls}» في المصفوفةِ وليسَ في نصِّ البندِ — والمِعيارُ لا يُوسَّعُ من داخلِه`,
        });
      }
    }
  }

  const seen = new Set<string>();
  for (const testCase of cases) {
    // ٢) المعرِّفُ مفتاحُ إحالةٍ، ومفتاحٌ بلا تفرُّدٍ يفسدُ صامتاً.
    if (seen.has(testCase.id)) {
      violations.push({ rule: "id.unique", detail: `معرِّفٌ مكرَّرٌ: ${testCase.id}` });
    }
    seen.add(testCase.id);

    // ٣) الكاتبُ يُطابَقُ بالمُكتشَفِ: مُدخلٌ يذكرُ دالَّةً لا وجودَ لها يُقرأُ
    //    تغطيةً لطورٍ لا كاتبَ لهُ.
    if (!inputs.discoveredWriters.includes(testCase.writer)) {
      violations.push({
        rule: "writer.exists-in-migrations",
        detail: `${testCase.id}: الكاتبُ \`${testCase.writer}\` غيرُ مُكتشَفٍ في الهجراتِ (مُدخلٌ ميّتٌ)`,
      });
    }

    // ٤) الحالُ الناتجُ — إن ذُكِرَ — يجبُ أن يكونَ من حالاتِ القيدِ.
    if (
      testCase.resultingStatus !== null &&
      !inputs.declaredStatuses.includes(testCase.resultingStatus)
    ) {
      violations.push({
        rule: "status.declared-in-constraint",
        detail: `${testCase.id}: الحالُ \`${testCase.resultingStatus}\` ليسَ في قيدِ المخطَّطِ`,
      });
    }

    // ٥) ملفُّ الاختبارِ موجودٌ، **واسمُ الحالةِ فيهِ حرفاً**. وإحالةٌ إلى اختبارٍ
    //    غيرِ موجودٍ أسوأُ من لا إحالةٍ: تُقرأُ إثباتاً ولا تُفتَحُ.
    if (!inputs.pathExists(testCase.testFile)) {
      violations.push({
        rule: "test.file-exists",
        detail: `${testCase.id}: ملفُّ الاختبارِ ${testCase.testFile} غيرُ موجودٍ`,
      });
    } else {
      const text = inputs.readTestFile(testCase.testFile);
      if (text === null || !text.includes(testCase.testName)) {
        violations.push({
          rule: "test.name-present-verbatim",
          detail: `${testCase.id}: لا حالةَ باسمِ «${testCase.testName}» في ${testCase.testFile}`,
        });
      }
    }

    // ٦) الأثرُ المقيسُ نصٌّ يُقرأُ ويُحاسَبُ عليهِ، فلا يُقبَلُ مقتضباً.
    if (testCase.measuredEffect.trim().length < 30) {
      violations.push({
        rule: "effect.written",
        detail: `${testCase.id}: الأثرُ المقيسُ أقصرُ من ثلاثينَ حرفاً — «يعملُ» ليسَ أثراً`,
      });
    }
  }

  // ٧) كلُّ حالةٍ في القيدِ إمّا مقيسةٌ أو مُعلَنةٌ دَيناً بسببٍ — لا ثالثَ.
  const producedStatuses = new Set(
    cases.map((c) => c.resultingStatus).filter((s): s is string => s !== null),
  );
  const declaredDebt = new Map(unmeasured.map((u) => [u.status, u.reason]));
  for (const status of inputs.declaredStatuses) {
    if (producedStatuses.has(status)) continue;
    const reason = declaredDebt.get(status);
    if (reason === undefined) {
      violations.push({
        rule: "status.measured-or-declared",
        detail: `الحالُ \`${status}\` في قيدِ المخطَّطِ بلا حالةٍ تُنتِجُه ولا إعلانِ دَينٍ بسببٍ`,
      });
    } else if (reason.trim().length < 30) {
      violations.push({
        rule: "status.debt-reason-written",
        detail: `الحالُ \`${status}\` مُعلَنٌ دَيناً بسببٍ أقصرَ من ثلاثينَ حرفاً`,
      });
    }
  }

  // ٨) دَينٌ مُعلَنٌ لحالٍ **مقيسةٍ فعلاً**: يُقرأُ عجزاً بعدَ أن زالَ — وذاكَ كذبٌ
  //    في الاتّجاهِ الآخرِ. ولحالٍ ليسَت في القيدِ: مُدخلٌ ميّتٌ.
  for (const debt of unmeasured) {
    if (producedStatuses.has(debt.status)) {
      violations.push({
        rule: "debt.not-already-measured",
        detail: `الحالُ \`${debt.status}\` مُعلَنٌ دَيناً وهوَ مقيسٌ في المصفوفةِ — يُقرأُ عجزاً زائفاً`,
      });
    }
    if (!inputs.declaredStatuses.includes(debt.status)) {
      violations.push({
        rule: "debt.status-in-constraint",
        detail: `الحالُ \`${debt.status}\` مُعلَنٌ دَيناً وليسَ في قيدِ المخطَّطِ (مُدخلٌ ميّتٌ)`,
      });
    }
  }

  // ٩) كاتبٌ مُكتشَفٌ بلا حالةٍ واحدةٍ: **وهذهِ القاعدةُ هيَ البندُ كلُّه**. مَن
  //    أضافَ كاتباً لحالةِ دفعٍ بلا قياسٍ يُخفِقُ ههنا لا في الإنتاجِ.
  const exercised = new Set(cases.map((c) => c.writer));
  for (const writer of inputs.discoveredWriters) {
    if (!exercised.has(writer)) {
      violations.push({
        rule: "writer.exercised-by-a-case",
        detail: `الكاتبُ \`${writer}\` يكتبُ حالَ دفعةٍ ولا حالةَ في المصفوفةِ تُمارِسُه`,
      });
    }
  }

  return violations;
}

/**
 * أجسامُ الدوالِّ من نصِّ هجرةٍ — **آخرُ تعريفٍ لكلِّ اسمٍ يغلبُ**، إذ
 * `create or replace` يُبطِلُ ما قبلَه. والجسمُ يُقتطَعُ بينَ فاتحةِ الاقتباسِ
 * الدولاريِّ وخاتمتِها **بالوسمِ عينِه** لا بـ`$$` وحدَها.
 *
 * **وهذا ليسَ تفصيلَ ترميزٍ**: هجراتُ المستودَعِ تستعمِلُ `as $fn$` فعلاً
 * (`20260916120000_f3_09_settled_predicate_and_issuable_flag.sql`)، فصياغةٌ تفتّشُ عن
 * `$$` وحدَها **تُعمِي الاكتشافَ** عن كاتبٍ موسومٍ بغيرِه — ويبقى الحاجزُ
 * أخضرَ وهوَ أعمى. وسُدَّ قبلَ أن يُستغَلّ.
 */
export function functionBodies(sql: string): { name: string; body: string }[] {
  const found: { name: string; body: string }[] = [];
  const head = /create\s+or\s+replace\s+function\s+([a-z0-9_]+)\s*\(/gi;
  for (let m = head.exec(sql); m !== null; m = head.exec(sql)) {
    const opener = /as\s+(\$[a-z0-9_]*\$)/i.exec(sql.slice(m.index));
    if (opener === null) continue;
    const tag = opener[1] ?? "$$";
    const bodyStart = m.index + opener.index + opener[0].length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    found.push({
      name: (m[1] ?? "").toLowerCase(),
      body: sql.slice(bodyStart, bodyEnd < 0 ? sql.length : bodyEnd),
    });
  }
  return found;
}

/** أيكتبُ هذا الجسمُ حالَ دفعةٍ أو صفَّ استردادٍ؟ */
export function writesPaymentLifecycle(body: string): boolean {
  return (
    /insert\s+into\s+payment_transactions/i.test(body) ||
    /update\s+payment_transactions/i.test(body) ||
    /insert\s+into\s+subscription_refunds/i.test(body)
  );
}

/**
 * حالاتُ الدفعِ من **آخرِ** قيدٍ يُنشَأُ في الهجراتِ بترتيبِ الطابعِ الزمنيِّ.
 * لا تُحفَظُ في شِفرةٍ: قيدٌ يُوسَّعُ غداً بحالةٍ ثامنةٍ يُرى ههنا حالاً.
 */
export function declaredPaymentStatuses(orderedSql: readonly string[]): string[] {
  let latest: string[] = [];
  for (const sql of orderedSql) {
    // (أ) القيدُ المُسمّى — وهوَ ما يُوسَّعُ عادةً. يُقرأُ باسمِه فلا يُخطَأُ بجدولٍ آخرَ.
    const named = /payment_transactions_status_check[\s\S]{0,300}?status\s+in\s*\(([^)]*)\)/gi;
    for (let m = named.exec(sql); m !== null; m = named.exec(sql)) {
      const values = [...(m[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((v) => v[1] ?? "");
      if (values.length > 0) latest = values;
    }
    // (ب) القيدُ الضمنيُّ **داخلَ جسمِ `create table payment_transactions` وحدَه**.
    //     ولو فُتِّشَ عن `check (status in …)` في الملفِّ جملةً لَسُرِقَ القيدُ من
    //     جدولٍ آخرَ في الهجرةِ نفسِها — وهوَ نجاحٌ كاذبٌ يُغيِّرُ المِعيارَ صامتاً.
    const table =
      /create\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\s*\.\s*)?"?payment_transactions"?\s*\(/i.exec(
        sql,
      );
    if (table !== null) {
      let depth = 0;
      let end = table.index + table[0].length;
      for (let i = table.index + table[0].length - 1; i < sql.length; i += 1) {
        if (sql[i] === "(") depth += 1;
        else if (sql[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = sql.slice(table.index, end);
      const inline = /check\s*\(\s*status\s+in\s*\(([^)]*)\)/gi;
      for (let m = inline.exec(body); m !== null; m = inline.exec(body)) {
        const values = [...(m[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((v) => v[1] ?? "");
        if (values.length > 0) latest = values;
      }
    }
  }
  return latest;
}
