/**
 * الغرض: ترويسات أمن صفحات لوحة الإدارة: سياسةُ أمن محتوىً بـ`nonce` لكل طلب،
 *   ومنعُ التأطير، وكفُّ تخمين النوع، وكتمُ المُحيل. والسياسةُ تُشتقّ من ضبط
 *   الخريطة فعلياً فلا تسمح بأصلٍ لا يُستعمل.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts، والمرحلة ١٣
 * ملاحظات مستقبلية: عند إضافة مصدر أحداث (SSE، ADR-0016) يبقى `connect-src 'self'`
 *   كافياً؛ ولا يُضاف أصلٌ إلا إذا صار يُطلب فعلاً من أصلٍ آخر.
 */

import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AdminEnv } from "./guard.ts";

/** طولُ الـnonce بالبايت — ١٢٨ بت عشوائية تكفي لقيمةٍ تُولَّد لكل طلب. */
const NONCE_BYTES = 16;

export interface SecurityHeaderOptions {
  /**
   * أصولُ الخريطة المسموحة، مُشتقّةً من `resolveMapStyle`. فارغةٌ تعني «لا خريطة»،
   * وحينها **لا يُسمح لأي أصلٍ خارجي بشيء** — لا نصٌّ ولا صورةٌ ولا اتصال.
   * وهذا هو معنى اشتقاق السياسة من الضبط: منصّةٌ لم تُفعِّل خريطةً لا تحمل سطحَ
   * هجومِ خريطة.
   */
  readonly mapOrigins: readonly string[];
}

/**
 * سياسةُ أمن المحتوى.
 *
 * ## لماذا `nonce` لا `'unsafe-inline'`
 *
 * اللوحة تُصيَّر في الخادم، وفيها وسمُ `<style>` ووسمُ `<script>` داخليان
 * (ADR 0007 اختار ذلك عن قصد). و`'unsafe-inline'` كان سيُبطل السياسةَ من أصلها:
 * أيُّ نصٍّ يُحقَن في الصفحة يُنفَّذ. والـ`nonce` يُبقي وسومَنا تعمل ويمنع أي
 * وسمٍ آخر — بما فيه ما يُحقَن عبر ثقبٍ في الهروب.
 *
 * ## `style-src-attr 'unsafe-inline'` — تنازلٌ صريح
 *
 * الصفحات تستعمل سمةَ `style="…"` في تسعة مواضع على الأقل، وأهمُّها خلايا الخريطة
 * الحرارية: لونُ كل خليّةٍ محسوبٌ من فارق الطلب والعرض، فلا يمكن أن يكون صنفَ CSS
 * ثابتاً. والـ`nonce` لا يُجيز سماتَ النمط (يُجيز الوسومَ وحدها).
 *
 * والبديلان: إمّا حصرُ الألوان في سلّمٍ ثابتٍ من الأصناف — فتُفقَد دقّةُ التدرّج
 * التي هي فائدةُ الصفحة؛ وإمّا كتابةُ ورقة أنماطٍ داخليةٍ تُولَّد لكل طلب بأصنافٍ
 * لكل خليّة، فتنتفخ الصفحةُ بمئة صنفٍ يُستعمل كلٌّ منها مرّةً. وسمةُ النمط لا
 * تُنفِّذ شيئاً: أسوأُ ما تفعله تشويهُ شكلٍ، لا تنفيذُ كود. فالتنازل محدودُ الأثر
 * ومُعلَن، ويبقى `script-src` مقصوراً على الـ`nonce`.
 */
function contentSecurityPolicy(nonce: string, mapOrigins: readonly string[]): string {
  const external = mapOrigins.join(" ");
  const hasMap = mapOrigins.length > 0;

  const directives: string[] = [
    // كل ما لم يُذكر صريحاً ممنوع. القائمة أدناه هي كل ما تحتاجه اللوحة فعلاً.
    "default-src 'none'",
    `script-src 'nonce-${nonce}'${hasMap ? ` ${external}` : ""}`,
    `style-src 'nonce-${nonce}'${hasMap ? ` ${external}` : ""}`,
    "style-src-attr 'unsafe-inline'",
    // `data:` لأن أدوات MapLibre تُولّد أيقوناتها، و`blob:` لبلاطاتٍ تُفكَّك في عاملٍ.
    `img-src 'self' data:${hasMap ? ` blob: ${external}` : ""}`,
    `connect-src 'self'${hasMap ? ` ${external}` : ""}`,
    "font-src 'self' data:",
    // MapLibre يُنشئ عمّاله من blob؛ وبلا خريطةٍ لا عاملَ أصلاً فلا يُسمح بشيء.
    hasMap ? "worker-src blob:" : "worker-src 'none'",
    "object-src 'none'",
    "media-src 'none'",
    "manifest-src 'none'",
    // النماذج لا تُرسل إلا إلى نفس الأصل: يمنع سحبَ رمز CSRF إلى مضيفٍ آخر لو
    // نجح أحدٌ في زرع وسمِ نموذجٍ في الصفحة.
    "form-action 'self'",
    "base-uri 'none'",
    // بديلُ X-Frame-Options الحديث، ويُبقى الاثنان معاً لأن المتصفّحات القديمة
    // تفهم الأقدم وحده.
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/**
 * وسيطٌ يولّد `nonce` لكل طلب، يضعه على السياق ليقرأه المُصيِّر، ثم يكتب
 * الترويسات على الردّ.
 *
 * الترتيب مقصود: التوليد **قبل** المُعالِج لأن الصفحة تحتاج القيمة، والكتابة
 * **بعده** لأن الردّ لم يكن موجوداً قبله. ولو وُلِّد الـnonce في المُصيِّر لما
 * أمكن للترويسة أن تعرفه، فتُرفض وسومُنا نفسُها.
 */
export function createAdminSecurityHeaders(
  options: SecurityHeaderOptions,
): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const nonce = randomBytes(NONCE_BYTES).toString("base64");
    c.set("cspNonce", nonce);
    await next();
    c.header("Content-Security-Policy", contentSecurityPolicy(nonce, options.mapOrigins));
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    // لا يُرسَل المُحيل إلى أي مكان: مسارات اللوحة تحمل معرّفات سائقين وطلبات في
    // الرابط، وتسريبُها في ترويسة `Referer` إلى مضيف بلاطاتٍ خارجي تسريبُ بيانات.
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    // اللوحة لا تحتاج موقعاً ولا كاميرا ولا ميكروفون؛ ومنعُها هنا يمنع أي نصٍّ
    // نجح في التنفيذ من أن يطلبها بصلاحية المسؤول.
    c.header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
  };
}

/** يُصدَّر للاختبار وحده: بناءُ السياسة دالّةٌ محضة تُفحص بلا خادم. */
export const buildContentSecurityPolicyForTest = contentSecurityPolicy;
