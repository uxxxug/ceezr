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
import { SUPPORTED_LANGUAGES } from "../../../../../packages/domain/i18n-translation/index.ts";
import { createTelegramApi } from "../../../../../packages/infrastructure/notification/telegram-client.ts";

export interface BotCommand {
  readonly command: string;
  readonly description: string;
}

/** منفذ التسجيل — grammY في الإنتاج، ومزدوج يلتقط النداءات في الاختبار. */
export interface CommandRegistrar {
  setCommands(commands: readonly BotCommand[], languageCode: string | null): Promise<void>;
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
  };
}

/**
 * لماذا تسجيل لكل لغة **ومرّة بلا لغة**؟ تلغرام يختار القائمة بلغة عميل المستخدم،
 * ويسقط إلى القائمة غير المقيَّدة بلغة إن لم يجد مطابقاً. فبلا التسجيل المطلق
 * يرى صاحبُ هاتف بالفرنسية قائمةً فارغة تماماً — لا عربية ولا إنجليزية.
 * والافتراضية عربية لأنها لغة التشغيل الفعلية للمنصّة.
 */
export async function registerBotCommands(
  audience: BotAudience,
  registrar: CommandRegistrar,
): Promise<void> {
  for (const language of SUPPORTED_LANGUAGES) {
    await registrar.setCommands(botCommandsFor(audience, language), language);
  }
  await registrar.setCommands(botCommandsFor(audience, "ar"), null);
}
