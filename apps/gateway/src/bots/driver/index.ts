/**
 * الغرض: محوّل بوت السائق: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً عبر grammY.
 *   لا قرار عمل هنا إطلاقاً: كل القرارات في packages/application/bots/driver-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/driver
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفّات المجاورة (offers, subscription, availability, registration,
 *   rating, trip-lifecycle) معزولةٌ ومُستبدَلة لا محذوفة: أقسامها منفَّذة فعلاً داخل
 *   `packages/application/bots/driver-dialog.ts`، ولا يستوردها شيء. وترويسة كلٍّ منها
 *   تُحيل إلى موضع تنفيذها بالضبط، لأنّ ملفّاً يعلن أنّ القدرة غير منفَّذة وهي منفَّذة
 *   يقرأه المراجع فيستنتج فجوةً لا وجود لها، ويقرأه الوكيل فيبني نسخةً ثانية من المنطق.
 */

import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../../../../packages/application/bots/driver-dialog.ts";
import type { BotReply } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender as TelegramSenderType } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";
import { isCallbackDataValid, toTelegramMarkup } from "../shared/keyboards.ts";
import type { LanguageHydration } from "../shared/language-middleware.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export type { TelegramSender } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";
export { grammyTelegramSender } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";

export interface DriverBotAdapter {
  /** يعيد false إن تعذّرت المعالجة، فتسجّلها البوابة بلا ادّعاء نجاح. */
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
}

/**
 * `language` اختياري: المحوّل يعمل بدونه كما كان، ومئات الاختبارات القائمة
 * لا تتغيّر. والتوجيه طلب توصيله في `server.ts`، ولا يصحّ تقنياً: `server.ts`
 * توجيه نقل محض (يركّب المسارات ويتحقّق من السرّ) ولا تعرف مُرسِلَ التحديث
 * ولا معرّفه أصلاً — فكّ التحديث يجري هنا في `toIncomingUpdate`. فوضعه في `server.ts`
 * يوجب تكرار الفكّ مرّتين، وهذا هو المفصل الصحيح: أوّل موضع تُعرف فيه الهوية.
 */
export function createDriverBot(
  deps: DriverBotDependencies,
  sender: TelegramSenderType,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
  language?: LanguageHydration,
): DriverBotAdapter {
  return {
    handleUpdate: async (raw) => {
      const incoming = toIncomingUpdate(raw);
      if (incoming === null) return true; // تحديث لا يخصّنا: نعترف بالاستلام ولا نردّ

      // قبل الحوار لا بعده: الحوار يقرأ الجلسة في أوّل سطر، فلا ينفع ترطيبٌ بعده.
      if (language !== undefined) await language.hydrate(incoming.from);

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
          if (reply.photoFileId === undefined) {
            await sender.sendMessage(reply.chatId, reply.text, markup);
          } else {
            await sender.sendPhoto(reply.chatId, reply.photoFileId, reply.text, markup);
          }
          /**
           * الدبّوس بعد النصّ لا قبله: النصّ يشرح ما هذه النقطة، فوصوله ثانياً
           * يجعل السائق يرى دبّوساً لا يعرف ما هو ثم يُشرَح له.
           *
           * ولماذا `try` هنا وليس في نفس المحاولة؟ لأن فشل الدبّوس لا يُبطل
           * الرسالة التي وصلت: السائق قرأ انطلاقه ووسمه، وإرجاع false كان
           * سيجعل الويبهوك يُعيد المحاولة فيصله النصّ مرّتين.
           */
          if (reply.mapPin !== undefined) {
            try {
              await sender.sendLocation(
                reply.chatId,
                reply.mapPin.latitude,
                reply.mapPin.longitude,
              );
            } catch (error) {
              log("تعذّر إرسال دبّوس الموقع — النصّ وصل", { detail: String(error) });
            }
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
