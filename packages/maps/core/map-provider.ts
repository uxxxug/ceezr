/**
 * الغرض: عقد عرض الخريطة كما يُنتَج **في الخادم** — نموذجُ عرضٍ يُصيَّر إلى صفحة،
 *   لا واجهةُ تحكّمٍ في متصفّح. ومعه تحليلُ ضبط النمط وأصولُه المسموحة.
 * الحالة: منفّذ فعلياً — المرحلة ١٠.
 * ينتمي إلى: packages/maps/core
 * يُتوقع أن يستخدمه لاحقاً: packages/maps/providers/maplibre،
 *   apps/admin-dashboard/src/map.ts، والمراحل ١١ و١٢ و١٣
 * ملاحظات مستقبلية: عند إضافة مزوّد عرضٍ ثانٍ (Google) يُضاف اسمُه إلى
 *   `MAP_PROVIDER_NAMES` ويُكتب مُحلِّلُ نمطٍ ثانٍ في `providers/`؛ ولا يُلمس هذا الملف.
 *
 * ## لماذا حُذفت `MapRenderer` و`MapView` و`MapViewConfig` و`MapProviderError`
 *
 * كانت هنا أربعة تجريداتٍ لواجهةٍ تعمل **في المتصفّح**: `createView(config)` تأخذ
 * `container: string` (مُعرِّف عنصر DOM)، و`MapView` تُعلن `addPoint`/`updatePoint`/
 * `fitBounds` — أي كائنٌ حيٌّ يُستدعى بعد التصيير.
 *
 * وثلاثةُ وقائع تجعل تلك التجريدات غيرَ قابلةٍ للتنفيذ في هذا المستودع، لا
 * «غيرَ منفَّذةٍ بعد»:
 *
 * ١. **صفر تنفيذٍ وصفر مستهلك** منذ المرحلة ١ — أُثبت بـ`grep` على الأسماء الأربعة
 *    في كل `*.ts`: لا نتيجة خارج ملفّ التعريف وملفّ التصدير.
 * ٢. **ADR 0007 يمنع الحزمة والمُجمِّع**: اللوحة صفحاتٌ تُبنى في الخادم بلا حالةٍ
 *    في المتصفّح. فلا يوجد مكانٌ تُبنى فيه فئةٌ تُنفِّذ `MapRenderer`: ما سيوجد
 *    فعلاً هو نصُّ جافاسكربت مُصيَّرٌ في الصفحة يستدعي `maplibregl` مباشرة.
 * ٣. **الحدُّ في المكان الخطأ**: تجريدُ «كيف يُحدَّث دبّوسٌ في DOM» لا يحمي أحداً،
 *    لأن من يبدّل المزوّد يبدّل نصَّ الجافاسكربت كلَّه. الحدُّ الذي **ينفع** هو
 *    ما يعبر من الخادم إلى الصفحة: النمطُ، والأصولُ المسموحة، والنقاط. وهو ما
 *    صار هذا الملفّ يُعلنه.
 *
 * وترْكُها كان يعني أن يبنيَ عليها من يأتي في المرحلة ١٣ فئةً وسيطةً لا وظيفة لها
 * إلا إرضاء واجهةٍ لا مزوّدَ لها — وهي نفسُ علّة `NearbyDriver` المحذوفة في
 * المرحلة ٨: نوعٌ يَعِد بما لا يملكه أحد.
 *
 * أمّا `MapProviderError` فحُذفت لأنها كانت خطأ **تشغيلٍ** لمزوّدٍ حيّ، والخطأ
 * الحقيقي الوحيد في هذه الطبقة خطأُ **ضبط** يُكتشف عند الإقلاع: `MapConfigError`.
 */

import type { MapProviderName } from "../../shared/config/index.ts";
import type { LatLng, MapPoint, Polyline } from "./types.ts";

export type { MapProviderName };

