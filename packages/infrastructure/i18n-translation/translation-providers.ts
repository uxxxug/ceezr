/**
 * الغرض: مزوّدات الترجمة الآلية الحقيقية عبر HTTP، كلٌّ منها ينفّذ المنفذ نفسه
 *   فيصير تبديل المزوّد متغيّرَ بيئة لا تعديلَ كود.
 * الحالة: منفّذ فعلياً ومُختبَر على شبكة حقيقية — المرحلة 2.6.
 * ينتمي إلى: infrastructure/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: إضافة مزوّد جديد = دالّة واحدة هنا وسطر في المصنع، لا أكثر.
 */

import type {
  TranslationProvider,
  TranslationRequest,
  TranslationSuccess,
} from "../../application/i18n-translation/index.ts";
import { TranslationFailure } from "../../domain/i18n-translation/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";

/** مهلة تقنية: محادثة بين سائق وعميل في الشارع لا تحتمل انتظار مزوّد بطيء. */
export const TRANSLATION_TIMEOUT_MS = 4000;

export interface HttpTranslationOptions {
  readonly timeoutMs?: number;
  /** يُحقن في الاختبار ليُثبَّت السلوك بلا شبكة. */
  readonly fetchImpl?: typeof fetch;
}

type ProviderResult = Promise<Result<TranslationSuccess, TranslationFailure>>;

async function requestJson(
  name: string,
  url: string,
  init: RequestInit,
  options: HttpTranslationOptions,
): Promise<Result<unknown, TranslationFailure>> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TRANSLATION_TIMEOUT_MS);

  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });

    if (response.status === 429) {
      return err(new TranslationFailure("rate_limited", name, `HTTP ${response.status}`));
    }
    if (!response.ok) {
      return err(new TranslationFailure("provider_unavailable", name, `HTTP ${response.status}`));
    }

    return ok((await response.json()) as unknown);
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    const detail = error instanceof Error ? error.message : String(error);
    return err(new TranslationFailure(isAbort ? "timeout" : "provider_unavailable", name, detail));
  } finally {
    clearTimeout(timeout);
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// ---------------------------------------------------------------------------
// DeepL — أدقّ المزوّدات للأزواج التي يدعمها، وهو المزوّد المقصود للإنتاج.
// عيبه أنه لا يدعم الأردية، فلا يصلح وحده لسوق فيه سائقون باكستانيون.
// ---------------------------------------------------------------------------
export function createDeepLProvider(
  apiKey: string,
  options: HttpTranslationOptions = {},
): TranslationProvider {
  const name = "deepl";
  // المفتاح المنتهي بـ :fx مفتاح الخطة المجانية، وله نطاق مختلف.
  const host = apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      if (request.pair.from === "ur" || request.pair.to === "ur") {
        return err(new TranslationFailure("unsupported_pair", name, "ur غير مدعومة في DeepL"));
      }

      const body = new URLSearchParams({
        text: request.text,
        source_lang: request.pair.from.toUpperCase(),
        target_lang: request.pair.to.toUpperCase(),
      });

      const payload = await requestJson(
        name,
        `https://${host}/v2/translate`,
        {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
        options,
      );
      if (!payload.ok) return payload;

      const translations = (payload.value as { translations?: { text?: unknown }[] }).translations;
      const text = readString(translations?.[0]?.text);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      return ok({ text, provider: name });
    },
  };
}

// ---------------------------------------------------------------------------
// Google Cloud Translation v2 — يدعم اللغات الثلاث جميعاً، ويحتاج مفتاحاً.
// ---------------------------------------------------------------------------
export function createGoogleTranslateProvider(
  apiKey: string,
  options: HttpTranslationOptions = {},
): TranslationProvider {
  const name = "google";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      const payload = await requestJson(
        name,
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: request.text,
            source: request.pair.from,
            target: request.pair.to,
            format: "text",
          }),
        },
        options,
      );
      if (!payload.ok) return payload;

      const translations = (
        payload.value as { data?: { translations?: { translatedText?: unknown }[] } }
      ).data?.translations;
      const text = readString(translations?.[0]?.translatedText);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      return ok({ text: decodeHtmlEntities(text), provider: name });
    },
  };
}

