/**
 * يسلّم صفَّ إشعارِ عرضٍ واحدًا من outbox: يستولي عليه بـclaim_token، فإن كان العرضُ
 * ميّتًا (غيرَ pending أو منتهيًا) تخلّى عنه (dead) لا يُعادُ أبدًا، وإن كان حيًّا
 * نشرَه فإن نجحَ علنَه مُسلَّمًا بمعرّفِ الرسالة، وإن فشلَ أعاده pending بموعدٍ جديد —
 * بلا تكرارِ أثرٍ: الصفُّ المُسلَّم لا يُلتقطُ ثانيةً (BUG-004). مرآةٌ لـdeliverSafetyIncident
 * في البنيةِ، يزيدُ عليها مسارَ التخلّي عن العرضِ المُنتهي قبل أن يصلَه الإشعار.
 */
import type { DistanceKm } from "../../domain/geo/value-objects.ts";
import type { CityId, DriverId, OfferId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { OfferNotification, OfferPublisher } from "./broadcast-offers.ts";

export interface OfferDelivery {
  readonly deliveryId: string;
  readonly offerId: OfferId;
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly cityId: CityId;
  readonly claimToken: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly distanceKm: string;
  readonly expiresAt: string;
  readonly offerStatus: string;
}

export interface OfferDeliveryPort {
  claim(): Promise<Result<{ delivery: OfferDelivery | null }, PortFailureError>>;
  finish(input: {
    deliveryId: string;
    claimToken: string;
    messageId: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
  abandon(input: {
    deliveryId: string;
    claimToken: string;
  }): Promise<Result<boolean, PortFailureError>>;
}

export interface OfferDeliveryDeps {
  readonly deliveries: OfferDeliveryPort;
  readonly publisher: OfferPublisher;
}

export interface OfferAttemptOutcome {
  readonly found: boolean;
  readonly delivered: boolean;
  readonly abandoned: boolean;
  readonly maxAttempts: number | null;
  /** سبب فشل النشر إن فشل. الصفّ يعود `pending` بموعدٍ جديد في كل الأحوال. */
  readonly failure: string | null;
}

const MS_PER_SECOND = 1000;

function offerExpired(expiresAt: string, now: Date): boolean {
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) || ms <= now.getTime();
}

export async function deliverOfferNotification(
  deps: OfferDeliveryDeps,
): Promise<Result<OfferAttemptOutcome, PortFailureError>> {
  const claimed = await deps.deliveries.claim();
  if (!claimed.ok) return claimed;
  const delivery = claimed.value.delivery;
  if (delivery === null) {
    return ok({
      found: false,
      delivered: false,
      abandoned: false,
      maxAttempts: null,
      failure: null,
    });
  }
  /**
   * العرضُ الميّتُ لا يُبعَثُ: انتهت مهلته أو لم يَعُد pending قبل أن يصلَه الإشعارُ.
   * لا إعادةُ إرسالٍ أبديةٌ لصفٍّ لن يُقبل أبدًا — تخلٍّ نهائيٌّ (dead) يُسجَّلُ
   * بالرمزِ كالـfinish، فلا يُسلبَ الصفَّ من حائزه. (BUG-004: مسارٌ حتميٌّ للقدم.)
   */
  if (delivery.offerStatus !== "pending" || offerExpired(delivery.expiresAt, new Date())) {
    const abandoned = await deps.deliveries.abandon({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
    });
    if (!abandoned.ok) return abandoned;
    return ok({
      found: true,
      delivered: false,
      abandoned: true,
      maxAttempts: delivery.maxAttempts,
      failure: null,
    });
  }
  const notification: OfferNotification = {
    orderId: delivery.orderId,
    offerId: delivery.offerId,
    driverId: delivery.driverId,
    distanceKm: Number(delivery.distanceKm) as DistanceKm,
    expiresInSeconds: Math.max(
      0,
      Math.ceil((Date.parse(delivery.expiresAt) - Date.now()) / MS_PER_SECOND),
    ),
  };
  const sent = await deps.publisher.publishOffer(notification);
  const finished = await deps.deliveries.finish({
    deliveryId: delivery.deliveryId,
    claimToken: delivery.claimToken,
    messageId: sent.ok ? sent.value : null,
  });
  // فشل `finish` وحده يُرجَع خطأً: الصفّ عالقٌ في `sending` بلا موعد. أمّا فشلُ
  // النشرِ فقد أُعيد الصفّ به إلى `pending` سليمًا بموعدٍ جديد.
  if (!finished.ok) return finished;
  // `sent.ok` شرطٌ مستقلّ عن جواب القاعدة عن قصد: «سُلّمت» تعني أنّ رسالةً وصلت
  // فعلاً ولها معرّف. لا يجوز أن يُعلن التسليم إلا بمعرّف رسالة حقيقيّ.
  return ok({
    found: true,
    delivered: sent.ok && finished.value,
    abandoned: false,
    maxAttempts: delivery.maxAttempts,
    failure: sent.ok ? null : sent.error.detail,
  });
}

export interface OfferBatchOutcome {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly abandoned: number;
}

/**
 * شوط outbox محدودٌ بإعدادِ المدينةِ الذي أرجعه claim الذرّي. لا يضع حدًّا لعمرِ
 * العرضِ — فشلُ تيليجرام يُعيدُه `pending` بموعدٍ جديد، والعروضُ الميتةُ يُتخلى
 * عنها (dead) فلا تُستهلِكُ الشوطَ ولا تُعادُ أبدًا (BUG-004).
 */
export async function deliverOfferNotificationBatch(
  deps: OfferDeliveryDeps,
): Promise<Result<OfferBatchOutcome, PortFailureError>> {
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  let limit = 1;
  while (claimed < limit) {
    const attempt = await deliverOfferNotification(deps);
    if (!attempt.ok) return attempt;
    if (!attempt.value.found) break;
    claimed += 1;
    if (attempt.value.maxAttempts !== null) limit = attempt.value.maxAttempts;
    if (attempt.value.delivered) delivered += 1;
    if (attempt.value.abandoned) abandoned += 1;
    // فشلُ نشرٍ واحد لا يُسقطُ الشوط: مجموعةُ مدينةٍ معطوبة كانت تمنعُ تسليمَ
    // عروضِ المدنِ الأخرى في نفسِ الدورة. يُعدّ ويُبلَّغ، ويستمرّ الشوط.
    if (attempt.value.failure !== null) failed += 1;
  }
  return ok({ claimed, delivered, failed, abandoned });
}
