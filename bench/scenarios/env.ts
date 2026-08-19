/**
 * الغرض: منفذُ «بيئةِ السيناريو» — ما يحتاجه المشغّلُ من بيئةٍ ما، بلا أن يعرف
 *        عمليةً واحدةً كانت أم عنقوداً من عمليات.
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: `harness.ts` (عمليةٌ واحدة)، و`bench/topology/cluster.ts`
 *                   (عنقودٌ متعدّدُ العمليات)، وأيُّ topology لاحقة.
 *
 * ## لماذا انتُزع هذا المنفذ في وحدة 2-6
 *
 * وحدة 2-5 أثبتت ثوابتَ العمل على **عمليةٍ واحدة**. والسؤالُ التالي ليس «هل
 * الثوابتُ صحيحة» بل «هل تبقى صحيحةً عندما يتوزّع النظامُ على عمليات». وأسوأُ
 * طريقةٍ للإجابة أن يُكتب مشغّلٌ ثانٍ وحكمٌ ثانٍ: حينها يصير الفرقُ بين النتيجتين
 * محتمِلاً أن يكون فرقاً في الحاكم لا في المحكوم عليه.
 *
 * فالحكمُ واحدٌ (`decideVerdict`) والعقدُ واحدٌ (`contract.ts`) والمشغّلُ واحد
 * (`runner.ts`)، والمتغيّرُ الوحيدُ هو تنفيذُ هذا المنفذ. وكلُّ بيئةٍ تُعلن
 * topology-ها ومزدوجاتِها ونطاقَ قياسِها بنفسها، فتُطبَع في التقرير ولا تُفترَض.
 */

import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { MockDeclaration, RecordedMessage } from "./contract.ts";

/** ما يقيسه تشغيلٌ على هذه البيئة فعلاً، وما لا يقيسه — §8 من الأمر الحاكم. */
export interface MeasurementScope {
  readonly measures: readonly string[];
  readonly doesNotMeasure: readonly string[];
}

export interface ScenarioEnvironment {
  readonly sql: Sql;
  readonly cityId: string;
  readonly cityCode: string;

  /**
   * يُرسل تحديثاً إلى مسارِ الويبهوك الحقيقي. البيئةُ وحدها تعرف كيف يصل: نداءٌ
   * داخليٌّ في العملية، أم HTTP إلى نسخةٍ من عدّةِ نسخ.
   */
  readonly post: (bot: "driver" | "rider", update: unknown) => Promise<Response>;

  readonly messagesTo: (chatId: number) => readonly RecordedMessage[];
  readonly allMessages: () => readonly RecordedMessage[];
  readonly clearMessages: () => void;
  readonly settingNumber: (key: string) => Promise<number>;
  readonly resetOperational: () => Promise<void>;

  /**
   * نصُّ سجلِّ المقاييس. غيرُ متزامنٍ عن قصد: في العنقودِ يُجمَع من كلِّ نسخةٍ
   * عبر الشبكة، ولو كان متزامناً لأُجبِرت البيئةُ الموزَّعةُ على تخزينٍ مؤقّتٍ
   * قديمٍ فقُرئ عدّادٌ بائتٌ على أنّه الحاضر.
   */
  readonly renderMetrics: () => Promise<string>;

  /** المزدوجاتُ المُعلَنةُ لهذه البيئة — تُنسخ إلى تقريرِ كلِّ سيناريو. */
  readonly mocks: readonly MockDeclaration[];

  /**
   * وصفُ الطبولوجيا سطراً سطراً: كم عملية، ومن يشترك في ماذا، وأين الحالةُ
   * المشتركة. تقريرٌ بلا هذا الوصفِ لا يمكن إعادةُ إنتاجِه ولا نقدُه.
   */
  readonly topology: readonly string[];

  readonly measurementScope: MeasurementScope;
}
