/**
 * الغرض: كل ما تمسّه المطابقة في القاعدة: المرشّحون، العروض، فتح دورة بثّ، القبول الذرّي، والرفض.
 *   القبول لا يُنفَّذ هنا منطقياً إطلاقاً: يُفوَّض كاملاً إلى الدالة claim_ride (القاعدة 0.5).
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/dispatch
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/*، apps/workers
 * ملاحظات مستقبلية: عند كبر عدد السائقين يُضاف فلتر مكاني بـ ST_DWithin بنصف قطر المدينة.
 */

import type { OfferDecisionPort } from "../../application/bots/types.ts";
import type { OfferWriter, OpenRoundInput } from "../../application/dispatch/broadcast-offers.ts";
import type {
  ExpireOffersRpcPort,
  PendingOfferRepository,
} from "../../application/dispatch/expire-offers-ports.ts";
import type {
  DispatchRpcPort,
  DriverCandidateRepository,
  OfferRepository,
} from "../../application/ports/index.ts";
import type { DriverCapability } from "../../domain/capability/entity.ts";
import type { DriverCandidate } from "../../domain/dispatch/entity.ts";
import type { Offer, OfferStatus } from "../../domain/dispatch/value-objects.ts";
import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../../domain/subscription/entity.ts";
import type { CityId, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

interface CandidateRow {
  readonly driver_id: string;
  readonly city_id: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly is_available: boolean | null;
  readonly verification_status: string;
  readonly is_blocked: boolean;
  readonly rating_average: string | null;
  readonly rating_count: number;
  readonly services: readonly string[] | null;
  readonly sub_plan: string | null;
  readonly sub_status: string | null;
  readonly sub_trial_ends_at: Date | null;
  readonly sub_current_period_end: Date | null;
}

function toCandidate(row: CandidateRow): DriverCandidate {
  const driverId = row.driver_id as DriverId;
  const cityId = row.city_id as CityId;
  const capabilities: readonly DriverCapability[] = (row.services ?? []).map((service) => ({
    driverId,
    cityId,
    service: service as ServiceType,
    isEnabled: true,
  }));
  const subscription: Subscription | null =
    row.sub_status === null || row.sub_plan === null
      ? null
      : {
          driverId,
          cityId,
          plan: row.sub_plan as SubscriptionPlan,
          status: row.sub_status as SubscriptionStatus,
          trialEndsAt: row.sub_trial_ends_at,
          currentPeriodEnd: row.sub_current_period_end,
        };
  return {
    driverId,
    cityId,
    /**
     * غياب الموقع يُمرّر كـ`null` لا كـ(0,0): الصفر إحداثية صالحة في المحيط الأطلسي،
     * وتمريرها يجعل الدومين يحسب مسافة حقيقية من موقع مختلق ويردّ `OUT_OF_RADIUS`
     * بدلاً من `NO_LOCATION` — فيُطارد المشغّل سبباً خاطئاً.
     */
    location:
      row.lat === null || row.lng === null
        ? null
        : { latitude: Number(row.lat), longitude: Number(row.lng) },
    isAvailable: row.is_available === true,
    isVerified: row.verification_status === "verified",
    isBlocked: row.is_blocked,
    ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
    ratingCount: Number(row.rating_count ?? 0),
    capabilities,
    subscription,
  };
}

export function createDriverCandidateRepository(sql: Sql): DriverCandidateRepository {
  return {
    /**
     * يجلب كلّ سائقي المدينة؛ الفلترة والترتيب مسؤولية الدومين لا القاعدة.
     *
     * حُذف شرط `and d.last_location is not null` قصداً: كان يجعل القاعدة تتخذ قرار
     * استبعاد تملكه القواعد التجارية وحدها، فيختفي السائق قبل أن يُسمّى سببه — وهو
     * نفس العلّة التي من أجلها نُقل `is_blocked` من SQL إلى الدومين سابقاً.
     * الأثر العمليّ: سائق بلا موقع لا يُسنَد إليه شيء كما كان، لكنّه يظهر الآن في
     * `evaluation.rejected` بـ`NO_LOCATION`، فيراه المشغّل ويُذكّر بإرسال موقعه.
     */
    findAvailableInCity: (cityId: CityId) =>
      guard("candidates.findAvailableInCity", async () => {
        const rows = await sql<CandidateRow[]>`
          select d.id as driver_id,
                 d.city_id,
                 st_y(d.last_location::geometry) as lat,
                 st_x(d.last_location::geometry) as lng,
                 a.is_available,
                 d.verification_status,
                 u.is_blocked,
                 d.rating_average,
                 d.rating_count,
                 (select array_agg(c.service::text)
                    from driver_capabilities c
                   where c.driver_id = d.id and c.is_enabled) as services,
                 s.plan as sub_plan,
                 s.status as sub_status,
                 s.trial_ends_at as sub_trial_ends_at,
                 s.current_period_end as sub_current_period_end
            from drivers d
            join users u on u.id = d.user_id
            left join driver_availability a on a.driver_id = d.id
            left join subscriptions s
                   on s.driver_id = d.id and s.status in ('trialing', 'active')
           where d.city_id = ${cityId}
        `;
        return rows.map(toCandidate);
      }),
  };
}

interface OfferRow {
  readonly order_id: string;
  readonly driver_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly round: number;
}

export function createOfferRepository(sql: Sql): OfferRepository {
  return {
    findByOrder: (orderId: OrderId) =>
      guard("offers.findByOrder", async () => {
        const rows = await sql<OfferRow[]>`
          select order_id, driver_id, status, created_at, round
            from order_offers
           where order_id = ${orderId}
           order by round, created_at
        `;
        return rows.map(
          (row): Offer => ({
            orderId: row.order_id as OrderId,
            driverId: row.driver_id as DriverId,
            status: row.status as OfferStatus,
            sentAt: row.created_at,
            round: row.round,
          }),
        );
      }),
  };
}

export function createOfferWriter(sql: Sql): OfferWriter {
  return {
    /** فتح دورة بثّ: تُكتب العروض ويُرفع رقم دورة الطلب في معاملة واحدة. */
    openRound: (input: OpenRoundInput) =>
      guard("offers.openRound", async () => {
        await sql.begin(async (tx) => {
          for (const entry of input.entries) {
            await tx`
              insert into order_offers
                (city_id, order_id, driver_id, round, score, distance_km, status, expires_at)
              values (${input.cityId}, ${input.orderId}, ${entry.driverId}, ${input.round},
                      ${entry.score}, ${entry.distanceKm}, 'pending', ${input.expiresAt})
              on conflict (order_id, driver_id, round) do nothing
            `;
          }
          await tx`
            update orders set broadcast_round = ${input.round}, updated_at = now()
             where id = ${input.orderId}
          `;
        });
      }),
  };
}

export function createDispatchRpc(sql: Sql): DispatchRpcPort {
  return {
    claimRide: (orderId: OrderId, driverId: DriverId) =>
      guard("rpc.claim_ride", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select claim_ride(${orderId}::uuid, ${driverId}::uuid) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ claim_ride غير مفهوم");
        return {
          claimed: envelope.ok,
          reason: envelope.ok ? null : (envelope.error ?? "UNKNOWN"),
        };
      }),
  };
}

