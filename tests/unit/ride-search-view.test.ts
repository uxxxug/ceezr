/**
 * الغرض: قياسُ نموذجِ عرضِ البحثِ (`F2-05` · القسم 9.11): أنَّ كلَّ خَرْجٍ
 *   **مفتاحٌ** لا نصٌّ، وأنَّ الصفرَ مفتاحٌ خاصٌّ لا رقمٌ في قالبٍ (`ADR 0023`)،
 *   وأنَّ المدّةَ تُبنى على قياسِ القاعدةِ ثمَّ يُضافُ فارقٌ محليٌّ — فلا يُري
 *   انحرافُ ساعةِ الجهازِ انتظاراً لم يحدثْ، وأنَّ مفتاحَ التكرارِ يُولَّدُ بشكلٍ
 *   يقبلُه النطاقُ ولا يُشتقُّ من الوقتِ وحدَه.
 * الحالة: اختبار فعلي — دالّاتٌ نقيّةٌ بلا JSX ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-06` تُعيدُ استعمالَ الدالّاتِ نفسِها.
 * ملاحظات مستقبلية: كلُّ رمزِ رفضٍ يُضافُ إلى الهجرةِ يُلزَمُ بمفتاحٍ ههنا آليّاً
 *   في `scripts/check-ride-request-contract.ts` — وهذا الملفُّ يقيسُ الهبوطَ
 *   الآمِنَ لِما لا يُعرَفُ.
 *
 * وما لا يُقاسُ: لا يُقاسُ أنَّ النصَّ مفهومٌ — الترجمةُ وجودٌ مفروضٌ لا فصاحةٌ
 * مقيسةٌ؛ ولا يُقاسُ أنَّ مستخدماً رأى الشاشةَ: لا نشرَ حيَّ (`ADR 0099`).
 */

import { describe, expect, it } from "bun:test";
import {
  cancelRefusalKey,
  elapsedSecondsFor,
  elapsedSecondsFromBirth,
  elapsedText,
  isRetryableRideError,
  newIdempotencyKey,
  notifiedLine,
  rideErrorKey,
  rideRefusalKey,
  rideStatusKey,
  searchPhaseKey,
  searchRefusalKey,
} from "../../apps/miniapp/src/surfaces/rider/search/search-view.ts";
import { readIdempotencyKey } from "../../packages/domain/transport/ride-request.ts";

describe("الحالةُ والطورُ — مفاتيحُ لا رموزٌ خامّةٌ", () => {
  it("كلُّ حالةٍ معروفةٍ مفتاحُها، والمجهولةُ مفتاحٌ عامٌّ لا رمزٌ خامٌّ", () => {
    expect(rideStatusKey("searching")).toBe("rider.search.status.searching");
    expect(rideStatusKey("in_progress")).toBe("rider.search.status.in_progress");
    expect(rideStatusKey("teleported")).toBe("rider.search.status.unknown");
  });

  it("الأطوارُ الأربعةُ ومجهولُها", () => {
    expect(searchPhaseKey("silent")).toBe("rider.search.phase.silent");
    expect(searchPhaseKey("announced")).toBe("rider.search.phase.announced");
    expect(searchPhaseKey("assigned")).toBe("rider.search.phase.assigned");
    expect(searchPhaseKey("closed")).toBe("rider.search.phase.closed");
    expect(searchPhaseKey("pending")).toBe("rider.search.phase.unknown");
  });
});

describe("سطرُ المبلَّغينَ — الصفرُ مفتاحٌ خاصٌّ", () => {
  it("الصفرُ يُقالُ «لم يُبلَّغْ أحدٌ بعدُ» بمفتاحٍ آخرَ لا برقمٍ في قالبٍ", () => {
    expect(notifiedLine(0)).toEqual({ key: "rider.search.notified.zero", count: 0 });
  });

  it("العددُ يُعرَضُ صحيحاً مُقتَطَعاً", () => {
    expect(notifiedLine(3)).toEqual({ key: "rider.search.notified.count", count: 3 });
    expect(notifiedLine(2.9)).toEqual({ key: "rider.search.notified.count", count: 2 });
  });

  it("السالبُ وغيرُ المنتهي يهبطانِ إلى الصفرِ لا إلى نصٍّ مكسورٍ", () => {
    expect(notifiedLine(-4)).toEqual({ key: "rider.search.notified.zero", count: 0 });
    expect(notifiedLine(Number.NaN)).toEqual({ key: "rider.search.notified.zero", count: 0 });
  });
});

describe("نصُّ المدّةِ — مفتاحٌ يختلفُ دونَ الدقيقةِ", () => {
  it("ما دونَ الدقيقةِ مفتاحُ ثوانٍ: «0 دقيقة و9 ثوانٍ» عبارةٌ ركيكةٌ", () => {
    expect(elapsedText(9)).toEqual({ key: "rider.search.elapsedSeconds", minutes: 0, seconds: 9 });
  });

  it("الدقيقةُ الكاملةُ تُبدِّلُ المفتاحَ وتُقسَّمُ", () => {
    expect(elapsedText(60)).toEqual({ key: "rider.search.elapsedMinutes", minutes: 1, seconds: 0 });
    expect(elapsedText(185)).toEqual({
      key: "rider.search.elapsedMinutes",
      minutes: 3,
      seconds: 5,
    });
  });

  it("السالبُ صفرٌ لا نصٌّ سالبٌ", () => {
    expect(elapsedText(-30)).toEqual({
      key: "rider.search.elapsedSeconds",
      minutes: 0,
      seconds: 0,
    });
  });
});

