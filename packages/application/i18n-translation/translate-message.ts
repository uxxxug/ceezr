/**
 * الغرض: حالة استخدام الترجمة — تأخذ نصّاً وزوج لغتين وتعيد ما يُعرض للقارئ.
 *   لا تفشل أبداً بمعنى إيقاف المحادثة: أسوأ نتائجها نصّ بلغته الأصلية مع سبب مسجَّل.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: application/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/infrastructure/notification (التمرير)، apps/gateway
 * ملاحظات مستقبلية: الترجمة الجماعية (دفعة رسائل بنداء واحد) تُضاف منفذاً ثانياً لا بتغيير هذا.
 */

import {
  decideTranslation,
  type LanguagePair,
  type TranslatedMessage,
  type TranslationFailure,
  translationCacheKey,
  untranslated,
} from "../../domain/i18n-translation/index.ts";
import type { Result } from "../../shared/result/index.ts";

export interface TranslationRequest {
  readonly text: string;
  readonly pair: LanguagePair;
}

export interface TranslationSuccess {
  readonly text: string;
  /** اسم المزوّد كما يُكتب في السجلّ: google، deepl، mymemory… */
  readonly provider: string;
}

/**
 * منفذ المزوّد الخارجي. تنفيذه في infrastructure ويُحقن هنا، فلا يعرف
 * هذا الملفّ HTTP ولا مفاتيح ولا صيغة استجابة.
 */
export interface TranslationProvider {
  readonly name: string;
  translate(request: TranslationRequest): Promise<Result<TranslationSuccess, TranslationFailure>>;
}

/**
 * ذاكرة مؤقتة اختيارية. رسائل التفاوض تتكرّر كثيراً («وين أنت؟»، «طالع لك»)،
 * وترجمة النصّ نفسه مرّتين إنفاق بلا مقابل.
 */
export interface TranslationCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface TranslateMessageDependencies {
  readonly provider: TranslationProvider | null;
  readonly cache?: TranslationCache;
  /** يُستدعى عند فشل المزوّد. الفشل لا يُوقف الرسالة لكنه لا يُخفى. */
  readonly onFailure?: (failure: TranslationFailure) => void;
  readonly maxChars?: number;
}

/**
 * الترجمة خدمة مساعِدة لا شرط تسليم: إن سقط المزوّد وصلت الرسالة بلغتها الأصلية.
 * البديل — حجب الرسالة حتى تُترجَم — يقطع محادثة بين سائق وعميل ينتظران بعضهما
 * في الشارع، وهذا ضرر أكبر بكثير من قراءة سطر بلغة لا يتقنها القارئ.
 */
export async function translateMessage(
  request: TranslationRequest,
  deps: TranslateMessageDependencies,
): Promise<TranslatedMessage> {
  const decision = decideTranslation({
    text: request.text,
    pair: request.pair,
    enabled: deps.provider !== null,
    ...(deps.maxChars === undefined ? {} : { maxChars: deps.maxChars }),
  });

  if (decision.kind === "skip") {
    return untranslated(request.text, request.pair, decision.reason);
  }

  const provider = deps.provider;
  if (provider === null) return untranslated(request.text, request.pair, "disabled");

  const key = translationCacheKey(decision.pair, decision.text);

  if (deps.cache !== undefined) {
    const hit = await deps.cache.get(key);
    if (hit !== null) {
      return {
        text: hit,
        original: request.text,
        translated: true,
        pair: decision.pair,
        skipped: null,
        provider: provider.name,
        cached: true,
      };
    }
  }

  const outcome = await provider.translate({ text: decision.text, pair: decision.pair });

  if (!outcome.ok) {
    deps.onFailure?.(outcome.error);
    return untranslated(request.text, request.pair, "disabled");
  }

  // المزوّد الذي يعيد النصّ كما أرسلناه لم يترجم شيئاً — يُعامَل عدم ترجمة
  // لا نجاحاً، وإلا عرضنا للقارئ سطرين متطابقين وسمّينا أحدهما ترجمة.
  if (outcome.value.text.trim() === decision.text) {
    return untranslated(request.text, request.pair, "no_translatable_content");
  }

  if (deps.cache !== undefined) await deps.cache.set(key, outcome.value.text);

  return {
    text: outcome.value.text,
    original: request.text,
    translated: true,
    pair: decision.pair,
    skipped: null,
    provider: outcome.value.provider,
    cached: false,
  };
}
