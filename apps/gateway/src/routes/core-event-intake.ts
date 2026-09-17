/**
 * الغرض: **بابُ استقبالِ أحداثِ CORE** (`core.*`) المُسلَّمةِ إلينا: إثباتُ أصلِها
 *    بتوقيعِ `HMAC-SHA256` على البايتاتِ المُرسَلةِ عينِها، ثمَّ ربطُ هويّتِها
 *    بترويسةِ `x-wasla-event-id`، ثمَّ إيداعُها وتطبيقُها بحالةِ الاستخدامِ.
 *    البند `W-5` (ناقلٌ).
 * الحالة: منفّذ فعلياً — 2026-09-12. صارَ ممكناً بإغلاقِ `DEP-CORE-001`: عقدُ
 *    التسليمِ الصادرِ من CORE منقولٌ في `docs/contracts/core/transport/`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` (يُركَّبُ عندَ توفّرِ سرِّ التوقيعِ
 *    والقاعدةِ)، و`tests/unit/gateway-core-event-intake.test.ts`.
 * ملاحظات مستقبلية: `GET /v1/event-deliveries/undelivered` في CORE يكشفُ ما لم
 *    يُسلَّمْ إلينا؛ ومقابلةُ ذاكَ بصندوقِ واردِنا مُصالحةٌ (reconciliation) تُبنى
 *    عاملاً لاحقاً — ولا تُدَّعى اليومَ. ولا يُسجَّلُ السرُّ ولا الجسمُ الخامُ في
 *    أيِّ سطرٍ ههنا.
 *
 * ## لماذا التحقّقُ على البايتاتِ لا على الكائنِ
 *
 * التوقيعُ عندَ CORE محسوبٌ على **البايتاتِ المُرسَلةِ**. وفَكُّ JSON ثمَّ إعادةُ
 * تركيبِه يُغيِّرُ البايتاتَ (ترتيبُ مفاتيحَ، فراغٌ، هروبُ محارفَ) فيُخفِقُ توقيعٌ
 * صحيحٌ أو — أسوأُ — يُقبَلُ ما لا يُطابِقُ. فتُقرأُ البايتاتُ خاماً ويُحسَبُ
 * عليها، ولا يُفَكُّ الجسمُ إلّا **بعدَ** ثبوتِ الأصلِ: فَكُّ مجهولِ المصدرِ عملٌ
 * على مُدخَلٍ لا صاحبَ له.
 *
 * ## ولماذا لا ذاكرةُ إسلامٍ في هذه الطبقةِ
 *
 * الإسلامُ (idempotency) مُنفَّذٌ حيثُ الحقيقةُ: `core_event_inbox` بمفتاحٍ فريدٍ
 * على `event_id`. وذاكرةٌ في العمليّةِ تُسبِقُه تكونُ **مصدرَ حقيقةٍ ثانياً**
 * ينسى عندَ إعادةِ تشغيلٍ ويختلفُ بينَ نسختَينِ من الخدمةِ، فتصيرُ الإجابةُ عن
 * «هل رُئيَ هذا الحدثُ؟» رهنَ أيِّ نسخةٍ استقبلَتْه. فالترويسةُ تُستعمَلُ لِـ**ربطِ
 * الهويّةِ** (أن يكونَ المُوقَّعُ هوَ المُعلَنُ)، والتكرارُ يُكشَفُ في القاعدةِ.
 *
 * ## ورمزُ الردِّ ليسَ تجميلاً
 *
 * جدولُ CORE المنقولُ يقرأُ `5xx` إعادةً و`4xx` (سوى `408` و`429`) موتاً فوريّاً.
 * فكلُّ عطلٍ عندَنا **عابرٍ** (قاعدةٌ ساقطةٌ، بابٌ غيرُ مُركَّبٍ) يُردُّ `503`
 * ليُعادَ، وكلُّ رفضٍ **دائمٍ** (توقيعٌ خاطئٌ، مغلَّفٌ مخالفٌ، نوعٌ لا نستهلكُه)
 * يُردُّ `4xx` فيموتُ عندَ CORE بسببِه مكتوباً بدلاً من إعادةٍ ثمانيةَ أضعافٍ لا
 * تُغيِّرُ شيئاً.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { type Context, Hono } from "hono";
import type { FulfillmentLifecycle } from "../../../../packages/application/wasla/fulfillment-lifecycle.ts";
import {
  CORE_EVENT_ID_HEADER,
  CORE_EVENT_SIGNATURE_HEADER,
  CORE_EVENT_SIGNATURE_PREFIX,
  CORE_INBOUND_MAX_BYTES,
  CORE_INBOUND_MIN_SECRET_LENGTH,
} from "../../../../packages/shared/config/core-event-transport.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { clientAddress, rateLimitRejection } from "../rate-limit/guard.ts";

export const CORE_EVENT_INTAKE_PATH = "/webhook/core-events";

export interface CoreEventIntakeDependencies {
  /**
   * سرُّ الاشتراكِ الذي زرعَه المُشغِّلُ في CORE. غيابُه أو قِصَرُه عن حدِّ CORE
   * **يُعطِّلُ البابَ معلَناً** (`503`) ولا يُخفِّفُ التحقّقَ: بابٌ يقبلُ بلا
   * توقيعٍ أسوأُ من بابٍ مُغلَقٍ، لأنَّه يُوهِمُ أنَّ ما دخلَ منه موثَّقٌ.
   */
  readonly signingSecret?: string;
  readonly lifecycle: FulfillmentLifecycle;
  /**
   * حاصرُ المعدَّلِ — **اختياريٌّ في النوعِ لا في التشغيلِ**: يُمرَّرُ من موضعِ
   * التركيبِ (`apps/gateway/src/index.ts`) بأرقامِ `rate-limit/policy.ts`، ويغيبُ في
   * اختباراتِ المسارِ التي لا تقيسُ الحدَّ. وغيابُه **مُعلَنٌ في السِجلِّ** لا
   * مسكوتٌ عنه، وحاجزُ `check-rate-limit-coverage` يطلبُ نصَّ تركيبِه.
   */
  readonly limits?: { readonly perAddress: RateLimiter };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

