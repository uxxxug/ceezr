/**
 * الغرض: يُلحِقُ بكلِّ رسالةٍ خاصّةٍ يُرسِلُها البوتُ زرَّ «افتح وَصْلة» — فكلُّ إشعارٍ بابٌ إلى
 *   التطبيقِ المصغَّرِ لا نهايةٌ في المحادثةِ (`ADR 0213` · `DEC-22`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/container.ts · apps/gateway/src/container.ts
 *
 * ## لماذا عند المُرسِلِ لا في كلِّ مُخطِرٍ
 *
 * للعاملِ أكثرُ من خمسةَ عشرَ مُخطِراً (إلغاءٌ، عدمُ مطابقةٍ، تذكيرُ اشتراكٍ، مستنداتٌ، أشياءُ
 * مفقودةٌ …). إضافةُ الزرِّ في كلٍّ منها خمسةَ عشرَ موضعاً يُنسى السادسَ عشرَ منها؛ والمُرسِلُ
 * موضعٌ واحدٌ يمرُّ به كلُّ شيءٍ. والمُخطِرُ الذي يعرفُ شاشتَه بدقّةٍ (بطاقةُ العرضِ، إشعارُ
 * القبولِ) يضعُ زرَّه بنفسِه برابطٍ عميقٍ، فيتركُه هذا الغلافُ — لا زرّانِ للتطبيقِ في رسالةٍ.
 *
 * ## ما لا يمسُّه
 *
 * - **القروبات**: معرّفُها سالبٌ، ورسائلُها بثٌّ عامٌّ لا بابَ شخصيَّ فيه — وتيليجرامُ لا يسمحُ
 *   بزرِّ `web_app` في غيرِ المحادثةِ الخاصّةِ أصلاً.
 * - **لوحاتُ الردِّ** (`keyboard` · `remove_keyboard` · `force_reply`): هي خطواتُ حوارٍ جارٍ
 *   (طلبُ الموقعِ أو الرقمِ)، وتيليجرامُ لا يجمعُ لوحةَ ردٍّ ولوحةَ inline في رسالةٍ واحدةٍ.
 * - **الموقعُ**: `sendLocation` بلا نصٍّ ولا زرٍّ.
 */

import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import type { SendOptions, TelegramSender } from "./telegram-api-sender.ts";
import type { InlineMarkup, InlineMarkupButton } from "./telegram-markup.ts";

/**
 * نصُّ الزرِّ المُلحَقِ: اسمُ العلامةِ كما يظهرُ في زرِّ القائمةِ المضبوطِ على البوتَين
 * (`setChatMenuButton` — «وصلة»). لغةُ المستلِمِ لا تصلُ إلى المُرسِلِ، والاسمُ العلَمُ لا
 * يُترجَمُ؛ والمُخطِرُ الذي يعرفُ اللغةَ يضعُ زرَّه المترجَمَ بنفسِه فيتركُه هذا الغلافُ.
 */
export const MINIAPP_ENTRY_LABEL = "📱 وَصْلة";

export interface MiniAppEntryOptions {
  /** أصلُ التطبيقِ — `MINIAPP_URL`. */
  readonly miniAppUrl: string;
  /** نصُّ الزرِّ — اسمُ العلامةِ لا جملةٌ: المُرسِلُ لا يعرفُ لغةَ المستلِمِ. */
  readonly label: string;
}

/** محادثةٌ خاصّةٌ: معرّفٌ موجبٌ. القروباتُ والقنواتُ سالبةٌ. */
function isPrivateChatId(chatId: string): boolean {
  return /^[0-9]+$/.test(chatId);
}

function hasWebAppButton(markup: InlineMarkup): boolean {
  return markup.inline_keyboard.some((row) => row.some((button) => "web_app" in button));
}

function isInlineMarkup(markup: unknown): markup is InlineMarkup {
  return (
    typeof markup === "object" &&
    markup !== null &&
    Array.isArray((markup as { inline_keyboard?: unknown }).inline_keyboard)
  );
}

/** يحسبُ اللوحةَ بعدَ الإلحاقِ — دالّةٌ خالصةٌ تُختبَرُ وحدَها. */
export function withEntryButton(
  chatId: string,
  markup: unknown,
  entry: InlineMarkupButton,
): unknown {
  if (!isPrivateChatId(chatId)) return markup;
  if (markup === undefined) return { inline_keyboard: [[entry]] } satisfies InlineMarkup;
  if (!isInlineMarkup(markup) || hasWebAppButton(markup)) return markup;
  return { inline_keyboard: [...markup.inline_keyboard, [entry]] } satisfies InlineMarkup;
}

export function withMiniAppEntry(
  sender: TelegramSender,
  options: MiniAppEntryOptions,
): TelegramSender {
  const entry: InlineMarkupButton = {
    text: options.label,
    web_app: { url: miniAppUrl(options.miniAppUrl, null) },
  };
  return {
    sendMessage: (chatId: string, text: string, markup: unknown, sendOptions?: SendOptions) =>
      sender.sendMessage(chatId, text, withEntryButton(chatId, markup, entry), sendOptions),
    sendPhoto: (
      chatId: string,
      fileId: string,
      caption: string,
      markup: unknown,
      sendOptions?: SendOptions,
    ) =>
      sender.sendPhoto(
        chatId,
        fileId,
        caption,
        withEntryButton(chatId, markup, entry),
        sendOptions,
      ),
    sendLocation: (chatId, latitude, longitude, sendOptions) =>
      sender.sendLocation(chatId, latitude, longitude, sendOptions),
  };
}
