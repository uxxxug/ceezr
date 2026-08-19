/**
 * الغرض: قرب السائق من مرجع العميل، وحداثة موقعه — المرحلة ١١، البند P11-5.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: حين يُوصل OSRM (خطر R-28) يُضاف اختبارٌ يقارن مسافة الطريق
 *   بالخطّ المستقيم، ويُوثَّق الفارق قبل أن يُعرض على العميل بوصفه وقتاً متوقّعاً.
 *
 * ## لماذا ملفٌّ منفصل عن rider-dialog.test.ts
 *
 * لأن `driverProximity` دالةٌ نقيّة: لا بوت، ولا جلسة، ولا قاعدة. واختبارُها
 * داخل ملفٍ يبني حواراً كاملاً في كل حالة يخفي أنّها كذلك، ويجعل فشلَها يُقرأ
 * «تعطّل الحوار» لا «أخطأ الحساب». وأثرُها في الرسالة يُختبر هناك لا هنا.
 */
import { describe, expect, it } from "bun:test";
import {
  DRIVER_LOCATION_STALE_SECONDS,
  driverProximity,
} from "../../packages/application/bots/rider-dialog.ts";
import type { ActiveOrderSummary } from "../../packages/application/bots/types.ts";
import { haversineKm } from "../../packages/domain/geo/index.ts";
import { DEFAULT_SESSION_POLICY } from "../../packages/domain/tracking/session.ts";
import type { OrderId } from "../../packages/shared/kernel/index.ts";

const NOW = new Date("2026-08-12T09:00:00.000Z");

/** نقطتان في جدّة يفصلهما نحو ١.٦ كم — أرقامٌ حقيقيّة لا وهميّة. */
const PICKUP = { lat: 21.5433, lng: 39.1728 };
const DROPOFF = { lat: 21.6003, lng: 39.1502 };
const DRIVER = { lat: 21.5578, lng: 39.1728 };

const order = (over: Partial<ActiveOrderSummary> = {}): ActiveOrderSummary => ({
  orderId: "11111111-1111-4111-8111-111111111111" as OrderId,
  service: "transport",
  status: "matched",
  pickupLabel: "الرصيف",
  dropoffLabel: "حي الصفا",
  createdAt: new Date(NOW.getTime() - 5 * 60_000),
  pickup: PICKUP,
  dropoff: DROPOFF,
  assignedDriver: {
    fullName: "أحمد العمري",
    vehicleType: "سيدان",
    plateNumber: "ح ط ب 1234",
    vehiclePhotoFileId: null,
    lastLocation: { ...DRIVER, recordedAt: new Date(NOW.getTime() - 10_000) },
  },
  ...over,
});

