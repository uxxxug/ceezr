/**
 * الغرض: اختيار ناقل الرسائل الصادرة وقياسُ ما يخرج منه فعلاً.
 * الحالة: منفّذ فعلياً — المرحلة 2 وحدة 2-3.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/container.ts` و`apps/workers`
 * ملاحظات مستقبلية: أيّ منصّةٍ غير تيليجرام تُضيف ناقلها هنا لا في الحاوية.
 *
 * ولماذا مِلفٌّ مستقل؟ لأن فيه أمرين مختلفين تماماً يجمعهما موضعٌ واحد هو نقطة
 * إنشاء المُرسِل: **قياسُ** ما يخرج (يسري في الإنتاج)، و**بديلٌ صامت** للقياس
 * (مرفوض في الإنتاج). وجمعهما هنا يجعل نقطة الدخول تبقى نقطةَ دخولٍ واحدة، فلا
 * تُستنسخ لتُبدَّل فيها سطران — وهو العطب الذي أبطل قياس `load-test.ts`.
 */

import type { OperationalMetrics, TelegramSendKind } from "../observability/metrics.ts";
import type { TelegramSender } from "./telegram-api-sender.ts";

/**
 * يلفّ أيّ مُرسِلٍ فيحصي ما **خرج فعلاً**.
 *
 * والعدّ بعد `await` لا قبله، وهذا هو موضع الدقّة كلّه: عدٌّ قبل النداء يقيس
 * «رسائل قرّرنا إرسالها»، وهو رقمٌ يبدو صحيحاً ويكذب عند أول رفضٍ من تيليجرام
 * أو أوّل تجاوزٍ لحدّ المعدّل. ونحن نقيس السقف الخارجي، فلا يُعَدّ إلا ما نجح.
 *
 * والاستثناء يُعاد رفعُه كما هو ولا يُبتلع: المُحوّلات فوقه (`asOutboundSender`
 * وأخواتها) هي التي تقرّر ما تفعله بالفشل، وابتلاعُه هنا كان سيحرمها قرارها.
 */
export function measuredTelegramSender(
  inner: TelegramSender,
  bot: "driver" | "rider",
  metrics: Pick<OperationalMetrics, "recordTelegramMessageSent">,
): TelegramSender {
  const count = (kind: TelegramSendKind): void => {
    metrics.recordTelegramMessageSent(bot, kind);
  };
  return {
    sendMessage: async (chatId, text, markup) => {
      const id = await inner.sendMessage(chatId, text, markup);
      count("message");
      return id;
    },
    sendPhoto: async (chatId, fileId, caption, markup) => {
      const id = await inner.sendPhoto(chatId, fileId, caption, markup);
      count("photo");
      return id;
    },
    sendLocation: async (chatId, latitude, longitude) => {
      const id = await inner.sendLocation(chatId, latitude, longitude);
      count("location");
      return id;
    },
  };
}

/**
 * ناقلٌ لا يُصدر نداءً شبكياً، للقياس وحده.
 *
 * ولماذا يعيد معرّفاً مُصطنعاً وقاعدةُ المستودع أن لا يُختلق معرّف؟ لأن القاعدة
 * سببُها أن `null` يعني «لا أعرف المعرّف» فتمتنع فوقَه تعديلاتُ الرسالة، فلو
 * اختلق المُرسِل الحقيقي معرّفاً لأصدر تعديلاً على رسالةٍ لا وجود لها. وهنا
 * العكس هو الخطأ: إعادةُ `null` كانت ستُسكِت مساراتِ التعديل كلَّها فيقيس
 * القياسُ نظاماً أخفَّ من الحقيقي، وهو تشويهٌ صامت للنتيجة. فالمعرّف مُصطنع
 * وبادئتُه `silent-` تجعله غير قابلٍ للالتباس في أي سجلٍّ أو صفٍّ يظهر فيه،
 * وهذا الناقل **مرفوضٌ في الإنتاج** في `loadConfig` فلا يمكن أن يصل إليه.
 */
export function silentTelegramSender(): TelegramSender {
  let sequence = 0;
  const nextId = (): string => {
    sequence += 1;
    return `silent-${sequence}`;
  };
  return {
    sendMessage: async () => nextId(),
    sendPhoto: async () => nextId(),
    sendLocation: async () => nextId(),
  };
}
