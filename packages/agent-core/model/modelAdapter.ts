/**
 * الغرض: العقد الذي يلتزم به أي مزوّد نموذج لغوي يُوصَل مستقبلاً، وما يلزمه من
 *   حدود تشغيلية ومحاسبة كلفة.
 * الحالة: **عقد فقط — لا تنفيذ متّصل بشبكة.** القسم 3، البند ب.7.
 * ينتمي إلى: packages/agent-core/model
 * يُتوقع أن يستخدمه لاحقاً: nullModel.ts اليوم، ومزوّد حقيقي بأمر صريح لاحقاً
 * ملاحظات مستقبلية: أوّل تنفيذ حقيقي يحتاج — قبل كتابته — قراراً معلناً عن:
 *   المزوّد، وسقف الإنفاق الشهري، وما يُرسَل من نصّ المستخدم وما يُحجَب. هذه
 *   قرارات مالك مشروع لا قرارات مهندس.
 *
 * ⚠️ **لا مفتاح API واحد في هذا المستودع، ولا نداء شبكي واحد من هذا المجلّد.**
 * التنفيذ الوحيد هو `nullModel.ts`. وجود العقد ليس إذناً بوصله.
 *
 * ═══ لماذا حقول الحدود والكلفة موجودة اليوم وهي غير مقروءة ═══
 *
 * لأن إضافتها **بعد** وجود مستدعين تُجبر على تعديل كل موضع استدعاء — وهذا بالضبط
 * ما يجعل الفرق تؤجّل ضبط الميزانية والمهلة إلى ما بعد أوّل فاتورة مفاجئة. الحقل
 * الموجود من اليوم يُملأ حين يأتي وقته بلا لمس شيء آخر.
 *
 * `ModelRequest`/`ModelResponse`/`ModelAdapter` معرَّفة في `schemas.ts` — مصدر
 * واحد للعقود لا اثنان. ما هنا هو **توسعة** فوقها لا نسخة موازية منها.
 */

import type { ModelAdapter, ModelRequest, ModelResponse } from "../schemas.ts";

export type { ModelAdapter, ModelRequest, ModelResponse };

/**
 * وصف مزوّد كما يراه موجّه النماذج المستقبلي. غير مقروء اليوم — لا موجّه ولا مزوّد.
 * يُقرأ يوم يوجد أكثر من مزوّد فيصير الاختيار بينهما قراراً يحتاج بيانات.
 */
export interface ProviderProfile {
  readonly provider: string;
  readonly model: string;
  /** كلفة تقديرية لكل ألف توكِن مُدخَل/مُخرَج، بوحدات الكلفة نفسها في `ModelResponse`. */
  readonly inputCostPerKilo: number;
  readonly outputCostPerKilo: number;
  /** أقصى حساسية محتوى يُقبل إرسالها لهذا المزوّد. */
  readonly maxSensitivity: "low" | "high";
  readonly defaultTimeoutMs: number;
}

/** ما يُسجَّل بعد كل نداء. أساس محاسبة الكلفة يوم تصير هناك كلفة تُحاسَب. */
export interface ModelCallRecord {
  readonly traceId: string;
  readonly purpose: string;
  readonly provider: string | null;
  readonly available: boolean;
  readonly costUnits: number | null;
  readonly latencyMs: number;
  readonly recordedAt: string;
}

/**
 * موجّه النماذج المستقبلي: يختار مزوّداً بحسب الغرض والحساسية والميزانية.
 * **لا تنفيذ له اليوم** — `nullModel` يُمرَّر مباشرةً للوكيل بلا موجّه بينهما،
 * لأن موجِّهاً بين مستدعٍ واحد ومزوّدٍ واحد تجريدٌ لا يخدم شيئاً.
 */
export type ModelRouter = (request: ModelRequest) => ModelAdapter;

/**
 * حارس ميزانية مستقبلي: يُسأل **قبل** الإرسال لا بعده. الرفض المسبق هو الفرق بين
 * سقف إنفاق حقيقي وتقريرٍ يُخبرك كم صرفت بعد أن صرفت.
 */
export type BudgetGuard = (request: ModelRequest) => {
  readonly allowed: boolean;
  readonly reason: string;
};

/**
 * استجابة «لا نموذج» الموحَّدة. تستعملها كل مسارات العجز — عدم اتصال، أو تجاوز
 * مهلة، أو رفض ميزانية — فلا يختلف شكل العجز باختلاف سببه.
 */
export function unavailableResponse(latencyMs = 0): ModelResponse {
  return { available: false, text: null, provider: null, costUnits: null, latencyMs };
}
