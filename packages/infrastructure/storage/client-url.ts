/**
 * الغرض: تحويلُ المسارِ النسبيِّ الذي يردُّه مخزنُ الكائناتِ (رابطُ رفعٍ أو قراءةٍ موقَّعٌ)
 *   إلى رابطٍ مطلقٍ يُسلَّمُ للعميل (هاتفِ السائقِ أو متصفّحِ المراجِع).
 * الحالة: منفَّذٌ فعليّاً — `WR-21` على CasaOS (ADR 0294).
 * ينتمي إلى: infrastructure/storage
 * يُستخدم من: `signed-upload.ts` و`signed-read.ts`.
 *
 * ## لِمَ `/object/` يُردُّ إلى `/storage/v1/object/`
 *
 * `storage-api` يردُّ المسارَ نسبيًّا إلى جذرِه هو (`/object/upload/sign/…`)، وجذرُه خلفَ
 * بوّابةِ Supabase هو `/storage/v1` — وكذا تبنيه `supabase-js` (`${storageUrl}${data.url}`).
 * فحلُّه على الأصلِ مباشرةً يُسقِطُ البادئةَ ويُسلِّمُ الهاتفَ رابطًا يُردُّ 404. مقيسٌ على
 * `supabase/storage-api:v1.84.36` في 2026-10-30. ومسارٌ يبدأُ بـ`/storage/v1/` يبقى كما هو.
 *
 * ## ولِمَ أصلٌ عامٌّ منفصل (`OBJECT_STORAGE_PUBLIC_URL`)
 *
 * نداءاتُ الخادمِ إلى المخزنِ تحملُ مفتاحَ الخدمة. فإن كان الأصلُ الوحيدُ عامًّا خلفَ نفقٍ
 * يُنهي TLS عندَ طرفٍ ثالث، مرَّ المفتاحُ به. الأصلُ الداخليُّ للنداءات، والعامُّ للرابطِ
 * المسلَّمِ وحدَه — والرمزُ في الرابطِ محدودٌ بمسارٍ ومدّة. وغيابُه يُبقي السلوكَ السابق.
 */

const STORAGE_PREFIX = "/storage/v1";

/**
 * يعيدُ الرابطَ المطلقَ أو `null` إن خرجَ المسارُ عن أصلِ المخزن (أصلٌ مُبدَّلٌ في الجوابِ
 * يُحوِّلُ الرفعَ إلى خادمٍ غريب — فيُرفَض).
 */
export function resolveStorageClientUrl(
  relative: string,
  baseUrl: string,
  publicBaseUrl?: string,
): URL | null {
  let path = relative;
  if (path.startsWith("/object/")) path = `${STORAGE_PREFIX}${path}`;
  let resolved: URL;
  let own: URL;
  try {
    resolved = new URL(path, `${baseUrl}/`);
    own = new URL(baseUrl);
  } catch {
    return null;
  }
  if (resolved.origin !== own.origin) return null;
  if (publicBaseUrl !== undefined && publicBaseUrl.length > 0) {
    let pub: URL;
    try {
      pub = new URL(publicBaseUrl);
    } catch {
      return null;
    }
    // بناءٌ جديدٌ من الأصلِ العامّ — لا تعديلُ `host` الذي يُبقي منفذَ الداخليّ (`:8090`).
    return new URL(`${resolved.pathname}${resolved.search}`, pub.origin);
  }
  return resolved;
}

/** الأصلُ العامُّ من البيئة — فارغٌ أو غيرُ `https` يُعامَلُ غيابًا. */
export function readPublicStorageUrl(env: Record<string, string | undefined>): string | undefined {
  const raw = (env.OBJECT_STORAGE_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  return raw.startsWith("https://") ? raw : undefined;
}
