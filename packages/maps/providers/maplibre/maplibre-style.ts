/**
 * الغرض: تحليلُ ضبط نمط MapLibre في الخادم: التحقّق من الرابط، وإلحاقُ مفتاح
 *   البلاطات العامّ إن لزم، واشتقاقُ الأصول المسموحة لسياسة أمن المحتوى.
 *   دالّةٌ محضة بلا شبكةٍ ولا `process.env` — تُختبر بلا خادمٍ ولا متصفّح.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: packages/maps/providers/maplibre
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway (ترويسة الأمن)،
 *   apps/admin-dashboard/src/map.ts، والمراحل ١١ و١٢ و١٣
 * ملاحظات مستقبلية: إن احتاج مشغّلٌ بلاطاتٍ من مضيفٍ غير مضيف النمط فالحلّ
 *   قراءةُ `sources` من ملفّ النمط لا إضافةُ متغيّر بيئةٍ ثانٍ (يُنظر R-36).
 */

import { err, ok, type Result } from "../../../shared/result/index.ts";
import {
  MapConfigError,
  type MapStyleInput,
  type ResolvedMapStyle,
} from "../../core/map-provider.ts";

/**
 * إصدارُ MapLibre GL JS المُثبَّت، وبصمةُ سلامته.
 *
 * الإصدار مُثبَّتٌ بالرقم لا بـ`latest`: نصٌّ يُنفَّذ في متصفّح مسؤولٍ يحمل كعكة
 * جلسته لا يُترك لأن يتغيّر تحت أقدامنا بلا مراجعة. وهو نفسُ عطب P2-12
 * (`bun-version: latest` في CI) في مكانٍ أخطر.
 *
 * والبصمة (SRI) هي ما يجعل ذلك التثبيت ذا معنى: بلا بصمةٍ يكفي أن يُخترق مضيفُ
 * التوزيع مرّةً واحدة ليُنفَّذ ما يشاء بصلاحية المسؤول. ومع البصمة يرفض المتصفّح
 * أي بايتٍ مختلف — ولو من نفس الرابط.
 *
 * **حالةُ البصمة: غير مُتحقَّق منها في هذا المستودع.** لم يُنزَّل الملفّ ولم
 * تُحسب بصمتُه هنا، فلا يُدّعى أنها صحيحة. مَن ينشر يحسبها بنفسه
 * (`openssl dgst -sha384 -binary maplibre-gl.js | openssl base64 -A`) ويقارنها
 * بما تُعلنه صفحةُ إصدار MapLibre. ولذلك لا يُصيَّر وسمُ النصّ إلا إذا ضُبِطت
 * البصمةُ صريحاً — يُنظر `MAPLIBRE_SRI_UNSET` أدناه.
 */
export const MAPLIBRE_VERSION = "4.7.1" as const;

/**
 * قيمةٌ صريحة تعني «لم تُضبَط بصمة». اخترتُ ثابتاً مقروءاً لا سلسلةً فارغة:
 * السلسلة الفارغة تُقرأ خطأً برمجياً، وهذه تُقرأ قراراً لم يُتَّخذ بعد.
 */
export const MAPLIBRE_SRI_UNSET = "sha384-UNSET" as const;

/** رابط التوزيع المقابل للإصدار المُثبَّت. */
export function maplibreScriptUrl(version: string = MAPLIBRE_VERSION): string {
  return `https://unpkg.com/maplibre-gl@${version}/dist/maplibre-gl.js`;
}

/** رابط ورقة الأنماط المقابلة — بلا الشيفرة الخاصّة بها لا تُرسم الأدوات. */
export function maplibreStylesheetUrl(version: string = MAPLIBRE_VERSION): string {
  return `https://unpkg.com/maplibre-gl@${version}/dist/maplibre-gl.css`;
}

/** أصلُ مضيف التوزيع — يحتاجه `script-src` و`style-src`. */
export const MAPLIBRE_CDN_ORIGIN = "https://unpkg.com" as const;

