/**
 * الغرض: الموقع الحيّ في تلغرام — رسالةٌ واحدة تُنشأ ثم تُعدَّل إحداثياتها، لا رسالةٌ لكل إصلاحة.
 * الحالة: منفّذ فعلياً — المرحلة ٦. موصول في apps/gateway/src/container.ts.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: مشاركة الرحلة مع طرف ثالث (المرحلة ٢٧ / safety)
 *
 * ## لماذا هذا هو ناقل العميل — ولا واجهة ويب في المرحلة ٦
 *
 * العميل في هذا المنتج ليس صفحةً بل محادثة تلغرام (ADR-0007). و`sendLocation`
 * بـ`live_period` تُنتج على جهازه خريطةً تتحرّك من داخل التطبيق الذي يستخدمه
 * أصلاً: بلا رابطٍ يُفتح، ولا صفحةٍ تُحمَّل، ولا جلسةٍ ثانية تُصادَق.
 *
 * وبناء خريطة ويب للعميل هنا كان يعني: نقلاً ثانياً (WebSocket/SSE)، ومصادقةً
 * ثانية لطرفٍ لا كلمة مرور له، وتصريحاً ثانياً — كلّه لعرض ما تعرضه المحادثة.
 * وهذه هي القاعدة ٥ حرفياً. الخريطة التفاعلية موضعها المرحلتان ١٠ و١١ حيث
 * تُبنى بقرارٍ صريح ولها مستهلكٌ محدَّد.
 *
 * ## ولماذا التعديل لا الإرسال المتكرّر
 *
 * لأن رسالةً لكل إصلاحة تعني عشرات الرسائل في الدقيقة الواحدة: إشعارٌ متواصل
 * على جهاز العميل، ومحادثةٌ تُغرق، وحدود معدّل تلغرام تُستهلك على رسائل يُهملها.
 * و`editMessageLiveLocation` تُحدّث نفس الرسالة بلا إشعار — وهو الفرق بين ميزةٍ
 * تُستخدم وميزةٍ يُكتَم البوت من أجلها.
 */

import type { LiveLocationChannel } from "../../application/tracking/customer-live-relay.ts";
import { createTelegramApi } from "./telegram-client.ts";

/**
 * أقصى مدّة بثّ يقبلها تلغرام: ٢٤ ساعة. تُستخدم كسقفٍ لا كتوقّع — الجلسة تُغلق
 * ببثٍّ يُوقَف صراحةً عند نهاية الرحلة، والسقف حمايةٌ إن مات المُرحِّل قبل ذلك،
 * فلا تبقى خريطةٌ حيّةٌ على جهاز العميل إلى الأبد.
 */
export const TELEGRAM_MAX_LIVE_PERIOD_SECONDS = 86_400;

export function grammyLiveLocationChannel(token: string): LiveLocationChannel {
  const api = createTelegramApi(token);
  return {
    start: async (chatId, position, livePeriodSeconds) => {
      try {
        const livePeriod = Math.min(
          Math.max(Math.trunc(livePeriodSeconds), 60),
          TELEGRAM_MAX_LIVE_PERIOD_SECONDS,
        );
        const sent = await api.sendLocation(chatId, position.lat, position.lng, {
          live_period: livePeriod,
        });
        return String(sent.message_id);
      } catch {
        return null;
      }
    },

    update: async (chatId, messageId, position) => {
      try {
        await api.editMessageLiveLocation(chatId, Number(messageId), position.lat, position.lng);
        return true;
      } catch {
        return false;
      }
    },

    stop: async (chatId, messageId) => {
      try {
        await api.stopMessageLiveLocation(chatId, Number(messageId));
        return true;
      } catch {
        return false;
      }
    },
  };
}
