/**
 * الغرض: مُنفِّذُ `MoveEventShipper` الإنتاجيُّ: يُودِعُ مغلَّفَ حدثٍ في CORE عبرَ
 *    `POST /v1/events` بمصادقةِ حاملٍ ومهلةٍ، ويُصنِّفُ الردَّ إلى تسليمٍ أو إعادةٍ
 *    أو موتٍ دائمٍ وفقَ جدولِ العقدِ المنقولِ. البند `W-5` (ناقلٌ).
 * الحالة: منفّذ فعلياً — 2026-09-12. أُغلِقَت `DEP-CORE-001` بالتزامَي CORE
 *    `d2c38e3` و`1231817`، فصارَ للبابِ عقدٌ منقولٌ ومُنفِّذٌ لا مُعلَنٌ فارغٌ.
 * ينتمي إلى: packages/infrastructure/wasla
 * يُستخدم من: `packages/application/wasla/fulfillment-lifecycle.ts` (`deliverOnce`)
 *    عندَ تركيبِه في عاملِ تسليمِ الصادرِ.
 * ملاحظات مستقبلية: التراجعُ الأُسِّيُّ وعددُ المحاولاتِ **ليسا ههنا** بل في
 *    `move_event_outbox` وثوابتِه: الناقلُ يُحاولُ مرّةً ويحكمُ على مرّتِه، والصفُّ
 *    هوَ الذاكرةُ. ولو أضافَ CORE ردّاً ذا معنىً جديدٍ فموضعُ الحكمِ
 *    `packages/shared/config/core-event-transport.ts` لا هذا الملفُّ.
 *
 * ## لِمَ لا يُقرأُ رمزُ الحاملِ من البيئةِ ههنا
 *
 * لأنَّ سرّاً يُقرأُ في وحدةٍ عميقةٍ يجعلُ كلَّ اختبارٍ يستوردُها مُطالَباً ببيئةٍ،
 * فيُلجَأُ إلى تعطيلِ الاختبارِ أو إلى سرٍّ وهميٍّ في المستودعِ. فالسرُّ يُمرَّرُ
 * وسيطاً عندَ التركيبِ، وموضعُ قراءتِه من البيئةِ هوَ حدُّ التركيبِ وحدَه.
 *
 * ## ولِمَ `fetch` وسيطٌ قابلٌ للإحلالِ
 *
 * لأنَّ ما يجبُ قياسُه ههنا ليسَ الشبكةَ بل **الحكمَ**: أنَّ `503` إعادةٌ وأنَّ
 * `403` موتٌ وأنَّ المهلةَ إعادةٌ. وقياسُ ذلكَ بشبكةٍ حقيقيّةٍ يعني اختباراً
 * هشّاً يُسكَتُ عندَ أوّلِ اضطرابٍ، وذاكَ إسقاطٌ للقياسِ لا تقويةٌ له.
 *
 * ## وأينَ الإسلامُ (idempotency)
 *
 * في CORE: إعادةُ إيداعِ المعرّفِ نفسِه آمنةٌ ويردُّ `first_delivery=false`. فلا
 * نحرسُ ههنا بذاكرةٍ محليّةٍ — حرسٌ محليٌّ ينسى عندَ إعادةِ تشغيلٍ، وحرسُ CORE
 * منصوصٌ في عقدِه. ونحنُ نُبلِّغُ الإيصالَ كما هوَ فيبقى الفرقُ مقروءاً.
 */

import type {
  EventEnvelope,
  MoveEventShipper,
  ShipFailure,
  ShipReceipt,
} from "../../application/wasla/fulfillment-lifecycle.ts";
import {
  CORE_EVENT_SUBMIT_PATH,
  CORE_EVENT_SUBMIT_TIMEOUT_MS,
  classifyCoreSubmitStatus,
} from "../../shared/config/core-event-transport.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

