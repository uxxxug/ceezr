/**
 * الغرض: سجلّ الأدوات المتاحة للوكلاء. **فارغ عملياً في هذه المرحلة.**
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/tools
 * يُتوقع أن يستخدمه لاحقاً: toolExecutor.ts
 * ملاحظات مستقبلية: أول أداة تُسجَّل ستكون بمستوى `READ` (قراءة حالة اشتراك مثلاً)
 *   وليس `EXECUTE`، وستحتاج أمراً صريحاً يفتح البند.
 *
 * ⚠️ ═══ لا أداة EXECUTE واحدة مسجَّلة، ولا يمكن تسجيلها ═══
 *
 * `registerTool` **ترفض برمجياً** أي أداة تُعلن مستوى فوق `MAX_ALLOWED_TOOL_LEVEL`.
 * أي أن المنع ليس في كون القائمة فارغة اليوم — القائمة تمتلئ يوماً — بل في أن
 * **باب التسجيل نفسه مغلق** أمام مستوى التنفيذ. من أضاف أداةً تنفيذية بحسن نيّة
 * يجدها مرفوضة عند التسجيل، ويجد اختبار وحدة يُثبت الرفض.
 *
 * ولماذا سجلٌّ فارغ أصلاً؟ لأن الغياب التامّ يعني أن أول أداة ستُستدعى يوماً ما
 * ستُستدعى بلا مسار مراجعة ولا صلاحيات ولا حارس — تُكتب في الوكيل مباشرةً لأنها
 * «أبسط». المسار موجود من اليوم، فأول أداة تمرّ منه لا حوله.
 */

import { MAX_ALLOWED_TOOL_LEVEL, toolLevelRank } from "../schemas.ts";
import type { ToolDefinition } from "./toolContracts.ts";

export interface ToolRegistry {
  register(tool: ToolDefinition): { readonly registered: boolean; readonly reason: string };
  get(toolId: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
  size(): number;
}

export function createToolRegistry(initial: readonly ToolDefinition[] = []): ToolRegistry {
  const tools = new Map<string, ToolDefinition>();

  const registry: ToolRegistry = {
    register: (tool) => {
      if (tool.id.trim() === "") {
        return { registered: false, reason: "أداة بلا معرّف" };
      }
      if (tools.has(tool.id)) {
        return { registered: false, reason: `الأداة ${tool.id} مسجَّلة أصلاً` };
      }
      if (toolLevelRank(tool.level) > toolLevelRank(MAX_ALLOWED_TOOL_LEVEL)) {
        return {
          registered: false,
          reason:
            `مرفوضة: الأداة ${tool.id} تُعلن ${tool.level} والسقف ${MAX_ALLOWED_TOOL_LEVEL}. ` +
            "لا تُسجَّل أداة تنفيذ في هذه المرحلة.",
        };
      }
      tools.set(tool.id, tool);
      return { registered: true, reason: `سُجّلت ${tool.id} بمستوى ${tool.level}` };
    },
    get: (toolId) => tools.get(toolId),
    list: () => [...tools.values()],
    size: () => tools.size,
  };

  for (const tool of initial) registry.register(tool);
  return registry;
}

/**
 * السجلّ الافتراضي: **فارغ**. هذا هو ما يُمرَّر للمنفّذ في المسار الحقيقي.
 * قائمة فارغة صريحة بتعليق يشرحها، لا غياب ملف يُفسَّر على أنه سهو.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  return createToolRegistry([]);
}