/**
 * ضبط النمط كما يأتي من البيئة — مُحلَّلٌ لا خام: من يبنيه هو `shared/config`
 * وحده، فلا تُقرأ `process.env` في هذه الطبقة إطلاقاً.
 */
export interface MapStyleInput {
  readonly provider: MapProviderName;
  /** رابط ملف النمط (style.json) — `null` يعني غيرَ مُهيَّأ. */
  readonly styleUrl: string | null;
  /**
   * مفتاح خدمة البلاطات. **الاسم يقول «عام» لأنه عامٌّ فعلاً**: المتصفّح هو من
   * يطلب البلاطات، فالمفتاح يظهر في كل طلبٍ وفي أدوات المطوّر. من ظنّه سرّاً
   * سيضع فيه مفتاحاً بلا حدّ نطاقٍ ولا سقفِ استخدام، فيُسرَق ويُستهلك على حسابه.
   * الحماية الصحيحة عند المزوّد: تقييدُ النطاق (HTTP referrer) وسقفُ الطلبات.
   */
  readonly publicApiKey: string | null;
}

/** خطأ ضبط الخريطة — يُكتشف عند الإقلاع لا عند فتح الصفحة. */
export class MapConfigError {
  readonly code = "MAP_CONFIG_INVALID" as const;
  constructor(
    readonly key: string,
    readonly detail: string,
  ) {}
}

/**
 * نمطٌ مُحلَّلٌ جاهزٌ للتصيير.
 *
 * `configured: false` ليس خطأً بل حالةٌ صالحة: منصّةٌ تعمل بلا خريطة. والتمييزُ
 * اتحادٌ مُميَّز لا حقلاً اختيارياً، فلا يستطيع مُصيِّرٌ أن يقرأ `styleUrl` بلا
 * أن يفحص أوّلاً — المُصرِّف يمنعه. (نفسُ مِنهاج `DistanceMatrixElement` في
 * ADR-0018، ولنفس السبب: حقلٌ اختياريٌّ يدعو إلى `?? ""`.)
 */
export type ResolvedMapStyle =
  | {
      readonly configured: false;
      /** سببٌ يُعرض للمشغّل في الصفحة، لا مربّعٌ فارغ يُظنّ عطلاً. */
      readonly reason: string;
    }
  | {
      readonly configured: true;
      readonly provider: Exclude<MapProviderName, "none">;
      /** الرابط النهائي بمفتاحه إن لزم — يُوضع في الصفحة كما هو. */
      readonly styleUrl: string;
      /**
       * الأصولُ التي يجب أن تسمح بها سياسةُ أمن المحتوى.
       *
       * تُشتقّ من الرابط المضبوط ولا تُكتب نصّاً في مكانٍ آخر: قائمةٌ ثابتةٌ
       * لأصولٍ «معروفة» تصير مصدرَ حقيقةٍ ثانياً يتباعد عمّا ضبطه المشغّل فعلاً،
       * فينكسر الأمرُ إمّا أمناً (نسمح لمن لا نستعمله) أو وظيفةً (نمنع من نستعمله).
       */
      readonly origins: readonly string[];
    };

/**
 * نموذجُ عرض الخريطة: ما يُسلَّم من الخادم إلى الصفحة في تصييرةٍ واحدة.
 * لا دوالّ فيه — بيانات محضة قابلة للتحويل إلى JSON، وهو الحدّ الحقيقي بين
 * الطبقتين.
 */
export interface MapViewModel {
  readonly center: LatLng;
  readonly zoom: number;
  readonly points: readonly MapPoint[];
  readonly polylines: readonly RenderedPolyline[];
  /** يلائم الإطارُ النقاطَ كلَّها عند التصيير بدل الاعتماد على مركزٍ ثابت. */
  readonly fitToPoints?: boolean;
}

export interface RenderedPolyline {
  readonly line: Polyline;
  readonly options?: PolylineOptions;
}

export interface PolylineOptions {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
  readonly dashed?: boolean;
}
