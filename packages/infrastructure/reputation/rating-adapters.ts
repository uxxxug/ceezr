/**
 * الغرض: محوّلات منافذ السمعة فوق دوالّ القاعدة — لا منطق قرار هنا، ترجمة فقط.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: infrastructure/reputation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: أي سبب جديد تعيده الدالّة يُضاف إلى أنواع domain/reputation أولاً.
 */

import type {
  CompletionSummary,
  RatingFlagPort,
  RatingPort,
  RatingRecomputePort,
  ReputationReader,
  RideLifecyclePort,
  StartSummary,
} from "../../application/reputation/index.ts";
import type {
  FlagRatingReason,
  RatingDirection,
  RideLifecycleReason,
  SubmitRatingReason,
} from "../../domain/reputation/index.ts";
import type { OrderId } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql } from "../db/client.ts";

/** طرف الرحلة كما يعود في jsonb — الحقول اختيارية دفاعياً لا تفاؤلاً. */
interface RawParty {
  readonly telegram_id?: string | number;
  readonly language_code?: string;
  readonly full_name?: string;
}

function party(raw: unknown): { telegramId: string; languageCode: string; fullName: string } {
  const value = (raw ?? {}) as RawParty;
  return {
    telegramId: String(value.telegram_id ?? ""),
    languageCode: value.language_code ?? "ar",
    fullName: value.full_name ?? "",
  };
}

export function createRatingPort(sql: Sql): RatingPort {
  return {
    submit: (input) =>
      guard("rpc.submit_rating", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select submit_rating(
            ${input.orderId}::uuid,
            ${input.raterTelegramId}::bigint,
            ${input.stars}::smallint,
            ${input.comment}::text
          ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) {
          return { ok: false, ratingId: null, direction: null, reason: null };
        }
        return {
          ok: envelope.ok,
          ratingId: envelope.ok ? String(envelope.rating_id) : null,
          direction: envelope.ok ? (String(envelope.direction) as RatingDirection) : null,
          reason: envelope.ok ? null : ((envelope.error ?? null) as SubmitRatingReason | null),
        };
      }),
  };
}

export function createRideLifecyclePort(sql: Sql): RideLifecyclePort {
  return {
    start: (input) =>
      guard("rpc.start_ride", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select start_ride(${input.orderId}::uuid, ${input.driverTelegramId}::bigint) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) return { ok: false, reason: null, summary: null };
        if (!envelope.ok) {
          return {
            ok: false,
            reason: (envelope.error ?? null) as RideLifecycleReason | null,
            summary: null,
          };
        }
        const summary: StartSummary = {
          orderId: String(envelope.order_id) as OrderId,
          service: String(envelope.service ?? ""),
          pickupLabel: (envelope.pickup_label as string | null) ?? null,
          dropoffLabel: (envelope.dropoff_label as string | null) ?? null,
          driver: party(envelope.driver),
          rider: party(envelope.rider),
        };
        return { ok: true, reason: null, summary };
      }),

    complete: (input) =>
      guard("rpc.complete_ride", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select complete_ride(${input.orderId}::uuid, ${input.driverTelegramId}::bigint) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) return { ok: false, reason: null, summary: null };
        if (!envelope.ok) {
          return {
            ok: false,
            reason: (envelope.error ?? null) as RideLifecycleReason | null,
            summary: null,
          };
        }
        const summary: CompletionSummary = {
          orderId: String(envelope.order_id) as OrderId,
          durationSeconds: Number(envelope.duration_seconds ?? 0),
          service: String(envelope.service ?? ""),
          pickupLabel: (envelope.pickup_label as string | null) ?? null,
          dropoffLabel: (envelope.dropoff_label as string | null) ?? null,
          driver: party(envelope.driver),
          rider: party(envelope.rider),
        };
        return { ok: true, reason: null, summary };
      }),
  };
}

export function createRatingFlagPort(sql: Sql): RatingFlagPort {
  return {
    flag: (input) =>
      guard("rpc.flag_rating", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select flag_rating(${input.ratingId}::uuid, ${input.actorTelegramId}::bigint) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) return { ok: false, reason: null };
        return {
          ok: envelope.ok,
          reason: envelope.ok ? null : ((envelope.error ?? null) as FlagRatingReason | null),
        };
      }),
  };
}

export function createRatingRecomputePort(sql: Sql): RatingRecomputePort {
  return {
    recompute: () =>
      guard("rpc.recompute_rating_averages", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select recompute_rating_averages() as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        return {
          driversUpdated: Number(envelope?.drivers_updated ?? 0),
          ridersUpdated: Number(envelope?.riders_updated ?? 0),
        };
      }),
  };
}

export function createReputationReader(sql: Sql): ReputationReader {
  return {
    summaryFor: (telegramId) =>
      guard("rpc.get_reputation_summary", async () => {
        const rows = await sql<{ result: unknown }[]>`
          select get_reputation_summary(${telegramId}::bigint) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null || !envelope.ok) return null;

        const snapshot = (raw: unknown) => {
          if (raw === null || raw === undefined) return null;
          const value = raw as { average?: number | string | null; count?: number };
          return {
            average:
              value.average === null || value.average === undefined ? null : Number(value.average),
            count: Number(value.count ?? 0),
          };
        };

        const received = Array.isArray(envelope.received) ? envelope.received : [];
        return {
          asDriver: snapshot(envelope.as_driver),
          asRider: snapshot(envelope.as_rider),
          received: received.map((raw) => {
            const value = raw as {
              stars: number;
              direction: string;
              comment: string | null;
              created_at: string;
            };
            return {
              stars: Number(value.stars),
              direction: String(value.direction),
              comment: value.comment ?? null,
              createdAt: new Date(value.created_at),
            };
          }),
        };
      }),
  };
}
