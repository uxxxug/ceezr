/**
 * الغرض: تدوير الدور بين المسجَّلين، وإتمام الاتفاق. عمليتان لا ثالث لهما في القسم 3.4:
 *   إمّا يضغط العميل «تم الاتفاق» فيُسنَد الطلب ذرّياً، وإمّا يرفض أو تنتهي المهلة
 *   فيُغلق دور الأول ويُفتح الذي يليه بنفس المنطق حتى ينفد الثلاثة.
 * الحالة: منفّذ فعلياً — المرحلة 2.3 (القسم 3.4، الخطوتان 4 و5).
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل (زرّ الاتفاق/الرفض)، apps/workers (انتهاء المهلة)
 * ملاحظات مستقبلية: عند إضافة تسعير التفاوض يُسجَّل السعر المتفَق عليه مع الاتفاق نفسه.
 */

import type { NegotiationSnapshot } from "../../domain/dispatch/negotiation.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import type {
  NegotiationNotifier,
  NegotiationPartiesReader,
  NegotiationTimeoutReader,
} from "./register-unsubscribed-claim.ts";

export type AdvanceOutcome =
  | {
      readonly advanced: true;
      readonly exhausted: false;
      readonly claimId: string;
      readonly position: number;
      readonly orderId: OrderId;
    }
  | { readonly advanced: true; readonly exhausted: true; readonly orderId: OrderId }
  | { readonly advanced: false; readonly reason: string };

export type SettleOutcome =
  | { readonly settled: true; readonly orderId: OrderId; readonly driverId: string }
  | { readonly settled: false; readonly reason: string };

/** منفذا الكتابة الذرّية — advance_unsubscribed_negotiation و settle_unsubscribed_negotiation. */
export interface NegotiationRotationPort {
  advance(
    negotiationId: string,
    reason: "declined" | "expired",
  ): Promise<Result<AdvanceOutcome, PortFailureError>>;
  settle(negotiationId: string): Promise<Result<SettleOutcome, PortFailureError>>;
  /** إغلاق نهائي لدورة لم يعد يُنتظر منها شيء — ما يجعل المهمة الدورية لا تُعيد معالجتها. */
  close(negotiationId: string, reason: string): Promise<Result<boolean, PortFailureError>>;
}

/** لقطة دورة مع سقف دورات مدينتها — السقف من platform_settings لا من الكود. */
export interface PendingNegotiation {
  readonly snapshot: NegotiationSnapshot;
  readonly maxCycles: number;
}

export interface NegotiationSnapshotReader {
  /** كل دورة في المدينة تنتظر قراراً: تجمع، أو تتفاوض، أو نفدت. */
  findPending(cityId: CityId): Promise<Result<readonly PendingNegotiation[], PortFailureError>>;
}

export interface RotateNegotiationDependencies {
  readonly rotation: NegotiationRotationPort;
  readonly parties: NegotiationPartiesReader;
  readonly notifier: NegotiationNotifier;
  readonly timeouts: NegotiationTimeoutReader;
}

export interface RotateReport {
  readonly negotiationId: string;
  readonly advanced: boolean;
  readonly exhausted: boolean;
  readonly nextPosition: number | null;
  readonly orderId: OrderId | null;
  readonly reason: string | null;
}

/**
 * يغلق دور المطالبة النشطة ويفتح التي تليها.
 * الطرفان يُقرآن قبل التدوير وبعده: الأول لإخطار من أُغلق دوره، والثاني لإخطار من فُتح له.
 * لولا القراءتين لأخطرنا الطرف الخطأ، لأن الدالة تُبدّل المطالبة النشطة بينهما.
 */
export async function advanceNegotiationTurn(
  input: { readonly negotiationId: string; readonly reason: "declined" | "expired" },
  deps: RotateNegotiationDependencies,
): Promise<Result<RotateReport, PortFailureError>> {
  const before = await deps.parties.findParties(input.negotiationId);
  if (!before.ok) return before;

  const advanced = await deps.rotation.advance(input.negotiationId, input.reason);
  if (!advanced.ok) return advanced;

  const outcome = advanced.value;
  if (!outcome.advanced) {
    return ok({
      negotiationId: input.negotiationId,
      advanced: false,
      exhausted: false,
      nextPosition: null,
      orderId: null,
      reason: outcome.reason,
    });
  }

  if (before.value !== null) {
    await deps.notifier.notifyTurnClosed(before.value, input.reason);
  }

  if (outcome.exhausted) {
    return ok({
      negotiationId: input.negotiationId,
      advanced: true,
      exhausted: true,
      nextPosition: null,
      orderId: outcome.orderId,
      reason: null,
    });
  }

  const after = await deps.parties.findParties(input.negotiationId);
  if (!after.ok) return after;

  if (after.value !== null) {
    const seconds = await deps.timeouts.negotiateSecondsFor(input.negotiationId);
    if (seconds.ok) {
      await deps.notifier.notifyTurnOpened(after.value, seconds.value);
    }
  }

  return ok({
    negotiationId: input.negotiationId,
    advanced: true,
    exhausted: false,
    nextPosition: outcome.position,
    orderId: outcome.orderId,
    reason: null,
  });
}

export interface SettleReport {
  readonly negotiationId: string;
  readonly settled: boolean;
  readonly orderId: OrderId | null;
  readonly driverId: string | null;
  readonly reason: string | null;
}

/**
 * «تم الاتفاق» من العميل: الطلب يصير matched بنفس ذرّية claim_ride في المسار المشترك.
 * الطرفان يُقرآن قبل الإتمام لأن الإتمام يُفرِّغ المطالبة النشطة من الدورة.
 */
export async function settleNegotiation(
  input: { readonly negotiationId: string },
  deps: RotateNegotiationDependencies,
): Promise<Result<SettleReport, PortFailureError>> {
  const before = await deps.parties.findParties(input.negotiationId);
  if (!before.ok) return before;

  const settled = await deps.rotation.settle(input.negotiationId);
  if (!settled.ok) return settled;

  if (!settled.value.settled) {
    return ok({
      negotiationId: input.negotiationId,
      settled: false,
      orderId: null,
      driverId: null,
      reason: settled.value.reason,
    });
  }

  if (before.value !== null) {
    await deps.notifier.notifyAgreed(before.value);
  }

  return ok({
    negotiationId: input.negotiationId,
    settled: true,
    orderId: settled.value.orderId,
    driverId: settled.value.driverId,
    reason: null,
  });
}
