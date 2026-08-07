/**
 * الغرض: بدء الرحلة وإنهاؤها — الانتقالان اللذان بلاهما لا توجد رحلة منتهية تُقيَّم.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/reputation
 * يُتوقع أن يستخدمه لاحقاً: حوار بوت السائق، لوحة الإدارة (صفحة الطلبات الحيّة)
 * ملاحظات مستقبلية: عند إضافة تسعير فعلي يعود مبلغ الرحلة في ملخّص الإنهاء.
 */

import type { RideLifecycleReason } from "../../domain/reputation/index.ts";
import type { OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** طرف في الرحلة كما يجب أن يُخاطَب: بمعرّفه ولغته هو، لا بلغة النظام. */
export interface RideParty {
  readonly telegramId: string;
  readonly languageCode: string;
  readonly fullName: string;
}

export interface CompletionSummary {
  readonly orderId: OrderId;
  readonly durationSeconds: number;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly driver: RideParty;
  readonly rider: RideParty;
}

export interface RideLifecyclePort {
  start(input: {
    readonly orderId: OrderId;
    readonly driverTelegramId: string;
  }): Promise<Result<{ ok: boolean; reason: RideLifecycleReason | null }, PortFailureError>>;
  complete(input: {
    readonly orderId: OrderId;
    readonly driverTelegramId: string;
  }): Promise<
    Result<
      { ok: boolean; reason: RideLifecycleReason | null; summary: CompletionSummary | null },
      PortFailureError
    >
  >;
}

export interface StartReport {
  readonly started: boolean;
  readonly reason: RideLifecycleReason | null;
}

export interface CompleteReport {
  readonly completed: boolean;
  readonly reason: RideLifecycleReason | null;
  readonly summary: CompletionSummary | null;
}

export async function startRide(
  input: { readonly orderId: OrderId; readonly driverTelegramId: string },
  deps: { readonly lifecycle: RideLifecyclePort },
): Promise<Result<StartReport, PortFailureError>> {
  const outcome = await deps.lifecycle.start(input);
  if (!outcome.ok) return outcome;
  return ok({ started: outcome.value.ok, reason: outcome.value.reason });
}

export async function completeRide(
  input: { readonly orderId: OrderId; readonly driverTelegramId: string },
  deps: { readonly lifecycle: RideLifecyclePort },
): Promise<Result<CompleteReport, PortFailureError>> {
  const outcome = await deps.lifecycle.complete(input);
  if (!outcome.ok) return outcome;
  return ok({
    completed: outcome.value.ok,
    reason: outcome.value.reason,
    summary: outcome.value.summary,
  });
}
