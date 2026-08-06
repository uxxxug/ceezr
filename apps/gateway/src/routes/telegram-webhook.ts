/**
 * الغرض: استقبال تحديثات تلغرام والتحقّق من هوية المُرسِل قبل أي معالجة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. التحقّق الأمني والاستجابة حقيقيان،
 *   ومعالجة التحديث نفسها تُمرَّر إلى منفذ يُوصَل بـ grammY عند وصول رموز البوتين.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts
 * ملاحظات مستقبلية: تلغرام يعيد إرسال التحديث إن لم نُجب 200 سريعاً، فالمعالجة الثقيلة تُؤجَّل لـ workers.
 */

import { Hono } from "hono";

/** ترويسة تلغرام القياسية للسرّ المشترك. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export type BotKind = "driver" | "rider";

export interface UpdateHandler {
  /** يعالج تحديثاً واحداً. يعيد false إن تعذّرت المعالجة، ولا يرمي استثناءً. */
  handle(bot: BotKind, update: unknown): Promise<boolean>;
}

export interface WebhookDependencies {
  readonly webhookSecret: string;
  readonly handler: UpdateHandler;
  /** تسجيل الأحداث — يُمرَّر ليكون صامتاً في الاختبار. */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * مقارنة زمن ثابت للسرّ، فلا يُستنتج طوله ولا محتواه من زمن الاستجابة.
 * لا تعتمد على مكتبة خارجية لتبقى الحزمة بلا تبعيات إضافية.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  let diff = providedBytes.length ^ expectedBytes.length;
  const length = Math.max(providedBytes.length, expectedBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (providedBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }
  return diff === 0;
}

function isBotKind(value: string): value is BotKind {
  return value === "driver" || value === "rider";
}

export function createTelegramWebhookRoutes(deps: WebhookDependencies): Hono {
  const app = new Hono();

  app.post("/webhook/telegram/:bot", async (c) => {
    const bot = c.req.param("bot");
    if (!isBotKind(bot)) {
      return c.json({ ok: false, error: "UNKNOWN_BOT" }, 404);
    }

    const provided = c.req.header(TELEGRAM_SECRET_HEADER) ?? "";
    if (!secretsMatch(provided, deps.webhookSecret)) {
      deps.log?.("رفض تحديث بسرّ غير مطابق", { bot });
      return c.json({ ok: false, error: "INVALID_SECRET" }, 401);
    }

    let update: unknown;
    try {
      update = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    if (typeof update !== "object" || update === null || Array.isArray(update)) {
      return c.json({ ok: false, error: "INVALID_UPDATE" }, 400);
    }

    const handled = await deps.handler.handle(bot, update);
    if (!handled) {
      deps.log?.("تعذّرت معالجة التحديث", { bot });
      // نُجيب 200 حتى لا يُعيد تلغرام الإرسال بلا نهاية؛ الفشل مسجَّل للمراجعة.
      return c.json({ ok: false, error: "NOT_HANDLED" }, 200);
    }

    return c.json({ ok: true }, 200);
  });

  return app;
}
