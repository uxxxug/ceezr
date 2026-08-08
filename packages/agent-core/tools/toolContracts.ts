/**
 * الغرض: عقد الأداة الواحدة — ما تعلنه عن نفسها قبل أن تُسجَّل، وما تُعيده.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/tools
 * يُتوقع أن يستخدمه لاحقاً: toolRegistry.ts، toolExecutor.ts، permissions.ts
 * ملاحظات مستقبلية: أول أداة `EXECUTE` تحتاج في عقدها حقلين إضافيين لا وجود
 *   لهما اليوم: `rollback` (كيف يُتراجع عمّا فُعل) و`auditSink` (أين يُسجَّل في
 *   `audit_log` بالمشروع الأساسي). أداةٌ تُغيّر حالةً بلا تراجع ولا أثر تدقيق
 *   لا تُسجَّل، مهما كانت نافعة.
 */

import type { ToolLevel } from "../schemas.ts";

export interface ToolInvocation {
  readonly traceId: string;
  readonly agentId: string;
  readonly toolId: string;
  /** وسائط مسطَّحة نصّية — لا كائنات دومين، حفاظاً على اتجاه الاعتماد. */
  readonly arguments: Readonly<Record<string, string>>;
}

export interface ToolOutcome {
  readonly ok: boolean;
  /** ناتج نصّي يُقرأ. الأدوات في هذه المرحلة كلها تُنتج نصّاً لا أثراً. */
  readonly output: string | null;
  readonly reason: string;
}

/**
 * تعريف الأداة. **`level` تُعلَن هنا ويُقارَن بالسقف عند التسجيل** لا عند
 * الاستدعاء وحده: أداةٌ تُعلن `EXECUTE` تُرفض قبل أن تدخل السجلّ أصلاً، فلا
 * تصير موجودةً تنتظر ثغرة.
 */
export interface ToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly level: ToolLevel;
  /** أسماء الوسائط المطلوبة. الغياب = رفض قبل التنفيذ لا خطأ أثناءه. */
  readonly requiredArguments: readonly string[];
  /** **لا ترمي أبداً** — العجز يعود كـ`ok: false`. */
  invoke(invocation: ToolInvocation): Promise<ToolOutcome>;
}
