/**
 * الغرض: ناشرُ رسائل البثّ الجماعي عبر تلغرام، ومعه تصنيفُ الإخفاق: عابرٌ يُعاد،
 *   ودائمٌ لا يُعاد. التصنيف هو الفرق بين إعادةِ محاولةٍ مفيدة وحرقِ حدِّ الإرسال.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts
 * ملاحظات مستقبلية: نصّ الرسالة يأتي من المسؤول فيُرسَل بلا parse_mode — أيّ
 *   تفسيرٍ للتنسيق كان سيُسقط رسالةَ من كتب شارحةً أو نجمة.
 */

import { Api } from "grammy";
import type { BroadcastPublisher, BroadcastRecipient } from "../../application/broadcast/ports.ts";
import { t } from "../../shared/i18n/index.ts";
import { err, ok } from "../../shared/result/index.ts";

/**
 * أكواد تلغرام التي لا تُغيّرها إعادةُ المحاولة:
 * • 403 — حجب البوت أو حسابٌ مُلغى. لن يستقبل شيئاً بعد اليوم.
 * • 400 — محادثةٌ غير موجودة أو معرّفٌ فاسد. الخطأ في الصفّ لا في الشبكة.
 * وما عداهما (429، 5xx، انقطاعُ شبكة) عابرٌ يُعاد بموعدٍ من إعداد المدينة.
 */
const PERMANENT_CODES = new Set([400, 403]);

function classify(cause: unknown): { code: string; permanent: boolean } {
  const raw = cause as { error_code?: unknown; description?: unknown } | null;
  const errorCode = typeof raw?.error_code === "number" ? raw.error_code : null;
  const description =
    typeof raw?.description === "string"
      ? raw.description
      : cause instanceof Error
        ? cause.message
        : String(cause);
  if (errorCode === null) return { code: description.slice(0, 120), permanent: false };
  return {
    code: `${errorCode}:${description}`.slice(0, 120),
    permanent: PERMANENT_CODES.has(errorCode),
  };
}

/** واجهةُ الإرسال الدنيا التي يحتاجها البثّ — يُستبدل مزدوجاً في الاختبار. */
export interface BroadcastApi {
  sendMessage(
    chatId: string,
    text: string,
    options: { disable_notification: boolean; reply_markup?: unknown },
  ): Promise<{ message_id: number }>;
}

export function grammyBroadcastApi(token: string): BroadcastApi {
  const api = new Api(token);
  return {
    sendMessage: (chatId, text, options) =>
      api.sendMessage(chatId, text, options as never) as Promise<{ message_id: number }>,
  };
}

export function createBroadcastPublisher(api: BroadcastApi): BroadcastPublisher {
  return {
    publish: async (recipient: BroadcastRecipient) => {
      // اللغةُ ملتقطةٌ لحظةَ إنشاء الحملة، و`t` تسقط إلى العربية عند لغةٍ مجهولة.
      const language = recipient.languageCode;
      // ترويسةٌ بلغة المستقبِل تُعرِّف من يُخاطبه: رسالةٌ تصل بلا مُرسِلٍ معروف
      // تُقرأ إعلاناً مجهولاً، ومن يقرؤها كذلك يحجب البوت.
      const text = `${t(language)("broadcast.header")}\n\n${recipient.body}`;
      const markup =
        recipient.linkUrl === null || recipient.linkLabel === null
          ? undefined
          : { inline_keyboard: [[{ text: recipient.linkLabel, url: recipient.linkUrl }]] };
      try {
        const sent = await api.sendMessage(recipient.chatId, text, {
          disable_notification: recipient.silent,
          ...(markup === undefined ? {} : { reply_markup: markup }),
        });
        const messageId = sent?.message_id;
        // بلا معرّفٍ حقيقيّ لا يُعلن التسليم: «أُرسلت» بلا معرّف نيّةٌ لا أثر.
        if (messageId === undefined || messageId === null) {
          return err({ code: "NO_MESSAGE_ID", permanent: false });
        }
        return ok({ messageId: String(messageId) });
      } catch (cause) {
        return err(classify(cause));
      }
    },
  };
}
