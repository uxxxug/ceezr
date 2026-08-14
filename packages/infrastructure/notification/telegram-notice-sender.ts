/**
 * الغرض: ناشرُ إشعارات دورة حياة الاشتراك عبر بوت السائق. رسالةٌ فرديةٌ للسائق
 *   نفسه، فلا ترويسةَ بثٍّ ولا كتمَ إشعار: تفعيلُ اشتراكٍ أو انتهاؤه خبرٌ يجب أن
 *   يُنبِّه هاتفه.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts
 * ملاحظات مستقبلية: يُرسَل بلا parse_mode — أسماءُ المدن والخطط قد تحمل شارحةً
 *   أو نجمة، وتفسيرُ التنسيق كان سيُسقط الرسالة كلَّها.
 */

import { Api } from "grammy";
import type { SubscriptionNoticePublisher } from "../../application/subscription/notice-ports.ts";
import { err, ok } from "../../shared/result/index.ts";
import { classifyTelegramFailure } from "./telegram-failure.ts";

/** واجهةُ الإرسال الدنيا — يُستبدل مزدوجاً في الاختبار. */
export interface NoticeApi {
  sendMessage(chatId: string, text: string): Promise<{ message_id: number }>;
}

export function grammyNoticeApi(token: string): NoticeApi {
  const api = new Api(token);
  return {
    sendMessage: (chatId, text) => api.sendMessage(chatId, text) as Promise<{ message_id: number }>,
  };
}

export function createSubscriptionNoticePublisher(api: NoticeApi): SubscriptionNoticePublisher {
  return {
    publish: async (input) => {
      try {
        const sent = await api.sendMessage(input.chatId, input.text);
        const messageId = sent?.message_id;
        // بلا معرّفٍ حقيقيّ لا يُعلن التسليم: «أُرسل» بلا معرّف نيّةٌ لا أثر.
        if (messageId === undefined || messageId === null) {
          return err({ code: "NO_MESSAGE_ID", permanent: false });
        }
        return ok({ messageId: String(messageId) });
      } catch (cause) {
        return err(classifyTelegramFailure(cause));
      }
    },
  };
}
