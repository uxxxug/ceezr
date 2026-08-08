/**
 * الغرض: استقبال تحديثات تلغرام والتحقّق من هوية المُرسِل قبل أي معالجة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. التحقّق الأمني والاستجابة حقيقيان،
 *   ومعالجة التحديث نفسها تُمرَّر إلى منفذ يُوصَل بـ grammY عند وصول رموز البوتين.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts
 * ملاحظات مستقبلية: تلغرام يعيد إرسال التحديث إن لم نُجب 200 سريعاً، فالمعالجة الثقيلة تُؤجَّل لـ workers.
 */

import { Hono } from "hono";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";

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
  /**
   * حدّان مختلفان لتهديدين مختلفين، وكلاهما اختياري فلا يتغيّر أي اختبار قائم:
   *
   * - `probes`: يُحتسب على **الطلبات الفاشلة سرّاً وحدها**، بعنوان المُرسِل. من يجرّب
   *   سرّاً بعد سرّ يُقفل عليه، ولا يُحتسب على تلغرام شيء لأن سرّه صحيح دائماً. ولو
   *   حُدّ بالعنوان قبل التحقّق لخُنقت تلغرام نفسها: تحديثاتها كلّها تأتي من حزمة
   *   عناوين ضيّقة، فحدُّ العنوان كان سيصير حدّاً على المنصّة لا على المهاجم.
   * - `users`: يُحتسب على التحديثات الموثَّقة بمعرّف صاحبها. الإنسان لا يبلغه؛
   *   والسكربت الذي يستعمل حساباً حقيقياً يبلغه فوراً.
   */
  readonly rateLimits?: {
    readonly probes?: RateLimiter;
    readonly users?: RateLimiter;
  };
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

/**
 * عنوان المُرسِل خلف وسيط Render. أول قيمة في `x-forwarded-for` هي العميل، وما بعدها
 * الوسطاء. القيمة مُنتحَلة بطبيعتها، ولذلك لا يُبنى عليها إلا حدّ محاولات فاشلة —
 * لا صلاحية ولا هوية.
 */
export function clientAddress(header: string | undefined): string {
  const first = (header ?? "").split(",")[0]?.trim() ?? "";
  return first === "" ? "unknown" : first;
}

/**
 * معرّف صاحب التحديث كما يرسله تلغرام: من `message.from` أو `callback_query.from`.
 * تحديث بلا صاحب معلوم (منشور قناة مثلاً) يُعاد له `null` فلا يُحسب على أحد.
 */
export function updateActorId(update: object): string | null {
  const shape = update as {
    message?: { from?: { id?: unknown } };
    callback_query?: { from?: { id?: unknown } };
  };
  const id = shape.message?.from?.id ?? shape.callback_query?.from?.id;
  return typeof id === "number" || typeof id === "string" ? String(id) : null;
}

/** جواب موحَّد للتجاوز: 429 مع Retry-After كي يعرف المُرسِل متى يعود. */
function tooManyRequests(
  c: {
    json: (body: unknown, status: 429, headers: Record<string, string>) => Response;
  },
  resetSeconds: number,
): Response {
  return c.json({ ok: false, error: "RATE_LIMITED" }, 429, {
    "retry-after": String(resetSeconds),
  });
}

export function createTelegramWebhookRoutes(deps: WebhookDependencies): Hono {
  const app = new Hono();

  app.post("/webhook/telegram/:bot", async (c) => {
    const bot = c.req.param("bot");
    if (!isBotKind(bot)) {
      return c.json({ ok: false, error: "UNKNOWN_BOT" }, 404);
    }

    const address = clientAddress(c.req.header("x-forwarded-for"));

    const provided = c.req.header(TELEGRAM_SECRET_HEADER) ?? "";
    if (!secretsMatch(provided, deps.webhookSecret)) {
      // الحدّ يُحتسب هنا فقط: بعد ثبوت أن السرّ خاطئ، لا قبل التحقّق منه.
      const probe = await deps.rateLimits?.probes?.hit(`probe:${address}`);
      deps.log?.("رفض تحديث بسرّ غير مطابق", {
        bot,
        address,
        ...(probe === undefined ? {} : { remaining: probe.remaining }),
      });
      if (probe !== undefined && !probe.allowed) {
        return tooManyRequests(c, probe.resetSeconds);
      }
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

    const actorId = updateActorId(update);
    if (actorId !== null && deps.rateLimits?.users !== undefined) {
      const decision = await deps.rateLimits.users.hit(`user:${bot}:${actorId}`);
      if (!decision.allowed) {
        deps.log?.("تجاوز مستخدم حدّ المعدّل", { bot, actorId });
        // 429 لتلغرام يعني إعادة إرسال لاحقاً، وهو المطلوب: الرسالة لا تُفقد
        // بل تُؤجَّل، والمستخدم الشرعي لا يبلغ الحدّ أصلاً.
        return tooManyRequests(c, decision.resetSeconds);
      }
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
