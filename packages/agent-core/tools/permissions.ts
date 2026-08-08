/**
 * الغرض: من يملك استدعاء أي أداة، وبأي مستوى. جدول صلاحيات صريح لا استنتاج.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/tools
 * يُتوقع أن يستخدمه لاحقاً: toolExecutor.ts
 * ملاحظات مستقبلية: عند تعدّد الوكلاء يصير هذا جدولاً في الإعداد لا في الكود،
 *   بمراجعة لكل تغيير. اليوم وكيل واحد وأداة صفر، فالجدول في الكود أوضح وأدقّ.
 *
 * مبدأ الامتياز الأدنى: الوكيل **لا يملك شيئاً بالافتراض**. ما لم يُذكر صراحةً
 * في `AGENT_PERMISSIONS` فهو ممنوع — لا العكس. أي جدول صلاحيات يبدأ من السماح
 * ويستثني المنع ينتهي إلى السماح بما نُسي استثناؤه.
 */

import { SUPPORT_TICKET_AGENT_ID } from "../agents/ids.ts";
import type { ToolLevel } from "../schemas.ts";
import { MAX_ALLOWED_TOOL_LEVEL, toolLevelRank } from "../schemas.ts";

export interface AgentPermission {
  readonly agentId: string;
  /** أقصى مستوى يملكه هذا الوكيل — لا يتجاوز السقف العام بحال. */
  readonly maxLevel: ToolLevel;
  /** معرّفات الأدوات المسموح بها بالاسم. فارغة اليوم لأن السجلّ فارغ. */
  readonly allowedTools: readonly string[];
}

export const AGENT_PERMISSIONS: readonly AgentPermission[] = [
  {
    agentId: SUPPORT_TICKET_AGENT_ID,
    maxLevel: "SUGGEST",
    // فارغة عمداً: **لا أداة واحدة مسجَّلة في هذه المرحلة.** الوكيل يقرأ المعرفة
    // والذاكرة عبر ما يُمرَّر إليه في `AgentContext`، لا عبر أدوات يستدعيها.
    allowedTools: [],
  },
];

export interface PermissionVerdict {
  readonly granted: boolean;
  readonly reason: string;
}

export function checkPermission(
  agentId: string,
  toolId: string,
  requestedLevel: ToolLevel,
): PermissionVerdict {
  const permission = AGENT_PERMISSIONS.find((entry) => entry.agentId === agentId);
  if (permission === undefined) {
    return { granted: false, reason: `لا صلاحيات مسجَّلة للوكيل ${agentId}` };
  }

  // السقف العام يُفحص أولاً: صلاحيةٌ في الجدول لا تعلو على سقف المرحلة حتى لو
  // كُتبت فيه بالخطأ. حاجزان لا واحد.
  if (toolLevelRank(requestedLevel) > toolLevelRank(MAX_ALLOWED_TOOL_LEVEL)) {
    return {
      granted: false,
      reason: `${requestedLevel} فوق السقف العام ${MAX_ALLOWED_TOOL_LEVEL}`,
    };
  }

  if (toolLevelRank(requestedLevel) > toolLevelRank(permission.maxLevel)) {
    return {
      granted: false,
      reason: `${requestedLevel} فوق سقف الوكيل ${agentId} (${permission.maxLevel})`,
    };
  }

  if (!permission.allowedTools.includes(toolId)) {
    return {
      granted: false,
      reason: `الأداة ${toolId} غير مدرجة لصلاحيات ${agentId} — الافتراضي المنع`,
    };
  }

  return { granted: true, reason: `مسموح: ${agentId} → ${toolId} بمستوى ${requestedLevel}` };
}
