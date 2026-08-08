/**
 * الغرض: الحاجز الأخير أمام أي تنفيذ. لا شيء يُغيّر حالة المنصّة يمرّ من دون
 *   أن يقف هنا أولاً.
 * الحالة: منفّذ فعلياً، وهو **يرفض كل تنفيذ اليوم** — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/guardrails
 * يُتوقع أن يستخدمه لاحقاً: tools/toolExecutor.ts
 * ملاحظات مستقبلية: عند السماح بأداة `EXECUTE` واحدة — بأمر صريح — يُضاف هنا:
 *   مفتاح مستقلّ لكل أداة، وسجلّ تدقيق في `audit_log` بالمشروع الأساسي لا في
 *   ملف محلي، وإمكان تراجع (rollback) معرَّفة لكل أداة قبل تسجيلها.
 *
 * ═══ لماذا حارسٌ يرفض كل شيء ليس عبثاً ═══
 *
 * لأن البديل ألّا يكون هناك حارس، فيصير السماح بأوّل أداة تنفيذ يوماً ما هو
 * **نفسه** لحظة كتابة الحارس — أي أن يُكتب تحت ضغط ميزة مطلوبة، ويُختبر على
 * عجل، ويُراجَع وقد صار في الطريق الحرج. الحارس مكتوبٌ اليوم ومُختبَرٌ اليوم،
 * فلا يبقى يوم السماح إلا **قلب قيمة واحدة** تحت مراجعة صريحة.
 *
 * والرفض هنا **كودٌ يمنع فعلاً**، لا اتفاق شفهي ولا تعليق: لا يوجد في هذه الطبقة
 * مسارٌ واحد يصل إلى فعلٍ يغيّر حالة المنصّة، لأن `toolExecutor` لا ينفّذ إلا ما
 * أجازه هذا الملف، وهذا الملف يقارن بـ`MAX_ALLOWED_TOOL_LEVEL` وهي `SUGGEST`.
 */

import type { ToolLevel } from "../schemas.ts";
import { MAX_ALLOWED_TOOL_LEVEL, toolLevelRank } from "../schemas.ts";

export interface ExecutionRequest {
  readonly traceId: string;
  readonly toolId: string;
  readonly requestedLevel: ToolLevel;
  readonly agentId: string;
  readonly confidence: number;
}

export interface ExecutionVerdict {
  readonly allowed: boolean;
  readonly reason: string;
  /** المستوى المسموح به فعلاً — لا يتجاوز السقف أبداً. */
  readonly effectiveLevel: ToolLevel;
}

/**
 * يفحص طلب تنفيذ. **`EXECUTE` مرفوض دائماً** ما دام السقف `SUGGEST`، ولا يوجد
 * تجاوز ولا استثناء ولا «وضع مدير»: مسارُ تجاوزٍ موجودٌ هو مسارُ تجاوزٍ يُستعمل.
 */
export function inspectExecution(request: ExecutionRequest): ExecutionVerdict {
  const requested = toolLevelRank(request.requestedLevel);
  const ceiling = toolLevelRank(MAX_ALLOWED_TOOL_LEVEL);

  if (requested > ceiling) {
    return {
      allowed: false,
      reason:
        `مرفوض: الأداة ${request.toolId} طُلبت بمستوى ${request.requestedLevel} ` +
        `والسقف المسموح ${MAX_ALLOWED_TOOL_LEVEL}. لا تنفيذ تلقائي في هذه المرحلة.`,
      effectiveLevel: "NONE",
    };
  }

  // ثقة خارج المدى ليست «ثقة منخفضة» بل **مُدخَل معطوب**، وحارسٌ يتساهل مع مُدخَل
  // معطوب هو حارسٌ يُخترَق بمُدخَلٍ معطوب.
  if (!Number.isFinite(request.confidence) || request.confidence < 0 || request.confidence > 1) {
    return {
      allowed: false,
      reason: `مرفوض: قيمة ثقة غير صالحة (${String(request.confidence)})`,
      effectiveLevel: "NONE",
    };
  }

  return {
    allowed: true,
    reason: `مسموح بمستوى ${request.requestedLevel}`,
    effectiveLevel: request.requestedLevel,
  };
}

/**
 * سؤال مباشر يُستعمل في الاختبارات والتوثيق: **هل يوجد أي مسار تنفيذ مفتوح؟**
 * الجواب اليوم `false`، ووجود هذه الدالة يجعله جواباً **مُختبَراً** لا مزعوماً.
 */
export function isExecutionEnabled(): boolean {
  return toolLevelRank(MAX_ALLOWED_TOOL_LEVEL) >= toolLevelRank("EXECUTE");
}