type RejectStatus = 400 | 401 | 415 | 422 | 503;

function rejected(c: Context, error: string, status: RejectStatus) {
  return c.json({ ok: false, error }, status);
}

/**
 * قراءةٌ محدودةٌ **بالبايتاتِ لا بالنصِّ**: نظيرةُ `readBounded` في مسارِ تلغرام
 * لكنَّها لا تفكُّ الترميزَ، لأنَّ الفَكَّ ثمَّ إعادةَ الترميزِ يُفسِدُ توقيعاً
 * محسوباً على البايتاتِ حينَ يحملُ الجسمُ ما لا يُفَكُّ سليماً.
 */
export async function readBoundedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (body === null) return new Uint8Array(0);
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
  return merged;
}

/**
 * مقابلةُ توقيعَينِ بزمنٍ ثابتٍ. والطولُ يُفحَصُ أوّلاً لأنَّ `timingSafeEqual`
 * يرمي على اختلافِ الطولِ، ولأنَّ طولَ توقيعٍ سِتّعشريٍّ لـ`sha256` معلومٌ سلفاً
 * فلا يُفشي فحصُه سرّاً.
 */
function signatureMatches(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(providedHex, "hex"));
}

const HEX_SIGNATURE = /^[0-9a-f]{64}$/;

export function createCoreEventIntakeRoutes(deps: CoreEventIntakeDependencies): Hono {
  const app = new Hono();

  app.post(CORE_EVENT_INTAKE_PATH, async (c) => {
    /**
     * الحدُّ قبلَ قراءةِ الجسمِ وقبلَ حسابِ التوقيعِ. و`429` ههنا **تأجيلٌ لا
     * موتٌ**: جدولُ إعادةِ `CORE` يقرؤها إعادةً — فلا يُفقَدُ حدثٌ بالحدِّ
     * (`SEC-07`).
     */
    const exceeded = rateLimitRejection(
      c,
      await deps.limits?.perAddress.hit(
        `core-events:${clientAddress(c.req.header("x-forwarded-for"))}`,
      ),
    );
    if (exceeded !== null) return exceeded;
    /**
     * **والحدُّ قبلَ فحصِ التركيبِ** لا بعدَه: بابٌ غيرُ مُهيَّأٍ يُجيبُ `503`، وذاكَ
     * جوابٌ يُحسَبُ ثمنُه أيضاً — فلا يُترَكُ سطحٌ مكشوفٌ بلا عدٍّ لأنَّه معطَّلٌ.
     */

    const secret = deps.signingSecret;
    if (secret === undefined || secret.length < CORE_INBOUND_MIN_SECRET_LENGTH) {
      deps.log?.("core.intake.route_disabled", {
        reason: secret === undefined ? "secret_absent" : "secret_too_short",
        min_length: CORE_INBOUND_MIN_SECRET_LENGTH,
      });
      return rejected(c, "CORE_INTAKE_NOT_CONFIGURED", 503);
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > CORE_INBOUND_MAX_BYTES) {
      return rejected(c, "PAYLOAD_TOO_LARGE", 400);
    }

    const eventId = c.req.header(CORE_EVENT_ID_HEADER);
    if (eventId === undefined || eventId.trim().length === 0) {
      deps.log?.("core.intake.missing_event_id", {});
      return rejected(c, "MISSING_EVENT_ID_HEADER", 400);
    }

    const provided = c.req.header(CORE_EVENT_SIGNATURE_HEADER);
    if (provided === undefined || !provided.startsWith(CORE_EVENT_SIGNATURE_PREFIX)) {
      deps.log?.("core.intake.missing_signature", { event_id: eventId });
      return rejected(c, "MISSING_SIGNATURE", 401);
    }
    const providedHex = provided.slice(CORE_EVENT_SIGNATURE_PREFIX.length).toLowerCase();
    if (!HEX_SIGNATURE.test(providedHex)) {
      deps.log?.("core.intake.malformed_signature", { event_id: eventId });
      return rejected(c, "MALFORMED_SIGNATURE", 401);
    }

    const raw = await readBoundedBytes(c.req.raw.body, CORE_INBOUND_MAX_BYTES);
    if (raw === null) return rejected(c, "PAYLOAD_TOO_LARGE", 400);

    const expectedHex = createHmac("sha256", secret).update(raw).digest("hex");
    if (!signatureMatches(expectedHex, providedHex)) {
      deps.log?.("core.intake.untrusted", { event_id: eventId, bytes: raw.byteLength });
      return rejected(c, "INVALID_SIGNATURE", 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    } catch (error) {
      deps.log?.("core.intake.malformed_body", {
        event_id: eventId,
        detail: error instanceof Error ? error.message : String(error),
      });
      return rejected(c, "MALFORMED_JSON", 400);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return rejected(c, "ENVELOPE_MUST_BE_OBJECT", 400);
    }

    const envelope = parsed as Record<string, unknown>;
    /**
     * الترويسةُ والجسمُ يجبُ أن يشهدا لهويّةٍ واحدةٍ: الترويسةُ مُوقَّعةٌ ضمناً
     * لا صراحةً (التوقيعُ على الجسمِ)، فلو اختلفَتْ عن الجسمِ صارَ للحدثِ اسمانِ
     * ولَبَنَينا الإسلامَ على أحدِهما دونَ بيانٍ. فالاختلافُ رفضٌ لا ترجيحٌ.
     */
    if (envelope.event_id !== eventId) {
      deps.log?.("core.intake.event_id_mismatch", { event_id: eventId });
      return rejected(c, "EVENT_ID_MISMATCH", 400);
    }

    const consumed = await deps.lifecycle.consume(envelope);
    if (!consumed.ok) {
      const failure = consumed.error;
      if (failure.kind === "contract") {
        deps.log?.("core.intake.contract_violation", {
          event_id: eventId,
          issues: failure.issues.map((issue) => `${issue.path}: ${issue.problem}`),
        });
        return rejected(c, "CONTRACT_VIOLATION", 422);
      }
      if (failure.kind === "unsupported_event_type") {
        /**
         * نوعٌ لا نستهلكُه: خطأُ تهيئةِ اشتراكٍ عندَ المُشغِّلِ لا عطلٌ عابرٌ،
         * فيُردُّ رفضاً دائماً ليموتَ عندَ CORE ظاهراً في «غيرِ المُسلَّمِ»
         * بسببِه، بدلاً من إعادةٍ صامتةٍ تُخفي سوءَ التهيئةِ.
         */
        deps.log?.("core.intake.unsupported_event_type", {
          event_id: eventId,
          event_type: failure.eventType,
        });
        return rejected(c, "UNSUPPORTED_EVENT_TYPE", 422);
      }
      if (failure.kind === "rejected") {
        deps.log?.("core.intake.rejected", {
          event_id: eventId,
          code: failure.code,
          detail: failure.detail,
        });
        return rejected(c, failure.code, 422);
      }
      deps.log?.("core.intake.port_failure", {
        event_id: eventId,
        port: failure.error.port,
        detail: failure.error.detail,
      });
      return rejected(c, "INTAKE_UNAVAILABLE", 503);
    }

    const outcome = consumed.value;
    deps.log?.("core.intake.accepted", {
      event_id: eventId,
      job_id: outcome.jobId,
      state: outcome.state,
      changed: outcome.changed,
    });
    return c.json({
      ok: true,
      event_id: eventId,
      job_id: outcome.jobId,
      state: outcome.state,
      changed: outcome.changed,
      note: outcome.note,
    });
  });

  return app;
}
