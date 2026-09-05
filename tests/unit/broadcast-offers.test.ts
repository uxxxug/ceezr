/**
 * الغرض: اختبار حالة الاستخدام broadcastOffers وحدها: ماذا يُكتب في العروض، ومَن يُخطَر،
 *   وماذا يحدث حين يتعذّر الوصول إلى سائق أو تفشل كتابة الدورة.
 * الحالة: اختبار فعلي بمزدوجات في الذاكرة (النظير التكاملي على قاعدة حقيقية في tests/integration).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة دورات البثّ التالية يُضاف هنا سيناريو الدورة الثانية.
 */
import { describe, expect, it } from "bun:test";
import {
  type BroadcastDependencies,
  broadcastOffers,
} from "../../packages/application/dispatch/broadcast-offers.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { DriverCandidate } from "../../packages/domain/dispatch/entity.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, isErr, isOk, ok } from "../../packages/shared/result/index.ts";
import { notifierDouble, offerWriterDouble } from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const JED = "city-jed" as CityId;
const ORDER_ID = "order-1" as OrderId;
const NOW = new Date("2026-08-06T12:00:30.000Z");
const FUTURE = new Date("2026-09-06T00:00:00.000Z");
const PICKUP = { latitude: 21.4858, longitude: 39.1925 };
const NEAR = { latitude: 21.5058, longitude: 39.1925 };
const MID = { latitude: 21.5458, longitude: 39.1925 };

const ORDER: Order = {
  id: ORDER_ID,
  cityId: JED,
  service: "transport",
  status: "searching",
  pickup: PICKUP,
  dropoff: null,
  assignedDriverId: null,
  broadcastRound: 0,
};

function driver(id: string, location: { latitude: number; longitude: number }): DriverCandidate {
  const driverId = id as DriverId;
  const subscription: Subscription = {
    driverId,
    cityId: JED,
    plan: "both",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
  };
  return {
    driverId,
    cityId: JED,
    location,
    isAvailable: true,
    isVerified: true,
    isBlocked: false,
    ratingAverage: null,
    ratingCount: 0,
    capabilities: [{ driverId, cityId: JED, service: "transport", isEnabled: true }],
    subscription,
  };
}

function deps(over: Partial<BroadcastDependencies> = {}): BroadcastDependencies {
  return {
    orders: orderRepo([ORDER]),
    offers: offerRepo([]),
    candidates: candidateRepo([driver("near", NEAR), driver("far", MID)]),
    settings: settingsRepo(seededRows(JED, {})),
    clock: fixedClock(NOW),
    offerWriter: offerWriterDouble(),
    notifier: notifierDouble(),
    ...over,
  };
}

