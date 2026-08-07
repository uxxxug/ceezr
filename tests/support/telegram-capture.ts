/**
 * الغرض: ملتقط رسائل تلغرام مشترك بين الاختبارات التكاملية — نصّاً وصورةً.
 * الحالة: منفّذ فعلياً — المرحلة 2.4 (كان مكرّراً في ثلاثة ملفات قبلها).
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: كل اختبار تكاملي يحتاج التحقّق ممّا أُرسل
 * ملاحظات مستقبلية: أي نوع إرسال جديد (مستند، موقع) يُضاف هنا وحده لا في كل ملف.
 */

import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";

export interface SentMessage {
  readonly chatId: string;
  readonly text: string;
  readonly markup: unknown;
  /** يُملأ حين تُرسَل صورة — يثبت أن الصورة أُعيد إرسالها بمعرّفها لا كرابط نصّي. */
  readonly photoFileId?: string;
}

/**
 * يعيد معرّفاً متزايداً حقيقياً لا null: المسار الحقيقي يعيد معرّفاً، ومزدوج
 * يعيد null كان سيُخفي أخطاء المسارات التي تحفظ معرّف الرسالة.
 */
export function capturing(sent: SentMessage[]): TelegramSender {
  return {
    sendMessage: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup });
      return String(sent.length);
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      sent.push({ chatId, text: caption, markup, photoFileId: fileId });
      return String(sent.length);
    },
  };
}
