/**
 * الغرض: قرار الدعم على التذكرة: تفعيل الاشتراك، أو إنهاؤه يدوياً، أو رفض الطلب —
 *   مع تبليغ صاحب التذكرة بالنتيجة في المسار نفسه.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: application/dispute
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (أزرار القروب و/activate)، apps/admin-dashboard
 * ملاحظات مستقبلية: مدّة التفعيل تُقرأ من platform_settings داخل الدالة الذرّية، لا هنا.
 */

import type { ResolveTicketReason, SupportResolution } from "../../domain/dispute/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface ResolveOutcome {
  readonly resolved: boolean;
  readonly reason: ResolveTicketReason | null;
  readonly action: SupportResolution | null;
  /** معرّف تلغرام لصاحب التذكرة — تعيده القاعدة لنبلّغه بلا استعلام ثانٍ. */
  readonly ownerTelegramId: string | null;
  /** لغة صاحب التذكرة كما سجّلها — نبلّغه بها لا بلغة النظام. */
  readonly ownerLanguage: string | null;
  readonly status: string | null;
}

/** يقابل resolve_support_ticket: القرار وأثره على الاشتراك في معاملة واحدة. */
export interface SupportResolutionPort {
  resolve(input: {
    readonly ticketId: string;
    readonly actorTelegramId: string;
    readonly action: SupportResolution;
    readonly note: string | null;
  }): Promise<Result<ResolveOutcome, PortFailureError>>;
}

/** تبليغ صاحب التذكرة بالقرار في محادثته الخاصة. */
export interface TicketOwnerNotifier {
  notifyResolution(input: {
    readonly telegramId: string;
    readonly action: SupportResolution;
    readonly language: string;
  }): Promise<Result<void, PortFailureError>>;
}

export interface ResolveDisputeDependencies {
  readonly resolutions: SupportResolutionPort;
  readonly notifier: TicketOwnerNotifier;
}

export interface ResolveReport extends ResolveOutcome {
  /** هل وصل التبليغ فعلاً؟ فشله لا يُبطل القرار لكنه يجب أن يظهر لا أن يُخفى. */
  readonly ownerNotified: boolean;
}

/**
 * التبليغ بعد القرار لا قبله: لو بلّغنا أولاً ثم فشل التفعيل لكان السائق قد قرأ
 * «تم تفعيل اشتراكك» واشتراكه منتهٍ — وهذا أسوأ من عدم التبليغ.
 */
export async function resolveDispute(
  input: {
    readonly ticketId: string;
    readonly actorTelegramId: string;
    readonly action: SupportResolution;
    readonly note?: string | null;
  },
  deps: ResolveDisputeDependencies,
): Promise<Result<ResolveReport, PortFailureError>> {
  const resolved = await deps.resolutions.resolve({
    ticketId: input.ticketId,
    actorTelegramId: input.actorTelegramId,
    action: input.action,
    note: input.note ?? null,
  });
  if (!resolved.ok) return resolved;

  const outcome = resolved.value;
  if (!outcome.resolved || outcome.ownerTelegramId === null) {
    return ok({ ...outcome, ownerNotified: false });
  }

  const notified = await deps.notifier.notifyResolution({
    telegramId: outcome.ownerTelegramId,
    action: input.action,
    language: outcome.ownerLanguage ?? "ar",
  });
  return ok({ ...outcome, ownerNotified: notified.ok });
}
