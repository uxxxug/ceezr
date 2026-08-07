/**
 * الغرض: محوّل بوت العميل: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً.
 *   لا قرار عمل هنا: القرارات في packages/application/bots/rider-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/rider
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: طلب التوصيل (request-delivery) يبقى هيكلاً حتى المرحلة 2.2.
 */

import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../../../../packages/application/bots/rider-dialog.ts";
import type { BotReply } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import { toTelegramMarkup } from "../shared/keyboards.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export interface RiderBotAdapter {
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
}

export function createRiderBot(
  deps: RiderBotDependencies,
  sender: TelegramSender,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
): RiderBotAdapter {
  return {
    handleUpdate: async (raw) => {
      const incoming = toIncomingUpdate(raw);
      if (incoming === null) return true;

      let replies: readonly BotReply[];
      try {
        replies = await handleRiderUpdate(incoming, deps);
      } catch (error) {
        log("عطل غير متوقَّع في حوار العميل", { detail: String(error) });
        return false;
      }

      for (const reply of replies) {
        const markup = toTelegramMarkup(reply.keyboard);
        try {
          if (reply.photoFileId === undefined) {
            await sender.sendMessage(reply.chatId, reply.text, markup);
          } else {
            await sender.sendPhoto(reply.chatId, reply.photoFileId, reply.text, markup);
          }
        } catch (error) {
          log("تعذّر إرسال رسالة إلى تلغرام", { detail: String(error) });
          return false;
        }
      }
      return true;
    },
  };
}
