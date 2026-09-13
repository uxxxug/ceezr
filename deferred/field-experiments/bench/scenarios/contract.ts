/**
 * الغرض: عقدُ سيناريو العمل — الشكلُ الذي يجب أن يُعلَنه كلُّ سيناريو قبل أن يُشغَّل،
 *        وفحصٌ آليٌّ يرفض أيَّ سيناريو ناقصِ الإعلان.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: كلُّ سيناريو في `bench/scenarios/catalog`، والمشغّل، ومولّدُ الحمل.
 * ملاحظات مستقبلية: أيُّ بندٍ جديدٍ في قائمةِ الإعلان يُضاف هنا وفي `REQUIRED_DECLARATIONS`
 *                   معاً، وإلّا صار بنداً اختيارياً بلا حرس.
 *
 * ولماذا عقدٌ مكتوبٌ لا اتّفاقٌ شفهيّ: «سيناريو» بلا إعلانٍ صريحٍ لحالةِ البداية
 * والنتيجةِ المتوقّعة والثوابتِ وشروطِ الفشل ليس سيناريو، بل تشغيلٌ يُقال عنه بعد
 * وقوعه إنّه نجح. والفحصُ الآليُّ أدناه يجعل النقصَ خطأً يُرفَع لا سهواً يُمرَّر.
 */

import type { Sql } from "../../../../packages/infrastructure/db/client.ts";

/** نوعُ التحقّق — يُصنَّف كي يُقرأ التقريرُ بأقسامه لا ككومةِ توكيدات. */
export type CheckKind =
  | "precondition"
  | "system_response"
  | "business_outcome"
  | "database_state"
  | "transition"
  | "invariant"
  | "idempotency";

export interface CheckResult {
  readonly kind: CheckKind;
  readonly name: string;
  readonly passed: boolean;
  /** تفصيلٌ يُقرأ عند الفشل: القيمةُ المتوقّعة والملاحَظة، لا «فشل». */
  readonly detail: string;
}

export const check = (
  kind: CheckKind,
  name: string,
  passed: boolean,
  detail: string,
): CheckResult => ({ kind, name, passed, detail });

/** مساواةٌ مُصرَّحٌ بطرفيها في التفصيل — أكثرُ ما يُحتاج، وأكثرُ ما يُكتب رديئاً. */
export const expectEqual = (
  kind: CheckKind,
  name: string,
  actual: unknown,
  expected: unknown,
): CheckResult =>
  check(
    kind,
    name,
    Object.is(actual, expected),
    `المتوقّع=${JSON.stringify(expected)} · الملاحَظ=${JSON.stringify(actual)}`,
  );

/**
 * مزدوجٌ مُعلَن. لا يُقبل مزدوجٌ في القياس إلّا بهذه الحقول الأربعة، لأن مزدوجاً
 * بلا «ما لا يُثبته» يُقرأ إثباتاً لما لم يُختبَر (§7 من الأمر الحاكم).
 */
export interface MockDeclaration {
  readonly what: string;
  readonly why: string;
  readonly proves: string;
  readonly doesNotProve: string;
}

export interface ActorPlan {
  readonly count: number;
  /**
   * `independent`: كلُّ فاعلٍ على بياناته — يقيس السعةَ والتصادمَ غيرَ المقصود.
   * `contended`: الفاعلون على **مورد واحد** — يقيس الذرّيةَ وحلَّ التسابق.
   */
  readonly mode: "independent" | "contended";
  readonly rationale: string;
}

export interface FailureCondition {
  readonly code: string;
  readonly description: string;
  /** يعيد وصفَ الإخفاق إن وقع، أو `null` إن لم يقع. */
  readonly detect: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<string | null>;
}

/** رسالةٌ خرجت من النظام إلى ناقلٍ صامت — نيّةُ إرسالٍ لا تسليمٌ مُثبَت. */
export interface RecordedMessage {
  readonly chatId: string;
  readonly text: string;
  readonly markup: unknown;
  readonly location?: { readonly latitude: number; readonly longitude: number };
}