describe("broadcastOffers", () => {
  it("يفتح دورة عروض بمهلة الإعدادات ويُخطر كل سائق في الدفعة", async () => {
    const offerWriter = offerWriterDouble();
    const notifier = notifierDouble();
    const result = await broadcastOffers({ orderId: ORDER_ID }, deps({ offerWriter, notifier }));

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.offered.map(String)).toEqual(["near", "far"]);
    expect(result.value.notified.map(String)).toEqual(["near", "far"]);
    expect(result.value.unreachable).toHaveLength(0);
    // 45 ثانية مصدرها offer_timeout_seconds لا ثابت في الكود
    expect(result.value.expiresAt.getTime() - NOW.getTime()).toBe(45_000);

    expect(offerWriter.rounds).toHaveLength(1);
    const round = offerWriter.rounds[0];
    expect(round?.round).toBe(1);
    expect(round?.cityId).toBe(JED);
    expect(round?.entries.map((e) => String(e.driverId))).toEqual(["near", "far"]);
    // المسافة محسوبة فعلاً لا صفراً
    expect(round?.entries[0]?.distanceKm).toBeGreaterThan(0);
    expect(round?.entries[0]?.distanceKm).toBeLessThan(round?.entries[1]?.distanceKm ?? 0);

    expect(notifier.sent.map((n) => String(n.driverId))).toEqual(["near", "far"]);
    expect(notifier.sent[0]?.expiresInSeconds).toBe(45);
    expect(notifier.sent[0]?.orderId).toBe(ORDER_ID);
    /**
     * `BUG-003` — كلُّ إشعارٍ يحملُ `offerId` عرضٍ بعينِه، فيُبنى منه زرُّ رفضٍ يصوبُ على
     * عرضٍ واحدٍ لا على كلِّ عرضٍ معلَّقٍ للسائقِ.
     */
    expect(notifier.sent.every((n) => n.offerId.length > 0)).toBe(true);
    expect(notifier.sent.map((n) => String(n.offerId))).not.toContain("near");
  });

  it("سائق حجب البوت يُحسب unreachable ولا يُوقف بقية الدفعة", async () => {
    const notifier = notifierDouble(["near"]);
    const result = await broadcastOffers({ orderId: ORDER_ID }, deps({ notifier }));

    if (!isOk(result)) throw new Error("توقّعنا نجاح البثّ");
    expect(result.value.unreachable.map(String)).toEqual(["near"]);
    expect(result.value.notified.map(String)).toEqual(["far"]);
    // العرض مكتوب للاثنين رغم تعذّر الإخطار: من حقّه أن يراه إن فتح البوت
    expect(result.value.offered).toHaveLength(2);
    expect(notifier.sent).toHaveLength(2);
  });

  it("فشل كتابة الدورة يُوقف البثّ فلا يُخطَر أحد بعرض غير موجود", async () => {
    const notifier = notifierDouble();
    const failingWriter = {
      openRound: async () => err(new PortFailureError("offers.openRound", "قاعدة معطّلة")),
    };
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ notifier, offerWriter: failingWriter }),
    );

    expect(isErr(result)).toBe(true);
    expect(notifier.sent).toHaveLength(0);
  });

  /**
   * `BUG-005`: الحراسةُ صارتْ في القاعدةِ، فرفضُها ليسَ عطلاً يُبلَعُ بل خبرٌ
   * يُتَرجَمُ. وهذه الثلاثةُ تُثبِتُ أنَّ كلَّ رفضٍ يَصلُ باسمِه وأنَّ أحداً لا
   * يُخطَرُ بعرضٍ لم تُنشِئْه القاعدةُ.
   */
  it("رفضُ القاعدةِ ORDER_NOT_SEARCHING يُترجَم خطأً بالحالِ ولا يُخطَر أحد", async () => {
    const notifier = notifierDouble();
    const refusing = {
      openRound: async () =>
        ok({
          opened: false as const,
          refusal: "ORDER_NOT_SEARCHING" as const,
          status: "matched" as const,
        }),
    };
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ notifier, offerWriter: refusing }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("ORDER_NOT_SEARCHING");
    expect(notifier.sent).toHaveLength(0);
  });

  it("رفضُ القاعدةِ ROUND_ALREADY_OPENED يُترجَم خطأً مستقلاً ولا يُخطَر أحد", async () => {
    const notifier = notifierDouble();
    const refusing = {
      openRound: async () =>
        ok({ opened: false as const, refusal: "ROUND_ALREADY_OPENED" as const }),
    };
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ notifier, offerWriter: refusing }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    // ليس `ORDER_NOT_SEARCHING`: الطلبُ ما يزالُ باحثاً، وإنّما سبقَ إلى دورتِه غيرُنا.
    expect(result.error.code).toBe("ROUND_ALREADY_OPENED");
    expect(notifier.sent).toHaveLength(0);
  });

  it("رفضُ القاعدةِ ORDER_NOT_FOUND يُترجَم خطأً ولا يُخطَر أحد", async () => {
    const notifier = notifierDouble();
    const refusing = {
      openRound: async () => ok({ opened: false as const, refusal: "ORDER_NOT_FOUND" as const }),
    };
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ notifier, offerWriter: refusing }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("ORDER_NOT_FOUND");
    expect(notifier.sent).toHaveLength(0);
  });

  it("لا مرشحين مؤهلين: خطأ صريح بلا دورة ولا إخطار", async () => {
    const offerWriter = offerWriterDouble();
    const notifier = notifierDouble();
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ candidates: candidateRepo([]), offerWriter, notifier }),
    );

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.code).toBe("NO_ELIGIBLE_DRIVER");
    // لا عرض يُكتب ولا سائق يُخطَر: الطلب يبقى في البحث للدورة التالية
    expect(offerWriter.rounds).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);
  });

  /**
   * البند 2.3: قبل هذا كان سبب الرفض يُرجع داخل الخطأ ثم يُسقطه منادي
   * بوت العميل بـ`if (!broadcast.ok) return replies`، فلا يبقى لـ«لماذا لم يصل أحد؟»
   * أي أثر في النظام. وإصلاح لا يراه أحد لا يُعتدّ به.
   */
  it("يُخرج تعداد أسباب الرفض إلى السجلّ — لا يدفنها في الخطأ", async () => {
    const entries: { message: string; meta: Record<string, unknown> }[] = [];
    const noLocation = { ...driver("no-loc", NEAR), location: null };
    // مرشّح آخر بسبب مختلف ليُثبت أن التعداد يفصل الأسباب ولا يجمعها في واحد
    const unverified = { ...driver("unverified", NEAR), isVerified: false };

    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({
        candidates: candidateRepo([noLocation, unverified]),
        log: (message, meta) => entries.push({ message, meta }),
      }),
    );

    expect(isErr(result)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe("dispatch.no_eligible_driver");
    expect(entries[0]?.meta.candidatesSeen).toBe(2);
    expect(entries[0]?.meta.reasons).toEqual({ NO_LOCATION: 1, NOT_VERIFIED: 1 });
  });

  it("لا يسجّل شيئاً عند نجاح البثّ: السجلّ للإنذار لا للضجيج", async () => {
    const entries: string[] = [];
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ log: (message) => entries.push(message) }),
    );

    expect(isOk(result)).toBe(true);
    expect(entries).toHaveLength(0);
  });

  it("يعمل بلا سجلّ مطلقاً: الحقل اختياري ولا يُسقط البثّ", async () => {
    const result = await broadcastOffers(
      { orderId: ORDER_ID },
      deps({ candidates: candidateRepo([{ ...driver("no-loc", NEAR), location: null }]) }),
    );
    expect(isErr(result)).toBe(true);
  });
});
