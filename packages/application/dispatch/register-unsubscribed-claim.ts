/**
 * الغرض: تسجيل ضغطة «قبول» من سائق غير مشترك، وفتح قناة التمرير مع صاحب الدور الأول.
 *   الحكم في التنافس كلّه للدالة الذرّية register_unsubscribed_claim (القاعدة 0.5):
 *   لا تُسجَّل ضغطة رابعة، ولا يُسجَّل السائق مرتين، ولا يُسجَّل من كان في الدورة السابقة.
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

export interface NegotiationPartiesReader {
  /** طرفا الدورة عند مطالبتها النشطة الآن، أو null إن لم تكن في تفاوض. */
  findParties(negotiationId: string): Promise<Result<NegotiationParties | null, PortFailureError>>;
}

export interface NegotiationNotifier {
  /** يُخطر الطرفين بأن الدور فُتح، ويعطي العميل زرّي «تم الاتفاق» و«غير مناسب». */
  notifyTurnOpened(
    parties: NegotiationParties,
    deadlineSeconds: number,
  ): Promise<Result<void, PortFailureError>>;
  /** يُخطر الطرفين بإغلاق الدور: رفضاً أو انتهاء مهلة. */
  notifyTurnClosed(
    parties: NegotiationParties,
    reason: "declined" | "expired",
  ): Promise<Result<void, PortFailureError>>;
  /** يُخطر الطرفين بالاتفاق النهائي وإسناد الطلب. */
  notifyAgreed(parties: NegotiationParties): Promise<Result<void, PortFailureError>>;
}

/** المهلة تأتي من platform_settings عبر هذا المنفذ، فلا رقم في الكود. */
export interface NegotiationTimeoutReader {
  negotiateSecondsFor(negotiationId: string): Promise<Result<number, PortFailureError>>;
}

export interface RegisterUnsubscribedClaimDependencies {
  readonly claims: ClaimRegistrationPort;
  readonly parties: NegotiationPartiesReader;
  readonly notifier: NegotiationNotifier;
  readonly timeouts: NegotiationTimeoutReader;
}

export interface RegisterClaimReport {
  readonly registered: boolean;
  readonly position: number | null;
  readonly slots: number | null;
  readonly isActive: boolean;
  readonly orderId: OrderId | null;
  /** سبب الرفض حرفياً من القاعدة: ALREADY_CLAIMED، SLOTS_FULL، EXCLUDED_PREVIOUS_CYCLE… */
  readonly reason: string | null;
  /** هل وصل إخطار فتح الدور فعلاً — يُفرَّق عن نجاح التسجيل نفسه. */
  readonly turnNotified: boolean;
}

/**
 * التسجيل ثم — للأول وحده — فتح القناة. فشل الإخطار لا يُبطل التسجيل: الصفّ مكتوب
 * في القاعدة والعامل سيلتقط الدورة عند انتهاء المهلة، والإبطال هنا كان سيضيّع الدور
 * على سائق سجّل بحقّ لمجرّد تعذّر رسالة.
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
      turnNotified: false,
    });
  }

  const base = {
    registered: true as const,
    position: outcome.position,
    slots: outcome.slots,
    isActive: outcome.isActive,
    orderId: outcome.orderId,
    reason: null,
  };

  if (!outcome.isActive) return ok({ ...base, turnNotified: false });

  const parties = await deps.parties.findParties(input.negotiationId);
  if (!parties.ok) return parties;
  if (parties.value === null) return ok({ ...base, turnNotified: false });

  const seconds = await deps.timeouts.negotiateSecondsFor(input.negotiationId);
  if (!seconds.ok) return seconds;

  const notified = await deps.notifier.notifyTurnOpened(parties.value, seconds.value);
  return ok({ ...base, turnNotified: notified.ok });
}
