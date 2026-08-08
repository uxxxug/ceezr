/**
 * الغرض: المسار **الوحيد** الذي تُستدعى منه أي أداة. لا يوجد طريق آخر.
 * الحالة: منفّذ فعلياً — القسم 3، البند ب.6.
 * ينتمي إلى: packages/agent-core/tools
 * يُتوقع أن يستخدمه لاحقاً: الوكلاء حين تُسجَّل أدوات (لا وكيل يستدعيه اليوم)
 * ملاحظات مستقبلية: عند أول أداة `EXECUTE` يُضاف هنا: قفل تزامني لكل مورد،
 *   ومحاولة واحدة لا إعادة محاولة (إعادة المحاولة على فعلٍ غير مُتماثل تُكرّر
 *   الفعل)، وكتابة أثر في `audit_log` بالمشروع الأساسي قبل الفعل لا بعده.
 *
 * ═══ ثلاثة حواجز لا حاجز ═══
 *
 * كل استدعاء يمرّ على: (1) وجود الأداة في السجلّ — وهو فارغ، (2) صلاحية الوكيل
 * في `permissions.ts` — وقوائمها فارغة، (3) `executionGuard` — ويرفض كل ما فوق
 * `SUGGEST`. تعطيل واحد منها بالسهو لا يفتح الباب، وهذا هو الغرض من تكرارها.
 *
 * عملياً: **لا استدعاء أداة واحد يقع في هذه المرحلة**، لأن السجلّ فارغ فيسقط
 * الطلب عند الحاجز الأول.
 */

import { guarded } from "../fallback.ts";
import { inspectExecution } from "../guardrails/executionGuard.ts";
import { checkPermission } from "./permissions.ts";
import type { ToolInvocation, ToolOutcome } from "./toolContracts.ts";
import type { ToolRegistry } from "./toolRegistry.ts";

export interface ToolExecutor {
  execute(invocation: ToolInvocation, confidence: number): Promise<ToolOutcome>;
}

export function createToolExecutor(registry: ToolRegistry): ToolExecutor {
  return {
    execute: async (invocation, confidence) => {
      // ── الحاجز الأول: وجود الأداة ─────────────────────────────────────────
      const tool = registry.get(invocation.toolId);
      if (tool === undefined) {
        return {
          ok: false,
          output: null,
          reason: `الأداة ${invocation.toolId} غير مسجَّلة — سجلّ الأدوات فارغ في هذه المرحلة`,
        };
      }

      // ── الحاجز الثاني: صلاحية الوكيل ──────────────────────────────────────
      const permission = checkPermission(invocation.agentId, tool.id, tool.level);
      if (!permission.granted) {
        return { ok: false, output: null, reason: permission.reason };
      }

      // ── الحاجز الثالث: حارس التنفيذ ───────────────────────────────────────
      const verdict = inspectExecution({
        traceId: invocation.traceId,
        toolId: tool.id,
        requestedLevel: tool.level,
        agentId: invocation.agentId,
        confidence,
      });
      if (!verdict.allowed) {
        return { ok: false, output: null, reason: verdict.reason };
      }

      const missing = tool.requiredArguments.filter(
        (name) => (invocation.arguments[name] ?? "").trim() === "",
      );
      if (missing.length > 0) {
        // الرفض قبل الاستدعاء لا خطأٌ أثناءه: أداةٌ تُستدعى بوسائط ناقصة قد تُحدث
        // نصف أثرٍ قبل أن تكتشف النقص، ونصف الأثر أسوأ من لا أثر.
        return { ok: false, output: null, reason: `وسائط ناقصة: ${missing.join("، ")}` };
      }

      return guarded(() => tool.invoke(invocation), {
        ok: false,
        output: null,
        reason: `عطل أثناء استدعاء ${tool.id}`,
      });
    },
  };
}