describe("المدّةُ المعروضةُ — قياسُ القاعدةِ زائدَ فارقٍ محليٍّ", () => {
  it("فارقُ لحظتَينِ من الساعةِ نفسِها يُضافُ إلى ما قاسَته القاعدةُ", () => {
    expect(
      elapsedSecondsFor({ serverElapsedSeconds: 42, measuredAtMs: 10_000, nowMs: 17_000 }),
    ).toBe(49);
  });

  it("انحرافُ ساعةِ الجهازِ لا يُضخِّمُ المدّةَ: الأساسُ من القاعدةِ", () => {
    // ساعةُ الجهازِ متأخِّرةٌ فيُقرأُ الفارقُ سالباً — فيُقرأُ صفراً ويبقى الأساسُ.
    expect(
      elapsedSecondsFor({ serverElapsedSeconds: 120, measuredAtMs: 50_000, nowMs: 10_000 }),
    ).toBe(120);
  });

  it("قياسٌ غيرُ منتهٍ أو سالبٌ من القاعدةِ يُقرأُ صفراً ولا يُسقِطُ السطرَ", () => {
    expect(
      elapsedSecondsFor({ serverElapsedSeconds: Number.NaN, measuredAtMs: 0, nowMs: 3_000 }),
    ).toBe(3);
    expect(elapsedSecondsFor({ serverElapsedSeconds: -9, measuredAtMs: 0, nowMs: 0 })).toBe(0);
  });

  it("قبلَ أوّلِ قراءةٍ تُقاسُ المدّةُ من ختمِ الميلادِ — لا من فتحِ الشاشةِ", () => {
    expect(elapsedSecondsFromBirth(1_000_000, 1_420_000)).toBe(420);
  });
});

describe("ترجمةُ الرفضِ والعطبِ — ولا رمزٌ يتيمٌ يُعرَضُ", () => {
  it("رفضُ الإنشاءِ يُترجَمُ بسببِه المحدَّدِ لا بعبارةٍ جامعةٍ", () => {
    expect(rideRefusalKey("ORIGIN_OUTSIDE_SERVICE_AREA")).toBe(
      "rider.search.refused.originOutside",
    );
    expect(rideRefusalKey("DESTINATION_OUTSIDE_SERVICE_AREA")).toBe(
      "rider.search.refused.destinationOutside",
    );
    expect(rideRefusalKey("ACTIVE_RIDE_EXISTS")).toBe("rider.search.refused.activeRide");
    // الخطوةُ ٨: «لم تُفتَحْ في مدينتِك» ليسَ «تعذَّرَ الطلبُ» — والفرقُ
    // أنَّ الأوّلَ يُخبِرُ الراكبَ بما لا سبيلَ له إلى إصلاحِه فيكُفُّ، والثاني
    // يدعوهُ إلى إعادةٍ لا تُجدي (`ADR 0023`).
    expect(rideRefusalKey("CITY_NOT_ACTIVE")).toBe("rider.search.refused.cityNotActive");
    expect(rideRefusalKey("SOMETHING_NEW")).toBe("rider.search.refused.unknown");
  });

  it("القراءةُ والإلغاءُ يُفرَّقُ بينَ «غيرُ موجودةٍ» و«فاتَ وقتُها»", () => {
    expect(searchRefusalKey("ORDER_NOT_FOUND")).toBe("rider.search.read.notFound");
    expect(cancelRefusalKey("ORDER_NOT_FOUND")).toBe("rider.search.cancel.notFound");
    expect(cancelRefusalKey("ORDER_NOT_CANCELLABLE")).toBe("rider.search.cancel.notCancellable");
    expect(cancelRefusalKey("WHATEVER")).toBe("rider.search.cancel.unknown");
  });

  it("عطبُ الجلسةِ يُقالُ جلسةً، ونقصُ الحسابِ يُقالُ حساباً (`ADR 0035`)", () => {
    for (const code of ["SESSION_REQUIRED", "SESSION_INVALID", "SESSION_EXPIRED"]) {
      expect(rideErrorKey(code)).toBe("rider.search.error.session");
    }
    expect(rideErrorKey("ACCOUNT_NOT_FOUND")).toBe("rider.search.error.account");
    expect(rideErrorKey("RIDER_NOT_REGISTERED")).toBe("rider.search.error.notRegistered");
    expect(rideErrorKey("BRAND_NEW_CODE")).toBe("rider.search.error.unavailable");
  });

  it("إعادةُ المحاولةِ تُعرَضُ لِما يتغيَّرُ وحدَه", () => {
    expect(isRetryableRideError("RIDE_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableRideError("HTTP_ERROR")).toBe(true);
    expect(isRetryableRideError("SESSION_INVALID")).toBe(false);
    expect(isRetryableRideError("ACCOUNT_NOT_FOUND")).toBe(false);
  });
});

describe("مفتاحُ التكرارِ — شكلٌ يقبلُه النطاقُ ولا يُشتقُّ من الوقتِ وحدَه", () => {
  it("المُولَّدُ يمرُّ على قارئِ النطاقِ نفسِه: حاجزانِ لا يتناقضانِ", () => {
    const key = newIdempotencyKey();
    expect(key.startsWith("ride:")).toBe(true);
    expect(readIdempotencyKey(key)).toEqual({ key });
  });

  it("مصدرُ العشوائيّةِ يُحقَنُ فيُقاسُ الشكلُ لا الحظُّ", () => {
    expect(newIdempotencyKey(() => "6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60")).toBe(
      "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60",
    );
  });

  it("نداءانِ متتابعانِ لا يُنتِجانِ المفتاحَ نفسَه: ضغطتانِ في مِلّي ثانيةٍ", () => {
    const keys = new Set([newIdempotencyKey(), newIdempotencyKey(), newIdempotencyKey()]);
    expect(keys.size).toBe(3);
  });
});