export function createOfferDecisionPort(sql: Sql): OfferDecisionPort {
  return {
    /** الرفض يمسّ العرض المعلَّق فقط: عرضٌ مقبول أو منتهٍ لا يُرفض بأثر رجعي. */
    reject: (orderId: OrderId, driverId: DriverId) =>
      guard("offers.reject", async () => {
        const rows = await sql<{ id: string }[]>`
          update order_offers
             set status = 'rejected', responded_at = now(), updated_at = now()
           where order_id = ${orderId}
             and driver_id = ${driverId}
             and status = 'pending'
          returning id
        `;
        return rows.length > 0;
      }),
  };
}

/** تحديث موقع السائق — يغذّي المطابقة، فبلا موقع حديث لا يكون السائق مرشَّحاً. */
export function createDriverLocationWriter(sql: Sql) {
  return async (driverId: DriverId, latitude: number, longitude: number): Promise<void> => {
    await sql`
      update drivers
         set last_location = st_setsrid(st_makepoint(${longitude}, ${latitude}), 4326)::geography,
             last_location_at = now(),
             updated_at = now()
       where id = ${driverId}
    `;
  };
}

/**
 * العروض المعلَّقة في مدينة واحدة مع معرّفاتها. المعرّف ضروري لأن مهمّة الإنهاء
 * تقرّر بالمهلة التجارية للمدينة ثم تُنهي عروضاً بعينها، لا كل ما مضى وقته.
 */
export function createPendingOfferRepository(sql: Sql): PendingOfferRepository {
  const base = createOfferRepository(sql);
  return {
    findByOrder: base.findByOrder,

    findPendingInCity: (cityId: CityId) =>
      guard("offers.findPendingInCity", async () => {
        const rows = await sql<(OfferRow & { readonly id: string })[]>`
          select id, order_id, driver_id, status, created_at, round
            from order_offers
           where city_id = ${cityId}
             and status = 'pending'
           order by created_at
        `;
        return rows.map((row) => ({
          id: row.id,
          orderId: row.order_id as OrderId,
          driverId: row.driver_id as DriverId,
          status: row.status as OfferStatus,
          sentAt: row.created_at,
          round: row.round,
        }));
      }),
  };
}

/**
 * إنهاء عروض بعينها في عبارة واحدة. شرط status = 'pending' جزءٌ من العبارة نفسها لا
 * فحصٌ قبلها: سائقٌ يقبل في نفس اللحظة التي تعمل فيها المهمّة يجب أن يفوز بالقبول،
 * والقيد order_offers_single_accepted يحرس النتيجة في القاعدة على كل حال.
 */
export function createExpireOffersRpc(sql: Sql): ExpireOffersRpcPort {
  return {
    expireStaleOffers: (_cityId: CityId, offerIds: readonly string[]) =>
      guard("offers.expireStaleOffers", async () => {
        if (offerIds.length === 0) return 0;
        const rows = await sql<{ id: string }[]>`
          update order_offers
             set status = 'expired', responded_at = now(), updated_at = now()
           where id = any(${sql.array(offerIds as string[])}::uuid[])
             and status = 'pending'
          returning id
        `;
        return rows.length;
      }),
  };
}