export interface ScenarioContext {
  readonly sql: Sql;
  /** يُرسِل تحديثَ ويبهوك حقيقياً إلى التطبيق الحقيقي ويعيد استجابته. */
  readonly post: (bot: "driver" | "rider", update: unknown) => Promise<Response>;
  readonly cityId: string;
  readonly cityCode: string;
  readonly messagesTo: (chatId: number) => readonly RecordedMessage[];
  readonly allMessages: () => readonly RecordedMessage[];
  readonly settingNumber: (key: string) => Promise<number>;
  /**
   * حركةُ عدّادٍ منذ بدءِ هذا السيناريو — فرقاً لا قيمةً مطلقة.
   *
   * ويُتاح للسيناريو كي يُوكّد على الحركةِ نفسها لا ليُطبَع الرقمُ في تقريرٍ يقرؤه
   * أحدٌ يوماً: «قُبِل عرضٌ واحدٌ بالضبط» توكيدُ ذرّيةٍ لا سطرٌ في سجلّ.
   */
  readonly metricDelta: (name: string) => number;
}

/** نتيجةُ تنفيذِ فاعلٍ واحد — يملأها السيناريو، ويقيس المشغّلُ زمنَها. */
export interface ActorRun {
  readonly index: number;
  /** معرّفاتُ تيليجرام المستخدَمة — تُفحَص ملكيّتُها لنطاق القياس. */
  readonly telegramIds: readonly number[];
  /** حصادُ الفاعل: معرّفاتُ الصفوف التي أنشأها، وما تحتاجه التوكيدات. */
  readonly produced: Readonly<Record<string, string | number | boolean | null>>;
  readonly httpStatuses: readonly number[];
  readonly durationMs: number;
  readonly error: string | null;
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly title: string;
  readonly service: "transport" | "delivery" | "subscription" | "platform";

  /** حالةُ البداية — وصفاً، ويُتحقَّق منها فعلاً في `preconditions`. */
  readonly initialState: readonly string[];
  /** مدخلاتُ المستخدم المُعلَنة (ما يُرسله الإنسان، لا ما يُرسله الكود). */
  readonly userInputs: readonly string[];
  /** خطواتُ السيناريو بترتيبها — تُطبَع في التقرير كي يُقرأ ما جرى. */
  readonly steps: readonly string[];
  /** استجابةُ النظام المتوقّعة — رسائلُ ومحتوى، لا كودُ HTTP. */
  readonly expectedSystemResponse: readonly string[];
  /** نتيجةُ العمل المتوقّعة — بلغةِ العمل لا بلغةِ الجداول. */
  readonly expectedBusinessOutcome: readonly string[];

  readonly concurrency: ActorPlan;
  readonly mocks: readonly MockDeclaration[];
  readonly proves: readonly string[];
  readonly doesNotProve: readonly string[];
  /** أسماءُ العدّادات التي يجب أن تتحرّك — وتُقاس حركتُها فرقاً لا قيمةً مطلقة. */
  readonly metrics: readonly string[];
  readonly failureConditions: readonly FailureCondition[];

