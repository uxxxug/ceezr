/**
 * الغرض: قياسُ نموذجِ عرضِ الاقتباسِ — أنَّ كلَّ ردٍّ من الخادمِ يُترجَمُ مفاتيحَ
 *   ونصوصاً قابلةً للقراءةِ، وأنَّ **المجهولَ لا يُبيِّضُ شاشةً ولا يُعرَضُ خاماً**،
 *   وأنَّ فعلَ التصحيحِ يُقابِلُ سببَ الرفضِ لا يُوحَّدُ معَه (البند `F2-04`).
 * الحالة: اختبار فعلي — دالّاتٌ نقيّةٌ تُستدعى مباشرةً بلا شبكةٍ ولا DOM.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُعيدُ استخدامَ البطاقاتِ نفسِها.
 * ملاحظات مستقبلية: الرمزُ المجهولُ من خادمٍ أحدثَ من العميلِ **حالةٌ مُتوقَّعةٌ**
 *   لا احتياطٌ: عميلُ تلغرام لا يُحدَّثُ لحظةَ نشرِ الخادمِ.
 *
 * وما لا يفعلُه: لا يُثبِتُ أنَّ المفاتيحَ مترجَمةٌ — ذاكَ حكمُ حاجزِ العقدِ على
 * القواميسِ الثلاثةِ؛ ولا يزعمُ أنَّ شاشةً ظهرَت لمستخدمٍ (`ADR 0099`).
 */

import { describe, expect, it } from "bun:test";
import {
  distanceLine,
  durationLine,
  isRetryableQuoteError,
  quoteErrorKey,
  quoteRefusalKey,
  refusalRemedy,
  serviceCards,
} from "../../apps/miniapp/src/surfaces/rider/quote/quote-view.ts";
import arabic from "../../packages/shared/i18n/miniapp/ar.json";

const DICTIONARY = arabic as Record<string, string>;

/** كلُّ مفتاحٍ يُعيدُه النموذجُ يجبُ أن يُوجَدَ نصُّه: مفتاحٌ خامٌّ شاشةٌ مكسورةٌ. */
function expectTranslated(key: string): void {
  expect(typeof DICTIONARY[key]).toBe("string");
  expect((DICTIONARY[key] ?? "").trim().length).toBeGreaterThan(0);
}

describe("سطرُ المسافةِ", () => {
  it("يُعيدُ مفتاحاً وقيمةً **ووسمَ الصنفِ** معاً", () => {
    const line = distanceLine({ kind: "STRAIGHT_LINE", meters: 7581.8 });
    expect(line).toEqual({
      key: "rider.quote.distanceKilometers",
      value: 7.6,
      kindKey: "rider.quote.distance.straightLine",
    });
    expectTranslated(line?.key as string);
    expectTranslated(line?.kindKey as string);
  });

  it("وسمٌ مجهولٌ يُسقِطُ السطرَ كلَّه ولا يُعرَضُ رقماً بلا وسمٍ", () => {
    expect(distanceLine({ kind: "ROUTE", meters: 1200 })).toBeNull();
    expect(distanceLine({ kind: "", meters: 1200 })).toBeNull();
  });

  it("قيمةٌ غيرُ مقيسةٍ تُسقِطُ السطرَ: والشاشةُ تعرضُ «غيرُ متاحةٍ» بنصٍّ مُترجَمٍ", () => {
    expect(distanceLine({ kind: "STRAIGHT_LINE", meters: Number.NaN })).toBeNull();
    expectTranslated("rider.quote.distance.unavailable");
  });
});

describe("سطرُ المدّةِ", () => {
  it("المدّةُ المُوجَّهةُ تُعرَضُ دقائقَ كما حكمَ النطاقُ", () => {
    expect(
      durationLine({
        kind: "ROUTED",
        seconds: 900,
        minutes: 15,
        distanceMeters: 8000,
        source: "osrm",
      }),
    ).toEqual({ kind: "ROUTED", minutes: 15 });
    expectTranslated("rider.quote.durationMinutes");
  });

  it("كلُّ سببِ امتناعٍ يُصنَّفُ بمفتاحِه المُترجَمِ ولا يُوحَّدُ", () => {
    const reasons = [
      "NOT_CONFIGURED",
      "PROVIDER_DOWN",
      "NO_ROUTE",
      "OFF_ROAD",
      "SNAP_UNKNOWN",
      "IMPLAUSIBLE",
      "NO_INPUT",
    ] as const;
    const keys = new Set<string>();
    for (const reason of reasons) {
      const line = durationLine({ kind: "UNAVAILABLE", reason });
      expect(line.kind).toBe("UNAVAILABLE");
      if (line.kind === "UNAVAILABLE") {
        keys.add(line.reasonKey);
        expectTranslated(line.reasonKey);
      }
    }
    // سبعةُ أسبابٍ وسبعةُ مفاتيحَ: توحيدُ اثنَينِ يُضيِّعُ فعلَ التصحيحِ.
    expect(keys.size).toBe(reasons.length);
  });

  it("سببٌ مجهولٌ يهبطُ إلى مفتاحٍ عامٍّ مُترجَمٍ لا إلى رمزٍ خامٍّ", () => {
    const line = durationLine({ kind: "UNAVAILABLE", reason: "FUTURE_REASON" });
    if (line.kind === "UNAVAILABLE") {
      expect(line.reasonKey).toBe("rider.quote.duration.unknown");
      expectTranslated(line.reasonKey);
    }
  });
});

