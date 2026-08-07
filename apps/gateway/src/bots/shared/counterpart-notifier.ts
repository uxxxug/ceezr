/**
 * الغرض: تبليغ طرف الرحلة المقابل عبر بوته هو — الجسر الوحيد بين البوتين.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: apps/gateway/src/bots/shared
 * يُتوقع أن يستخدمه لاحقاً: container.ts، وأي مسار يخاطب طرفاً على البوت الآخر
 * ملاحظات مستقبلية: عند إضافة بوت ثالث يبقى الجسر واحداً بمُرسِل مختلف لا بمنطق مختلف.
 */

import type { CounterpartNotifier } from "../../../../../packages/application/bots/rating-dialog.ts";
import type { Keyboard } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import { toTelegramMarkup } from "./keyboards.ts";

/**
 * الفشل يُبتلع عمداً: الرحلة اكتملت في القاعدة قبل هذه المكالمة، وحظرُ العميل للبوت
 * أو انقطاع الشبكة لا يجوز أن يُظهر للسائق أن الإنهاء فشل وهو قد نجح.
 */
export function counterpartNotifier(sender: TelegramSender): CounterpartNotifier {
  return {
    notify: async (telegramId: string, text: string, keyboard: Keyboard | null) => {
      try {
        await sender.sendMessage(telegramId, text, toTelegramMarkup(keyboard));
      } catch {
        // متعمَّد: لا شيء نفعله هنا، والحالة الصحيحة محفوظة في القاعدة
      }
    },
  };
}
