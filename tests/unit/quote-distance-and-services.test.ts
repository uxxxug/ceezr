/**
 * الغرض: قياسُ حكمَي النطاقِ في شريحةِ الاقتباسِ — سياسةِ عرضِ المسافةِ الموسومةِ،
 *   وبناءِ بطاقاتِ الخدماتِ من قائمةِ المخدومِ — على حدودِهما لا على وسطِهما.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: إضافةُ الصنفِ `ROUTE` في `F2-06` — تُوجِبُ حالاتٍ ههنا.
 * ملاحظات مستقبلية: حدُّ الوحدةِ (متر/كيلومتر) مُثبَّتٌ ههنا **بعدَ التقريبِ**،
 *   وهيَ الحالةُ التي كشفَت عيباً حقيقيّاً: 980 متراً كانَ يُعرَضُ «1000 م».
 *
 * وما لا يفعلُه: لا يزعمُ أنَّ رقماً ظهرَ لمستخدمٍ — لا نشرَ حيَّ (`ADR 0099`).
 */

import { describe, expect, it } from "bun:test";
import {
  describeDistance,
  isMeasurableMeters,
  METERS_DISPLAY_CEILING,
  METERS_DISPLAY_STEP,
  type TaggedDistance,
} from "../../packages/domain/quote/distance-kind.ts";
import {
  hasAnyAvailable,
  isServiceKind,
  offersFromServed,
  SERVICE_KINDS,
} from "../../packages/domain/quote/service-offer.ts";

function straight(meters: number): TaggedDistance {
  return { kind: "STRAIGHT_LINE", meters };
}

describe("سياسةُ عرضِ المسافةِ — الوسمُ لا يُفصَلُ عن الرقمِ", () => {
  it("كلُّ عرضٍ يحملُ وسمَه: مسافةٌ بلا وسمٍ تُقرأُ طولَ طريقٍ", () => {
    for (const meters of [0, 250, 999, 1000, 7581.8, 42_000]) {
      expect(describeDistance(straight(meters))?.kind).toBe("STRAIGHT_LINE");
    }
  });

  it("دونَ الحدِّ: مترٌ مُقرَّبٌ إلى أقربِ مئةٍ", () => {
    expect(describeDistance(straight(249))).toEqual({
      key: "rider.quote.distanceMeters",
      value: 200,
      kind: "STRAIGHT_LINE",
    });
    expect(describeDistance(straight(250))?.value).toBe(300);
  });

  it("صفرٌ يُعرَضُ صفراً بالمترِ: القيمةُ مقيسةٌ لا مفقودةٌ", () => {
    expect(describeDistance(straight(0))).toEqual({
      key: "rider.quote.distanceMeters",
      value: 0,
      kind: "STRAIGHT_LINE",
    });
  });

  it("ما يُقرَّبُ إلى الحدِّ يسقطُ إلى الكيلومترِ: «1000 م» وحدةٌ مُخالِفةٌ للحدِّ", () => {
    const display = describeDistance(straight(980));
    expect(display?.key).toBe("rider.quote.distanceKilometers");
    expect(display?.value).toBe(1);
  });

  it("عندَ الحدِّ بالضبطِ: كيلومترٌ واحدٌ", () => {
    expect(describeDistance(straight(METERS_DISPLAY_CEILING))).toEqual({
      key: "rider.quote.distanceKilometers",
      value: 1,
      kind: "STRAIGHT_LINE",
    });
  });

  it("فوقَ الحدِّ: كيلومترٌ بعشريٍّ واحدٍ لا أكثرَ", () => {
    expect(describeDistance(straight(7581.8))?.value).toBe(7.6);
    expect(describeDistance(straight(42_000))?.value).toBe(42);
  });

  it("ما لا يُقاسُ يُعيدُ لا شيءَ لا صفراً: «صفرُ مترٍ» تُقرأُ «أنتَ هناكَ»", () => {
    for (const meters of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(describeDistance(straight(meters))).toBeNull();
      expect(isMeasurableMeters(meters)).toBe(false);
    }
  });

  it("ثابتا السياسةِ مُعلَنانِ ومُستخدَمانِ: لا رقمَ محفوراً في فرعٍ", () => {
    expect(METERS_DISPLAY_CEILING).toBe(1000);
    expect(METERS_DISPLAY_STEP).toBe(100);
  });
});

describe("بطاقاتُ الخدماتِ — التعذُّرُ مُصنَّفٌ لا مُجمَّعٌ", () => {
  it("كلُّ خدمةٍ تظهرُ بترتيبٍ ثابتٍ ولو لم تكن مخدومةً: الغيابُ خبرٌ لا فراغٌ", () => {
    const offers = offersFromServed([]);
    expect(offers.map((offer) => offer.service)).toEqual([...SERVICE_KINDS]);
    for (const offer of offers) {
      expect(offer.available).toBe(false);
      if (!offer.available) expect(offer.reason).toBe("NO_CAPABLE_DRIVER_IN_CITY");
    }
  });

  it("المخدومُ يُعلَّمُ متاحاً وغيرُه يحملُ سببَه", () => {
    const offers = offersFromServed(["transport"]);
    expect(offers.find((offer) => offer.service === "transport")?.available).toBe(true);
    const delivery = offers.find((offer) => offer.service === "delivery");
    expect(delivery?.available).toBe(false);
    if (delivery !== undefined && !delivery.available) {
      expect(delivery.reason).toBe("NO_CAPABLE_DRIVER_IN_CITY");
    }
  });

  it("خدمةٌ مجهولةٌ من القاعدةِ تُهمَلُ ولا تُخترَعُ بطاقةً: النطاقُ هوَ من يُعدِّدُ", () => {
    const offers = offersFromServed(["helicopter", "transport"]);
    expect(offers.length).toBe(SERVICE_KINDS.length);
    expect(offers.map((offer) => offer.service)).toEqual([...SERVICE_KINDS]);
  });

  it("التكرارُ لا يُضاعِفُ بطاقةً", () => {
    expect(offersFromServed(["transport", "transport"]).length).toBe(SERVICE_KINDS.length);
  });

  it("`hasAnyAvailable` تُجيبُ الشاشةَ سطراً واحداً", () => {
    expect(hasAnyAvailable(offersFromServed([]))).toBe(false);
    expect(hasAnyAvailable(offersFromServed(["delivery"]))).toBe(true);
  });

  it("`isServiceKind` تحرسُ حدَّ الثقةِ بما يأتي من القاعدةِ", () => {
    expect(isServiceKind("transport")).toBe(true);
    expect(isServiceKind("delivery")).toBe(true);
    expect(isServiceKind("Transport")).toBe(false);
    expect(isServiceKind("")).toBe(false);
  });
});
