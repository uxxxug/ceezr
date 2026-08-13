/**
 * الغرض: محوّل غير متطفل يلتقط نتيجة وزمن معالجة تحديثات Telegram وقرار التكرار
 *   من العقود الحالية، من غير تعديل منطق مسار الويبهوك.
 * الحالة: منفّذ فعلياً — يحتاج تركيبه في index.ts كما في WIRING_METRICS.md.
 * ينتمي إلى: apps/gateway/src/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts.
 * ملاحظات مستقبلية: لا تُسجّل update_id أو actorId في المقاييس لتجنب cardinality وحساسية البيانات.
 */

import type { OperationalMetrics } from "../../../../packages/infrastructure/observability/index.ts";
import type { BotKind, UpdateHandler } from "../routes/telegram-webhook.ts";
import type { UpdateDeduplicator } from "../routes/update-dedup.ts";

export interface TelegramInstrumentationOptions {
  readonly nowMs?: () => number;
  readonly log?: (message: string, fields: Record<string, unknown>) => void;
}

/** يسجّل كل تحديث وصل إلى المعالج، ويحوّل الاستثناء غير المتوقع إلى فشل متحكم به ومسجّل. */
export function instrumentTelegramHandler(
  handler: UpdateHandler,
  metrics: OperationalMetrics,
  options: TelegramInstrumentationOptions = {},
): UpdateHandler {
  const nowMs = options.nowMs ?? Date.now;
  return {
    handle: async (bot, update) => {
      const startedAt = nowMs();
      try {
        const handled = await handler.handle(bot, update);
        metrics.recordTelegramUpdate(bot, handled ? "handled" : "failed", nowMs() - startedAt);
        return handled;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        metrics.recordTelegramUpdate(bot, "failed", nowMs() - startedAt);
        options.log?.("telegram.webhook.unexpected_error", {
          component: "telegram_webhook",
          bot,
          error: detail,
        });
        return false;
      }
    },
  };
}

/** يسجّل التحديثات المتكررة عند موضع القرار الحقيقي قبل حد المعدّل ومعالجة البوت. */
export function instrumentUpdateDeduplicator(
  dedup: UpdateDeduplicator,
  metrics: OperationalMetrics,
): UpdateDeduplicator {
  return {
    admit: (bot, updateId) => {
      const admitted = dedup.admit(bot, updateId);
      if (!admitted && (bot === "driver" || bot === "rider")) metrics.recordTelegramDuplicate(bot);
      return admitted;
    },
    size: () => dedup.size(),
  };
}

export type { BotKind };
