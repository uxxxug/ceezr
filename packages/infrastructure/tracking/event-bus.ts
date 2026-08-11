/**
 * الغرض: ناقل أحداث التتبّع داخل العملية — والتصريح جزءٌ من الاشتراك لا مُرشِّح بعده.
 * الحالة: منفّذ فعلياً — المرحلة ٦. موصول في apps/gateway/src/container.ts.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: مسار SSE للعمليات، ومُرحِّل الموقع الحيّ إلى العميل
 *
 * ## لماذا داخل العملية — وما حدّ ذلك بالضبط
 *
 * فُحِص الموجود في المستودع قبل بناء أي شيء:
 *
 * | المُرشَّح | الحكم المقيس |
 * |---|---|
 * | Supabase Realtime | القاعدة تُستخدم باتصال PostgreSQL مباشر (ADR-0006)، وسطح PostgREST مُغلق (ADR-0014). وتشغيله يعني إعادة فتح سطحٍ أُغلق بقرار أمني. |
 * | Redis Pub/Sub | Upstash عبر REST فقط (`redis/upstash.ts`: أمرٌ واحد لكل نداء HTTP). و`SUBSCRIBE` اتصالٌ دائم لا يُمثَّل في REST — **غير ممكن تقنياً** لا مؤجَّل. |
 * | WebSocket | لا وجود له في المستودع، ولا عميل ويب للسائق ولا للعميل: المنتج بوتان على تلغرام ولوحةٌ تُرسَم في الخادم (ADR-0007). فإدخاله يعني نقلاً بلا مستهلك. |
 * | SSE على Hono | موجود في التبعيات أصلاً، ونصف مستهلكه مكتوب: `layout.ts` يستطلع `/admin/api/*` كل ثوانٍ، وترويسة `admin-api.ts` تنصّ على أن الاستطلاع يُستبدل بـSSE على نفس نماذج القراءة. |
 *
 * فالنقل المختار: **SSE للعمليات، وتلغرام نفسه للعميل**، وبينهما ناقلُ أحداثٍ
 * واحد في العملية. راجع ADR-0016.
 *
 * ### الحدّ المُعلَن بلا تجميل
 *
 * الناقل في العملية يرى أحداث نسخته وحدها. والبوابة اليوم نسخةٌ واحدة
 * (`render.yaml`: `numInstances: 1`)، فالحدّ لا أثر له الآن. وحين تُرفع النسخ
 * يصير مشغّلٌ متّصلٌ بالنسخة أ لا يرى فوراً سائقاً موقعُه وصل النسخةَ ب.
 *
 * وهذا **لا يفقد بياناً**: الموقع القانوني في القاعدة، ومسار العمليات يبدأ
 * بلقطةٍ منها ويُعيد قراءتها دورياً. فالذي يتأخّر هو الدفع لا الحقيقة. وشرط
 * رفع النسخ مكتوبٌ في نفس الملف الذي يرفعها (`render.yaml`).
 */

import {
  canCustomerWatch,
  canDriverWatch,
  canOperationsWatch,
  type OperationsWatchScope,
  type TripAssignmentProof,
} from "../../domain/tracking/visibility.ts";
import type { TrackingEvent, TrackingEventPublisher } from "../../tracking/index.ts";

/**
 * الاشتراك: من يستقبل، وبأيّ حقّ.
 *
 * `customer` لا يُبنى إلا من برهانٍ قُرئ من القاعدة — ولذلك يحمل `provenBy`:
 * حقلٌ إلزامي لا يُمكن ملؤه إلا بصفٍّ حقيقي من `orders`. وهذا يجعل «اشتراكاً
 * بلا تحقّق» **خطأ ترجمة** لا سهواً يُكتشف في الإنتاج.
 */
export type TrackingSubscription =
  | { readonly kind: "operations"; readonly scope: OperationsWatchScope }
  | {
      readonly kind: "customer";
      readonly riderId: string;
      readonly tripId: string;
      readonly driverId: string;
      readonly provenBy: TripAssignmentProof;
    }
  | { readonly kind: "driver"; readonly driverId: string };

/** مستقبل الأحداث. يرمي ⇒ يُفصَل: مجرى SSE ميت لا يُحاوَل عليه إلى الأبد. */
export interface TrackingEventSink {
  deliver(event: TrackingEvent): void | Promise<void>;
}

export interface TrackingEventBus extends TrackingEventPublisher {
  /** يعيد دالة الفصل. الفصل متسامح مع التكرار. */
  subscribe(subscription: TrackingSubscription, sink: TrackingEventSink): () => void;
  readonly subscriberCount: number;
}

