/**
 * الغرض: المرحلة ٦ — إثبات نواة النقل اللحظي بلا قاعدة ولا شبكة.
 *
 *   ثلاث وحدات تُختبَر هنا لأن كلًّا منها قرارُ أمانٍ أو صحّةٍ قائم بذاته:
 *
 *   (١) **سياسة الرؤية** (`packages/domain/tracking/visibility.ts`): من يرى من.
 *       نقيّة، فتُختبَر مباشرةً بلا تركيب — وهذا هو ثمن نقلها إلى المجال.
 *   (٢) **الناقل** (`event-bus.ts`): التصريح مُطبَّق على **كل حدث** لا عند
 *       الاشتراك وحده. الاختبار الحاسم هنا هو تسريب ما بعد نهاية الرحلة.
 *   (٣) **مُرحِّل العميل** (`customer-live-relay.ts`): الخنق، وإسقاط الحدث الذي
 *       سائقه ليس سائق الرحلة، وإيقاف البثّ عند النهاية.
 *   (٤) **التركيب على الجلسة** (`live-tracking.ts`): الفتح، والانتهاء بالسقف
 *       الزمني ثم إعادة الفتح (وهو ما يُغني عن الماسح الدوري)، وأن عطل القاعدة
 *       لا يرمي في وجه المسار الحيّ.
 *
 * الحالة: اختبار وحدة فعلي — لا يتطلب قاعدة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { createCustomerLiveRelay } from "../../packages/application/tracking/customer-live-relay.ts";
import {
  createLiveTracking,
  type StoredFix,
} from "../../packages/application/tracking/live-tracking.ts";
import {
  canCustomerWatch,
  canDriverWatch,
  canOperationsWatch,
  isTripLive,
  type TripAssignmentProof,
  type WatchedTripStatus,
} from "../../packages/domain/tracking/visibility.ts";
import { createTrackingEventBus } from "../../packages/infrastructure/tracking/event-bus.ts";
import { createMemoryTrackingSessionStore } from "../../packages/tracking/session-store.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const RIDER = "rider-1";
const DRIVER = "driver-1";
const TRIP = "trip-1";
const CITY = "city-jed";

const proof = (over: Partial<TripAssignmentProof> = {}): TripAssignmentProof => ({
  tripId: TRIP,
  riderId: RIDER,
  driverId: DRIVER,
  status: "in_progress",
  cityId: CITY,
  ...over,
});

const fixAt = (recordedAtMs: number, over: Partial<StoredFix> = {}): StoredFix => ({
  driverId: DRIVER,
  cityId: CITY,
  latitude: 21.5471,
  longitude: 39.1751,
  recordedAtMs,
  accuracyMeters: 8,
  verdict: "ACCEPT",
  findings: [],
  ...over,
});

const SESSION = "11111111-1111-4111-8111-111111111111";

/**
 * `BUG-009` — `sessionId` و`sequence` إلزاميّان في العقدِ، فلكلِّ حدثٍ في هذه
 * الاختباراتِ قيمةٌ صريحةٌ. وهي أرقامٌ مصطنعةٌ **بقصدٍ** هنا: هذه المجموعةُ تختبر
 * الناقلَ والمُرحِّلَ لا مولِّدَ الرقمِ. ودليلُ المولِّدِ الحقيقيِّ في
 * `tests/integration/tracking-sequence.test.ts` على `PostgreSQL` حقيقيّ.
 */
/**
 * والرقمُ يتزايد تلقائيّاً في كلِّ نداءٍ: بوّابةُ الترتيبِ في المُرحِّلِ (`BUG-009`)
 * تُسقِط ما لا يزيد على آخرِ مطبَّقٍ، فحدثانِ متعاقبانِ في اختبارٍ يقصد بهما
 * «إصلاحةٌ ثمّ أحدثُ منها» يجب أن يختلفَ رقمُهما. ومن أراد رقماً بعينِه — دليلَ
 * تكرارٍ أو تراجعٍ — يُمرّره صريحاً في `over`.
 */
let nextProbeSequence = 1;

const positionEvent = (over: Partial<TrackingEvent> = {}): TrackingEvent => ({
  type: "location_updated",
  driverId: DRIVER,
  tripId: TRIP,
  sessionId: SESSION,
  sequence: ++nextProbeSequence,
  cityId: CITY,
  position: { lat: 21.5471, lng: 39.1751 },
  timestamp: new Date(0),
  ...over,
});