/** اسمُ مُعامل المفتاح الذي تستعمله خدمات البلاطات الشائعة. */
const KEY_PARAM = "key";

/**
 * يحلّل الضبط إلى نمطٍ جاهزٍ للتصيير.
 *
 * التمييز الجوهري: **غيرُ مُهيَّأ ≠ خطأ**. منصّةٌ بلا خريطة تعمل كاملةً (وهي حالها
 * اليوم)، فلا يجوز أن يمنع غيابُ `MAP_STYLE_URL` الإقلاع. أمّا رابطٌ **مضبوطٌ
 * وخاطئ** فخطأُ إقلاعٍ صريح: الفشل عند فتح الصفحة يظهر للمشغّل بعد أن ينشر،
 * والفشل عند الإقلاع يظهر له قبل أن ينشر.
 */
export function resolveMapStyle(input: MapStyleInput): Result<ResolvedMapStyle, MapConfigError> {
  if (input.provider === "none") {
    return ok({ configured: false, reason: "مزوّد الخريطة غير مُفعَّل (MAP_PROVIDER=none)." });
  }

  const raw = input.styleUrl?.trim() ?? "";
  if (raw === "") {
    // مزوّدٌ مُفعَّلٌ بلا رابطِ نمط: نقصٌ في الضبط لا اختيار. ومع ذلك لا يُوقف
    // الإقلاع، لأن الأثر محصورٌ في لوحةٍ إداريةٍ تعرض بديلاً نصّياً — وإيقافُ
    // البوّابة كلّها (وفيها بوتان يخدمان مستخدمين) لأجل خريطةٍ عقوبةٌ لا تناسب
    // الجرم. والرسالة تُقال للمشغّل في الصفحة، فلا يبقى الأمر صامتاً.
    return ok({
      configured: false,
      reason: "MAP_PROVIDER=maplibre مضبوط بلا MAP_STYLE_URL — لا مصدرَ بلاطات.",
    });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err(new MapConfigError("MAP_STYLE_URL", `ليس رابطاً صالحاً: ${raw}`));
  }

  // https فقط: صفحةُ اللوحة تُقدَّم على https في الإنتاج، ونمطٌ على http يُحجب
  // كمحتوىٍ مختلط فتظهر خريطةٌ فارغةٌ بلا سببٍ ظاهر في الصفحة. ورفضُه هنا يحوّل
  // عطلاً صامتاً في المتصفّح إلى خطأِ إقلاعٍ مقروء.
  if (url.protocol !== "https:") {
    return err(
      new MapConfigError(
        "MAP_STYLE_URL",
        `يجب أن يكون https (وردَ ${url.protocol.replace(":", "")})`,
      ),
    );
  }

  const urlHasKey = url.searchParams.has(KEY_PARAM);
  const providedKey = input.publicApiKey?.trim() ?? "";

  // مفتاحٌ في الرابط ومفتاحٌ في متغيّرٍ منفصل = مصدران للحقيقة لنفس القيمة، وأحدُهما
  // سيُنسى عند التبديل فتظهر أعطالُ حصّةٍ يصعب ردُّها إلى سببها. يُرفض صريحاً.
  if (urlHasKey && providedKey !== "") {
    return err(
      new MapConfigError(
        "MAP_TILES_PUBLIC_KEY",
        "الرابط يحمل ?key= ومعه مفتاحٌ مضبوطٌ منفصلاً — اختر أحدهما لا كليهما",
      ),
    );
  }

  if (providedKey !== "") url.searchParams.set(KEY_PARAM, providedKey);

  return ok({
    configured: true,
    provider: "maplibre",
    styleUrl: url.toString(),
    // مضيفُ النمط أوّلاً، ثم مضيفُ التوزيع لأن النصّ نفسه يُحمَّل منه.
    // ولا يُضاف غيرُهما: كلُّ أصلٍ زائدٍ في السياسة أصلٌ يُسمح له بتنفيذ شيءٍ
    // في صفحةٍ تحمل جلسة مسؤول.
    origins: [url.origin, MAPLIBRE_CDN_ORIGIN],
  });
}
