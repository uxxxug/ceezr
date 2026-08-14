/**
 * الغرض: ترويسات أمن **الصفحات العامّة** (صفحةُ تتبّع الرحلة `/track/:token`):
 *   سياسةُ أمن محتوى بـ`nonce` لكلّ طلب، ومنعُ التأطير والفهرسة، وكتمُ المُحيل،
 *   ومنعُ التخزين المؤقّت.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: apps/gateway/src/public
 * يُتوقع أن يستخدمه: apps/gateway/src/routes/public-tracking.ts.
 * ملاحظات مستقبلية: أيّ صفحةٍ عامّةٍ أخرى (إيصالُ رحلة، تقييمٌ برابط) تُركَّب على
 *   هذا الوسيط نفسه، ولا يُوسَّع إلا إن طلبت أصلاً خارجياً جديداً فعلاً.
 *
 * ## لماذا وسيطٌ ثانٍ لا إعادةُ استخدام وسيط الإدارة
 *
 * `createAdminSecurityHeaders` مربوطٌ بـ`AdminEnv` (فيه `csrfToken` وجلسةُ مسؤول)،
 * وسياستُه تسمح بما تحتاجه اللوحةُ لا ما تحتاجه صفحةٌ عامّة. والفرقان جوهريّان:
 *   ١. **`style-src-attr 'unsafe-inline'`**: تنازلٌ قبلته اللوحة لأجل الخريطة
 *      الحرارية. والصفحةُ العامّة لا سماتَ نمطٍ محسوبةٍ فيها، فلا تُورَّث تنازلاً
 *      لا تحتاجه — وهي الصفحةُ الوحيدة التي يفتحها من ليس مستخدماً عندنا.
 *   ٢. **`https://unpkg.com`**: اللوحة تُحمّل MapLibre من الشبكة وتُصرّح بذلك في
 *      أصول الخريطة نفسها؛ وهنا يُصرَّح بأصل الشبكة صريحاً منفصلاً عن أصل
 *      البلاطات، لأنّهما مضيفان مختلفان لهما دورانِ مختلفان.
 *
 * وتوريثُ سياسةِ لوحةِ إدارةٍ إلى صفحةٍ عامّة كان سيجعل كلَّ توسيعٍ للوحة توسيعاً
 * تلقائياً لسطح الهجوم في الصفحة العامّة — وهذا بالضبط ما يجب ألّا يحدث.
 */

import { randomBytes } from "node:crypto";
import type { Env, MiddlewareHandler } from "hono";

/** ١٢٨ بت عشوائية لكلّ طلب — نفسُ قياس وسيط الإدارة. */
const NONCE_BYTES = 16;

/** بيئةُ Hono للصفحات العامّة: لا جلسةَ ولا رمزَ CSRF، الـ`nonce` وحده. */
export interface PublicEnv extends Env {
  readonly Variables: {
    cspNonce: string;
  };
}

export interface PublicSecurityHeaderOptions {
  /**
   * أصولُ البلاطات المسموحة كما يُشتقّها `resolveMapStyle`. فارغةٌ تعني «لا
   * خريطة»، وحينها لا يُسمح لأيّ أصلٍ خارجيّ بشيء والصفحةُ تعرض الإحداثيات نصّاً.
   */
  readonly mapOrigins: readonly string[];
  /** أصلُ شبكة توزيع نصّ MapLibre — `MAPLIBRE_CDN_ORIGIN`. */
  readonly scriptOrigin: string;
}

/**
 * السياسة. أضيقُ من سياسة اللوحة عن قصد، والزيادةُ الوحيدة عليها `unpkg`.
 *
 * `connect-src` يشمل `'self'` لأنّ الصفحة تستفتي `/api/track/:token/position` كلّ
 * خمس ثوانٍ، ويشمل أصلَ البلاطات لأنّ MapLibre يجلبها بـ`fetch`.
 */
function publicContentSecurityPolicy(
  nonce: string,
  mapOrigins: readonly string[],
  scriptOrigin: string,
): string {
  const hasMap = mapOrigins.length > 0;
  const tiles = mapOrigins.join(" ");
  // بلا خريطةٍ لا يُحمَّل نصُّ MapLibre أصلاً، فلا يُسمح بأصل الشبكة كذلك: الصفحةُ
  // تعرض نصّاً محضاً، ولا سببَ لفتح بابٍ لا يُستعمل.
  const scriptSources = hasMap ? `'nonce-${nonce}' ${scriptOrigin}` : `'nonce-${nonce}'`;
  const styleSources = hasMap ? `'nonce-${nonce}' ${scriptOrigin}` : `'nonce-${nonce}'`;

  const directives: string[] = [
    "default-src 'none'",
    `script-src ${scriptSources}`,
    `style-src ${styleSources}`,
    `img-src 'self' data:${hasMap ? ` blob: ${tiles}` : ""}`,
    `connect-src 'self'${hasMap ? ` ${tiles}` : ""}`,
    "font-src 'self' data:",
    hasMap ? "worker-src blob:" : "worker-src 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "manifest-src 'none'",
    // لا نموذجَ في الصفحة إطلاقاً — فلا وجهةَ إرسالٍ مسموحة.
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/**
 * وسيطُ الصفحات العامّة. الترتيب كترتيب وسيط الإدارة: توليدُ الـ`nonce` قبل
 * المُعالِج ليقرأه المُصيِّر، وكتابةُ الترويسات بعده.
 */
export function createPublicSecurityHeaders(
  options: PublicSecurityHeaderOptions,
): MiddlewareHandler<PublicEnv> {
  return async (c, next) => {
    const nonce = randomBytes(NONCE_BYTES).toString("base64");
    c.set("cspNonce", nonce);
    await next();
    c.header(
      "Content-Security-Policy",
      publicContentSecurityPolicy(nonce, options.mapOrigins, options.scriptOrigin),
    );
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    // الرمزُ في المسار نفسه، فترويسةُ `Referer` كانت ستُسلّمه لمضيف البلاطات — أي
    // تُسلّم مفتاحَ الصفحة لطرفٍ ثالث في أوّل بلاطةٍ تُطلب.
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
    /**
     * لا تخزينَ ولا فهرسة: الصفحةُ تعرض موقعَ إنسانٍ لحظةَ عرضها، وكلُّ نسخةٍ منها
     * في وسيطٍ أو فهرسِ محرّكِ بحثٍ نسخةٌ من موقعه تبقى بعد انتهاء صلاحية الرمز.
     */
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, private");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  };
}

/** يُصدَّر للاختبار وحده: بناءُ السياسة دالّةٌ محضة تُفحص بلا خادم. */
export const buildPublicContentSecurityPolicyForTest = publicContentSecurityPolicy;
