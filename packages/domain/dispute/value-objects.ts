/**
 * الغرض: كائنات القيمة لوحدة dispute — نصّ الشكوى ونوعها ومرفقها، مُتحقَّقاً منها قبل أي كتابة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: domain/dispute
 * يُتوقع أن يستخدمه لاحقاً: application/dispute، apps/gateway (حواري السائق والعميل)
 * ملاحظات مستقبلية: حدود الطول تقنية لا تجارية (حدّ تلغرام للنصّ)، فلا مكان لها في
 *   platform_settings؛ أي حدّ تجاري لاحق (عدد التذاكر شهرياً مثلاً) يُقرأ من الإعدادات.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import {
  type SupportTicketType as FullSupportTicketType,
  SUPPORT_TICKET_TYPES,
} from "../support/ticket-types.ts";

/**
 * نوعُ تذكرةِ الدعمِ — يُعادُ تصديرُهُ من `domain/support/ticket-types.ts` لأنّهُ
 * نفسُ قيمِ `support_ticket_type` في القاعدةِ. كانَ هنا نسخةٌ قديمةٌ تَحصُرُهُ في
 * نوعَين، فكسرتْ مسارَ الاعتراضِ الماليّ (`deduction`) الذي هو صنفٌ قائمٌ في القاعدةِ.
 */
export type SupportTicketType = FullSupportTicketType;

export type SupportTicketStatus = "open" | "claimed" | "resolved" | "rejected";

/**
 * التصرّفاتُ الأربعةُ الممكنةُ على تذكرةٍ: التفعيلُ، الإنهاءُ اليدويُّ، الرفضُ، والردُّ.
 *
 * و`answer` زِيدَ في الخطوةِ ١٠ لأنَّ الثلاثةَ الأولى كلَّها لا تُجيبُ شاكياً:
 * الأوّلانِ يقتضيانِ اشتراكاً فيسقطانِ على تذكرةِ راكبٍ، والثالثُ إقفالٌ برفضٍ.
 * فكانَ الراكبُ الشاكي لا مخرجَ لشكواهُ إلّا أن تُرفَضَ. و`answer` وحدَه يُوجِبُ
 * ملاحظةً مكتوبةً تصلُ صاحبَها حرفاً.
 */
export type SupportResolution = "activate" | "terminate" | "reject" | "answer";

/**
 * الردُّ وحدَه يقتضي نصّاً. والحكمُ ههنا لا في الحاجزِ ولا في القاعدةِ وحدَها:
 * ردٌّ بلا نصٍّ يُقفِلُ تذكرةً ويُرسِلُ إطاراً فارغاً، فيُسجَّلُ «مُجابةٌ» ولم يُجَبْ.
 */
export function requiresWrittenNote(resolution: SupportResolution): boolean {
  return resolution === "answer";
}

/** الردُّ لا يقتضي سائقاً — وهوَ كلُّ الفائدةِ منه: تذكرةُ راكبٍ تُجابُ. */
export function requiresDriver(resolution: SupportResolution): boolean {
  return resolution === "activate" || resolution === "terminate";
}

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
  return (SUPPORT_TICKET_TYPES as readonly string[]).includes(value);
}

export function isSupportResolution(value: string): value is SupportResolution {
  return value === "activate" || value === "terminate" || value === "reject" || value === "answer";
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
