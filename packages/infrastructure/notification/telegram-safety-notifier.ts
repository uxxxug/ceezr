/** بطاقة SOS؛ النص والأزرار من i18n ولا يسجّل هذا المحول أي قرار بشري. */

import { PortFailureError } from "../../application/ports/index.ts";
import type { SafetyCardPublisher, SafetyDelivery } from "../../application/safety/ports.ts";
import { DEFAULT_LANGUAGE, t } from "../../shared/i18n/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { TelegramSender } from "./telegram-api-sender.ts";

function coordinates(wkt: string | null): string {
  if (wkt === null) return t(DEFAULT_LANGUAGE)("safety.location_unknown");
  const found = /POINT\(([-.\d]+) ([-.\d]+)\)/.exec(wkt);
  return found === null
    ? t(DEFAULT_LANGUAGE)("safety.location_unknown")
    : `${found[2]}, ${found[1]}`;
}
export function createSafetyCardPublisher(sender: TelegramSender): SafetyCardPublisher {
  return {
    publish: async (card: SafetyDelivery): Promise<Result<string, PortFailureError>> => {
      const tr = t(DEFAULT_LANGUAGE);
      /**
       * `F12-03` — بلاغٌ بلا رحلةٍ **بطاقةٌ أخرى لا حقلٌ محذوفٌ**: سطرُ «الطلب:
       * —» في بطاقةِ طوارئٍ يُقرأُ عطلَ تسليمٍ فيُنتَظَرُ توضيحٌ، والمنتَظَرُ ثوانٍ
       * لا تُعوَّضُ. فَتُقالُ الحقيقةُ صريحةً: بلاغٌ من حسابٍ لا من رحلةٍ.
       *
       * `PD-020` — وجنسُ البلاغِ كذلكَ يختارُ البطاقةَ قبلَ وجودِ الرحلةِ:
       * تعذُّرُ الإكمالِ عملٌ تشغيليٌّ يُقرَؤُ برمزٍ مُهادنٍ لا برمزِ طوارئِ
       * الاستغاثةِ (🆘) — فمَن يفتحُ القروبَ يُميِّزُ في نصفِ ثانيةٍ ماذا
       * يقرأُ وماذا يُجهِّزُ، وفريقُ السلامةِ السريعُ لا يُستنفَرُ لقرارِ
       * إسنادٍ.
       */
      const text =
        card.incidentReason === "driver_cannot_complete" && card.orderId !== null
          ? tr("safety.group_card_cannot_complete", {
              incident: card.incidentId.slice(0, 8),
              order: card.orderId,
              service: tr(
                card.service === "delivery"
                  ? "safety.service_delivery"
                  : "safety.service_transport",
              ),
              location: coordinates(card.locationWkt),
            })
          : card.orderId === null
            ? tr("safety.group_card_no_order", {
                incident: card.incidentId.slice(0, 8),
                reporter: tr(`safety.reporter_${card.reporterRole}`),
                location: coordinates(card.locationWkt),
              })
            : tr("safety.group_card", {
                incident: card.incidentId.slice(0, 8),
                order: card.orderId,
                reporter: tr(`safety.reporter_${card.reporterRole}`),
                service: tr(
                  card.service === "delivery"
                    ? "safety.service_delivery"
                    : "safety.service_transport",
                ),
                location: coordinates(card.locationWkt),
              });
      const keyboard = {
        inline_keyboard: [
          [{ text: tr("safety.claim_button"), callback_data: `sos:claim:${card.incidentId}` }],
          [
            { text: tr("safety.close_button"), callback_data: `sos:close:${card.incidentId}` },
            { text: tr("safety.block_button"), callback_data: `sos:block:${card.incidentId}` },
          ],
        ],
      };
      try {
        const id = await sender.sendMessage(card.groupId, text, keyboard);
        if (id === null) return err(new PortFailureError("telegram.safetyCard", "NO_MESSAGE_ID"));
        return ok(id);
      } catch (cause) {
        return err(
          new PortFailureError(
            "telegram.safetyCard",
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }
    },
  };
}
