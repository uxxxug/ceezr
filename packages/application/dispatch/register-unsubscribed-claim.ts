/**
 * الغرض: تسجيل ضغطة «قبول» من سائق غير مشترك، وفتح قناة التمرير مع صاحب الدور الأول.
 *   الحكم في التنافس كلّه للدالة الذرّية register_unsubscribed_claim (القاعدة 0.5):
 *   لا تُسجَّل ضغطة رابعة، ولا يُسجَّل السائق مرتين، ولا يُسجَّل من كان في الدورة السابقة.
 *   وإخطارُ فتحِ الدورِ يُودَعُ في صندوقِ الصادرِ داخلَ معاملةِ الدالّةِ نفسِها
 *   (BUG-004) لا يُرسَلُ من هنا بعدَها: دورٌ مفتوحٌ وسائقٌ لا يعلمُ به كان أثرَ
 *   تعطّلِ تيليجرامَ لحظةَ الضغطةِ، ولا شيءَ يُعيدُ المحاولةَ.
 * الحالة: منفّذ فعلياً — المرحلة 2.3 (القسم 3.4، الخطوتان 2 و3).
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/groups/unsubscribed-drivers-group.ts
 * ملاحظات مستقبلية: عند إضافة تقييم غير المشتركين يُرتَّب الدور بالتقييم لا بأسبقية الضغط.
 */

import type { DriverId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export type ClaimRegistration =
  | {
      readonly registered: true;
      readonly claimId: string;
      readonly orderId: OrderId;
      readonly position: number;
      readonly slots: number;
      /** true للأول فقط: هو من يُفتح معه التواصل فوراً بلا انتظار اكتمال الثلاثة. */
      readonly isActive: boolean;
      /** عددُ صفوفِ الصادرِ التي أُودِعت في المعاملةِ نفسِها: صفٌّ لكلِّ مُستلِمٍ. */
      readonly notificationsQueued: number;
    }
  | { readonly registered: false; readonly reason: string };

export interface ClaimRegistrationPort {
  registerClaim(
    negotiationId: string,
    driverId: DriverId,
  ): Promise<Result<ClaimRegistration, PortFailureError>>;
}

/** طرفا القناة كما يحتاجهما المُرسِل: معرّفا محادثة ولغتان، بلا رقمي هاتف. */
export interface NegotiationParties {
  readonly negotiationId: string;
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly driverChatId: string;
  readonly driverLanguage: string;
  readonly riderChatId: string;
  readonly riderLanguage: string;
  readonly position: number;
}

export interface RegisterUnsubscribedClaimDependencies {
  readonly claims: ClaimRegistrationPort;
}

export interface RegisterClaimReport {
  readonly registered: boolean;
  readonly position: number | null;
  readonly slots: number | null;
  readonly isActive: boolean;
  readonly orderId: OrderId | null;
  /** سبب الرفض حرفياً من القاعدة: ALREADY_CLAIMED، SLOTS_FULL، EXCLUDED_PREVIOUS_CYCLE… */
  readonly reason: string | null;
  /** كم صفَّ صادرٍ أُودِعَ مع التسجيلِ — لا كم رسالةً وصلت: الوصولُ شأنُ العاملِ. */
  readonly notificationsQueued: number;
}

/**
 * التسجيلُ وحدَه: الدالّةُ الذرّيةُ تفتحُ الدورَ للأولِ وتُودِعُ إخطارَ طرفَيه في
 * صندوقِ الصادرِ في معاملتِها، فلا أثرَ خارجيًّا هنا بعدَ commit. ولا شيءَ يُبطِلُ
 * التسجيلَ من أجلِ رسالةٍ: الرسالةُ صفٌّ باقٍ يُعادُ حتى يصل.
 */
export async function registerUnsubscribedClaim(
  input: { readonly negotiationId: string; readonly driverId: DriverId },
  deps: RegisterUnsubscribedClaimDependencies,
): Promise<Result<RegisterClaimReport, PortFailureError>> {
  const registered = await deps.claims.registerClaim(input.negotiationId, input.driverId);
  if (!registered.ok) return registered;

  const outcome = registered.value;
  if (!outcome.registered) {
    return ok({
      registered: false,
      position: null,
      slots: null,
      isActive: false,
      orderId: null,
      reason: outcome.reason,
      notificationsQueued: 0,
    });
  }

  return ok({
    registered: true,
    position: outcome.position,
    slots: outcome.slots,
    isActive: outcome.isActive,
    orderId: outcome.orderId,
    reason: null,
    notificationsQueued: outcome.notificationsQueued,
  });
}