  /**
   * تهيئةُ حالةِ البداية التي لا يُنشئها الفاعلون أنفسُهم (سائقون متاحون مثلاً).
   *
   * ومنفصلةٌ عن `preconditions` لأن الفحصَ يجب أن يبقى فحصاً: خلطُ التهيئةِ بالفحص
   * يُنتج «شرطاً ابتدائياً» ينجح دائماً لأنّه هو من صنع ما يفحصه. فالتهيئةُ تصنع،
   * ثمّ الفحصُ يتحقّق، ثمّ التقريرُ يذكر ما هُيّئ نصّاً كي يُقرأ الرقمُ بحالتِه.
   */
  readonly arrange?: (context: ScenarioContext) => Promise<readonly string[]>;
  readonly preconditions: (context: ScenarioContext) => Promise<readonly CheckResult[]>;
  /** تنفيذُ فاعلٍ واحدٍ كاملاً. يرمي عند الخطأ؛ المشغّلُ يُسجّله ولا يكتمه. */
  readonly runActor: (
    context: ScenarioContext,
    actor: { readonly index: number },
  ) => Promise<Omit<ActorRun, "durationMs" | "error">>;
  readonly systemResponse: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<readonly CheckResult[]>;
  readonly businessOutcome: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<readonly CheckResult[]>;
  readonly databaseState: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<readonly CheckResult[]>;
  readonly transitions: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<readonly CheckResult[]>;
  readonly invariants: (
    context: ScenarioContext,
    actors: readonly ActorRun[],
  ) => Promise<readonly CheckResult[]>;
  /**
   * الحتميّةُ عند التكرار: `replay` يُعيد **نفسَ** مدخلات المستخدم، و`expectation`
   * يتحقّق أنّ الإعادةَ لم تُنشئ عملاً ثانياً. وبلا هذا البند يبقى «التكرار آمن»
   * ادّعاءً معماريّاً لا نتيجةَ قياس.
   */
  readonly idempotency: {
    readonly description: string;
    readonly replay: (context: ScenarioContext, actors: readonly ActorRun[]) => Promise<void>;
    readonly expectation: (
      context: ScenarioContext,
      actors: readonly ActorRun[],
    ) => Promise<readonly CheckResult[]>;
  };
}

/**
 * بنودُ الإعلان الواجبة. القائمةُ هي §6 من الأمر الحاكم مكتوبةً كودًا: ما لم
 * يُعلَن هنا لا يُشغَّل.
 */
export const REQUIRED_DECLARATIONS = [
  "id",
  "title",
  "initialState",
  "userInputs",
  "steps",
  "expectedSystemResponse",
  "expectedBusinessOutcome",
  "proves",
  "doesNotProve",
  "metrics",
  "failureConditions",
] as const satisfies readonly (keyof ScenarioDefinition)[];

export interface ContractViolation {
  readonly field: string;
  readonly reason: string;
}

/**
 * يفحص اكتمالَ الإعلان **قبل** التشغيل. ويرفض الفراغَ لا الغيابَ وحده: حقلٌ
 * موجودٌ بقيمة `[]` نقصٌ في الإعلان تماماً كحقلٍ مفقود، والفرقُ بينهما شكليّ.
 */
export function validateScenario(definition: ScenarioDefinition): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];

  for (const field of REQUIRED_DECLARATIONS) {
    const value = definition[field] as unknown;
    if (value === undefined || value === null) {
      violations.push({ field, reason: "غير مُعلَن" });
      continue;
    }
    if (typeof value === "string" && value.trim() === "") {
      violations.push({ field, reason: "نصٌّ فارغ" });
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      violations.push({ field, reason: "قائمةٌ فارغة — الإعلانُ الفارغُ ليس إعلاناً" });
    }
  }

  if (definition.concurrency.count < 1) {
    violations.push({ field: "concurrency.count", reason: "عددُ الفاعلين يجب أن يكون ≥ 1" });
  }
  if (definition.concurrency.rationale.trim() === "") {
    violations.push({
      field: "concurrency.rationale",
      reason: "سببُ اختيار العدد والنمط واجبٌ — الرقمُ بلا سببٍ رقمٌ اعتباطيّ",
    });
  }
  if (definition.idempotency.description.trim() === "") {
    violations.push({ field: "idempotency.description", reason: "غير مُعلَن" });
  }
  for (const mock of definition.mocks) {
    if (mock.doesNotProve.trim() === "") {
      violations.push({
        field: `mocks[${mock.what}].doesNotProve`,
        reason: "مزدوجٌ بلا «ما لا يُثبته» يُقرأ إثباتاً لما لم يُختبَر",
      });
    }
  }

  return violations;
}
