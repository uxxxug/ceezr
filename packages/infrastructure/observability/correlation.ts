/**
 * الغرض: **سياقُ الارتباطِ المحمولُ** — موضعُ الحقيقةِ الواحدُ لمعرِّفِ وحدةِ
 *   العملِ (`request-id`) ولشكلِه، محمولاً عبرَ `AsyncLocalStorage` من الحافةِ
 *   إلى كلِّ ما تُنادِيه الطبقاتُ بلا تمريرِ وسيطٍ في كلِّ توقيعٍ. البند `F8-01`
 *   (`OPS-002`).
 * الحالة: منفّذ فعلياً — البند `F8-01`، الرجلُ الأولى (الحافةُ ⇒ التطبيقُ ⇒ السجلُّ).
 * ينتمي إلى: packages/infrastructure/observability
 * يُستخدم من: `apps/gateway/src/observability/request-id.ts` (المولِّدُ في الحافةِ) ·
 *   `packages/infrastructure/observability/structured-log.ts` (إلحاقُ المعرِّفِ
 *   بكلِّ سطرٍ) · `packages/infrastructure/db/client.ts` (`withRequestContext`
 *   ينقلُه إلى القاعدةِ) · `apps/workers/src/runner.ts` (سياقُ شوطِ المهمّةِ).
 * الحاكم: `ADR 0129` · `ADR 0043` (الرأسُ الوارِدُ من العميلِ لا يُقرأُ) · القاعدة 0.6
 *   (أقلُّ مصادرِ حقيقةٍ مكرَّرةٍ: الصيغةُ ههنا وحدَها، ويستوردُها كلُّ مَن يحكمُ بها).
 * ولماذا في `infrastructure` لا في `shared`: هذا الملفُّ يستوردُ `node:async_hooks`،
 *   و`packages/shared` تُبنى في حزمةِ المتصفِّحِ (يستوردُها التطبيقُ المصغَّرُ) فلا
 *   يجوزُ أن يدخلَها استيرادُ `node:` — وحدةُ الحقيقةِ لا تُشترى بتلويثِ حزمةِ
 *   العميلِ. وكلُّ مَن يحكمُ بهذه الصيغةِ خادميٌّ (البوّابةُ · العاملُ · الحواجزُ).
 * ملاحظات مستقبلية: **OpenTelemetry بحرفِه ليسَ ههنا**: لا `traceparent` يُقرأُ ولا
 *   يُكتَبُ، ولا حزمةَ SDK، ولا مُجمِّعَ — ذاكَ محجوبٌ بـ`DEC-17` (موردٌ لا شيفرةٌ).
 *   وحينَ يُحسَمُ، هذا الملفُّ **جسرُ الوصلِ** لا موضعٌ يُلغى: يُضافُ إليه استخراجُ
 *   `traceId`/`spanId` ويبقى `requestId` أثراً في الصفوفِ.
 *
 * ولماذا `AsyncLocalStorage` لا وسيطٌ في كلِّ توقيعٍ: تمريرُ المعرِّفِ يدوياً يعني
 * أنَّ أوّلَ دالّةٍ يكتبُها أحدٌ في المستقبلِ تفقدُه، ولا أحدَ يلاحظُ حتّى يُطلَبَ
 * أثرٌ في الإنتاجِ فلا يُوجَدُ. والسياقُ المحمولُ يجعلُ الارتباطَ **الافتراضَ**
 * لا التزاماً يُتذَكَّرُ.
 *
 * وثلاثةُ حدودٍ مقصودةٍ مكتوبةٍ ههنا:
 *   ــ **الغيابُ غيابٌ ولا يُلفَّقُ**: `currentRequestId()` تُرجِعُ `undefined` حينَ
 *      لا سياقَ، ولا تولِّدُ معرِّفاً عندَ القراءةِ. صفٌّ كُتِبَ بلا سياقٍ يحملُ
 *      `null` في القاعدةِ — «لم يُقَسْ» أصدقُ من معرِّفٍ يُوهِمُ ربطاً.
 *   ــ **معرِّفٌ لا يطابقُ الصيغةَ لا يدخلُ السياقَ**: يُرَدُّ عندَ البناءِ، فلا
 *      يُبحَثُ به ولا يُكتَبُ في صفٍّ (والقاعدةُ تردُّه ثانياً بقيدِ `check`).
 *   ــ **معرِّفُ شوطِ المهمّةِ مُميَّزٌ بلاحقةٍ لا مُشتَبِهٌ بمعرِّفِ طلبٍ**: فمن
 *      قرأَ `job-…` في صفٍّ عَلِمَ أنَّ الكاتبَ عاملٌ لا طلبُ مستخدمٍ.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * صيغةُ المعرِّفِ — **موضعُ الحقيقةِ الواحدُ في المستودعِ كلِّه**: حروفٌ وأرقامٌ
 * وشُرَطٌ، من 8 إلى 64 محرفاً. أوسعُ من UUID عن قصدٍ (ULID أو معرِّفُ تتبُّعٍ
 * لاحقٌ يمرُّ)، وأضيقُ من «أيُّ نصٍّ»: المعرِّفُ يُسجَّلُ ويُبحَثُ به ويُكتَبُ في
 * صفٍّ، ومحرفُ سطرٍ فيه يفسدُ كلَّ سجلٍّ يُبنى عليه.
 */