describe("بطاقاتُ الخدماتِ", () => {
  it("المتاحُ بلا سببٍ والمتعذِّرُ بسببِه المُترجَمِ", () => {
    const cards = serviceCards([
      { service: "transport", available: true },
      { service: "delivery", available: false, reason: "NO_CAPABLE_DRIVER_IN_CITY" },
    ]);
    expect(cards.length).toBe(2);
    expect(cards[0]).toEqual({
      service: "transport",
      labelKey: "rider.quote.service.transport",
      available: true,
      reasonKey: null,
    });
    expect(cards[1]?.reasonKey).toBe("rider.quote.service.noCapableDriver");
    for (const card of cards) {
      expectTranslated(card.labelKey);
      if (card.reasonKey !== null) expectTranslated(card.reasonKey);
    }
  });

  it("خدمةٌ لا يعرفُها العميلُ تُطرَحُ ولا تُعرَضُ برمزٍ خامٍّ", () => {
    const cards = serviceCards([
      { service: "courier", available: true },
      { service: "transport", available: true },
    ]);
    expect(cards.map((card) => card.service)).toEqual(["transport"]);
  });

  it("سببٌ مجهولٌ لخدمةٍ معروفةٍ يهبطُ إلى مفتاحٍ عامٍّ", () => {
    const cards = serviceCards([
      { service: "delivery", available: false, reason: "FUTURE_REASON" },
    ]);
    expect(cards[0]?.reasonKey).toBe("rider.quote.service.unavailable");
    expectTranslated("rider.quote.service.unavailable");
  });
});

describe("الرفضُ وفعلُ التصحيحِ", () => {
  it("كلُّ رمزِ رفضٍ مُعلَنٍ له مفتاحُه المُترجَمُ المستقلُّ", () => {
    const codes = [
      "INVALID_POINT",
      "CITY_HAS_NO_SERVICE_AREA",
      "ORIGIN_OUTSIDE_SERVICE_AREA",
      "DESTINATION_OUTSIDE_SERVICE_AREA",
    ] as const;
    const keys = new Set(codes.map((code) => quoteRefusalKey(code)));
    expect(keys.size).toBe(codes.length);
    for (const key of keys) expectTranslated(key);
  });

  it("رمزٌ مجهولٌ يهبطُ إلى مفتاحٍ عامٍّ مُترجَمٍ", () => {
    expect(quoteRefusalKey("FUTURE_CODE")).toBe("rider.quote.refused.unknown");
    expectTranslated("rider.quote.refused.unknown");
  });

  it("فعلُ التصحيحِ يُقابِلُ السببَ: ولا زرَّ لِما لا يُصلِحُه الراكبُ", () => {
    expect(refusalRemedy("ORIGIN_OUTSIDE_SERVICE_AREA")).toBe("RELOCATE");
    expect(refusalRemedy("INVALID_POINT")).toBe("RELOCATE");
    expect(refusalRemedy("DESTINATION_OUTSIDE_SERVICE_AREA")).toBe("PICK_ANOTHER_DESTINATION");
    // مدينةٌ بلا حدٍّ مرسومٍ: لا يُصلِحُها الراكبُ أبداً، فلا يُشغَلُ بزرٍّ.
    expect(refusalRemedy("CITY_HAS_NO_SERVICE_AREA")).toBe("NONE");
    expect(refusalRemedy("FUTURE_CODE")).toBe("NONE");
    expectTranslated("rider.quote.remedy.relocate");
    expectTranslated("rider.quote.remedy.pickAnother");
  });
});

describe("العطبُ وإعادةُ المحاولةِ", () => {
  it("كلُّ رمزِ عطبٍ يُنشَرُ له مفتاحٌ مُترجَمٌ", () => {
    for (const code of [
      "SESSION_REQUIRED",
      "SESSION_INVALID",
      "SESSION_EXPIRED",
      "SESSION_NOT_AVAILABLE",
      "MALFORMED",
      "ACCOUNT_NOT_FOUND",
      "QUOTE_STORE_NOT_AVAILABLE",
      "FUTURE_CODE",
    ]) {
      expectTranslated(quoteErrorKey(code));
    }
  });

  it("الجلسةُ الساقطةُ لا تُعادُ محاولتُها وتعذُّرُ التبعيةِ يُعادُ", () => {
    expect(isRetryableQuoteError("SESSION_EXPIRED")).toBe(false);
    expect(isRetryableQuoteError("MALFORMED")).toBe(false);
    expect(isRetryableQuoteError("ACCOUNT_NOT_FOUND")).toBe(false);
    expect(isRetryableQuoteError("QUOTE_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableQuoteError("SESSION_NOT_AVAILABLE")).toBe(true);
    expectTranslated("rider.quote.retry");
  });
});
