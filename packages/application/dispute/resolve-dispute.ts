/**
 * الغرض: قرار الدعم على التذكرة: تفعيل الاشتراك، أو إنهاؤه يدوياً، أو رفض الطلب —
 *   وتبليغُ صاحبِ التذكرةِ يُودَعُ في صندوقِ الصادرِ **داخلَ معاملةِ القرارِ نفسِها**
 *   (BUG-004) ويُرسَلُ من عاملِ التسليمِ بعدَ الـcommit. لا أثرَ صادرٌ في هذا المسارِ:
 *   قرارٌ رجعت معاملتُه لا يُتركُ معه تبليغٌ قد وصلَ صاحبَه، وقرارٌ نجحَ لا يضيعُ
 *   تبليغُه لو تعطّلَ تلغرامُ لحظتَها — الصفُّ باقٍ يُعادُ حتى يصلَ.
 * الحالة: منفّذ فعلياً — المرحلة 2.4، ومُوحَّدُ الصادرِ 2026-09-06.
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
  /**
   * هل أُودِعَ صفُّ التبليغِ في معاملةِ القرارِ؟ الإيداعُ حتميٌّ مع القرارِ الناجحِ،
   * وnull يعني أنَّ القاعدةَ لم تُعلنْه (قرارٌ لم يقع). ليس معناه أنَّ الرسالةَ وصلت.
   */
  readonly notificationQueued: boolean;
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

/**
 * تبليغ صاحب التذكرة بالقرار في محادثته الخاصة. يُنادى من عاملِ التسليمِ بعدَ
 * الـcommit لا من مسارِ القرارِ، ويُرجعُ معرّفَ الرسالةِ: «سُلّمت» لا تُعلَنُ بغيرِه.
 */
export interface TicketOwnerNotifier {
  notifyResolution(input: {
    readonly telegramId: string;
    readonly action: SupportResolution;
    readonly language: string;
  }): Promise<Result<string | null, PortFailureError>>;
}

export interface ResolveDisputeDependencies {
  readonly resolutions: SupportResolutionPort;
}

export type ResolveReport = ResolveOutcome;

/**
 * التبليغُ أثرٌ خارجيٌّ فلا يقعُ ههنا: لو بلّغنا أولاً ثم فشلَ التفعيلُ لكان السائقُ
 * قد قرأ «تم تفعيل اشتراكك» واشتراكه منتهٍ؛ ولو بلّغنا بعدَ الـcommit من هذا المسارِ
 * لضاعَ التبليغُ متى تعطّلَ تلغرامُ أو مات المسارُ بينهما. فالإيداعُ داخلَ المعاملةِ
 * والإرسالُ من العاملِ (BUG-004).
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
  return ok(resolved.value);
}
