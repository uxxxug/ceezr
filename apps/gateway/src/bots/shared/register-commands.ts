/**
 * الغرض: تسجيل قائمة أوامر البوتين عند تلغرام (setMyCommands) بكل لغة مدعومة،
 *   فتظهر للمستخدم في زرّ القائمة داخل تلغرام بلا أن يحفظ أمراً واحداً.
 * الحالة: منفّذ فعلياً — البند 2.1.
 * ينتمي إلى: apps/gateway/bots/shared
 * يستخدمه: apps/gateway/src/index.ts عند الإقلاع (غير حاجز).
 * ملاحظات مستقبلية: عند إضافة لغة رابعة تُسجَّل تلقائياً — القائمة تُقرأ من
 *   SUPPORTED_LANGUAGES لا من ثوابت هنا.
 */

import {
  type BotAudience,
  botCommandsFor,
} from "../../../../../packages/application/bots/main-menu.ts";
import {
  type MiniAppSurfaceConfig,
  surfaceCommandsFor,
} from "../../../../../packages/application/bots/miniapp-surface.ts";
import { SUPPORTED_LANGUAGES } from "../../../../../packages/domain/i18n-translation/index.ts";
import { createTelegramApi } from "../../../../../packages/infrastructure/notification/telegram-client.ts";
import { miniAppUrl } from "../../../../../packages/shared/miniapp-link/index.ts";

export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

/** منفذ التسجيل — grammY في الإنتاج، ومزدوج يلتقط النداءات في الاختبار. */
export interface CommandRegistrar {
  setCommands(commands: readonly BotCommand[], languageCode: string | null): Promise<void>;
  /**
   * زرُّ القائمةِ الافتراضيُّ للبوتِ (`setChatMenuButton` بلا `chat_id`) — `ADR 0213`. كان يُضبَطُ
   * يدويّاً من BotFather فلا يعرفُه المستودعُ ولا يُستعادُ بعدَ تبديلِ الرمزِ؛ صارَ يُضبَطُ من
   * الكودِ عند كلِّ إقلاعٍ. اختياريٌّ لأنّ مُسجِّلاتِ الاختبارِ القائمةَ لا تحتاجُه.
   */
  setMenuButton?(text: string, url: string): Promise<void>;
}

export function grammyCommandRegistrar(token: string): CommandRegistrar {
  const api = createTelegramApi(token);
  return {
    setCommands: async (commands, languageCode) => {
      // نوع grammY يقيّد language_code بقائمة رموز ثابتة؛ ولغاتنا من SUPPORTED_LANGUAGES
      // وهي رموز ISO صحيحة (ar/en/ur)، فالتطويع هنا مقصور على حدّ المكتبة.
      await api.setMyCommands(
        commands.map((c) => ({ command: c.command, description: c.description })),
        languageCode === null ? {} : ({ language_code: languageCode } as never),
      );
    },
    setMenuButton: async (text, url) => {
      await api.setChatMenuButton({ menu_button: { type: "web_app", text, web_app: { url } } });
    },
  };
}

/**
 * لماذا تسجيل لكل لغة **ومرّة بلا لغة**؟ تلغرام يختار القائمة بلغة عميل المستخدم،
 * ويسقط إلى القائمة غير المقيَّدة بلغة إن لم يجد مطابقاً. فبلا التسجيل المطلق
 * يرى صاحبُ هاتف بالفرنسية قائمةً فارغة تماماً — لا عربية ولا إنجليزية.
 * والافتراضية عربية لأنها لغة التشغيل الفعلية للمنصّة.
 */
/**
 * نصُّ زرِّ القائمةِ — الاسمُ نفسُه المضبوطُ يدويّاً على البوتَين قبلَ هذا (قراءةُ
 * `getChatMenuButton` في 2026-09-29: «وصلة»)، فلا يرى المستخدمُ تغيّراً إلّا مصدرَ الضبطِ.
 */
export const MENU_BUTTON_TEXT = "وصلة";

export async function registerBotCommands(
  audience: BotAudience,
  registrar: CommandRegistrar,
  surface?: MiniAppSurfaceConfig,
): Promise<void> {
  const miniapp =
    surface !== undefined && surface.mode === "miniapp" && surface.miniAppUrl !== null;
  // في وضعِ التطبيقِ تُعلَنُ الأوامرُ المقيمةُ في البوتِ وحدَها (`surfaceCommandsFor`)؛ والمنتقلةُ
  // تبقى مفهومةً إن كُتِبَت، ولا تُعرَضُ في القائمةِ كأنّ عملَها ما زالَ هنا.
  const commandsFor = miniapp ? surfaceCommandsFor : botCommandsFor;
  for (const language of SUPPORTED_LANGUAGES) {
    await registrar.setCommands(commandsFor(audience, language), language);
  }
  await registrar.setCommands(commandsFor(audience, "ar"), null);
  if (miniapp && registrar.setMenuButton !== undefined && surface.miniAppUrl !== null) {
    await registrar.setMenuButton(MENU_BUTTON_TEXT, miniAppUrl(surface.miniAppUrl, null));
  }
}
