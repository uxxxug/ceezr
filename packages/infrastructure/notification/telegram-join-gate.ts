/**
 * الغرض: تنفيذُ تلغرامَ لمنفذِ بوّابةِ القروبِ (`PD-001` · `ADR 0157`): قبولُ
 *   طلبِ الانضمامِ ورفضُهُ (`approveChatJoinRequest`/`declineChatJoinRequest`)
 *   ومراسلةُ صاحبِ الطلبِ خاصّةً (أفضلُ جهدٍ)، وبناءُ رابطِ `/start` العميقِ
 *   من هويّةِ البوتِ نفسِهِ (`getMe`) لا من إعدادٍ يدويٍّ يتقادمُ بصمتٍ.
 * الحالة: منفَّذ فعلياً — البند `PD-001` (خارطةُ دَينِ المنتَج).
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts (توصيلُ `groupJoinGate`).
 * ملاحظات مستقبلية: لو احتاجتِ البوّابةُ حظراً مؤقَّتاً (`banChatMember`) فموضعُهُ
 *   ههنا — لكنَّهُ اليومَ قرارٌ في غيرِ حاجةٍ: الرفضُ يكفي ولا يعاقبُ من يُعيدُ المحاولةَ.
 *
 * ## لماذا كلُّ دالّةٍ تُعيدُ `boolean` ولا ترمي
 *
 * فشلُ نداءِ تلغرامَ في البوّابةِ ليسَ انهيارًا للحوارِ بلَ حدثًا يُسجَّلُ
 * ويُعادُ تقديرُهُ: فالاستثناءُ ههنا كانَ سيُسقِطُ التحديثَ كلَّهُ بلا أثرٍ
 * ولا إعادةٍ (تسلسلُ الإقرارِ انتهى عندَ الإيداعِ الصامدِ — ADR 0054/0057).
 * والقاعدةُ التي اختارَها المستودَعُ في المُرسِلاتِ الأخرىُ نفسُها: نتيجةٌ
 * صريحةٌ تُقرأُ، لا استثناءً يُبتلَعُ.
 *
 * ## ولماذا `getMe` مرةً واحدةً لا عندَ كلِّ رفضٍ
 *
 * هويّةُ البوتِ لا تتغيّرُ بينَ طلبَينِ، وكلُّ نداءٍ زائدٍ حصّةٌ من حدِّ المعدَّلِ
 * تُدفعُ في غيرِ حاجةٍ. فتُخبَّأُ عندَ أوّلِ طلبٍ — و`null` عندَ فشلِها: فلا
 * يُوعَدُ برابطٍ لا يُبنى، ويُرسَلُ نصُّ الإرشادِ العاريُ (بلا رابطٍ) بدلَهُ.
 */

import type { TelegramGroupGatePort } from "../../application/groups/group-join-gate.ts";
import { createTelegramApi } from "./telegram-client.ts";

/** حاجزُ الاسمِ المُستعارِ: لا يُبنى رابطٌ من اسمٍ فارغٍ ولا يبدأُ بـ@. */
function isUsername(value: string): boolean {
  return value.length > 1 && value.startsWith("@");
}

/**
 * معرّفُ تلغرامَ داخلَ مكتبةِ grammY رقَمٌ. ومعرّفاتُ تلغرامَ اليومَ (مستخدمونَ
 * وقروباتٌ) دونَ ٢^٥٣ بكثيرٍ فلا فقدَ دقّةٍ — لكنَّ التحولَ **يُفحَصُ لا
 * يُفترَضُ**: قيمةٌ لا تُفسَّرُ رقَماً صحيحاً تُقابَلُ بفشلٍ صريحٍ لا بNaN
 * يُرسَلُ إلى تلغرامَ ويُرجعُ خطأً غامضاً.
 */
function asTelegramNumber(id: string): number | null {
  const value = Number(id);
  return Number.isSafeInteger(value) ? value : null;
}

export function grammyGroupJoinGate(token: string): TelegramGroupGatePort {
  const api = createTelegramApi(token);
  let cachedUsername: string | null | undefined;

  const username = async (): Promise<string | null> => {
    if (cachedUsername !== undefined) return cachedUsername;
    try {
      const me = await api.getMe();
      cachedUsername = isUsername(me.username ?? "") ? (me.username as string) : null;
    } catch {
      // أفضلُ جهدٍ لا وعدٌ: تعذُّرَتِ الهويّةُ فيُرسَلُ الإرشادُ بلا رابطٍ.
      cachedUsername = null;
    }
    return cachedUsername;
  };

  return {
    approve: async (groupChatId, telegramUserId) => {
      const user = asTelegramNumber(telegramUserId);
      if (user === null) return false;
      try {
        await api.approveChatJoinRequest(groupChatId, user);
        return true;
      } catch {
        return false;
      }
    },

    decline: async (groupChatId, telegramUserId) => {
      const user = asTelegramNumber(telegramUserId);
      if (user === null) return false;
      try {
        await api.declineChatJoinRequest(groupChatId, user);
        return true;
      } catch {
        return false;
      }
    },

    messageUser: async (userChatId, text) => {
      try {
        await api.sendMessage(userChatId, text);
        return true;
      } catch {
        // تلغرامُ لا يضمنُ مراسلةَ من لم يبدأِ البوتَ — وهذا معلَنٌ في `ADR 0157`
        // أفضلَ جهدٍ، فالفشلُ متوقَّعٌ وموثَّقٌ وليسَ عطلًا في البوّابةِ.
        return false;
      }
    },

    registrationLink: async () => {
      const name = await username();
      // الحمولةُ `register` تصلُ إلى الحوارِ `/start register` فيُتجاهُلَها آمنًا
      // (الاسمُ وحدهُ يُقرأُ) وتبقى للقياسِ لاحقًا (`chat_member` خارجَ النطاقِ).
      return name === null ? null : `https://t.me/${name.slice(1)}?start=register`;
    },
  };
}