/**
 * Google v2 يعيد النصّ مُرمَّزاً بكيانات HTML حتى مع format=text في بعض الحالات.
 * عرض `&#39;` للمستخدم عيبٌ ظاهر، وفكّه هنا أرخص من فكّه في كل نقطة عرض.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// ---------------------------------------------------------------------------
// MyMemory — مزوّد حقيقي بخطّة مجانية موثَّقة بلا مفتاح، يدعم الأزواج الثلاثة.
// كمّه اليومي محدود، فهو مزوّد التطوير والتحقّق لا مزوّد الإنتاج تحت حمل.
// ---------------------------------------------------------------------------
export function createMyMemoryProvider(
  options: HttpTranslationOptions & { readonly contactEmail?: string } = {},
): TranslationProvider {
  const name = "mymemory";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      const params = new URLSearchParams({
        q: request.text,
        langpair: `${request.pair.from}|${request.pair.to}`,
      });
      // البريد يرفع الحصّة اليومية في شروط المزوّد المعلنة.
      if (options.contactEmail !== undefined) params.set("de", options.contactEmail);

      const payload = await requestJson(
        name,
        `https://api.mymemory.translated.net/get?${params.toString()}`,
        { method: "GET" },
        options,
      );
      if (!payload.ok) return payload;

      const parsed = payload.value as {
        responseStatus?: unknown;
        quotaFinished?: unknown;
        responseData?: { translatedText?: unknown };
      };

      if (parsed.quotaFinished === true) {
        return err(new TranslationFailure("rate_limited", name, "انتهت الحصّة اليومية"));
      }
      if (parsed.responseStatus !== 200 && parsed.responseStatus !== "200") {
        return err(
          new TranslationFailure("bad_response", name, `responseStatus=${parsed.responseStatus}`),
        );
      }

      const text = readString(parsed.responseData?.translatedText);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      // المزوّد يعيد رسائل خطأ داخل حقل الترجمة نفسه بحروف كبيرة — تُلتقط هنا
      // لئلّا تصل المستخدمَ رسالةٌ إنجليزية غاضبة بدل ترجمة رسالة صاحبه.
      if (/^[A-Z '.]+$/.test(text) && text.includes("INVALID")) {
        return err(new TranslationFailure("unsupported_pair", name, text));
      }

      return ok({ text, provider: name });
    },
  };
}

// ---------------------------------------------------------------------------
// google-web — نقطة الترجمة المجانية التي يستعملها موقع ترجمة جوجل نفسه، بلا مفتاح.
//
// ⚠️ للتطوير والتحقّق فقط، ولا يجوز ضبطها في الإنتاج. سببان لا واحد:
//   (1) نقطة غير موثَّقة رسمياً، فصيغة ردّها قد تتغيّر بلا إشعار ولا نسخة API تحميها.
//   (2) استعمالها آلياً تحت حمل مخالفٌ لشروط الخدمة، والاعتماد عليها تجارياً
//       يعني بناء ميزة على أساس قد يُقطع في أي لحظة بلا مسار دعم.
//
// وجودها هنا مقصود ومحدود: تُثبِت أن مسار الترجمة يعمل من طرف إلى طرف بلا انتظار
// حساب مدفوع، ثم يُستبدل اسم المزوّد بـ deepl أو google قبل الإنتاج بتغيير متغيّر بيئة.
// ---------------------------------------------------------------------------
export function createGoogleWebProvider(options: HttpTranslationOptions = {}): TranslationProvider {
  const name = "google-web";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      const params = new URLSearchParams({
        client: "gtx",
        sl: request.pair.from,
        tl: request.pair.to,
        dt: "t",
        q: request.text,
      });

      const payload = await requestJson(
        name,
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        { method: "GET" },
        options,
      );
      if (!payload.ok) return payload;

      // الردّ مصفوفات متداخلة بلا أسماء حقول: المقطع الأول مصفوفة قطع، وأول عنصر
      // في كل قطعة نصّها المترجَم. النصّ الطويل يُقسَّم قطعاً فتُوصَل هنا بالترتيب.
      const segments = (payload.value as unknown[])[0];
      if (!Array.isArray(segments)) {
        return err(new TranslationFailure("bad_response", name, "لا مصفوفة قطع في الردّ"));
      }

      const text = segments
        .map((segment) => (Array.isArray(segment) ? readString(segment[0]) : null))
        .filter((piece): piece is string => piece !== null)
        .join("");

      if (text.trim() === "") {
        return err(new TranslationFailure("bad_response", name, "قطع فارغة"));
      }

      return ok({ text, provider: name });
    },
  };
}

export type TranslationProviderName = "deepl" | "google" | "google-web" | "mymemory" | "none";

export interface TranslationProviderConfig {
  readonly provider: TranslationProviderName;
  readonly apiKey?: string;
  readonly contactEmail?: string;
  readonly timeoutMs?: number;
}

/**
 * المصنع: `none` قيمة صريحة تعني «شغِّل النظام بلا ترجمة» — وهي حالة سليمة
 * لا عطل. الصمت هنا مقصود: من لا يضبط مزوّداً يجب أن يعمل نظامه، لا أن يسقط.
 */
export function createTranslationProvider(
  config: TranslationProviderConfig,
  options: HttpTranslationOptions = {},
): TranslationProvider | null {
  const shared: HttpTranslationOptions = {
    ...options,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  };

  switch (config.provider) {
    case "deepl":
      return config.apiKey === undefined ? null : createDeepLProvider(config.apiKey, shared);
    case "google":
      return config.apiKey === undefined
        ? null
        : createGoogleTranslateProvider(config.apiKey, shared);
    case "google-web":
      return createGoogleWebProvider(shared);
    case "mymemory":
      return createMyMemoryProvider({
        ...shared,
        ...(config.contactEmail === undefined ? {} : { contactEmail: config.contactEmail }),
      });
    default:
      return null;
  }
}
