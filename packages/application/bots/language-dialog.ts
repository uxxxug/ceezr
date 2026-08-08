/**
 * الغرض: حوار اختيار اللغة، مشترك بين بوت السائق وبوت العميل بلا تكرار.
 *   الأمر /language يعرض القائمة، والزرّ يكتب الاختيار في القاعدة ويحدّث الجلسة معاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: driver-dialog، rider-dialog، وأي بوت لاحق
 * ملاحظات مستقبلية: عرض القائمة داخل /start نفسه للمستخدم الجديد يستعمل نفس الدالّتين.
 */

import { isSupportedLanguage, LANGUAGE_LABELS } from "../../domain/i18n-translation/index.ts";
import { t } from "../../shared/i18n/index.ts";
import {
  getSupportedLanguages,
  type LanguagePreferencePort,
  selectLanguage,
} from "../i18n-translation/index.ts";
import type { BotReply, Keyboard, Sender } from "./types.ts";

/** بادئة أزرار اللغة. مفصولة عن بقية البوادئ لأن اللغة تُختار قبل أي شيء آخر. */
export const LANGUAGE_CALLBACK_PREFIX = "lang:";

export interface LanguageDialogDependencies {
  readonly preferences: LanguagePreferencePort;
  /**
   * تحديث لغة الجلسة بعد نجاح الكتابة في القاعدة. الجلسة والقاعدة يجب أن تتفقا،
   * وإلا تغيّرت اللغة في القاعدة وبقيت الرسائل تصل بالقديمة حتى تنتهي الجلسة.
   */
  readonly rememberLanguage: (telegramId: string, language: string) => Promise<void>;
}

/** لوحة اختيار اللغة: كل لغة باسمها بلغتها هي، صفّاً لكلٍّ منها. */
export function languageKeyboard(): Keyboard {
  return {
    kind: "inline",
    rows: getSupportedLanguages().map((option) => [
      { label: option.label, data: `${LANGUAGE_CALLBACK_PREFIX}${option.code}` },
    ]),
  };
}

/**
 * عرض القائمة. النصّ يُكتب بلغة المستخدم الحالية — لا بالافتراضية — لأن من
 * يريد تغيير لغته قد يكون فهم لغته الحالية جيّداً وأراد غيرها لسبب آخر.
 */
export function handleLanguageCommand(
  sender: Sender,
  currentLanguage: string,
): readonly BotReply[] {
  return [
    {
      chatId: sender.telegramUserId,
      text: t(currentLanguage)("language.choose"),
      keyboard: languageKeyboard(),
    },
  ];
}

/**
 * معالجة ضغطة زرّ اللغة. الردّ يُكتب باللغة **الجديدة** لا القديمة: أوّل ما يجب أن
 * يراه المستخدم بعد اختياره دليلٌ على أن الاختيار نفذ، وأصدق دليل أن يصله بلغته.
 */
export async function handleLanguageCallback(
  data: string,
  sender: Sender,
  currentLanguage: string,
  deps: LanguageDialogDependencies,
): Promise<readonly BotReply[]> {
  const requested = data.slice(LANGUAGE_CALLBACK_PREFIX.length);

  if (!isSupportedLanguage(requested)) {
    return [
      {
        chatId: sender.telegramUserId,
        text: t(currentLanguage)("language.unsupported"),
        keyboard: null,
      },
    ];
  }

  const outcome = await selectLanguage(
    { telegramId: sender.telegramUserId, language: requested },
    { preferences: deps.preferences },
  );

  if (!outcome.ok) {
    // فشل الكتابة هنا سببه الغالب أن المستخدم لم يسجّل بعد، لا عطل تقني:
    // زرّ اللغة قد يُضغط قبل /start حين تُعرض القائمة في رسالة ترحيب.
    return [
      {
        chatId: sender.telegramUserId,
        text: t(currentLanguage)("language.not_registered"),
        keyboard: null,
      },
    ];
  }

  await deps.rememberLanguage(sender.telegramUserId, outcome.value.language);

  const tr = t(outcome.value.language);
  const label = LANGUAGE_LABELS[outcome.value.language];
  const key = outcome.value.changed ? "language.changed" : "language.unchanged";

  return [{ chatId: sender.telegramUserId, text: tr(key, { language: label }), keyboard: null }];
}