export interface CoreEventShipperConfig {
  /** أصلُ CORE بلا مسارٍ، مثل `https://core.example`. */
  readonly baseUrl: string;
  /** رمزُ حاملٍ لخدمةِ MOVE؛ منه يستنبطُ CORE البادئاتَ المسموحةَ. */
  readonly bearerToken: string;
  readonly timeoutMs?: number;
  /** يُحَلُّ في الاختبارِ وحدَه؛ في التشغيلِ `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/** إخفاقٌ عابرٌ: عطلُ شبكةٍ أو مهلةٌ أو رمزٌ يُعادُ. */
function transient(detail: string): Result<ShipReceipt, ShipFailure> {
  return err({ permanent: false, detail });
}

/** إخفاقٌ دائمٌ: رفضٌ عقديٌّ أو صلاحيّةٌ — لا يُصلِحُه انتظارٌ. */
function permanent(detail: string): Result<ShipReceipt, ShipFailure> {
  return err({ permanent: true, detail });
}

/**
 * تركيبُ العنوانِ: الأصلُ بلا شرطةٍ زائدةٍ، ثمَّ مسارُ العقدِ. ولا يُقبَلُ أصلٌ
 * يحملُ مساراً خاصّاً به لأنَّ ذاكَ يُنشِئُ عنواناً مُخترَعاً لا منصوصاً.
 */
function submitUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${CORE_EVENT_SUBMIT_PATH}`;
}

/**
 * وصفُ ردٍّ غيرِ مقبولٍ بلا كشفِ سرٍّ: الرمزُ ومقتطفٌ قصيرٌ من الجسمِ. والمقتطفُ
 * مقصوصٌ لأنَّ ردَّ بوّابةٍ وسيطةٍ قد يكونُ صفحةً كاملةً، ولا يُسجَّلُ سرٌّ لأنَّ
 * الرمزَ لم يُرسَلْ في الجسمِ أصلاً.
 */
function describe(status: number, body: string): string {
  const trimmed = body.trim().slice(0, 300);
  return trimmed.length === 0 ? `HTTP ${status}` : `HTTP ${status}: ${trimmed}`;
}

export function createCoreEventShipper(config: CoreEventShipperConfig): MoveEventShipper {
  const doFetch = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? CORE_EVENT_SUBMIT_TIMEOUT_MS;
  const url = submitUrl(config.baseUrl);

  return {
    ship: async (envelope: EventEnvelope): Promise<Result<ShipReceipt, ShipFailure>> => {
      /**
       * المهلةُ بمُلغٍ لا بمُسابقةِ وعودٍ: المُسابقةُ تتركُ الطلبَ جارياً بعدَ
       * الحكمِ عليه، فتتكدَّسُ اتّصالاتٌ لا صاحبَ لها في عاملٍ يعملُ ساعاتٍ.
       */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.bearerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
      } catch (error) {
        /**
         * كلُّ ما يُرمى ههنا شبكةٌ أو إلغاءٌ أو عنوانٌ لا يُحَلُّ، وكلُّها في
         * جدولِ العقدِ **إعادةٌ**. وتُسمّى المهلةُ باسمِها في السببِ حتّى يُقرأَ
         * الفرقُ في `last_error` لا يُخمَّنَ.
         */
        const aborted = controller.signal.aborted;
        const detail = aborted
          ? `TIMEOUT: انقضت مهلةُ ${timeoutMs} ملّي ثانية دونَ ردٍّ من CORE`
          : `NETWORK: ${error instanceof Error ? error.message : String(error)}`;
        return transient(detail);
      } finally {
        clearTimeout(timer);
      }

      const verdict = classifyCoreSubmitStatus(response.status);
      if (verdict === "retry") {
        return transient(describe(response.status, await response.text().catch(() => "")));
      }
      if (verdict === "dead") {
        return permanent(describe(response.status, await response.text().catch(() => "")));
      }

      /**
       * نجاحٌ برمزٍ لكن بجسمٍ لا يُقرأُ: لا يُدَّعى تسليمٌ بلا إيصالٍ. وهوَ إخفاقٌ
       * **عابرٌ** لا دائمٌ، لأنَّ الأرجحَ وسيطٌ اعترضَ الردَّ لا رفضٌ من CORE.
       */
      let receipt: unknown;
      try {
        receipt = await response.json();
      } catch (error) {
        return transient(
          `MALFORMED_ACCEPTED_BODY: رمزٌ ${response.status} بجسمٍ لا يُفَكُّ — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (receipt === null || typeof receipt !== "object") {
        return transient(`MALFORMED_ACCEPTED_BODY: رمزٌ ${response.status} بجسمٍ ليسَ كائناً`);
      }

      const body = receipt as Record<string, unknown>;
      /**
       * العقدُ يردُّ `{event_id, accepted, first_delivery}`. و`accepted=false` مع
       * رمزِ نجاحٍ حالةٌ لا ينصُّ عليها العقدُ صريحاً، فلا تُقرأُ تسليماً: تُعادُ.
       */
      if (body.accepted === false) {
        return transient(`CORE_DID_NOT_ACCEPT: رمزٌ ${response.status} و accepted=false`);
      }
      if (typeof body.event_id === "string" && body.event_id !== envelope.event_id) {
        return permanent(
          `EVENT_ID_MISMATCH: أودِعَ ${String(envelope.event_id)} وردَّ CORE ${body.event_id}`,
        );
      }
      return ok({ firstDelivery: body.first_delivery !== false });
    },
  };
}