describe("قرب السائق من مرجع العميل", () => {
  /**
   * جوهر العيب P11-5: كان `/status` يعرف السائق ولا يعرف أين هو. والقياس هنا
   * يُقارن بـ`haversineKm` نفسها لا برقمٍ مكتوبٍ بيدي: رقمٌ مكتوبٌ يُثبّت خطأً
   * في الحساب إن وُجد، ومقارنةٌ بالدالة تُثبت أن المسار يستعمل مقياس المنصّة
   * الواحد لا مقياساً ثانياً.
   */
  it("في matched يقاس إلى موضع الانطلاق — حيث العميل واقف", () => {
    const near = driverProximity(order(), NOW);
    expect(near).not.toBeNull();
    expect(near?.towards).toBe("PICKUP");
    const expected =
      haversineKm(
        { latitude: DRIVER.lat, longitude: DRIVER.lng },
        { latitude: PICKUP.lat, longitude: PICKUP.lng },
      ) * 1000;
    expect(near?.meters).toBeCloseTo(expected, 6);
  });

  /**
   * والمرجع يتبع الحالة: من هو جالسٌ في السيّارة لا يعنيه بعدُ السائق عنه —
   * يعنيه ما بقي إلى وجهته. ولو قِيس إلى الانطلاق دائماً لقرأ الراكب «سائقك
   * يبعد عنك ٢ كم» وهو معه في المقعد نفسه.
   */
  it("في in_progress يقاس إلى المقصد — لا إلى الانطلاق", () => {
    const near = driverProximity(order({ status: "in_progress" }), NOW);
    expect(near?.towards).toBe("DROPOFF");
    const toDropoff =
      haversineKm(
        { latitude: DRIVER.lat, longitude: DRIVER.lng },
        { latitude: DROPOFF.lat, longitude: DROPOFF.lng },
      ) * 1000;
    expect(near?.meters).toBeCloseTo(toDropoff, 6);
    // وبرهانٌ أنّه ليس نفس الرقم بالمصادفة: النقطتان مختلفتان فعلاً.
    const toPickup = driverProximity(order(), NOW)?.meters ?? 0;
    expect(Math.abs(toPickup - toDropoff)).toBeGreaterThan(1_000);
  });

  it("سائقٌ لم يُرسل موقعاً قطّ لا يُنتج مسافةً مخترعة", () => {
    const near = driverProximity(
      order({
        assignedDriver: {
          fullName: "أحمد",
          vehicleType: null,
          plateNumber: null,
          vehiclePhotoFileId: null,
          lastLocation: null,
        },
      }),
      NOW,
    );
    expect(near).toBeNull();
  });

  it("طلبٌ بلا سائق مُسنَد لا يُنتج مسافة", () => {
    expect(driverProximity(order({ status: "searching", assignedDriver: null }), NOW)).toBeNull();
  });

  /**
   * حالةٌ ليست `matched` ولا `in_progress` لا مرجع لها. والفحص صريحٌ لا ضمنيّ:
   * استعلام الطلبات النشطة قد يوسَّع يوماً بحالةٍ ثالثة، فمسافةٌ تُحسب إلى مرجعٍ
   * افتراضيّ حينها تكون رقماً بلا معنى يُعرض على العميل بثقة.
   */
  it("حالةٌ لا مرجع لها لا تُنتج مسافة حتى مع موقعٍ حاضر", () => {
    expect(driverProximity(order({ status: "searching" }), NOW)).toBeNull();
  });

  it("in_progress بلا مقصد مخزَّن لا تُقاس إلى الانطلاق بديلاً", () => {
    expect(driverProximity(order({ status: "in_progress", dropoff: null }), NOW)).toBeNull();
  });

  it("matched بلا موضع انطلاق لا تُنتج مسافة", () => {
    expect(driverProximity(order({ pickup: null }), NOW)).toBeNull();
  });
});

describe("حداثة موقع السائق المعروض للعميل", () => {
  const aged = (secondsAgo: number, now: Date = NOW) =>
    driverProximity(
      order({
        assignedDriver: {
          fullName: "أحمد",
          vehicleType: null,
          plateNumber: null,
          vehiclePhotoFileId: null,
          lastLocation: { ...DRIVER, recordedAt: new Date(now.getTime() - secondsAgo * 1000) },
        },
      }),
      now,
    );

  /**
   * الحدّ **هو** حدّ المجال لا رقمٌ ثانٍ. وهذا الاختبار يمنع ما يحدث عادةً بعد
   * أسابيع: يشتكي أحدٌ من «إزعاج التحذير» فيُرفع الحدّ هنا وحده، فيصير المشغّل
   * يرى سائقاً منقطعاً والعميل يرى موقعه معروضاً بلا تحفّظ — حكمان مختلفان على
   * الواقعة نفسها.
   */
  it("حدّ القدم هو نفسه حدّ جلسة التتبّع في المجال", () => {
    expect(DRIVER_LOCATION_STALE_SECONDS).toBe(DEFAULT_SESSION_POLICY.staleAfterSeconds);
  });

  it("على الحدّ تماماً لا يُعدّ قديماً، وثانيةٌ بعده يُعدّ", () => {
    expect(aged(DRIVER_LOCATION_STALE_SECONDS)?.stale).toBe(false);
    expect(aged(DRIVER_LOCATION_STALE_SECONDS + 1)?.stale).toBe(true);
  });

  it("عمر الموقع يُقاس بالثواني كما هو لا مقرَّباً إلى دقائق", () => {
    expect(aged(47)?.ageSeconds).toBe(47);
  });

  /**
   * ساعةُ جهاز السائق قد تسبق ساعتنا ثوانٍ — وهي حالٌ شائعةٌ في هواتفٍ لا تُزامن
   * وقتها. و«قبل ٣- ثانية» تُقرأ عطلاً في البوت لا حداثةً في الموقع.
   */
  it("موقعٌ مسجَّلٌ في مستقبلٍ قريب يُقرأ عمرُه صفراً لا سالباً", () => {
    const near = aged(-8);
    expect(near?.ageSeconds).toBe(0);
    expect(near?.stale).toBe(false);
  });
});