describe("سياسة رؤية التتبّع — المرحلة ٦", () => {
  it("عميل الرحلة يرى سائقها", () => {
    expect(canCustomerWatch(RIDER, DRIVER, proof()).allowed).toBe(true);
  });

  it("عميلٌ آخر لا يرى الرحلة ولو كانت جارية", () => {
    const decision = canCustomerWatch("rider-2", DRIVER, proof());
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("NOT_TRIP_OWNER");
  });

  it("عميل الرحلة لا يرى سائقاً غير المُسنَد إليها", () => {
    /**
     * هذا هو الفرق بين «العميل صاحب الرحلة» و«العميل يرى هذا السائق». معرّف
     * السائق في الحدث ادّعاءٌ يُطابَق بالبرهان؛ ومن اكتفى بالأول سلّم لعميلٍ
     * صادقٍ موقعَ سائقٍ لا علاقة له به.
     */
    const decision = canCustomerWatch(RIDER, "driver-9", proof());
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("DRIVER_MISMATCH");
  });

  it("رحلة منتهية لا تُشاهَد — الحقّ ينتهي بانتهائها", () => {
    for (const status of ["completed", "cancelled", "failed", "searching"] as const) {
      expect(isTripLive(status)).toBe(false);
      expect(canCustomerWatch(RIDER, DRIVER, proof({ status })).allowed).toBe(false);
    }
    expect(isTripLive("matched")).toBe(true);
    expect(isTripLive("in_progress")).toBe(true);
  });

  it("رحلة بلا سائق مُسنَد ليست قابلة للمشاهدة", () => {
    const decision = canCustomerWatch(RIDER, DRIVER, proof({ driverId: null }));
    expect(decision.allowed ? null : decision.reason).toBe("DRIVER_NOT_ASSIGNED");
  });

  it("رحلة غير موجودة تُرفض ولا تُعامل معاملة المسموح", () => {
    const decision = canCustomerWatch(RIDER, DRIVER, null);
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? null : decision.reason).toBe("TRIP_NOT_FOUND");
  });

  it("نطاق المشغّل بمدينة يحصر الرؤية بمدينته", () => {
    const subject = { driverId: DRIVER, cityId: CITY };
    expect(canOperationsWatch({ kind: "all_cities" }, subject).allowed).toBe(true);
    expect(canOperationsWatch({ kind: "city", cityId: CITY }, subject).allowed).toBe(true);
    expect(canOperationsWatch({ kind: "city", cityId: "city-ruh" }, subject).allowed).toBe(false);
  });

  it("السائق يرى نفسه ولا يرى غيره", () => {
    expect(canDriverWatch(DRIVER, DRIVER).allowed).toBe(true);
    expect(canDriverWatch(DRIVER, "driver-2").allowed).toBe(false);
  });
});

