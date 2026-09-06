/**
 * الغرض: تدوير الدور بين المسجَّلين، وإتمام الاتفاق. عمليتان لا ثالث لهما في القسم 3.4:
 *   إمّا يضغط العميل «تم الاتفاق» فيُسنَد الطلب ذرّياً، وإمّا يرفض أو تنتهي المهلة
 *   فيُغلق دور الأول ويُفتح الذي يليه بنفس المنطق حتى ينفد الثلاثة.
 *   وإخطاراتُ الإغلاقِ والفتحِ والاتفاقِ تُودَعُ في صندوقِ الصادرِ داخلَ معاملةِ
 *   الدالّةِ الذرّيةِ نفسِها (BUG-004): طلبٌ صارَ matched ورسالةُ اتفاقٍ ضاعت كانَ
 *   يعني عميلاً له سائقٌ لا يعلمُ أنّه اتُّفِقَ عليه، ولا شيءَ يُعيدُ المحاولةَ.
 * الحالة: منفّذ فعلياً — المرحلة 2.3 (القسم 3.4، الخطوتان 4 و5).
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل (زرّ الاتفاق/الرفض)، apps/workers (انتهاء المهلة)
 * ملاحظات مستقبلية: عند إضافة تسعير التفاوض يُسجَّل السعر المتفَق عليه مع الاتفاق نفسه.
 */

import type { NegotiationSnapshot } from "../../domain/dispatch/negotiation.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type AdvanceOutcome =
  | {
      readonly advanced: true;
      readonly exhausted: false;
      readonly claimId: string;
      readonly position: number;
      readonly orderId: OrderId;
      /** صفوفُ الصادرِ المودَعةُ في المعاملةِ: إغلاقُ دورٍ وفتحُ آخرَ لطرفَيهما. */
      readonly notificationsQueued: number;
    }
  | {
      readonly advanced: true;
      readonly exhausted: true;
      readonly orderId: OrderId;
      readonly notificationsQueued: number;
    }
  | { readonly advanced: false; readonly reason: string };

export type SettleOutcome =
  | {
      readonly settled: true;
      readonly orderId: OrderId;
      readonly driverId: string;
      readonly notificationsQueued: number;
    }
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
}

export interface RotateReport {
  readonly negotiationId: string;
  readonly advanced: boolean;
  readonly exhausted: boolean;
  readonly nextPosition: number | null;
  readonly orderId: OrderId | null;
  readonly reason: string | null;
  /** صفوفُ الصادرِ المودَعةُ مع التدويرِ — لا رسائلُ وصلت: الوصولُ شأنُ العاملِ. */
  readonly notificationsQueued: number;
}

/**
 * يغلق دور المطالبة النشطة ويفتح التي تليها.
 * ولا قراءةَ لطرفَي القناةِ هنا: الدالّةُ الذرّيةُ نفسُها تعرفُ من أُغلِقَ دورُه ومن
 * فُتِحَ له — هي التي بدّلتهما — فتُودِعُ إخطارَ كلٍّ منهما بمعرّفِ مطالبتِه في
 * معاملتِها. القراءةُ من هنا كانت تُخطِرُ الطرفَ الخطأَ لو تغيّرَ بينهما شيءٌ.
 */
export async function advanceNegotiationTurn(
  input: { readonly negotiationId: string; readonly reason: "declined" | "expired" },
  deps: RotateNegotiationDependencies,
): Promise<Result<RotateReport, PortFailureError>> {
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
      notificationsQueued: 0,
    });
  }

  if (outcome.exhausted) {
    return ok({
      negotiationId: input.negotiationId,
      advanced: true,
      exhausted: true,
      nextPosition: null,
      orderId: outcome.orderId,
      reason: null,
      notificationsQueued: outcome.notificationsQueued,
    });
  }

  return ok({
    negotiationId: input.negotiationId,
    advanced: true,
    exhausted: false,
    nextPosition: outcome.position,
    orderId: outcome.orderId,
    reason: null,
    notificationsQueued: outcome.notificationsQueued,
  });
}

export interface SettleReport {
  readonly negotiationId: string;
  readonly settled: boolean;
  readonly orderId: OrderId | null;
  readonly driverId: string | null;
  readonly reason: string | null;
  readonly notificationsQueued: number;
}

/**
 * «تم الاتفاق» من العميل: الطلب يصير matched بنفس ذرّية claim_ride في المسار المشترك.
 * وإخطارُ الطرفَينِ يُودَعُ في المعاملةِ نفسِها، فلا يقعُ إسنادٌ بلا تبليغٍ يُعادُ.
 */
export async function settleNegotiation(
  input: { readonly negotiationId: string },
  deps: RotateNegotiationDependencies,
): Promise<Result<SettleReport, PortFailureError>> {
  const settled = await deps.rotation.settle(input.negotiationId);
  if (!settled.ok) return settled;

  if (!settled.value.settled) {
    return ok({
      negotiationId: input.negotiationId,
      settled: false,
      orderId: null,
      driverId: null,
      reason: settled.value.reason,
      notificationsQueued: 0,
    });
  }

  return ok({
    negotiationId: input.negotiationId,
    settled: true,
    orderId: settled.value.orderId,
    driverId: settled.value.driverId,
    reason: null,
    notificationsQueued: settled.value.notificationsQueued,
  });
}
