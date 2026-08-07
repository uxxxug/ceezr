/**
 * الغرض: محوّل بوت السائق: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً عبر grammY.
 *   لا قرار عمل هنا إطلاقاً: كل القرارات في packages/application/bots/driver-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/driver
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفات المجاورة (offers, subscription, availability) صارت أقساماً داخل
 *   driver-dialog لأن تفريقها بملفات محوّل يكرّر المنطق؛ تبقى هيكلاً حتى تُحتاج فعلاً.
 */

import { Api } from "grammy";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../../../../packages/application/bots/driver-dialog.ts";
import type { BotReply } from "../../../../../packages/application/bots/types.ts";
import { isCallbackDataValid, toTelegramMarkup } from "../shared/keyboards.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

/** منفذ الإرسال — grammY ينفّذه في الإنتاج، ومزدوج يلتقط الرسائل في الاختبار. */
export interface TelegramSender {
  /**
   * يعيد معرّف الرسالة المُرسَلة. بطاقة قروب غير المشتركين تُحفَظ بمعرّفها لتُعدَّل
   * أو يُشار إليها لاحقاً، ولا يجوز اختلاق معرّف؛ فمن لا يعرف المعرّف يعيد null.
   */
  sendMessage(chatId: string, text: string, markup: unknown): Promise<string | null>;
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
  };
}

export interface DriverBotAdapter {
  /** يعيد false إن تعذّرت المعالجة، فتسجّلها البوابة بلا ادّعاء نجاح. */
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
}

export function createDriverBot(
  deps: DriverBotDependencies,
  sender: TelegramSender,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
): DriverBotAdapter {
  return {
    handleUpdate: async (raw) => {
      const incoming = toIncomingUpdate(raw);
      if (incoming === null) return true; // تحديث لا يخصّنا: نعترف بالاستلام ولا نردّ

      let replies: readonly BotReply[];
      try {
        replies = await handleDriverUpdate(incoming, deps);
      } catch (error) {
        log("عطل غير متوقَّع في حوار السائق", { detail: String(error) });
        return false;
      }

      for (const reply of replies) {
        const markup = toTelegramMarkup(reply.keyboard);
        if (reply.keyboard?.kind === "inline") {
          const tooLong = reply.keyboard.rows
            .flat()
            .filter((button) => !isCallbackDataValid(button.data));
          if (tooLong.length > 0) {
            log("بيانات زرّ تتجاوز حدّ تلغرام", { count: tooLong.length });
            return false;
          }
        }
        try {
          await sender.sendMessage(reply.chatId, reply.text, markup);
        } catch (error) {
          log("تعذّر إرسال رسالة إلى تلغرام", { detail: String(error) });
          return false;
        }
      }
      return true;
    },
  };
}