describe("ناقل أحداث التتبّع — التصريح داخل الاشتراك", () => {
  const collector = (): { readonly seen: TrackingEvent[]; deliver(e: TrackingEvent): void } => {
    const seen: TrackingEvent[] = [];
    return {
      seen,
      deliver: (event) => {
        seen.push(event);
      },
    };
  };

  it("العميل يستقبل أحداث رحلته وحدها", async () => {
    const bus = createTrackingEventBus();
    const sink = collector();
    bus.subscribe(
      { kind: "customer", riderId: RIDER, tripId: TRIP, driverId: DRIVER, provenBy: proof() },
      sink,
    );

    await bus.publish(positionEvent());
    await bus.publish(positionEvent({ tripId: "trip-other" }));
    // حدثٌ بلا رحلة: السائق متاح يُرسل موقعه للمطابقة — لا يخصّ عميلاً.
    await bus.publish(positionEvent({ tripId: null }));

    expect(sink.seen.length).toBe(1);
    expect(sink.seen[0]?.tripId).toBe(TRIP);
  });

  it("العميل لا يستقبل حدثاً لسائقٍ آخر في رحلته", async () => {
    const bus = createTrackingEventBus();
    const sink = collector();
    bus.subscribe(
      { kind: "customer", riderId: RIDER, tripId: TRIP, driverId: DRIVER, provenBy: proof() },
      sink,
    );
    await bus.publish(positionEvent({ driverId: "driver-9" }));
    expect(sink.seen.length).toBe(0);
  });

  it("نهاية الجلسة تُسلَّم للعميل ثم تُفصل اشتراكه", async () => {
    /**
     * هذا الاختبار هو سبب وجود الفصل التلقائي. بدونه يبقى مجرى العميل مفتوحاً
     * بعد رحلته، والسائق يأخذ رحلة شخصٍ آخر — فيصير المجرى نفسه قناةَ تتبّعٍ
     * لرحلةٍ لا يملكها. والحماية الثانية (مطابقة الرحلة) تكفي منطقياً، لكن
     * إزالة الاشتراك تُغلق الباب لا تحرسه.
     */
    const bus = createTrackingEventBus();
    const sink = collector();
    bus.subscribe(
      { kind: "customer", riderId: RIDER, tripId: TRIP, driverId: DRIVER, provenBy: proof() },
      sink,
    );

    await bus.publish({
      type: "session_ended",
      driverId: DRIVER,
      tripId: TRIP,
      sessionId: SESSION,
      sequence: 3,
      position: null,
      timestamp: new Date(0),
    });

    expect(sink.seen.length).toBe(1);
    expect(bus.subscriberCount).toBe(0);

    await bus.publish(positionEvent());
    expect(sink.seen.length).toBe(1);
  });

  it("مشغّل مدينةٍ لا يرى سائقي مدينةٍ أخرى، ويرى أحداث دورة الحياة كلّها", async () => {
    const bus = createTrackingEventBus();
    const sink = collector();
    bus.subscribe({ kind: "operations", scope: { kind: "city", cityId: CITY } }, sink);

    await bus.publish(positionEvent());
    await bus.publish(positionEvent({ cityId: "city-ruh" }));
    // بلا مدينة ⇒ يُسلَّم: إسقاطه يُخلّد صفّاً لسائقٍ انتهت رحلته على الخريطة.
    await bus.publish({
      type: "session_ended",
      driverId: DRIVER,
      tripId: TRIP,
      sessionId: SESSION,
      sequence: 3,
      position: null,
      timestamp: new Date(0),
    });

    expect(sink.seen.length).toBe(2);
    expect(sink.seen[1]?.type).toBe("session_ended");
  });

  it("مُستقبِلٌ يرمي يُفصَل ولا يُعطّل بقيّة المشتركين", async () => {
    const bus = createTrackingEventBus();
    const healthy = collector();
    bus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      {
        deliver: () => {
          throw new Error("مجرى مقطوع");
        },
      },
    );
    bus.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, healthy);

    await bus.publish(positionEvent());
    expect(healthy.seen.length).toBe(1);
    expect(bus.subscriberCount).toBe(1);

    await bus.publish(positionEvent());
    expect(healthy.seen.length).toBe(2);
  });

  it("الفصل يعمل ويتسامح مع التكرار", async () => {
    const bus = createTrackingEventBus();
    const sink = collector();
    const off = bus.subscribe({ kind: "operations", scope: { kind: "all_cities" } }, sink);
    off();
    off();
    await bus.publish(positionEvent());
    expect(sink.seen.length).toBe(0);
    expect(bus.subscriberCount).toBe(0);
  });
});

interface ChannelCall {
  readonly op: "start" | "update" | "stop";
  readonly chatId: string;
  readonly lat?: number;
}

function captureChannel(over: { readonly failUpdate?: boolean } = {}) {
  const calls: ChannelCall[] = [];
  let next = 0;
  return {
    calls,
    channel: {
      start: async (chatId: string, position: { lat: number; lng: number }) => {
        calls.push({ op: "start", chatId, lat: position.lat });
        next += 1;
        return `msg-${next}`;
      },
      update: async (
        chatId: string,
        _messageId: string,
        position: { lat: number; lng: number },
      ) => {
        calls.push({ op: "update", chatId, lat: position.lat });
        return over.failUpdate !== true;
      },
      stop: async (chatId: string) => {
        calls.push({ op: "stop", chatId });
        return true;
      },
    },
  };
}

