/**
 * الغرض: معالجُ نوعِ «offer» في صندوقِ الصادرِ الموحَّدِ (BUG-004): يقرأُ حمولةَ
 *   الصفِّ الملتقَطِ — وهي بياناتُ العرضِ كما قُرئت حيّةً لحظةَ الالتقاطِ من
 *   order_offers لا نسخةً مخزَّنةً — فإن كان العرضُ ميّتًا (غيرَ pending أو
 *   منتهيًا أو محذوفًا) تخلّى عنه (dead) لا يُعادُ أبدًا، وإن كان حيًّا نشرَه
 *   وأعادَ معرّفَ الرسالةِ أو سببَ الفشلِ. البنيةُ (الالتقاطُ والإتمامُ والتخلّي)
 *   في deliver-notification العامِّ لا هنا.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: مهلةُ العرضِ تُقرأُ من الحمولةِ الحيّةِ لا من إعدادٍ ثانٍ.
 */
import type { DistanceKm } from "../../domain/geo/value-objects.ts";
import type { DriverId, OfferId, OrderId } from "../../shared/kernel/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { OfferNotification, OfferPublisher } from "./broadcast-offers.ts";

const MS_PER_SECOND = 1000;

/** حمولةُ نوعِ العرضِ كما يبنيها claim_notification_delivery حيًّا. */
interface OfferPayload {
  readonly offerId: OfferId;
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly distanceKm: string;
  readonly expiresAt: string;
  readonly offerStatus: string;
}

function readOfferPayload(payload: Readonly<Record<string, unknown>>): OfferPayload | null {
  const offerId = payload.offer_id;
  const orderId = payload.order_id;
  const driverId = payload.driver_id;
  const distanceKm = payload.distance_km;
  const expiresAt = payload.expires_at;
  const offerStatus = payload.offer_status;
  if (
    typeof offerId !== "string" ||
    typeof orderId !== "string" ||
    typeof driverId !== "string" ||
    typeof distanceKm !== "string" ||
    typeof expiresAt !== "string" ||
    typeof offerStatus !== "string"
  ) {
    return null;
  }
  return {
    offerId: offerId as OfferId,
    orderId: orderId as OrderId,
    driverId: driverId as DriverId,
    distanceKm,
    expiresAt,
    offerStatus,
  };
}

function offerExpired(expiresAt: string, now: Date): boolean {
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) || ms <= now.getTime();
}

export function createOfferNotificationHandler(publisher: OfferPublisher): NotificationHandler {
  return async (delivery) => {
    const offer = readOfferPayload(delivery.payload);
    /**
     * العرضُ الميّتُ لا يُبعَثُ: انتهت مهلته أو لم يَعُد pending أو زال صفُّه
     * قبل أن يصلَه الإشعارُ. لا إعادةُ إرسالٍ أبديةٌ لصفٍّ لن يُقبل أبدًا —
     * تخلٍّ نهائيٌّ (dead) يُسجَّلُ بالرمزِ كالـfinish، فلا يُسلبَ الصفَّ من حائزه.
     */
    if (
      offer === null ||
      offer.offerStatus !== "pending" ||
      offerExpired(offer.expiresAt, new Date())
    ) {
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const notification: OfferNotification = {
      orderId: offer.orderId,
      offerId: offer.offerId,
      driverId: offer.driverId,
      distanceKm: Number(offer.distanceKm) as DistanceKm,
      expiresInSeconds: Math.max(
        0,
        Math.ceil((Date.parse(offer.expiresAt) - Date.now()) / MS_PER_SECOND),
      ),
    };
    const sent = await publisher.publishOffer(notification);
    return ok({
      abandon: false,
      messageId: sent.ok ? sent.value : null,
      failure: sent.ok ? null : sent.error.detail,
    });
  };
}
