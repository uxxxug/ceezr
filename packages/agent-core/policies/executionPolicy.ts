/**
 * الغرض: تقرير الصلاحية النهائية الممنوحة لأي قرار — وهي اليوم `SUGGEST` سقفاً
 *   لا يُتجاوز بحال.
 * الحالة: منفّذ فعلياً، **يرفض برمجياً كل ما فوق SUGGEST** — القسم 3، ب.6.
 * ينتمي إلى: packages/agent-core/policies
 * يُتوقع أن يستخدمه لاحقاً: core.ts، وtools/toolExecutor.ts
 * ملاحظات مستقبلية: رفع السقف يوماً ما يجب أن يكون **تعديل سطر واحد** في
 *   `schemas.ts` (`MAX_ALLOWED_TOOL_LEVEL`) يظهر في المراجعة، لا رقماً منثوراً
 *   في خمسة ملفات يُرفع في أحدها ويُنسى في الباقي.
 *
 * ⚠️ ═══ هذا كودٌ يمنع، لا اتفاق شفهي ═══
 *
 * الفرق جوهري: «اتّفقنا ألّا ينفّذ الوكيل شيئاً» جملةٌ تُنسى بعد ثلاثة أشهر وخمسة
 * مساهمين. `enforceExecutionPolicy` **تُعيد `NONE` لكل طلب فوق السقف**، وهناك
 * اختبار وحدة يُثبت ذلك، وهناك `executionGuard` يعيد الفحص عند نقطة التنفيذ
 * نفسها. **حاجزان لا واحد**: من يُعدّل أحدهما بالسهو يصطدم بالثاني.
 */

import type { AgentProposal, ToolLevel } from "../schemas.ts";
import { MAX_ALLOWED_TOOL_LEVEL, toolLevelRank } from "../schemas.ts";

export interface ExecutionPolicyVerdict {
  readonly allowed: boolean;
  /** ما يُمنَح فعلاً. لا يتجاوز `MAX_ALLOWED_TOOL_LEVEL` في أي مسار. */
  readonly grantedLevel: ToolLevel;
  readonly reason: string;
  /** `true` حين طلب الوكيل أعلى ممّا يُمنح — إشارة تستحقّ التسجيل والمراجعة. */
  readonly violation: boolean;
}

/**
 * **الرفض لا التخفيض.** طلبٌ فوق السقف يُرفض ويُوسم انتهاكاً، ولا يُخفَّض بصمت:
 * التخفيض الصامت يُنتج وكيلاً يطلب `EXECUTE` في كل حدث ويُخفَّض في كل حدث، فلا
 * يظهر الخلل في أي مقياس — حتى يُرفع السقف يوماً فيُنفَّذ فوراً كل ما كان يُطلب.
 */
export function enforceExecutionPolicy(proposal: AgentProposal): ExecutionPolicyVerdict {
  const requested = toolLevelRank(proposal.requestedToolLevel);
  const ceiling = toolLevelRank(MAX_ALLOWED_TOOL_LEVEL);

  if (requested > ceiling) {
    return {
      allowed: false,
      grantedLevel: "NONE",
      reason:
        `الوكيل ${proposal.agentId} طلب ${proposal.requestedToolLevel} ` +
        `والسقف ${MAX_ALLOWED_TOOL_LEVEL} — مرفوض، لا تنفيذ تلقائي في هذه المرحلة.`,
      violation: true,
    };
  }

  return {
    allowed: true,
    grantedLevel: proposal.requestedToolLevel,
    reason: `مُنح ${proposal.requestedToolLevel} (السقف ${MAX_ALLOWED_TOOL_LEVEL})`,
    violation: false,
  };
}

/** يُستعمل في التوثيق والاختبار: السقف الحالي مقروءاً من مصدره الوحيد. */
export function currentCeiling(): ToolLevel {
  return MAX_ALLOWED_TOOL_LEVEL;
}