describe("مُرحِّل الموقع الحيّ إلى العميل", () => {
  const target = {
    tripId: TRIP,
    riderId: RIDER,
    riderTelegramId: "555",
    driverId: DRIVER,
    riderLanguage: "ar",
    // المرحلة ١١: الحالة صارت جزءاً من الوجهة، و`matched` هي حال التتبّع الطبيعية.
    status: "matched" as WatchedTripStatus,
  };

  const buildRelay = (
    nowMsRef: { value: number },
    over: {
      readonly failUpdate?: boolean;
      readonly resolved?: typeof target | null;
      /** مرجعٌ متغيّر: تُمكِّن الاختبار من تحويل الحالة **بين** إصلاحتين. */
      readonly statusRef?: { value: WatchedTripStatus };
    } = {},
  ) => {
    const captured = captureChannel({
      ...(over.failUpdate === undefined ? {} : { failUpdate: over.failUpdate }),
    });
    const relay = createCustomerLiveRelay({
      channel: captured.channel,
      customers: {
        resolve: async () => {
          if (over.resolved !== undefined) return over.resolved;
          return over.statusRef === undefined
            ? target
            : { ...target, status: over.statusRef.value };
        },
      },
      clock: { now: () => new Date(nowMsRef.value) },
      livePeriodSeconds: 3600,
    });
    return { relay, calls: captured.calls };
  };

  it("أول موقع يفتح بثّاً، والمواقع القريبة زمناً لا تُرسل تعديلاً", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);

    await relay.handle(positionEvent());
    expect(calls.map((c) => c.op)).toEqual(["start"]);

    now.value += 1_000; // أقل من ٥ ثوان
    await relay.handle(positionEvent({ position: { lat: 21.6, lng: 39.2 } }));
    expect(calls.map((c) => c.op)).toEqual(["start"]);
  });

  it("حركة كافية بعد فاصلٍ كافٍ تُرسل تعديلاً واحداً", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);
    await relay.handle(positionEvent());

    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.56, lng: 39.1751 } }));
    expect(calls.map((c) => c.op)).toEqual(["start", "update"]);
  });

  it("ضجيج مكانيّ بعد فاصلٍ طويل لا يُستهلك عليه معدّل تلغرام", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);
    await relay.handle(positionEvent());

    now.value += 60_000;
    // إزاحة نحو مترٍ واحد: أقلّ من حدّ الحركة.
    await relay.handle(positionEvent({ position: { lat: 21.54711, lng: 39.1751 } }));
    expect(calls.map((c) => c.op)).toEqual(["start"]);
  });

  it("حدثٌ لسائقٍ غير سائق الرحلة المُخزَّن لا يُبَثّ للعميل", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);
    await relay.handle(positionEvent({ driverId: "driver-9" }));
    expect(calls.length).toBe(0);
    expect(relay.openBroadcasts).toBe(0);
  });

  it("رحلةٌ لا عميل لها لا تُنتج بثّاً ولا عطلاً", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now, { resolved: null });
    await relay.handle(positionEvent());
    expect(calls.length).toBe(0);
  });

  it("نهاية الجلسة تُوقف البثّ مرّةً واحدة", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now);
    await relay.handle(positionEvent());

    const ended: TrackingEvent = {
      type: "session_ended",
      driverId: DRIVER,
      tripId: TRIP,
      sessionId: SESSION,
      sequence: 3,
      position: null,
      timestamp: new Date(0),
    };
    await relay.handle(ended);
    await relay.handle(ended);

    expect(calls.filter((c) => c.op === "stop").length).toBe(1);
    expect(relay.openBroadcasts).toBe(0);
  });

  /**
   * المرحلة ١١ — العيب P11-3 مقيساً: أقوى قاعدةٍ في المجال (`isTripLive`)
   * كانت غائبةً عن مسار العميل الفعليّ. والسبب أن المرحّل يشترك بوصفه
   * `operations/all_cities`، و`canOperationsWatch` تأذن دائماً فلا تمرّ بـ`isTripLive`
   * أصلاً — فإصلاحةٌ متأخّرة لرحلةٍ منتهية كانت **تفتح** خريطةً لعميل رحلته
   * انتهت. والحراسة في المرحّل لا في سياسة الاشتراك: المشغّل له أن يرى كلّ
   * شيء، والعميل ليس له — وهما حكمان مختلفان على الاشتراك الواحد.
   */
  it("رحلةٌ غير حيّة لا يُفتح لها بثٌّ ولو وصل موقعٌ أصلاً", async () => {
    for (const dead of ["completed", "cancelled"] as readonly WatchedTripStatus[]) {
      const now = { value: 1_000_000 };
      const { relay, calls } = buildRelay(now, { statusRef: { value: dead } });
      await relay.handle(positionEvent());
      expect(calls.length).toBe(0);
      expect(relay.openBroadcasts).toBe(0);
    }
  });

  it("الحالتان الحيّتان وحدهما تفتحان بثٌّاً — فلا يصير الحراس حجباً شاملاً", async () => {
    for (const live of ["matched", "in_progress"] as readonly WatchedTripStatus[]) {
      expect(isTripLive(live)).toBe(true);
      const now = { value: 1_000_000 };
      const { relay, calls } = buildRelay(now, { statusRef: { value: live } });
      await relay.handle(positionEvent());
      expect(calls.map((c) => c.op)).toEqual(["start"]);
    }
  });

  /**
   * والحراسة عند الفتح وحده لا تكفي: الرحلة تنتهي **بين** إصلاحتين، والبثّ حينها
   * مفتوحٌ أصلاً. ومن الممكن أن تنتهي بـRPC لا يمرّ بـ`onTripEnded` أصلاً — أو أن
   * يُعاد تشغيل الخدمة فيُفقد الحدث. فالوجهة تُقرأ ثانيةً عند كلّ تعديل: القاعدة
   * مصدر الحقيقة لا الذاكرة المحليّة للمرحّل.
   */
  it("انتهاء الرحلة أثناء بثٍّ مفتوح يُوقفه عند التعديل التالي لا يُحدّثه", async () => {
    const now = { value: 1_000_000 };
    const statusRef = { value: "matched" as WatchedTripStatus };
    const { relay, calls } = buildRelay(now, { statusRef });

    await relay.handle(positionEvent());
    expect(calls.map((c) => c.op)).toEqual(["start"]);

    // أُلغيت الرحلة ولم يصل `session_ended`، ثم وصلت إصلاحةٌ تستحقّ تعديلاً.
    statusRef.value = "cancelled";
    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.56, lng: 39.1751 } }));

    expect(calls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(relay.openBroadcasts).toBe(0);
  });

  /**
   * وترتيب الحراس مع الخنق هو البند نفسه لا تفصيلاً فيه: فحص الحياة بعد
   * **حدّ الحركة** يترك نصف العيب قائماً: سائقٌ أُلغيت رحلته ثم أوقف سيّارته
   * لا يتجاوز حدّ الحركة قطّ، فلا تُقرأ الحالة أبداً وتبقى خريطة العميل حيّةً
   * إلى انتهاء مدّة تلغرام. وقد وُضع الفحص هناك أولاً فأسقط هذا الاختبار
   * واختبارَ التكامل معاً — وهو ما نقله إلى ما بين حدّ الزمن وحدّ الحركة.
   */
  it("سائقٌ واقفٌ ورحلةٌ انتهت: يُغلق البثّ ولو لم يتحرّك متراً", async () => {
    const now = { value: 1_000_000 };
    const statusRef = { value: "in_progress" as WatchedTripStatus };
    const { relay, calls } = buildRelay(now, { statusRef });

    await relay.handle(positionEvent());
    expect(calls.map((c) => c.op)).toEqual(["start"]);

    statusRef.value = "completed";
    now.value += 10_000;
    // إصلاحةٌ بـ**نفس** الإحداثيّات: لا تجتاز حدّ الحركة ألبتّة.
    await relay.handle(positionEvent());

    expect(calls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(relay.openBroadcasts).toBe(0);
  });

  it("اختفاء الوجهة أثناء بثٍّ مفتوح يُوقفه لا يتركه معلّقاً", async () => {
    const now = { value: 1_000_000 };
    const resolvedRef: { value: typeof target | null } = { value: target };
    const captured = captureChannel({});
    const relay = createCustomerLiveRelay({
      channel: captured.channel,
      customers: { resolve: async () => resolvedRef.value },
      clock: { now: () => new Date(now.value) },
      livePeriodSeconds: 3600,
    });

    await relay.handle(positionEvent());
    expect(captured.calls.map((c) => c.op)).toEqual(["start"]);

    resolvedRef.value = null;
    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.56, lng: 39.1751 } }));

    expect(captured.calls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(relay.openBroadcasts).toBe(0);
  });

  /**
   * وإعادة الإسناد أثناء البثّ أخطر من الانتهاء: الخريطة تبقى مفتوحةً تُري
   * العميل موقع سائقٍ لم يعد سائقَه — وهو لا يعلم أنّ من ينتظره غير من يراه.
   */
  it("تغيّر سائق الرحلة أثناء بثٍّ مفتوح يُوقفه", async () => {
    const now = { value: 1_000_000 };
    const driverRef = { value: DRIVER };
    const captured = captureChannel({});
    const relay = createCustomerLiveRelay({
      channel: captured.channel,
      customers: { resolve: async () => ({ ...target, driverId: driverRef.value }) },
      clock: { now: () => new Date(now.value) },
      livePeriodSeconds: 3600,
    });

    await relay.handle(positionEvent());
    expect(captured.calls.map((c) => c.op)).toEqual(["start"]);

    driverRef.value = "driver-77" as typeof DRIVER;
    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.56, lng: 39.1751 } }));

    expect(captured.calls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(relay.openBroadcasts).toBe(0);
  });

  it("فشل التعديل يُنسي الرسالة فيُفتح بثٌّ جديد بدل خريطةٍ متجمّدة", async () => {
    const now = { value: 1_000_000 };
    const { relay, calls } = buildRelay(now, { failUpdate: true });
    await relay.handle(positionEvent());

    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.56, lng: 39.1751 } }));
    expect(relay.openBroadcasts).toBe(0);

    now.value += 10_000;
    await relay.handle(positionEvent({ position: { lat: 21.57, lng: 39.1751 } }));
    expect(calls.map((c) => c.op)).toEqual(["start", "update", "start"]);
  });
});

