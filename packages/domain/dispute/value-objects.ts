/**
 * الغرض: كائنات القيمة لوحدة dispute — نصّ الشكوى ونوعها ومرفقها، مُتحقَّقاً منها قبل أي كتابة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute، apps/gateway (حواري السائق والعميل)
 * ملاحظات مستقبلية: حدود الطول تقنية لا تجارية (حدّ تلغرام للنصّ)، فلا مكان لها في
 *   platform_settings؛ أي حدّ تجاري لاحق (عدد التذاكر شهرياً مثلاً) يُقرأ من الإعدادات.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";

export type SupportTicketType = "subscription" | "ride_dispute";

export type SupportTicketStatus = "open" | "claimed" | "resolved" | "rejected";

/** التصرّفات الثلاثة الممكنة على تذكرة: التفعيل، الإنهاء اليدوي، الرفض. */
export type SupportResolution = "activate" | "terminate" | "reject";

/**
 * حدّ أدنى معقول: «مشكلة» وحدها لا تُمكِّن موظّف الدعم من فهم شيء، وردّه سيكون
 * سؤالاً آخر يستهلك دورة كاملة. الحدّ الأعلى حدّ تلغرام لنصّ الرسالة الواحدة.
 */
export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 3000;

export type MessageProblem = "too_short" | "too_long" | "is_command";

export interface InvalidSupportMessage {
  readonly reason: MessageProblem;
}

/**
 * نصّ الشكوى كما كتبه صاحبها: نقتصّ الفراغات ولا نغيّر حرفاً غيرها.
 * البطاقة تعرض النصّ حرفياً لأن إعادة الصياغة تُفقد الدعمَ المعنى الأصلي.
 */
export function parseSupportMessage(raw: string): Result<string, InvalidSupportMessage> {
  const trimmed = raw.trim();
  // من كتب أمراً بدل وصف مشكلته أخطأ في الخطوة لا في النصّ — نميّز الحالتين للردّ الصحيح
  if (trimmed.startsWith("/")) return err({ reason: "is_command" });
  if (trimmed.length < MESSAGE_MIN_LENGTH) return err({ reason: "too_short" });
  if (trimmed.length > MESSAGE_MAX_LENGTH) return err({ reason: "too_long" });
  return ok(trimmed);
}

export function isSupportTicketType(value: string): value is SupportTicketType {
  return value === "subscription" || value === "ride_dispute";
}

export function isSupportResolution(value: string): value is SupportResolution {
  return value === "activate" || value === "terminate" || value === "reject";
}

/**
 * معرّف صورة تلغرام: نصّ غير فارغ لا نفسّره ولا نتحقّق من شكله.
 * أي تحقّق على بنيته سيكسر عند تغيير تلغرام لتنسيقه، والمقابل صفر.
 */
export function parseAttachmentId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}
