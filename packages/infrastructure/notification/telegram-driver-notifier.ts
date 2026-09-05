/**
 * الغرض: نشرُ إشعارِ العرضِ للسائقِ عبر تيليجرام. يقرأ معرّفَ الدردشةِ واللغةَ من
 *   القاعدةِ، ويرسلُ نصًّا من القواميسِ مع زرّي قبولٍ ورفضٍ، ويُرجعُ معرّفَ الرسالةِ
 *   — دليلًا قاطعًا على التسليمِ يُخزَّنُ في delivered_message_id. لا نصٌّ مكتوبٌ هنا
 *   ولا معرّفٌ مُخمَّنٌ. هذا الناشرُ يُستهلَكُ من عاملِ التسليمِ (deliver-offer-
 *   notification) لا من broadcastOffers: هناك يُقرَّرُ ما إذا وُجدَ السائقُ
 *   ووصلَه العرضُ، وهنا يُنفَّذُ الإرسالُ فعلاً (`BUG-004`).
 * الحالة: منفّذ فعلياً — BUG-004 (ناشرٌ يُرجعُ معرّفَ الرسالةِ كنمطِ بطاقةِ SOS).
 * ينتمي إلى: infrastructure/notification
 * يُتوقّع أن يستخدمه: apps/workers (عاملُ تسليمِ إشعاراتِ العروض).
 * ملاحظات مستقبلية: السائقُ بلا حسابِ تيليجرام (بلا telegram_id) يُرجَعُ له
 *   DRIVER_CONTACT_NOT_FOUND — وهو فشلٌ دائمٌ لا يُعالَجُ بإعادةِ الإرسالِ؛ يتولّى
 *   العاملُ قرارَ التخلّي (dead) حين يجدُ العرضَ قد انتهى أو لم يَعُد pending.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import type { OfferNotification, OfferPublisher } from "../../application/dispatch/broadcast-offers.ts";
import { PortFailureError } from "../../application/ports/index.ts";
import { t } from "../../shared/i18n/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";
import type { Sql } from "../db/client.ts";

/**
 * إرسالٌ فعلي إلى المنصّة يُكتفي بنجاح/فشل — يُستهلَكُ من ناشرِ مفاوضاتِ الاشتراك
 * لا من إشعارِ العرض. يُبقَى هنا لأنّه مرتبطٌ بالنوعِ لا بالناشرِ.
 */
export interface OutboundSender {
  send(chatId: string, text: string, keyboard: Keyboard | null): Promise<boolean>;
}

interface DriverContactRow {
  readonly telegram_id: string;
  readonly language_code: string;
}

const KM_DECIMALS = 1;

/**
 * ناشرُ إشعارِ العرضِ على السائقِ. مرآةٌ لـcreateSafetyCardPublisher في الإرجاعِ:
 * `ok(messageId)` عند النجاحِ، `err(PortFailureError)` عند الفشلِ. الفرقُ أنّ هذا
 * يُرسلُ لسائقٍ فردٍ لا لقروبٍ، ويبني لوحةَ `Keyboard` (لا markup الخام) لأنّ
 * `asIdentifyingSender` يتولّى تحويلَها. لا «true» كاذبةٌ: ما لم يَعُدْ معرّفًا —
 * لم يُسلَّم، فيُعادُ إرسالُه من العاملِ بلا تكرارِ أثرٍ.
 */
export function createOfferPublisher(sql: Sql, sender: IdentifyingSender): OfferPublisher {
  return {
    publishOffer: async (
      notification: OfferNotification,
    ): Promise<Result<string, PortFailureError>> => {
      let contact: DriverContactRow | undefined;
      try {
        const rows = await sql<DriverContactRow[]>`
          select u.telegram_id, u.language_code
            from drivers d
            join users u on u.id = d.user_id
           where d.id = ${notification.driverId}
        `;
        contact = rows[0];
      } catch (cause) {
        return err(
          new PortFailureError(
            "publisher.publishOffer",
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }
      if (contact === undefined) {
        return err(new PortFailureError("publisher.publishOffer", "DRIVER_CONTACT_NOT_FOUND"));
      }

      const tr = t(contact.language_code);
      const text = tr("driver.offer_received", {
        distance: notification.distanceKm.toFixed(KM_DECIMALS),
        seconds: notification.expiresInSeconds,
      });
      const keyboard: Keyboard = {
        kind: "inline",
        rows: [
          [
            {
              label: tr("driver.offer_accept_button"),
              data: `offer:accept:${notification.orderId}`,
            },
            {
              label: tr("driver.offer_reject_button"),
              /**
               * الرفضُ يحمِلُ `offerId` لا `orderId`: كلُّ زرٍّ مُعلَّقٌ على عرضٍ
               * بعينِه، فيُرفَضُ عرضٌ واحدٌ لا كلُّ عرضٍ معلَّقٍ للسائقِ على الطلبِ (`BUG-003`).
               * ومعرّفُ العرضِ uuid (٦٣ حرفاً)، فيَبلى `offer:reject:<uuid>` ٥٠ حرفاً —
               * تحتَ حدِّ تلغرامَ ٦٤ لـ`callback_data`.
               */
              data: `offer:reject:${notification.offerId}`,
            },
          ],
        ],
      };
      try {
        const id = await sender.sendReturningId(String(contact.telegram_id), text, keyboard);
        if (id === null) {
          return err(new PortFailureError("publisher.publishOffer", "TELEGRAM_SEND_FAILED"));
        }
        return ok(id);
      } catch (cause) {
        return err(
          new PortFailureError(
            "publisher.publishOffer",
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
      }
    },
  };
}
