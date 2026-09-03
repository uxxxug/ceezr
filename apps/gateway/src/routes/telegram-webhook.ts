/**
 * الغرض: استقبال تحديثات تلغرام والتحقّق من هوية المُرسِل قبل أي معالجة.
 * الحالة: منفّذ فعلياً — المرحلة 2.1. التحقّق الأمني والاستجابة حقيقيان،
 *   ومعالجة التحديث نفسها تُمرَّر إلى منفذ يُوصَل بـ grammY عند وصول رموز البوتين.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/server.ts
 * ملاحظات مستقبلية: تلغرام يعيد إرسال التحديث إن لم نُجب 200 سريعاً، فالمعالجة الثقيلة تُؤجَّل لـ workers.
 *
 * ## ترتيبُ المسارِ حاكمٌ لا اختيارٌ — ولماذا تغيّر
 *
 * [ADR 0054](../../../../docs/adr/0054-telegram-webhook-durable-ingest-and-dedup.md) §٦ يُثبِّت
 * خمسَ خطواتٍ بهذا الترتيبِ: **السرُّ ← حدُّ المعدَّلِ ← الإيصالُ الصامدُ ومنعُ التكرارِ
 * (فعلٌ واحدٌ) ← إتاحةُ العملِ للحجزِ ← الإقرارُ السريعُ**.
 *
 * والمقلوبُ قبلَ ذلك كان **فقداً دائماً لا تكرارَ معالجةٍ**: `dedup.admit()` يفحص
 * **ويَسِم** في نداءٍ واحدٍ لا رجعةَ فيه، وكان يُنادى **قبلَ** حدِّ المعدَّل. فمنِ
 * ارتدَّ بـ`429` كان رقمُ تحديثِه **قد وُسِم مستهلَكاً**، فإعادةُ إرسالِ تيليجرام
 * تُبتلَع بوصفِها «مكرَّراً» — والتحديثُ لم يُعالَج قطُّ ولن يُعاد. والتعليقُ القديمُ
 * كان يقول «الرسالة لا تُفقد بل تُؤجَّل» — **وكان غيرَ صحيحٍ بسببِ الوسمِ السابقِ**.
 *
 * وموضعُ قرارِ منعِ التكرارِ صار **القاعدةَ** (`update-intake.ts`): إيصالُ استلامٍ
 * صامدٌ بقيدِ تفرُّدٍ على `(bot, update_id)`. و`update-dedup.ts` **لم يعد مصدرَ القرارِ**:
 * لا يُنادى إلّا في تركيبٍ بلا منفَذٍ صامدٍ — وذاك **تدهورٌ مُعلَنٌ للاختبارِ وحدَه**.
 */

import { Hono } from "hono";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { createUpdateDeduplicator, type UpdateDeduplicator, updateIdOf } from "./update-dedup.ts";
import type { DurableUpdateIntake } from "./update-intake.ts";

/** ترويسة تلغرام القياسية للسرّ المشترك. */
export const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * أقصى حجم مقبول لجسم التحديث.
 *
 * لماذا يلزم حدّ أصلاً: `c.req.json()` يُخزّن الجسم كاملاً في الذاكرة قبل أن
 * يُتاح لنا فحصه. فبلا حدّ يصير حجمُ ما نحجزه من ذاكرة تحت سيطرة المُرسِل، لا
 * تحت سيطرتنا — وذلك بالضبط تعريف إغراق الذاكرة. والخدمة بنسخة واحدة
 * (numInstances: 1 في render.yaml) فليس ثمّة نظير يمتصّ السقوط.
 *
 * لماذا 256 كِبّي: أكبر تحديث واقعي من تلغرام أصغر من ذلك بكثير — نصّ الرسالة
 * محدود بـ 4096 محرفاً، ومع الكيانات والاقتباس والتوجيه لا يبلغ عشرات الكِبّيات.
 * فالحدّ متّسع بما لا يردّ تحديثاً شرعياً، وضيّق بما يمنع الحجز غير المحدود.
 *
 * لماذا رمز «الحمولة أكبر من اللازم» لا رمز «طلب غير صالح»: الأوّل يصف السبب
 * بدقّة، وتلغرام لا يُعيد إرسال أخطاء العميل فلا تنشأ حلقة إعادة. والفرق مهمّ
 * للمراقبة: تكراره إشارة هجوم لا خلل تنسيق.
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

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
   * **موضعُ قرارِ منعِ التكرارِ والاستلامِ الصامدِ** (ADR 0054 §٣-أ).
   *
   * اختياريٌّ في النوعِ لا في الإنتاج: `apps/gateway/src/index.ts` يوصِلُه دائماً،
   * وإغفالُه **تدهورٌ مُعلَنٌ للاختبارِ وحدَه** يرتدُّ فيه القرارُ إلى `dedup` في
   * الذاكرةِ. ولماذا لا يُجعل إلزاميّاً: نحو خمسٍ وثلاثينَ ملفَّ اختبارٍ تُركّب هذا
   * المسارَ بلا قاعدةٍ، وإلزامُه كان سيُوجِب قاعدةً لفحصِ مقارنةِ سرٍّ.
   */
  readonly intake?: DurableUpdateIntake;
  /**
   * مانع تكرار `update_id` **في الذاكرة** — **لم يعد مصدرَ القرارِ** متى وُصِل
   * `intake`. يُمرَّر في الاختبار للتحكّم بالزمن. عند الإغفال يُنشأ واحد لعمر الخادم.
   */
  readonly dedup?: UpdateDeduplicator;
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

