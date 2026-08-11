/**
 * الغرض: دفع موقع السائق إلى عميل رحلته وحده — طرفُ المسار عند العميل.
 * الحالة: منفّذ فعلياً — المرحلة ٦. موصول في apps/gateway/src/container.ts.
 * ينتمي إلى: application/tracking
 * يُتوقع أن يستخدمه لاحقاً: المرحلة ١١ (تتبّع العميل) بديلاً/مكمّلاً بخريطة ويب
 *
 * ## أين يقع التصريح هنا بالضبط
 *
 * لا يوجد في هذا الملف سطرٌ يقرأ «العميل الذي يريد المتابعة». المُرحِّل لا
 * يستقبل طلباً من أحد: يرى حدثاً على رحلةٍ، ويسأل القاعدة **من عميل هذه الرحلة**،
 * ويُرسل إليه.
 *
 * وهذا أقوى من فحص صلاحية: الفحص يفترض طالباً يزعم هويّةً فيُقارن زعمه ببرهان،
 * وهنا لا زعم أصلاً — الوجهة مُشتَقّة من مصدر الحقيقة (`orders.rider_id`). فلا
 * مدخل لعميلٍ يطلب رحلةً ليست له، لأنه لا يطلب.
 *
 * ولذلك اشتراك المُرحِّل على الناقل بنطاق `all_cities`: هو ليس مستخدماً له نطاق
 * رؤية، بل جزءٌ من النقل نفسه. والحصر يجري بعد الاستقبال بالاشتقاق من القاعدة،
 * لا قبله بمُرشِّح نطاق. ولو حُصر بمدينة لكان الحدّ خطأً صريحاً: عميلٌ في مدينةٍ
 * لا يُشترك فيها المُرحِّل يفقد تتبّعه بلا سبب.
 */

import { haversineKm } from "../../domain/geo/index.ts";
import type { TrackingEvent } from "../../tracking/index.ts";

export interface LivePosition {
  readonly lat: number;
  readonly lng: number;
}

/**
 * منفذ قناة الموقع الحيّ — يُعرَّف هنا لا في infrastructure: التطبيق لا يستورد من
 * البنية التحتية (وإلا انقلب اتجاه التبعية، وصار اختبار المُرحِّل يستدعي تلغرام).
 * تنفيذه في `infrastructure/notification/telegram-live-location.ts`.
 *
 * **لا يرمي**: يعيد `null`/`false`. أخطاء المنصّة هنا متوقّعة لا استثنائية —
 * رسالةٌ حُذفت، بوتٌ كُتم، مدّةٌ انتهت، تعديلٌ بلا تغيير.
 */
export interface LiveLocationChannel {
  /** يبدأ بثّاً حيّاً ويعيد معرّف الرسالة — المقبض الوحيد للتعديل والإيقاف. */
  start(chatId: string, position: LivePosition, livePeriodSeconds: number): Promise<string | null>;
  update(chatId: string, messageId: string, position: LivePosition): Promise<boolean>;
  /** يُوقف البثّ. الرسالة تبقى في المحادثة ساكنةً على آخر موضع. */
  stop(chatId: string, messageId: string): Promise<boolean>;
}

/** الحدّ الأدنى بين تعديلين. */
export const DEFAULT_RELAY_MIN_INTERVAL_MS = 5_000;
/** الحدّ الأدنى للحركة (متر) لتعديلٍ قبل انتهاء المدّة. */
export const DEFAULT_RELAY_MIN_MOVE_METERS = 15;

export interface CustomerChannelResolver {
  resolve(tripId: string): Promise<{
    readonly riderTelegramId: string;
    readonly driverId: string;
  } | null>;
}

