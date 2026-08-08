/**
 * الغرض: بناء الرسالة التي تصل الطرف الآخر: قالبٌ بلغته هو من القاموس الثابت،
 *   ونصٌّ حرّ مترجَم داخله، والأصل تحته حين تُرجم. هذا هو موضع دمج القالب بالترجمة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/notification، apps/gateway
 * ملاحظات مستقبلية: تمرير الصور بتعليق مترجَم يستعمل نفس الدالّة بنفس المفاتيح.
 */

import type { SupportedLanguage, TranslatedMessage } from "../../domain/i18n-translation/index.ts";
import { shouldShowOriginal } from "../../domain/i18n-translation/index.ts";
import { t } from "../../shared/i18n/index.ts";
import { type TranslateMessageDependencies, translateMessage } from "./translate-message.ts";

export interface LocalizedTemplateInput {
  /** مفتاح القالب في القاموس — يجب أن يحوي المتغيّر {text}. */
  readonly templateKey: string;
  /** النصّ الحرّ الذي كتبه الطرف الآخر. */
  readonly body: string;
  readonly from: SupportedLanguage;
  readonly to: SupportedLanguage;
  /** متغيّرات إضافية للقالب، إن وُجدت. */
  readonly params?: Record<string, string | number>;
}

export interface LocalizedTemplate {
  readonly text: string;
  readonly translation: TranslatedMessage;
}

/**
 * القالب دائماً بلغة القارئ من القاموس الثابت — لا يُترجَم آلياً أبداً.
 * ترجمة «رسالة من السائق:» آلياً في كل مرّة إنفاق على نصّ نملك ترجمته اليدوية
 * الأدقّ، ومخاطرةٌ بأن يتغيّر معناه بتغيّر مزاج المزوّد. المترجَم هو النصّ الحرّ وحده.
 */
export async function renderLocalizedTemplate(
  input: LocalizedTemplateInput,
  deps: TranslateMessageDependencies,
): Promise<LocalizedTemplate> {
  const pair = { from: input.from, to: input.to };
  const translation = await translateMessage({ text: input.body, pair }, deps);
  const tr = t(input.to);

  const base = tr(input.templateKey, { ...(input.params ?? {}), text: translation.text });

  if (!shouldShowOriginal(translation)) {
    return { text: base, translation };
  }

  // الأصل يُذيَّل تحت الترجمة موسوماً بلغته، لا مدموجاً بها: القارئ يجب أن يعرف
  // أيّ السطرين كتبه إنسان وأيّهما كتبته آلة.
  const footer = tr("translation.original_note", {
    language: tr(`translation.language_name.${translation.pair.from}`),
    original: translation.original.trim(),
  });

  return { text: `${base}\n\n${footer}`, translation };
}
