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
 *
 * ## `SCL-005` — مخزنُ البثّ المشترك
 *
 * كانَت خريطةُ `tripId → messageId` في الذاكرةِ وحدَها (`Map` داخلَ العملية).
 * فأُستُبدِلَت بمخزنٍ مشتركٍ (`LiveBroadcastStore`) يُحقَنُ: تنفيذُ Redis في
 * الإنتاجِ (حالةٌ تبقى بعدَ إعادةِ التشغيلِ ومشاركةٌ بينَ النسخ)، وتنفيذُ الذاكرة
 * افتراضيّاً للاختبار. وبدءُ البثّ صار يُدّعى ذرّيّاً (`claimStart` بـ`SET NX`)
 * حتى لا تفتحَ نسختانِ رسالتَي بثٍّ للرحلةِ الواحدة. والكتابةُ عندَ البدءِ
 * والإغلاقِ لا عندَ كلِّ إصلاحةٍ، فيتفادّى ثمنَ الكتابةِ لكلِّ تحديث.
 */

import { haversineKm } from "../../domain/geo/index.ts";
import { isTripLive, type WatchedTripStatus } from "../../domain/tracking/visibility.ts";
import type { TrackingEvent } from "../../tracking/index.ts";
import { createInMemoryLiveBroadcastStore } from "./in-memory-live-broadcast-store.ts";
import type { LiveBroadcastStore } from "./live-broadcast-store.ts";

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
/** عمرُ ادّعاءِ بدءِ البثّ — يكفي لنداءِ `channel.start` (تلغرام ≤ ثانيتَين). */
export const DEFAULT_CLAIM_TTL_MS = 10_000;
/** هامشُ TTL فوقَ عمرِ البثّ حتى لا ينتهيَ قبلَ تعديلِه. */
export const BROADCAST_TTL_MARGIN_MS = 60_000;

export interface CustomerChannelResolver {
  resolve(tripId: string): Promise<{
    readonly riderTelegramId: string;
    readonly driverId: string;
    /**
     * حالة الرحلة لحظةَ الاشتقاق — أُضيفت في المرحلة ١١.
     *
     * ولماذا تعود الحالة ولا يُرشَّح بها في `where`؟ لأن «أيُ حالاتٍ تُتابع» حكمٌ
     * للمجال قرّره `isTripLive` مرّةً واحدة؛ ومُرشَّحٌ في SQL يكون تجسيداً
     * ثانياً لنفس القاعدة ينحرف عنها أوّل مرّةٍ تُضاف حالةٌ للطلبات. وفرقٌ عمليٌّ
     * أيضاً: المُرشَّح يردُّ `null` فلا يميّز «رحلةٌ انتهت فأغلقِ بثّها» من «رحلةٍ
     * لا وجود لها»، والأوّل يوجب إيقافاً.
     */
    readonly status: WatchedTripStatus;
  } | null>;
}

