/**
 * الغرض: محوّل بوت العميل: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً.
 *   لا قرار عمل هنا: القرارات في packages/application/bots/rider-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/rider
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفّات المجاورة (request-ride, request-delivery, order-tracking,
 *   rating) معزولةٌ ومُستبدَلة لا محذوفة: طلب التوصيل منفَّذ في
 *   `packages/application/delivery/request-delivery.ts`، والتتبّع والتقييم في `rider-dialog.ts`
 *   و`rating-dialog.ts`، ولا يستورد أيًّا منها شيء. وترويسة كلٍّ منها تُحيل إلى موضع تنفيذها
 *   بالضبط، فلا يقرأ قارئٌ «غير منفَّذ» عن قدرةٍ منفَّذة.
 */

import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../../../../packages/application/bots/rider-dialog.ts";
import type { BotReply } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import { toTelegramMarkup } from "../shared/keyboards.ts";
import type { LanguageHydration } from "../shared/language-middleware.ts";
import { SessionCasConflictError } from "../shared/session-revision.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export interface RiderBotAdapter {
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
}

/** `language` اختياري للسبب المشروح في محوّل السائق: المحوّل أوّل موضع تُعرف فيه الهوية. */
export function createRiderBot(
  deps: RiderBotDependencies,
  sender: TelegramSender,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
  language?: LanguageHydration,
): RiderBotAdapter {
  return {
    handleUpdate: async (raw) => {
      const incoming = toIncomingUpdate(raw);
      if (incoming === null) return true;

      // قبل الحوار لا بعده: الحوار يقرأ الجلسة في أوّل سطر. ويُعادُ كلُّه — ترطيبُ اللغة
      // ثم حسابُ الردود — عند تعارضِ مراجعةِ الجلسة (BUG-007): لا تُرسَلُ رسالةٌ قبلَ
      // أن تنجحَ الكتابةُ الشرطية. والحدُّ ثلاثٌ: من يفشلُ بعدَها عطلٌ لا تزامن.
      const MAX_CAS_RETRIES = 3;
      let replies: readonly BotReply[] = [];
      for (let attempt = 0; ; attempt++) {
        try {
          if (language !== undefined) await language.hydrate(incoming.from);
          replies = await handleRiderUpdate(incoming, deps);
          break;
        } catch (error) {
          if (error instanceof SessionCasConflictError && attempt < MAX_CAS_RETRIES) {
            log("bot.session_revision_conflict", {
              attempt: attempt + 1,
              userId: error.telegramUserId,
            });
            continue;
          }
          log("bot.rider.dialog_unexpected_error", { detail: String(error) });
          return false;
        }
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
          log("bot.telegram_send_failed", { detail: String(error) });
          return false;
        }
      }
      return true;
    },
  };
}
