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
import type { DurableUpdateIntake, TelegramUpdateEnqueuer } from "../routes/update-intake.ts";

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
    ...handler,
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

/**
 * يسجّل التحديثات المتكرّرة **عند موضعِ القرارِ الحقيقيِّ** بعدَ انتقالِه إلى القاعدةِ
 * (ADR 0054 §٣-أ). ولولا هذا اللافُّ لبقي `waslah_telegram_webhook_duplicates_total`
 * ساكناً بعدَ الإصلاحِ فيُقرأ صفرُه على أنّه «لا تكرارَ» وهو في الحقيقةِ «لا قياسَ».
 *
 * و«قيدَ المعالجةِ» يُحتسب مكرَّراً في العدّادِ عن قصدٍ: كلاهما تسليمٌ ثانٍ لم يُنتج
 * عملاً ثانياً، وهو ما يقيسه العدّادُ. والتمييزُ بينهما في السجلِّ لا في المقياسِ،
 * حفاظاً على `cardinality` وعلى ما تعنيه السلسلةُ الزمنيةُ قبلَ الإصلاحِ وبعدَه.
 */
export function instrumentUpdateIntake(
  intake: DurableUpdateIntake & TelegramUpdateEnqueuer,
  metrics: OperationalMetrics,
): DurableUpdateIntake & TelegramUpdateEnqueuer {
  return {
    ...intake,
    claimAndEnqueue: async (bot, updateId, payload) => {
      const outcome = await intake.claimAndEnqueue(bot, updateId, payload);
      const isRepeat = outcome === "duplicate" || outcome === "in_progress";
      if (isRepeat && (bot === "driver" || bot === "rider")) metrics.recordTelegramDuplicate(bot);
      return outcome;
    },
    claim: async (bot, updateId) => {
      const claim = await intake.claim(bot, updateId);
      const isRepeat = claim.outcome === "duplicate" || claim.outcome === "in_progress";
      if (isRepeat && (bot === "driver" || bot === "rider")) metrics.recordTelegramDuplicate(bot);
      return claim;
    },
  };
}

/** يسجّل التحديثات المتكررة في مسارِ التدهورِ المُعلَنِ حينَ لا منفَذَ صامدَ. */
export function instrumentUpdateDeduplicator(
  dedup: UpdateDeduplicator,
  metrics: OperationalMetrics,
): UpdateDeduplicator {
  return {
    ...dedup,
    admit: (bot, updateId) => {
      const admitted = dedup.admit(bot, updateId);
      if (!admitted && (bot === "driver" || bot === "rider")) metrics.recordTelegramDuplicate(bot);
      return admitted;
    },
    size: () => dedup.size(),
  };
}

export type { BotKind };