export interface CustomerLiveRelayDeps {
  readonly channel: LiveLocationChannel;
  readonly customers: CustomerChannelResolver;
  readonly clock: { now(): Date };
  readonly livePeriodSeconds: number;
  /** مخزنُ البثّ المشترك. افتراضيّاً الذاكرة — الإنتاجُ يوصِّلُ Redis (`SCL-005`). */
  readonly store?: LiveBroadcastStore;
  /** عمرُ ادّعاءِ بدءِ البثّ بالميلي ثانية. */
  readonly claimTtlMs?: number;
  /**
   * مُولِّدُ رمزِ الادّعاء. يُحقَنُ حتى لا يستوردَ طبقةُ التطبيقِ `node:crypto`
   * مباشرةً. الإنتاجُ يوصِّلُ `() => crypto.randomUUID()`.
   */
  readonly newClaimToken?: () => string;
  readonly minIntervalMs?: number;
  readonly minMoveMeters?: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface CustomerLiveRelay {
  /** يُستدعى من الناقل لكل حدثٍ مصرَّح به. لا يرمي. */
  handle(event: TrackingEvent): Promise<void>;
  /** عددُ البثّاتِ المفتوحةِ التي تُديرُها هذه النسخة — للاختبار والقياس. */
  readonly openBroadcasts: number;
}

export function createCustomerLiveRelay(deps: CustomerLiveRelayDeps): CustomerLiveRelay {
  const minIntervalMs = deps.minIntervalMs ?? DEFAULT_RELAY_MIN_INTERVAL_MS;
  const minMoveMeters = deps.minMoveMeters ?? DEFAULT_RELAY_MIN_MOVE_METERS;
  const claimTtlMs = deps.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS;
  const log = deps.log ?? ((): void => undefined);
  const store = deps.store ?? createInMemoryLiveBroadcastStore();
  const newClaimToken =
    deps.newClaimToken ??
    ((): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const liveTtlMs = deps.livePeriodSeconds * 1000 + BROADCAST_TTL_MARGIN_MS;

  /**
   * البثّاتُ التي تُديرُها هذه النسخةُ من بثٍّ مفتوحٍ بدأَته. هي عدّادُ قياسٍ
   * محليٌّ، لا مصدرُ الحقيقةِ (ذاك المخزنُ المشترك): نسخةٌ تُغلقُ بثّاً بدأتْه
   * نسخةٌ أخرى لا تُنقِصُ عدّادَها — وهذا مقصودٌ، فالعدّادُ يصفُ عملَ هذه النسخةِ
   * وحدَها.
   */
  const localOpen = new Set<string>();

  const closeTrip = async (tripId: string): Promise<void> => {
    const open = await store.get(tripId);
    if (open === null) return;
    await store.delete(tripId);
    localOpen.delete(tripId);
    await deps.channel.stop(open.chatId, open.messageId);
  };

  return {
    get openBroadcasts() {
      return localOpen.size;
    },

    handle: async (event) => {
      try {
        const tripId = event.tripId;
        if (tripId === null) return;

        if (event.type === "session_ended") {
          /**
           * `BUG-009` — نهايةُ جلسةٍ أخرى لا تُغلق بثَّ هذه.
           *
           * رحلةٌ طويلةٌ تعبُر جلستَينِ (سقفُ الاثنتَي عشرةَ ساعةً يُغلق الأولى
           * ويفتح الثانيةَ): لو وصل `session_ended` للأولى بعدَ أن فتحَ حدثٌ من
           * الثانيةِ بثَّه — والترتيبُ بينَ الجلستَينِ غيرُ مضمونٍ لأنَّ الرقمَ
           * جلسيٌّ لا عالميٌّ (§٣-أ/٩) — لأطفأت خريطةً مشروعةً للعميلِ حتّى نهايةِ
           * الرحلةِ.
           *
           * وإن لم يكن بثٌّ مفتوحٌ فلا شيءَ يُغلق — و`closeTrip` تتحمّل ذلك أصلاً.
           */
          const open = await store.get(tripId);
          if (open !== null && open.sessionId !== event.sessionId) {
            log("tracking.live_location_end_other_session", { tripId });
            return;
          }
          await closeTrip(tripId);
          return;
        }

        if (event.type !== "location_updated" || event.position === null) return;

        const nowMs = deps.clock.now().getTime();
        const open = await store.get(tripId);

        /**
         * ## `BUG-009` — بوّابةُ الترتيبِ عندَ المستهلكِ
         *
         * ولماذا تُلزَم وقد صار الناشرُ لا ينشر إلّا مقبولاً؟ لأنَّ القبولَ
         * لا يضمن ترتيبَ الوصولِ: طلبا ويبهوكٍ متزامنانِ لنفسِ السائقِ يأخذانِ
         * الرقمَينِ ٥ و٦ من القاعدةِ، ولا شيءَ يمنع أن يسبقَ نشرُ ٦ نشرَ ٥ — فيرتدُّ
         * الدبّوسُ إلى موضعٍ أقدمَ وكلا الحدثَينِ مقبولٌ. فالقاعدةُ تُصدِر ترتيباً
         * صحيحاً، والمستهلكُ وحدَه يملك أن يُلزِمَ عرضَه به.
         *
         * والحكمُ مقرونٌ بالجلسةِ دائماً: `sessionId` مختلفٌ ⇒ قناةٌ جديدةٌ، فلا
         * يُقارن رقمٌ برقمٍ من غيرِ قناتِه (§٤-ب/٢).
         *
         * ### ولماذا لا «فجوةٌ ⇒ لقطةٌ» هنا
         *
         * `ADR 0053` §٣-ب يوجب عندَ الفجوةِ لقطةً موثوقةً — ومحلُّ ذلك مستهلكٌ
         * يُراكم حالةً من الأحداثِ. وهذا المُرحِّلُ لا يُراكم شيئاً: عرضُه نقطةٌ واحدةٌ
         * تُستبدَل بأحدثِ ما وصل، والحدثُ يحمل الحالةَ كاملةً (إحداثيّةً). ففجوةٌ تعني
         * «فاتتني مواضعٌ وسطى» ولا أحدَ يرسم مساراً — والتصحيحُ الصحيحُ لعرضِ
         * «أحدثِ قيمةٍ» أن يُطبّق أحدثُ قيمةٍ، لا أن يُستجلَب `HTTP` ما هو في اليدِ.
         * و§٨ من أمرِ التنفيذِ يأمر بتوثيقِ مثلِ هذا لا بإضافةِ تعقيدٍ بلا حاجةٍ.
         * ولا `replay` ولا `event store` ولا تخزينَ معرّفاتٍ في أيِّ حالٍ.
         */
        if (
          open !== null &&
          open.sessionId === event.sessionId &&
          event.sequence <= open.lastAppliedSeq
        ) {
          log("tracking.live_location_stale_sequence", { tripId });
          return;
        }

        if (open === null) {
          /**
           * ## `SCL-005` — ادّعاءُ بدءِ البثّ ذرّيّاً
           *
           * نسختانِ تريانِ الحدثَ الأولَ لرحلةٍ معاً (عبرَ المجرى المشتركِ
           * `SCL-004`) لو لم تُسلسَل لفتحتا رسالتَي بثٍّ في محادثةِ العميل.
           * والادّعاءُ بـ`SET NX` يمنحُ نسخةً واحدةً حقَّ البدء؛ والأخرى تتخطّى،
           * فيلتقطُ الحدثُ التالي الحالةَ من المخزنِ فيُعدِّلُها لا يفتحُها.
           *
           * والادّعاءُ محدودُ العمرِ: إن ماتتِ النسخةُ بينَ الادّعاءِ و`channel.start`
           * انتهى الادّعاءُ فتُعيدُ نسخةٌ أخرى المحاولةَ. والرمزُ (`token`) يُحرَّرُ
           * بأمانٍ (قارنْ ثم احذفْ) حتى لا يُطلِقَ نسخةٌ ادّعاءَ أخرى.
           */
          const token = newClaimToken();
          const claimed = await store.claimStart(tripId, token, claimTtlMs);
          if (!claimed) {
            log("tracking.live_location_start_claimed_elsewhere", { tripId });
            return;
          }
          try {
            const target = await deps.customers.resolve(tripId);
            if (target === null) return;
            /**
             * التحقّق من أن سائق الحدث هو سائق الرحلة المُخزَّن — رغم أن الناقل
             * فحص التصريح. طبقتان بقصد: الأولى تمنع الوصول غير المصرَّح به، وهذه
             * تمنع **الخطأ في الوجهة** (حدثٌ لسائقٍ أُعيد إسناده بين لحظة النشر
             * ولحظة الإرسال). والثانية ليست تكراراً للأولى بل تُغلق سباقاً.
             */
            if (target.driverId !== event.driverId) return;
            /**
             * المرحلة ١١ — أقوى قاعدةٍ في مجال التتبّع تُطبَّق أخيراً على مسار العميل
             * الحقيقي: لا بثَّ لرحلةٍ غير حيّة.
             *
             * وكانت غائبةً لا لأنها غير مكتوبة، بل لأن مَن يكتبها (`canCustomerWatch`)
             * لم يكن على هذا المسار: المُرحِّل يشترك بنطاق `operations/all_cities`،
             * فيمرّ بـ`canOperationsWatch` الذي يسمح دائماً، ولا يلمس `isTripLive`
             * إطلاقاً. فكان حدثُ موقعٍ لرحلةٍ مكتملةٍ أو مُلغاة **يفتح بثّاً**.
             *
             * وهذا ليس تكراراً لإغلاق الإلغاء في `rider-dialog`: ذاك يُغلق بثّاً
             * قائماً عند حدثٍ نعرف وقته، وهذا يمنع فتحَ بثٍّ لرحلةٍ ميتة أصلاً —
             * فيصحّح كل نهايةٍ لا تمرّ بنا (إلغاءُ مشرف، فشلٌ، تعديلٌ في القاعدة).
             */
            if (!isTripLive(target.status)) {
              log("tracking.live_location_skipped_not_live", { tripId, status: target.status });
              return;
            }

            const messageId = await deps.channel.start(
              target.riderTelegramId,
              { lat: event.position.lat, lng: event.position.lng },
              deps.livePeriodSeconds,
            );
            if (messageId === null) return;
            localOpen.add(tripId);
            await store.save(
              tripId,
              {
                chatId: target.riderTelegramId,
                messageId,
                sentAtMs: nowMs,
                lat: event.position.lat,
                lng: event.position.lng,
                sessionId: event.sessionId,
                lastAppliedSeq: event.sequence,
              },
              liveTtlMs,
            );
          } finally {
            await store.releaseClaim(tripId, token);
          }
          return;
        }

        // حدّ الزمن أوّلاً: أرخص فحصٍ في المسار، ويحمي كلّ ما بعده من التكرار.
        if (nowMs - open.sentAtMs < minIntervalMs) return;

        /**
         * المرحلة ١١ — إعادة اشتقاق الوجهة، **بعد حدّ الزمن وقبل حدّ الحركة**.
         * والترتيب هو جوهر البند لا تفصيلاً فيه:
         *
         *  - بلا هذه القراءة أصلاً يبقى نصفُ العيب قائماً: بثٌّ فُتح وهو حيٌّ يظلّ
         *    يُعدَّل إلى الأبد، لأن `resolve` لا تُنادى إلا حين `open === undefined`.
         *    فرحلةٌ انتهت بطريقٍ لا يمرّ بـ`session_ended` تبقى خريطتها تتحرّك.
         *
         *  - وبعد **حدّ الحركة** — وهو ما جرّبناه أوّلاً — يبقى نصفُ النصف: سائقٌ
         *    أُلغيت رحلته ثم أوقف سيّارته لا يتجاوز حدّ الحركة قطّ، فلا تُقرأ الحالة
         *    أبداً وتبقى خريطة العميل حيّةً إلى انتهاء مدّة تلغرام. وأسقط ذلك
         *    اختبارَ التكامل فعلاً، وهو ما نقل الفحص إلى هنا.
         *
         *  - وقبل **حدّ الزمن** يعني قراءةَ صفٍّ لكل إصلاحة (نحو واحدة في الثانية
         *    لكل سائقٍ متتبَّع) — كلفةٌ بلا مقابل، لأن الغلق المتأخّر ثوانٍ قليلة
         *    لا يضرّ أحداً.
         *
         * فالموضع الحالي يعني: قراءةٌ واحدة كل خمس ثوان لكل بثٍّ مفتوح على أكثر
         * تقدير، وغلقٌ مضمونٌ ولو لم يتحرّك السائق مترا واحداً.
         *
         * وفحصُ السائق يُعاد هنا كذلك: إعادةُ إسنادٍ أثناء بثٍّ مفتوح كانت تُرسل
         * موقعَ سائقٍ إلى عميلٍ لم يعد سائقَه.
         */
        const target = await deps.customers.resolve(tripId);
        if (target === null || !isTripLive(target.status) || target.driverId !== event.driverId) {
          log("tracking.live_location_closed_not_live", {
            tripId,
            status: target?.status ?? null,
          });
          await closeTrip(tripId);
          return;
        }

        /**
         * الخنق بشرطين معاً — زمنٍ **و**مسافة:
         *  - الزمن وحده يُرسل تعديلاً لسائقٍ واقفٍ في إشارة، فيُستهلك معدّل تلغرام
         *    على تعديلٍ بنفس الإحداثيات (وترفضه الواجهة أصلاً بـ`not modified`).
         *  - المسافة وحدها تُرسل تعديلاً لكل قفزةٍ من ضجيج GPS في وقوفٍ طويل.
         * والاجتماع بينهما يعني: تعديلٌ حين تحرّك فعلاً، وبفاصلٍ محترم.
         */
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
          await store.delete(tripId);
          localOpen.delete(tripId);
          log("tracking.live_location_edit_failed", { tripId });
          return;
        }
        await store.save(
          tripId,
          {
            ...open,
            sentAtMs: nowMs,
            lat: event.position.lat,
            lng: event.position.lng,
            sessionId: event.sessionId,
            lastAppliedSeq: event.sequence,
          },
          liveTtlMs,
        );
      } catch (error) {
        log("tracking.customer_relay_failed", { detail: String(error) });
      }
    },
  };
}