/**
 * يقرأ التدفّق نصّاً بحدٍّ أعلى صارم، ويعيد `null` إن تجاوزه.
 *
 * الفارق عن `req.text()` ثم القياس: هنا يُلغى القارئ فور تجاوز الحدّ، فلا
 * يُحجز من الذاكرة أكثر من الحدّ مهما بلغ ما يُرسله الخصم. القياس بالبايت لا
 * بالمحارف، لأن الحرف العربي محرفان في UTF-8 فالقياس النصّي يسمح بضعف الحدّ.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<string | null> {
  if (body === null) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function createTelegramWebhookRoutes(deps: WebhookDependencies): Hono {
  // مانع واحد لعمر الخادم. يُمرَّر عبر deps في الاختبار للتحكّم بالزمن.
  const dedup: UpdateDeduplicator = deps.dedup ?? createUpdateDeduplicator();
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

    // الفحص بعد التحقّق من السرّ لا قبله، حفاظاً على ترتيب «لا نردّ على مجهول
    // بأكثر من رفض». ولا يُضعِف ذلك الحماية: الجسم لم يُقرأ بعدُ إلى هنا.
    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BODY_BYTES) {
      deps.log?.("رُفض تحديث لتجاوزه حدّ الحجم", { bot, address, bytes: declaredLength });
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    // الترويسة قد تغيب (نقل مقطَّع)، فلا يُكتفى بها. والقراءة نصّاً كاملاً ثم
    // القياس تحجز أولاً وتسأل ثانياً — أي أنها لا تحمي شيئاً. فيُقرأ التدفّق
    // مقطعاً مقطعاً ويُقطع فور تجاوز الحدّ، فلا يُحجز أكثر منه أبداً.
    const raw = await readBounded(c.req.raw.body, MAX_WEBHOOK_BODY_BYTES);
    if (raw === null) {
      deps.log?.("رُفض تحديث لتجاوزه حدّ الحجم", { bot, address });
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }

    let update: unknown;
    try {
      update = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    if (typeof update !== "object" || update === null || Array.isArray(update)) {
      return c.json({ ok: false, error: "INVALID_UPDATE" }, 400);
    }

    // ٢) حدُّ المعدَّلِ **قبلَ أيِّ استهلاكٍ لـ`update_id`** (ADR 0054 §٦).
    // وأثرُ الترتيبِ واحدٌ لا أكثر: أن يقعَ الرفضُ قبلَ أن يُوسَم الرقمُ، فتكونَ
    // إعادةُ إرسالِ تيليجرام **مقبولةً لا مُبتلَعةً**. وأمّا إعفاءُ الإعاداتِ من
    // حصّةِ المستخدمِ فسؤالٌ **لا يحسمُه ADR 0054** (§١٠/٥) ولا يُجتهَد فيه ههنا.
    const actorId = updateActorId(update);
    if (actorId !== null && deps.rateLimits?.users !== undefined) {
      const decision = await deps.rateLimits.users.hit(`user:${bot}:${actorId}`);
      if (!decision.allowed) {
        deps.log?.("تجاوز مستخدم حدّ المعدّل", { bot, actorId });
        // 429 لتلغرام يعني إعادة إرسال لاحقاً — والإعادةُ الآن تُقبَل فعلاً لأنّ
        // الرقمَ لم يُودَع بعدُ. فالتعليقُ «لا تُفقد بل تُؤجَّل» صار صحيحاً.
        return tooManyRequests(c, decision.resetSeconds);
      }
    }

    /** المعالجةُ وجوابُها — موضعٌ واحدٌ كي لا يختلفَ الجوابُ بينَ فرعٍ وفرعٍ. */
    const answer = (handled: boolean): Response => {
      if (!handled) {
        deps.log?.("تعذّرت معالجة التحديث", { bot });
        // نُجيب 200 حتى لا يُعيد تلغرام الإرسال بلا نهاية؛ الفشل مسجَّل للمراجعة.
        return c.json({ ok: false, error: "NOT_HANDLED" }, 200);
      }
      return c.json({ ok: true }, 200);
    };

    const updateId = updateIdOf(update);

    // ٣) الإيصالُ الصامدُ ومنعُ التكرارِ — **فعلٌ واحدٌ ذرّيٌّ في القاعدةِ**، لا فحصٌ
    //    ثمَّ كتابةٌ منفصلةٌ تُقتنَص النافذةُ بينهما.
    if (deps.intake !== undefined && updateId !== null) {
      const intake = deps.intake;
      let claim: Awaited<ReturnType<DurableUpdateIntake["claim"]>>;
      try {
        claim = await intake.claim(bot, updateId);
      } catch {
        // عجزُ الإيداعِ **ليس إذناً بالمعالجةِ ولا بالإقرارِ**: `503` يجعل تيليجرام
        // يُعيد الإرسالَ فلا يُفقد التحديثُ. ولا يُسجَّل `updateId` حفاظاً على §٧/٥.
        deps.log?.("تعذّر الإيداعُ الصامدُ للتحديث", { bot });
        return c.json({ ok: false, error: "INTAKE_UNAVAILABLE" }, 503);
      }

      if (claim.outcome === "duplicate" || claim.outcome === "in_progress") {
        deps.log?.("تحديث مكرَّر أُهمل", { bot, outcome: claim.outcome });
        // 200 لا 4xx: التحديث مقبولٌ ومعالَجٌ (أو قيدَ المعالجةِ)، فلا عملَ ثانٍ.
        return c.json({ ok: true, duplicate: true }, 200);
      }

      // ٤) العملُ محجوزٌ برمزٍ. وإن ماتت العمليةُ ههنا بقيَ الإيصالُ غيرَ مختومٍ،
      //    فيُسترجَع حجزُه عندَ إعادةِ تيليجرام — وإعادتُها هي ناقلُ الحمولةِ، فلا
      //    تُخزَّن حمولةٌ (§٧/١) وتبقى «مرّةً على الأقلّ» قائمةً (§٥/٣).
      const token = claim.claimToken;
      let handled = false;
      try {
        handled = await deps.handler.handle(bot, update);
      } finally {
        if (token !== null) {
          await intake.finish(
            bot,
            updateId,
            token,
            handled ? "done" : "failed",
            handled ? undefined : "NOT_HANDLED",
          );
        }
      }
      return answer(handled);
    }

    // تركيبٌ بلا منفَذٍ صامدٍ: **تدهورٌ مُعلَنٌ للاختبارِ والقياسِ وحدَهما**، يرتدُّ
    // فيه القرارُ إلى خريطةِ الذاكرةِ. **والترتيبُ يبقى مصحَّحاً حتّى ههنا**: الوسمُ
    // بعدَ حدِّ المعدَّلِ لا قبلَه، فنافذةُ الفقدِ الأولى مغلقةٌ في الفرعَينِ كليهما.
    if (updateId !== null && !dedup.admit(bot, updateId)) {
      deps.log?.("تحديث مكرَّر أُهمل", { bot, updateId });
      return c.json({ ok: true, duplicate: true }, 200);
    }

    return answer(await deps.handler.handle(bot, update));
  });

  return app;
}