export interface CustomerLiveRelayDeps {
  readonly channel: LiveLocationChannel;
  readonly customers: CustomerChannelResolver;
  readonly clock: { now(): Date };
  readonly livePeriodSeconds: number;
  readonly minIntervalMs?: number;
  readonly minMoveMeters?: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface CustomerLiveRelay {
  /** يُستدعى من الناقل لكل حدثٍ مصرَّح به. لا يرمي. */
  handle(event: TrackingEvent): Promise<void>;
  /** عدد الرحلات التي لها بثٌّ مفتوح — للاختبار والقياس. */
  readonly openBroadcasts: number;
}

interface Broadcast {
  readonly chatId: string;
  readonly messageId: string;
  sentAtMs: number;
  lat: number;
  lng: number;
}

export function createCustomerLiveRelay(deps: CustomerLiveRelayDeps): CustomerLiveRelay {
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_RELAY_MIN_INTERVAL_MS;
  const minMoveMeters = deps.minMoveMeters ?? DEFAULT_RELAY_MIN_MOVE_METERS;
  const log = deps.log ?? ((): void => undefined);

  /**
   * خريطة البثّ في الذاكرة ومعرّف الرسالة فيها. وحدّها معلن: إعادة تشغيل النسخة
   * تُفقد المعرّفات، فأوّل إصلاحةٍ بعدها تُنشئ **رسالة بثٍّ جديدة** بدلاً من تعديل
   * القديمة — فيرى العميل خريطةً ثانية في محادثته، والأولى تسكن حتى تنتهي مدّتها.
   *
   * وقُبِل هذا الحدّ بوعي: تخزين المعرّفات في القاعدة يعني جدولاً وكتابةً في مسارٍ
   * تُرسَل فيه إصلاحةٌ كل ثوانٍ، مقابل عيبٍ تجميليّ يظهر عند نشرٍ جديد فقط
   * (والنشر يوقف الجلسات أصلاً). البديل الصحيح — إن أزعج فعلاً — أن يُقرأ معرّف
   * الرسالة من `orders` لا من جدولٍ جديد. وهو قرار المرحلة ١١ لا هذه.
   */
  const broadcasts = new Map<string, Broadcast>();

  const closeTrip = async (tripId: string): Promise<void> => {
    const open = broadcasts.get(tripId);
    if (open === undefined) return;
    broadcasts.delete(tripId);
    await deps.channel.stop(open.chatId, open.messageId);
  };

  return {
    get openBroadcasts() {
      return broadcasts.size;
    },

    handle: async (event) => {
      try {
        const tripId = event.tripId;
        if (tripId === null) return;

        if (event.type === "session_ended") {
          await closeTrip(tripId);
          return;
        }

        if (event.type !== "location_updated" || event.position === null) return;

        const nowMs = deps.clock.now().getTime();
        const open = broadcasts.get(tripId);

        if (open === undefined) {
          const target = await deps.customers.resolve(tripId);
          if (target === null) return;
          /**
           * التحقّق من أن سائق الحدث هو سائق الرحلة المُخزَّن — رغم أن الناقل
           * فحص التصريح. طبقتان بقصد: الأولى تمنع الوصول غير المصرَّح به، وهذه
           * تمنع **الخطأ في الوجهة** (حدثٌ لسائقٍ أُعيد إسناده بين لحظة النشر
           * ولحظة الإرسال). والثانية ليست تكراراً للأولى بل تُغلق سباقاً.
           */
          if (target.driverId !== event.driverId) return;

          const messageId = await deps.channel.start(
            target.riderTelegramId,
            { lat: event.position.lat, lng: event.position.lng },
            deps.livePeriodSeconds,
          );
          if (messageId === null) return;
          broadcasts.set(tripId, {
            chatId: target.riderTelegramId,
            messageId,
            sentAtMs: nowMs,
            lat: event.position.lat,
            lng: event.position.lng,
          });
          return;
        }

        /**
         * الخنق بشرطين معاً — زمنٍ **و**مسافة:
         *  - الزمن وحده يُرسل تعديلاً لسائقٍ واقفٍ في إشارة، فيُستهلك معدّل تلغرام
         *    على تعديلٍ بنفس الإحداثيات (وترفضه الواجهة أصلاً بـ`not modified`).
         *  - المسافة وحدها تُرسل تعديلاً لكل قفزةٍ من ضجيج GPS في وقوفٍ طويل.
         * والاجتماع بينهما يعني: تعديلٌ حين تحرّك فعلاً، وبفاصلٍ محترم.
         */
        if (nowMs - open.sentAtMs < minIntervalMs) return;
        const movedMeters =
          haversineKm(
            { latitude: open.lat, longitude: open.lng },
            { latitude: event.position.lat, longitude: event.position.lng },
          ) * 1000;
        if (movedMeters < minMoveMeters) return;

        const updated = await deps.channel.update(open.chatId, open.messageId, {
          lat: event.position.lat,
          lng: event.position.lng,
        });
        if (!updated) {
          /**
           * فشل التعديل ⇒ نسيان الرسالة لا الإصرار عليها: الرسالة حُذفت أو انتهت
           * مدّتها. والنسيان يجعل الإصلاحة التالية تفتح بثّاً جديداً — وهو أفضل
           * من عميلٍ تتوقّف خريطته صامتةً إلى نهاية الرحلة.
           */
          broadcasts.delete(tripId);
          log("tracking.live_location_edit_failed", { tripId });
          return;
        }
        open.sentAtMs = nowMs;
        open.lat = event.position.lat;
        open.lng = event.position.lng;
      } catch (error) {
        log("tracking.customer_relay_failed", { detail: String(error) });
      }
    },
  };
}