describe("تركيب الجلسة على المسار الحيّ", () => {
  const buildLive = (
    nowMsRef: { value: number },
    over: { readonly trip?: string | null; readonly onDuty?: boolean } = {},
  ) => {
    const store = createMemoryTrackingSessionStore();
    const events: TrackingEvent[] = [];
    /**
     * `BUG-010` — عائدُ `close` مُلتقَطٌ لأنَّ الدعوى المُقاسة «الرقمُ في الحدثِ هو
     * الرقمُ الذي أعادَه الإغلاقُ». ورقمٌ يُكتَب في التوقُّعِ يدَاً يُخفي المُولِّدَ.
     */
    const closed: Awaited<ReturnType<typeof store.close>>[] = [];
    const sessions = {
      ...store,
      close: async (
        driverId: string,
        reason: Parameters<typeof store.close>[1],
        endedAtMs: number,
      ) => {
        const record = await store.close(driverId, reason, endedAtMs);
        closed.push(record);
        return record;
      },
    };
    const live = createLiveTracking({
      sessions,
      publisher: {
        publish: async (event) => {
          events.push(event);
        },
      },
      trips: { activeTripOf: async () => (over.trip === undefined ? null : over.trip) },
      /**
       * المرحلة ١٢ — الأصل «في الخدمة»: اختبارات هذه المجموعة تقيس ميلاد
       * الجلسة وتقدّمها وانتهاءها بالسقف، وكلّها تفترض سائقاً عاملاً.
       */
      duty: { isOnDuty: async () => over.onDuty !== false },
      clock: { now: () => new Date(nowMsRef.value) },
    });
    return { live, sessions: store, events, closed };
  };

  it("أول إصلاحة تفتح جلسةً وتنشر البدء ثم الموقع", async () => {
    const now = { value: 10_000_000 };
    const { live, sessions, events } = buildLive(now);

    await live.onFix(fixAt(now.value));

    expect(events.map((e) => e.type)).toEqual(["session_started", "location_updated"]);
    // حدث البدء بلا موضع بقصد (المرحلة ٥): الصفر نقطةٌ حقيقية في خليج غينيا.
    expect(events[0]?.position).toBeNull();
    const open = await sessions.openSessionOf(DRIVER);
    expect(open?.facts.lastFixAtMs).toBe(now.value);
  });

  it("إصلاحة ثانية تُقدّم الجلسة نفسها ولا تفتح ثانية", async () => {
    const now = { value: 10_000_000 };
    const { live, sessions, events } = buildLive(now);
    await live.onFix(fixAt(now.value));

    now.value += 20_000;
    await live.onFix(fixAt(now.value));

    expect(events.filter((e) => e.type === "session_started").length).toBe(1);
    expect((await sessions.openSessionOf(DRIVER))?.facts.lastFixAtMs).toBe(now.value);
  });

  it("جلسة تجاوزت سقفها تُغلق EXPIRED وتُستبدل بلا ماسحٍ دوري", async () => {
    /**
     * هذا الاختبار هو دليل إغلاق R-14. لا مؤقّت ولا جوب: أوّل إصلاحة بعد السقف
     * هي التي تكتب الحكم. وما يبقى مفتوحاً لسائقٍ لا يعود صفٌّ لا يُقرأ نشطاً
     * أصلاً — فلا يُضلّل العمليات ولا يمنع فتح جلسةٍ تالية.
     */
    const now = { value: 10_000_000 };
    const { live, sessions, events } = buildLive(now);
    await live.onFix(fixAt(now.value));
    const first = await sessions.openSessionOf(DRIVER);

    now.value += 13 * 60 * 60 * 1000; // أكثر من السقف (١٢ ساعة)
    await live.onFix(fixAt(now.value));

    const second = await sessions.openSessionOf(DRIVER);
    expect(second).not.toBeNull();
    expect(second?.facts.startedAtMs).toBe(now.value);
    expect(second?.facts.startedAtMs).not.toBe(first?.facts.startedAtMs);
    expect(events.filter((e) => e.type === "session_started").length).toBe(2);
  });

  it("إنهاء الرحلة يُغلق جلستها وينشر النهاية بسببها", async () => {
    const now = { value: 10_000_000 };
    const { live, sessions, events } = buildLive(now, { trip: TRIP });
    await live.onFix(fixAt(now.value));

    await live.onTripEnded(TRIP, "TRIP_COMPLETED");

    expect(await sessions.openSessionOf(DRIVER)).toBeNull();
    const ended = events.filter((e) => e.type === "session_ended");
    expect(ended.length).toBe(1);
    expect(ended[0]?.metadata?.reason).toBe("TRIP_COMPLETED");
  });

  it("رحلة بلا جلسة تتبّع لا تُنتج حدث نهايةٍ كاذباً", async () => {
    const now = { value: 10_000_000 };
    const { live, events } = buildLive(now, { trip: TRIP });
    await live.onTripEnded(TRIP, "TRIP_COMPLETED");
    expect(events.length).toBe(0);
  });

  it("عطل مخزن الجلسات لا يرمي في مسار الموقع — الموقع محفوظ فعلاً", async () => {
    /**
     * النقل اللحظي عونٌ لا شرط. لو رمى هذا الاستدعاء لرأى السائق «تعذّر حفظ
     * موقعك» وموقعه مكتوبٌ في القاعدة (الكاتب الوحيد سبقه — ADR-0015)، فيُعيد
     * الإرسال بلا داعٍ ويظنّ التتبّع معطّلاً.
     */
    const events: TrackingEvent[] = [];
    const live = createLiveTracking({
      sessions: {
        openSessionOf: async () => {
          throw new Error("انقطاع القاعدة");
        },
        open: async () => {
          throw new Error("انقطاع القاعدة");
        },
        attachTrip: async () => null,
        advance: async () => ({ kind: "no_session" }) as const,
        close: async () => null,
        closeByTrip: async () => [],
      },
      publisher: {
        publish: async (event) => {
          events.push(event);
        },
      },
      trips: { activeTripOf: async () => null },
      duty: { isOnDuty: async () => true },
      clock: { now: () => new Date(10_000_000) },
    });

    await live.onFix(fixAt(10_000_000));
    expect(events.length).toBe(0);
  });
  it("جلسة تجاوزت سقفها تنشر `session_ended` برقمِ الإغلاقِ قبلَ بدءِ الخَلَف", async () => {
    /**
     * `BUG-010` — الإغلاقُ بالسقفِ كان يُنادي `sessions.close` مباشرةً ويُهمل
     * عائدَها، فيُستهلك الرقمُ بلا حدثٍ يقابله (`ADR 0053` §٤-أ يوجب النشرَ لكلِّ
     * إغلاقٍ). وأربعُ دعاوى تُقاس هنا لأنَّها التي يعتمد عليها المستهلك:
     * الإغلاقُ نفسُه، والنشرُ، وأنَّ الرقمَ **هو عائدُ الإغلاقِ** لا رقمٌ مُصطنعٌ،
     * وأنَّ النهايةَ تسبق بدايةَ الخَلَفِ فلا يُرى الترتيبُ مقلوباً.
     */
    const now = { value: 10_000_000 };
    const { live, events, closed } = buildLive(now, { trip: TRIP });
    await live.onFix(fixAt(now.value));
    const first = events.find((e) => e.type === "session_started");

    now.value += 13 * 60 * 60 * 1000; // أكثرُ من السقفِ (١٢ ساعةً)
    await live.onFix(fixAt(now.value));

    const ended = events.filter((e) => e.type === "session_ended");
    expect(ended.length).toBe(1);
    expect(ended[0]?.metadata?.reason).toBe("EXPIRED");
    expect(ended[0]?.sessionId).toBe(first?.sessionId);
    // الرقمُ من عائدِ الإغلاقِ نفسِه — لا رقمَ مكتوباً في التوقُّع
    const closedRecord = closed.at(-1);
    expect(closedRecord).not.toBeNull();
    expect(ended[0]?.sequence).toBe(closedRecord?.sequence);
    // النهايةُ قبلَ بدايةِ الخَلَفِ، وبدايةُ الخَلَفِ لجلسةٍ أخرى
    const types = events.map((e) => e.type);
    expect(types.indexOf("session_ended")).toBeLessThan(types.lastIndexOf("session_started"));
    expect(events.at(-1)?.sessionId).not.toBe(first?.sessionId);
  });

  it("إغلاقٌ سبقَنا إليه غيرُنا لا يُنتج حدثَ نهايةٍ كاذباً", async () => {
    /**
     * `BUG-010` — النشرُ مشروطٌ بعائدِ الإغلاقِ لا بمحاولتِه: صفٌّ أُغلق بين
     * القراءةِ والإغلاقِ يُعيد `null`، فحدثُ نهايةٍ حينَها يحمل معرّفَ جلسةٍ ورقماً
     * لا يملكهما أحدٌ — ولأغلقَ عندَ المستهلكِ بثّاً مشروعاً.
     */
    const events: TrackingEvent[] = [];
    const expired = {
      sessionId: "session-expired",
      sequence: 7,
      facts: {
        driverId: DRIVER,
        tripId: TRIP,
        startedAtMs: 10_000_000,
        lastFixAtMs: 10_000_000,
        endedAtMs: null,
        endReason: null,
      },
    } as const;
    const nowMs = 10_000_000 + 13 * 60 * 60 * 1000;
    const live = createLiveTracking({
      sessions: {
        openSessionOf: async () => expired,
        open: async (driverId, tripId, startedAtMs) => ({
          sessionId: "session-next",
          sequence: 1,
          facts: {
            driverId,
            tripId,
            startedAtMs,
            lastFixAtMs: null,
            endedAtMs: null,
            endReason: null,
          },
        }),
        attachTrip: async () => null,
        advance: async () => ({ kind: "no_session" }) as const,
        // الصفُّ مُغلقٌ سلفاً — وهذا هو المقصودُ بالقياس
        close: async () => null,
        closeByTrip: async () => [],
      },
      publisher: {
        publish: async (event) => {
          events.push(event);
        },
      },
      trips: { activeTripOf: async () => TRIP },
      duty: { isOnDuty: async () => true },
      clock: { now: () => new Date(nowMs) },
    });

    await live.onFix(fixAt(nowMs));

    expect(events.filter((e) => e.type === "session_ended").length).toBe(0);
  });

  it("نهايةُ الجلسةِ بالسقفِ تُغلق بثَّ العميلِ لأنَّها جلستُه نفسُها", async () => {
    /**
     * `BUG-010` — الأثرُ الظاهرُ الذي كان يتسرَّب: رسالةُ الموقعِ الحيِّ على جهازِ
     * العميلِ تبقى تدور بعدَ إغلاقِ الجلسةِ في القاعدةِ. والقياسُ على القناةِ لا على
     * الحالةِ الداخليّةِ. وبوّابةُ `BUG-009` في المُرحِّلِ لا تُغلق إلّا إن كان
     * `sessionId` في الحدثِ **هو** معرّفُ الجلسةِ التي يملك بثَّها — فنجاحُ
     * `stop` هو بعينِه إثباتُ أنَّ الجلسةَ المنتهيةَ هي جلسةُ البثِّ.
     */
    const now = { value: 10_000_000 };
    const captured = captureChannel();
    const store = createMemoryTrackingSessionStore();
    const relay = createCustomerLiveRelay({
      channel: captured.channel,
      customers: {
        resolve: async () => ({
          tripId: TRIP,
          riderId: RIDER,
          riderTelegramId: "555",
          driverId: DRIVER,
          riderLanguage: "ar",
          status: "in_progress" as WatchedTripStatus,
        }),
      },
      clock: { now: () => new Date(now.value) },
      livePeriodSeconds: 3600,
    });
    const live = createLiveTracking({
      sessions: store,
      publisher: { publish: async (event) => await relay.handle(event) },
      trips: { activeTripOf: async () => TRIP },
      duty: { isOnDuty: async () => true },
      clock: { now: () => new Date(now.value) },
    });

    await live.onFix(fixAt(now.value));
    expect(captured.calls.map((c) => c.op)).toEqual(["start"]);
    expect(relay.openBroadcasts).toBe(1);

    now.value += 13 * 60 * 60 * 1000;
    await live.onFix(fixAt(now.value));

    // `stop` للجلسةِ المنتهيةِ، ثم بثٌّ جديدٌ لجلسةِ الخَلَفِ — لا خريطةٌ تدور بلا جلسة
    expect(captured.calls.map((c) => c.op)).toEqual(["start", "stop", "start"]);
  });
});