/**
 * هل يُسلَّم هذا الحدث لهذا المشترك؟
 *
 * التصريح يُعاد تطبيقه على كل حدث ولا يُكتفى بفحص لحظة الاشتراك. والسبب واقعة
 * لا احتمال: العميل يشترك ورحلته جارية، ثم تنتهي رحلته ويأخذ السائق رحلةً
 * أخرى — ونفس المجرى المفتوح يصير قناةً لتتبّع سائقٍ في رحلة شخصٍ آخر. فمطابقة
 * `tripId` في كل حدث هي ما يُغلق هذا الباب، لا فحصٌ جرى مرّةً في البداية.
 */
function shouldDeliver(subscription: TrackingSubscription, event: TrackingEvent): boolean {
  if (subscription.kind === "driver") {
    return canDriverWatch(subscription.driverId, event.driverId).allowed;
  }

  if (subscription.kind === "customer") {
    // الحدث يجب أن يكون لسائق هذه الرحلة **وفي هذه الرحلة**. حدثٌ بلا رحلة
    // (السائق متاح بلا إسناد) لا يخصّ عميلاً إطلاقاً.
    if (event.tripId !== subscription.tripId) return false;
    return canCustomerWatch(subscription.riderId, event.driverId, subscription.provenBy).allowed;
  }

  /**
   * حدثٌ بلا مدينة يُسلَّم لكل مشغّل مهما كان نطاقه. وهو حدث دورة حياة
   * (`session_ended`) مفتاحه الرحلة لا السائق، فلا تُقرأ فيه المدينة.
   *
   * وإسقاطه بحجّة «لا تُطابق المدينة» كان سيُنتج الخطأ الأسوأ في لوحة عمليات:
   * صفٌّ لسائقٍ أنهى رحلته يبقى على الخريطة إلى الأبد — والمشغّل يبني قراره على
   * وجودٍ لا أصل له.
   */
  if (event.cityId === undefined) return true;
  return canOperationsWatch(subscription.scope, {
    driverId: event.driverId,
    cityId: event.cityId,
  }).allowed;
}

export function createTrackingEventBus(
  log: (message: string, meta: Record<string, unknown>) => void = () => undefined,
): TrackingEventBus {
  interface Entry {
    readonly subscription: TrackingSubscription;
    readonly sink: TrackingEventSink;
  }
  const entries = new Map<symbol, Entry>();

  return {
    get subscriberCount() {
      return entries.size;
    },

    subscribe: (subscription, sink) => {
      const key = Symbol("tracking-subscriber");
      entries.set(key, { subscription, sink });
      return () => {
        entries.delete(key);
      };
    },

    publish: async (event) => {
      /**
       * نسخة من المفاتيح قبل التسليم: مُستقبِلٌ يفصل نفسه أثناء التسليم (مجرى
       * أُغلق) يُعدّل الخريطة تحت الحلقة. والتعديل أثناء التكرار في JS لا يرمي
       * بل **يُسقط مشتركاً بلا إشعار** — وهو عطلٌ يظهر بعد أسبوعٍ بلا سبب مفهوم.
       */
      for (const key of [...entries.keys()]) {
        const entry = entries.get(key);
        if (entry === undefined) continue;
        if (!shouldDeliver(entry.subscription, event)) continue;
        try {
          await entry.sink.deliver(event);
        } catch (error) {
          // الفصل عند العطل لا إعادة المحاولة: مجرى SSE مقطوع لا يُشفى بمحاولة
          // ثانية، وإبقاؤه يعني عطلاً في كل حدثٍ إلى أن تُعاد النسخة.
          entries.delete(key);
          log("tracking.sink_failed_detached", {
            kind: entry.subscription.kind,
            detail: String(error),
          });
        }
      }

      /**
       * نهاية الجلسة تُغلق اشتراك عميلها بعد تسليمه. لو بقي مفتوحاً لكان أوّل
       * سطرٍ في `shouldDeliver` يحميه (مطابقة الرحلة)، لكن الاعتماد على حماية
       * تُفحَص لاحقاً أضعف من إزالة الاشتراك أصلاً — والاثنان معاً هو الصحيح.
       */
      if (event.type !== "session_ended") return;
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.subscription.kind !== "customer") continue;
        if (entry.subscription.tripId !== event.tripId) continue;
        entries.delete(key);
      }
    },
  };
}
