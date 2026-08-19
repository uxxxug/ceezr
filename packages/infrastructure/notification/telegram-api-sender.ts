/**
 * الغرض: المُرسِل الحقيقي عبر واجهة تلغرام، ومحوّلاته إلى منافذ الإرسال المختلفة.
 *   نُقِل من حاوية البوابة في المرحلة 2.6 الخطوة 02 لأن العامل الخلفي يحتاج المُرسِل
 *   نفسه لينشر بطاقات القروب ويصعّد الطلبات، ولا يجوز لـ app أن يستورد من app آخر.
 * الحالة: منفّذ فعلياً — نُقِل بلا تغيير في السلوك ولا في التوقيعات.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: عند إضافة منصّة غير تلغرام يُضاف مُرسِل مجاور ينفّذ نفس المنافذ.
 */

import { Api } from "grammy";
import type { Keyboard } from "../../application/bots/types.ts";
import type { OutboundSender } from "./telegram-driver-notifier.ts";
import { toTelegramMarkup } from "./telegram-markup.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";
import type { SupportSender } from "./telegram-support-notifier.ts";

/** منفذ الإرسال — grammY ينفّذه في الإنتاج، ومزدوج يلتقط الرسائل في الاختبار. */
export interface TelegramSender {
  /**
   * يعيد معرّف الرسالة المُرسَلة. بطاقة قروب غير المشتركين تُحفَظ بمعرّفها لتُعدَّل
   * أو يُشار إليها لاحقاً، ولا يجوز اختلاق معرّف؛ فمن لا يعرف المعرّف يعيد null.
   */
  sendMessage(chatId: string, text: string, markup: unknown): Promise<string | null>;
  /**
   * إرسال صورة بمعرّف ملف تلغرام والنصّ تعليقاً عليها. نمرّر المعرّف كما وصل
   * ولا نُنزّل الصورة: التنزيل يعني تخزين ملفات مستخدمين بلا حاجة ولا سياسة حذف.
   */
  sendPhoto(
    chatId: string,
    fileId: string,
    caption: string,
    markup: unknown,
  ): Promise<string | null>;
  /**
   * المرحلة ١٢ — دبّوس موقعٍ ثابت: نقطة انطلاقٍ أو مقصدٍ يفتحها السائق في
   * تطبيق ملاحته بضغطة. ليست `live_period`: تلك للموقع المتحرّك ولها منفذها
   * (`LiveLocationChannel`) وهي تخصّ خريطة العميل. ونقطةُ الرحلة لا تتحرّك،
   * وبثّها حيّاً كان سيشغل رسالةً قابلةً للتعديل بلا شيء يُعدَّل فيها.
   *
   * ولماذا رسالةٌ منفصلة لا نصّ فيه إحداثيتان؟ لأن نصّ «21.5471, 39.1751» لا
   * يفتح خريطةً ولا يُوجِّه سيّارة — يُنسَخ باليد إلى تطبيق آخر، وأثناء القيادة.
   */
  sendLocation(chatId: string, latitude: number, longitude: number): Promise<string | null>;
}

export function grammyTelegramSender(token: string): TelegramSender {
  const api = new Api(token);
  return {
    sendMessage: async (chatId, text, markup) => {
      const sent = await api.sendMessage(
        chatId,
        text,
        markup === undefined ? {} : { reply_markup: markup as never },
      );
      return String(sent.message_id);
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      const sent = await api.sendPhoto(chatId, fileId, {
        caption,
        ...(markup === undefined ? {} : { reply_markup: markup as never }),
      });
      return String(sent.message_id);
    },
    sendLocation: async (chatId, latitude, longitude) => {
      const sent = await api.sendLocation(chatId, latitude, longitude);
      return String(sent.message_id);
    },
  };
}

export function asOutboundSender(sender: TelegramSender): OutboundSender {
  return {
    send: async (chatId, text, keyboard: Keyboard | null) => {
      try {
        await sender.sendMessage(chatId, text, toTelegramMarkup(keyboard));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** مُرسِل يُبقي معرّف الرسالة — تحتاجه بطاقات القروبات لا الرسائل الفردية. */
export function asIdentifyingSender(sender: TelegramSender): IdentifyingSender {
  return {
    sendReturningId: async (chatId, text, keyboard: Keyboard | null) => {
      try {
        return await sender.sendMessage(chatId, text, toTelegramMarkup(keyboard));
      } catch {
        return null;
      }
    },
  };
}

/**
 * مُرسِل بطاقات الدعم: نصّاً أو صورةً. الصورة تُعاد بمعرّفها لأن إيصال التحويل
 * يجب أن يظهر صورةً أمام الفريق لا رابطاً لا يفتحه أحد.
 */
export function asSupportSender(sender: TelegramSender): SupportSender {
  return {
    sendReturningId: async (chatId, text, keyboard) => {
      try {
        return await sender.sendMessage(chatId, text, keyboard);
      } catch {
        return null;
      }
    },
    sendPhotoReturningId: async (chatId, fileId, caption, keyboard) => {
      try {
        return await sender.sendPhoto(chatId, fileId, caption, keyboard);
      } catch {
        return null;
      }
    },
  };
}
