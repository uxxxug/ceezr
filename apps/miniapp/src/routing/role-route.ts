/**
 * الغرض: التوجيهُ المبنيُّ على الدور (البند `F1-05`) — دالّةٌ نقيّةٌ تترجم ما
 *   قاله الخادمُ إلى سطحٍ جذريٍّ واحدٍ، وتحميلُ حزمةِ الدورِ عندَ الحاجةِ إليها
 *   وحدَها (القسم 9.4: حزمةُ `driver` «عند كون الدور سائقاً»).
 * الحالة: منفّذ فعلياً — البند `F1-05`.
 * ينتمي إلى: apps/miniapp/src/routing (حزمة `shell` — «الموجّه» في القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` و`routing/RoleRouter.tsx`، وشاشاتُ
 *   `F2`/`F3` عندَ بنائها على هذه الأسطحِ الجذرية.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ لكلِّ دورٍ (القسم 9.3) وشاشاتُ
 *   `SS-01..SS-05` بندُ `F1-07`، وشاشاتُ الراكبِ والسائقِ بنودُ `F2`/`F3`. وقاعدةُ
 *   «الرحلةُ النشطةُ تسيطر على التطبيق» تحتاج حالةَ رحلةٍ لا وجودَ لها اليوم،
 *   فلا تُدَّعى ههنا.
 *
 * لماذا دالّةٌ نقيّةٌ لا شرطٌ داخلَ مكوّن؟ لأنّ «أيُّ سطحٍ لأيِّ دورٍ» قاعدةُ
 * توجيهٍ تُختبَر بلا DOM ولا متصفّح، فتُقرأ في اختبارٍ واحدٍ صريحٍ لا تُستنتَج
 * من شجرةِ عناصر.
 */

import type { ViewerView } from "../identity/viewer.ts";

/** الأسطحُ الجذريةُ الموجودةُ اليوم — وليست هي الأدوار. */
export type Surface = "rider" | "driver" | "admin" | "none";

export type NoSurfaceReason =
  /** لا صفَّ لهذا المستخدمِ في القاعدة: تسجيلُه اليومَ عبرَ البوت. */
  | "unregistered"
  /** محجوبٌ بقرارِ الخادم. */
  | "blocked"
  /** دورٌ صحيحٌ لا سطحَ له في التطبيقِ المصغَّرِ بعد (`support`). */
  | "no_surface_yet"
  /** لا جلسةَ صالحة. */
  | "session_invalid"
  /** انتهت الجلسةُ: تجديدٌ ثم إعادةُ قراءة. */
  | "session_expired"
  /** تعطيلٌ معلَنٌ أو ردٌّ لا يُفهَم. */
  | "unavailable";

export type RoleRoute =
  | { readonly surface: "rider" | "driver" | "admin" }
  | { readonly surface: "none"; readonly reason: NoSurfaceReason };

/**
 * قرارُ التوجيه. **مدخلُه ردُّ الخادمِ وحدَه**: لا حاملَ جلسةٍ ولا تخزينٌ ولا
 * `initData` ولا افتراضٌ عندَ الشكّ. وكلُّ حالةٍ لها فرعٌ صريحٌ — فلا حالةَ
 * تسقط على سطحٍ بالسهو.
 *
 * و`support` دورٌ قائمٌ في القاعدةِ لا سطحَ له بعدُ: يُعاد `none` بسببٍ صريحٍ
 * **ولا يُطوى على سطحِ الراكبِ ولا يُرقّى إلى سطحِ المشرف**.
 */
export function routeForViewer(view: ViewerView): RoleRoute {
  if (view.kind === "blocked") return { surface: "none", reason: "blocked" };
  if (view.kind === "session_expired") {
    return { surface: "none", reason: "session_expired" };
  }
  if (view.kind === "session_invalid") {
    return { surface: "none", reason: "session_invalid" };
  }
  if (view.kind === "unavailable") return { surface: "none", reason: "unavailable" };

  if (view.status === "unregistered") return { surface: "none", reason: "unregistered" };
  if (view.role === "rider") return { surface: "rider" };
  if (view.role === "driver") return { surface: "driver" };
  if (view.role === "admin") return { surface: "admin" };
  if (view.role === "support") return { surface: "none", reason: "no_surface_yet" };
  return { surface: "none", reason: "unregistered" };
}

/**
 * مُحمّلاتُ الحزم — تُحقَن كي يُختبَر «ما حُمِّل ومتى» بلا بناءِ حزمٍ حقيقيةٍ في
 * الاختبار. والفصلُ مقصود: حزمةُ `driver` **لا تُطلَب لغيرِ السائق**، وهذا هو
 * نصُّ القسم 9.4 لا تحسينُ أداءٍ اختياري.
 */
export interface SurfaceLoaders<TModule> {
  readonly rider: () => Promise<TModule>;
  readonly driver: () => Promise<TModule>;
  readonly admin: () => Promise<TModule>;
}

export type SurfaceLoadOutcome<TModule> =
  | { readonly loaded: "none" }
  | { readonly loaded: "rider" | "driver" | "admin"; readonly module: TModule }
  /** فشلُ تحميلِ حزمةٍ يُعلَن فشلاً — ولا يُبدَّل بسطحٍ آخرَ ولا بدورٍ أدنى. */
  | { readonly loaded: "rider" | "driver" | "admin"; readonly failed: true };

export async function loadSurface<TModule>(
  route: RoleRoute,
  loaders: SurfaceLoaders<TModule>,
): Promise<SurfaceLoadOutcome<TModule>> {
  if (route.surface === "none") return { loaded: "none" };
  const loader = loaders[route.surface];
  try {
    return { loaded: route.surface, module: await loader() };
  } catch {
    return { loaded: route.surface, failed: true };
  }
}
