/**
 * الغرض: اختبار مهلة قبول العرض ومن يُستبعد من دورة البثّ التالية.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: الإلغاء الفعلي يتم بالدالة الذرّية expire_stale_offers، وهذا يختبر القرار فقط.
 */
import { describe, expect, it } from "bun:test";
import {
  driversToExclude,
  isOfferExpired,
  type Offer,
  type OfferStatus,
  offerExpiresAt,
  secondsRemaining,
} from "../../packages/domain/dispatch/value-objects.ts";
import type { DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

const ORDER = "order-1" as OrderId;
const TIMEOUT = 45; // من platform_settings.offer_timeout_seconds المبذور
const SENT = new Date("2026-08-06T12:00:00.000Z");

function offer(driverId: string, status: OfferStatus, sentAt: Date = SENT): Offer {
  return { orderId: ORDER, driverId: driverId as DriverId, status, sentAt, round: 1 };
}

describe("offerExpiresAt", () => {
  it("يضيف المهلة بالثواني إلى لحظة الإرسال", () => {
    expect(offerExpiresAt(offer("d1", "pending"), TIMEOUT).toISOString()).toBe(
      "2026-08-06T12:00:45.000Z",
    );
  });
});

describe("isOfferExpired", () => {
  it("غير منتهٍ قبل المهلة بثانية", () => {
    expect(
      isOfferExpired(offer("d1", "pending"), TIMEOUT, new Date("2026-08-06T12:00:44.000Z")),
    ).toBe(false);
  });
  it("منتهٍ عند بلوغ المهلة بالضبط", () => {
    expect(
      isOfferExpired(offer("d1", "pending"), TIMEOUT, new Date("2026-08-06T12:00:45.000Z")),
    ).toBe(true);
  });
  it("العرض المقبول لا تنتهي مهلته", () => {
    expect(
      isOfferExpired(offer("d1", "accepted"), TIMEOUT, new Date("2026-08-06T13:00:00.000Z")),
    ).toBe(false);
  });
  it("تغيير المهلة في الإعدادات يغيّر النتيجة فعلياً", () => {
    const at30s = new Date("2026-08-06T12:00:30.000Z");
    expect(isOfferExpired(offer("d1", "pending"), 45, at30s)).toBe(false);
    expect(isOfferExpired(offer("d1", "pending"), 20, at30s)).toBe(true);
  });
});

describe("secondsRemaining", () => {
  it("المهلة كاملة عند لحظة الإرسال", () => {
    expect(secondsRemaining(offer("d1", "pending"), TIMEOUT, SENT)).toBe(45);
  });
  it("لا يعيد رقماً سالباً بعد انتهاء المهلة", () => {
    expect(
      secondsRemaining(offer("d1", "pending"), TIMEOUT, new Date("2026-08-06T12:05:00.000Z")),
    ).toBe(0);
  });
});

describe("driversToExclude", () => {
  const now = new Date("2026-08-06T12:00:30.000Z");

  it("يستبعد الرافض والملغى استبعاداً دائماً", () => {
    const offers = [offer("rejecter", "rejected"), offer("cancelled-one", "cancelled")];
    expect(driversToExclude(offers, TIMEOUT, now).map(String).sort()).toEqual([
      "cancelled-one",
      "rejecter",
    ]);
  });

  /**
   * المرحلة ١٤ — الصمتُ ليس رفضاً. كان `expired` يُستبعَد استبعاداً دائماً، فكانت
   * هذه القاعدةُ تُناقض القاعدةَ التي تحتها («لا يستبعد من انتهت مهلته المعلَّقة»):
   * السائقُ نفسه بالسلوك نفسه يُستبعَد أو لا يُستبعَد بحسب أَجَرَت مهمّةُ
   * `expire-offers` شوطَها أم لا. وقيسَ الأثر: سائقٌ واحدٌ في المدينة تجاهل عرضاً
   * فصار الطلبُ لا يُبَثّ إليه أبداً و`max_broadcast_rounds = 3` بلا معنى.
   */
  it("لا يستبعد من انتهت مهلته دائماً — الصمت ليس رفضاً فيعود مؤهّلاً لدورة جديدة", () => {
    expect(driversToExclude([offer("silent", "expired")], TIMEOUT, now)).toEqual([]);
  });

  it("انتهاءُ المهلة لا يُنجّي من رفضٍ صريحٍ في دورةٍ أخرى", () => {
    const offers = [offer("d1", "expired"), { ...offer("d1", "rejected"), round: 2 }];
    expect(driversToExclude(offers, TIMEOUT, now)).toEqual(["d1" as DriverId]);
  });

  it("يستبعد من لديه عرض معلَّق ما زال سارياً — منعاً لعرضين على سائق واحد", () => {
    expect(driversToExclude([offer("busy", "pending")], TIMEOUT, now)).toEqual([
      "busy" as DriverId,
    ]);
  });

  it("لا يستبعد من انتهت مهلته المعلَّقة فعلياً فيصبح متاحاً لدورة جديدة", () => {
    const stale = offer("stale", "pending", new Date("2026-08-06T11:59:00.000Z"));
    expect(driversToExclude([stale], TIMEOUT, now)).toEqual([]);
  });

  it("لا يكرّر السائق إن كان له عرضان في دورتين", () => {
    const offers = [offer("d1", "rejected"), { ...offer("d1", "rejected"), round: 2 }];
    expect(driversToExclude(offers, TIMEOUT, now)).toHaveLength(1);
  });

  it("قائمة فارغة لا تستبعد أحداً", () => {
    expect(driversToExclude([], TIMEOUT, now)).toEqual([]);
  });
});