export const CORRELATION_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/** لاحقةُ معرِّفِ شوطِ المهمّةِ — تُميِّزُ كاتبَ الصفِّ بلا عمودٍ ثانٍ. */
export const WORKER_CORRELATION_PREFIX = "job-";

/**
 * مدخلُ العملِ: من أينَ بدأَت وحدةُ العملِ. يُسجَّلُ في السطرِ ولا يُكتَبُ في
 * القاعدةِ (العمودُ معرِّفٌ لا تصنيفٌ؛ واللاحقةُ تكفي لتمييزِ العاملِ).
 */
export const CORRELATION_ENTRIES = ["gateway", "worker"] as const;

export type CorrelationEntry = (typeof CORRELATION_ENTRIES)[number];

export interface Correlation {
  readonly requestId: string;
  readonly entry: CorrelationEntry;
  /**
   * معرِّفُ ما سبَّبَ هذه الوحدةَ حينَ تُستعادُ عبرَ الطابورِ: العاملُ يحجزُ صفّاً
   * كتبَه طلبٌ، فيُسجَّلُ معرِّفُ الطلبِ ههنا ويبقى `requestId` هوَ الجاري.
   * غيابُه يعني «لا سلسلةَ معلومةً» لا «لا سلسلةَ».
   */
  readonly causationId?: string;
}

const storage = new AsyncLocalStorage<Correlation>();

/** يولِّدُ معرِّفَ وحدةِ عملٍ في الحافةِ. مصدرٌ واحدٌ: `crypto.randomUUID`. */
export function newCorrelationId(): string {
  return randomUUID();
}

/** يولِّدُ معرِّفَ شوطِ مهمّةٍ، موسوماً بلاحقتِه فلا يُشتبَهُ بطلبِ مستخدمٍ. */
export function newWorkerCorrelationId(): string {
  return `${WORKER_CORRELATION_PREFIX}${randomUUID()}`;
}

/** هل يطابقُ النصُّ صيغةَ المعرِّفِ. */
export function isCorrelationId(candidate: unknown): candidate is string {
  return typeof candidate === "string" && CORRELATION_ID_SHAPE.test(candidate);
}

/**
 * يقرأُ معرِّفاً من مصدرٍ غيرِ موثوقٍ (صفُّ طابورٍ · حمولةُ مهمّةٍ) فيُرجِعُ
 * `null` إن لم يطابقْ الصيغةَ. **ولا يستبدلُه بمولَّدٍ**: مصدرُ السلسلةِ إن
 * فسدَ فالسلسلةُ مجهولةٌ، وتوليدُ معرِّفٍ ههنا يُوهِمُ سلسلةً لا وجودَ لها.
 */
export function readCorrelationId(candidate: unknown): string | null {
  return isCorrelationId(candidate) ? candidate : null;
}

/**
 * يُنشئُ سياقاً بعدَ التحقُّقِ من الشكلِ، ويُرجِعُ `null` لِمَا لا يطابقُ. لا
 * يرمي: مسارُ الطلبِ لا يجوزُ أن يسقطَ بسببِ معرِّفٍ، والبديلُ عن سياقٍ فاسدٍ
 * **لا سياقَ** لا سياقٌ مُلفَّقٌ.
 */
export function createCorrelation(input: {
  readonly requestId: string;
  readonly entry: CorrelationEntry;
  readonly causationId?: string;
}): Correlation | null {
  if (!isCorrelationId(input.requestId)) return null;
  const causationId = readCorrelationId(input.causationId) ?? undefined;
  return causationId === undefined
    ? { requestId: input.requestId, entry: input.entry }
    : { requestId: input.requestId, entry: input.entry, causationId };
}

/** يُشغِّلُ الدالّةَ داخلَ السياقِ. يُستخدَمُ في الحافةِ وفي شوطِ المهمّةِ. */
export function runWithCorrelation<T>(correlation: Correlation, run: () => T): T {
  return storage.run(correlation, run);
}

/**
 * يُشغِّلُ الدالّةَ داخلَ سياقٍ إن صحَّ المعرِّفُ، **وبلا سياقٍ إن لم يصحَّ** —
 * فلا يسقطُ العملُ ولا يُلفَّقُ ارتباطٌ.
 */
export function runWithCorrelationId<T>(
  input: {
    readonly requestId: unknown;
    readonly entry: CorrelationEntry;
    readonly causationId?: unknown;
  },
  run: () => T,
): T {
  const requestId = readCorrelationId(input.requestId);
  if (requestId === null) return run();
  const causationId = readCorrelationId(input.causationId);
  const correlation = createCorrelation(
    causationId === null
      ? { requestId, entry: input.entry }
      : { requestId, entry: input.entry, causationId },
  );
  return correlation === null ? run() : runWithCorrelation(correlation, run);
}

/** السياقُ الجاري إن وُجِدَ. `undefined` تعني «لا سياقَ» لا «سياقٌ فارغٌ». */
export function currentCorrelation(): Correlation | undefined {
  return storage.getStore();
}

/** معرِّفُ الوحدةِ الجارية إن وُجِدَ سياقٌ. لا يولِّدُ عندَ الغيابِ. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
