/**
 * الغرض: قياسُ نموذجِ عرضِ المشاركةِ — المتبقّي، وسطرُ المعاينةِ، ومفاتيحُ
 *   الرفضِ والخطأِ، وحجبُ ما خرقَ العقدَ (البند `F2-09` · `SR-13`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إذ يُعيدُ استعمالَ صياغةِ المدّةِ.
 *
 * ولماذا يُقاسُ النموذجُ لا المكوّنُ: `RideShareCard.tsx` رسمٌ، والحكمُ كلُّه
 * ههنا في دالّاتٍ نقيّةٍ — فيُقاسُ الحكمُ حيثُ هوَ لا حيثُ يُعرَضُ.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ نصٌّ عربيٌّ**: المقيسُ مفتاحٌ، والنصُّ في `packages/shared/i18n`
 *    ووجودُه في الألسنةِ الثلاثةِ يُقاسُ في `scripts/check-ride-share-contract.ts`.
 * ــ **لا يُقاسُ انقضاءُ الوقتِ**: لا ساعةَ في المِلفِّ — الرقمُ يصلُ من القاعدةِ.
 */

import { describe, expect, it } from "bun:test";
import type {
  ApiShareLifetime,
  ApiSharePreview,
} from "../../apps/miniapp/src/surfaces/rider/share/ride-share-contract.ts";
import {
  disclosureKey,
  isRetryableShareError,
  lifetimeLine,
  previewLine,
  readRefusalKey,
  remainingText,
  shareErrorKey,
  startRefusalKey,
} from "../../apps/miniapp/src/surfaces/rider/share/ride-share-view.ts";

function lifetime(over: Partial<ApiShareLifetime> = {}): ApiShareLifetime {
  return {
    verdict: "LIVE_RIDE_ACTIVE",
    secondsRemaining: null,
    graceMinutes: 15,
    graceSource: "SETTING",
    ...over,
  };
}

/**
 * **`F12-04`** — وكانَ ههنا قياسٌ على `isLiveRemaining`: حكمٌ بالحياةِ من
 * **بقيّةِ السقفِ**. والدعوى التي كانَ يحملُها — «صفرٌ لا يُقرأُ عاملاً» —
 * باقيةٌ أدناهُ في `rider.share.until.ended`، وقد صارت تُقاسُ على الحكمِ الصادقِ
 * لا على رقمٍ يُقارَنُ بالصفرِ (`ADR 0146`).
 */
describe("سطرُ حياةِ المشاركةِ", () => {
  it("رحلةٌ جاريةٌ: جملةٌ بلا عدٍّ تنازليٍّ، ومهلةٌ معلومةٌ بقيمةِ المدينةِ", () => {
    expect(lifetimeLine(lifetime())).toEqual({
      key: "rider.share.until.rideEnds",
      minutes: 15,
      seconds: 0,
    });
  });

  it("مهلةٌ جاريةٌ: عدٌّ تنازليٌّ إلى الموعدِ الحقيقيِّ لا إلى السقفِ", () => {
    expect(lifetimeLine(lifetime({ verdict: "LIVE_GRACE", secondsRemaining: 605 }))).toEqual({
      key: "rider.share.until.grace",
      minutes: 10,
      seconds: 5,
    });
  });

  it("انقضاءٌ: يُقالُ «انتهَت» صريحاً ولا يُعرَضُ رقمٌ يُقرأُ وعداً", () => {
    expect(lifetimeLine(lifetime({ verdict: "EXPIRED_RIDE_ENDED" }))).toEqual({
      key: "rider.share.until.ended",
      minutes: 0,
      seconds: 0,
    });
  });

  // حكمٌ جديدٌ في القاعدةِ **لا يُبيِّضُ شاشةً ولا يُنشَرُ رمزاً خاماً**.
  it("حكمٌ لا تعرفُه النسخةُ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً", () => {
    expect(lifetimeLine(lifetime({ verdict: "SOMETHING_NEW" })).key).toBe(
      "rider.share.until.unknown",
    );
  });

  it("مهلةٌ مشوَّهةٌ أو سالبةٌ تُطوى إلى صفرٍ ولا تُنشَرُ رقماً سالباً", () => {
    expect(lifetimeLine(lifetime({ graceMinutes: -5 })).minutes).toBe(0);
    expect(lifetimeLine(lifetime({ graceMinutes: Number.NaN })).minutes).toBe(0);
    expect(lifetimeLine(lifetime({ verdict: "LIVE_GRACE", secondsRemaining: -90 })).seconds).toBe(
      0,
    );
  });
});

describe("المتبقّي", () => {
  it("دونَ الدقيقةِ يُقالُ بالثواني كي لا يُقرأَ «٠»", () => {
    expect(remainingText(45)).toEqual({
      key: "rider.share.remainingSeconds",
      minutes: 0,
      seconds: 45,
    });
  });

  it("فوقَ الدقيقةِ يُقالُ بالدقائقِ وبثانيةٍ باقيةٍ", () => {
    expect(remainingText(605)).toEqual({
      key: "rider.share.remainingMinutes",
      minutes: 10,
      seconds: 5,
    });
  });

  it("سالبٌ أو مشوَّهٌ يُطوى إلى صفرٍ ولا يُنشَرُ رقماً سالباً في الشاشةِ", () => {
    expect(remainingText(-90).minutes).toBe(0);
    expect(remainingText(-90).seconds).toBe(0);
    expect(remainingText(Number.NaN).seconds).toBe(0);
  });
});

function preview(over: Record<string, unknown>): ApiSharePreview {
  return {
    active: true,
    maxAgeSeconds: 90,
    maxAgeSource: "SETTING",
    ...over,
  } as ApiSharePreview;
}

describe("سطرُ المعاينةِ", () => {
  it("نقطةٌ حاضرةٌ تُعرَضُ بإحداثيّتِها وعُمرِها", () => {
    const line = previewLine(
      preview({ verdict: "LOCATED", lat: 21.49, lng: 39.19, ageSeconds: 12 }),
    );
    expect(line).toEqual({
      show: true,
      lat: 21.49,
      lng: 39.19,
      ageKey: "rider.share.preview.ageSeconds",
      ageMinutes: 0,
      ageSeconds: 12,
    });
  });

  it("عُمرٌ فوقَ الدقيقةِ يُقالُ بالدقائقِ", () => {
    const line = previewLine(
      preview({ verdict: "LOCATED", lat: 21.49, lng: 39.19, ageSeconds: 185 }),
    );
    if (!line.show) throw new Error("سطرٌ غيرُ متوقَّعٍ");
    expect(line.ageKey).toBe("rider.share.preview.ageMinutes");
    expect(line.ageMinutes).toBe(3);
    expect(line.ageSeconds).toBe(5);
  });

  it("كلُّ حكمٍ محجوبٍ لهُ سببُه مكتوباً لا صمتاً", () => {
    expect(previewLine(preview({ verdict: "NEVER_REPORTED", ageSeconds: null }))).toEqual({
      show: false,
      key: "rider.share.preview.neverReported",
    });
    expect(previewLine(preview({ verdict: "NO_TIMESTAMP", ageSeconds: null }))).toEqual({
      show: false,
      key: "rider.share.preview.noTimestamp",
    });
    expect(previewLine(preview({ verdict: "TOO_OLD", ageSeconds: 400 }))).toEqual({
      show: false,
      key: "rider.share.preview.tooOld",
    });
  });

  // خرقُ العقدِ يأتي من فوقُ (خادمٌ قديمٌ، أو حمولةٌ مُعدَّلةٌ): والمطلوبُ
  // **حجبٌ لا ترقيعٌ** — نقطةٌ مُخترَعةٌ تُري صاحبَها موضعاً ليسَ موضعَ سائقِه.
  it("«موجودٌ» بلا إحداثيّةٍ يُحجَبُ ولا يُرقَّعُ بصفرٍ", () => {
    for (const broken of [
      { verdict: "LOCATED", lng: 39.19, ageSeconds: 5 },
      { verdict: "LOCATED", lat: 21.49, ageSeconds: 5 },
      { verdict: "LOCATED", lat: 21.49, lng: 39.19 },
      { verdict: "LOCATED", lat: "21.49", lng: 39.19, ageSeconds: 5 },
    ]) {
      const line = previewLine(preview(broken));
      expect(line.show).toBe(false);
      if (!line.show) expect(line.key).toBe("rider.share.preview.unknown");
    }
  });

  it("حكمٌ مجهولٌ يُقالُ مفتاحاً عامّاً لا رمزاً خاماً في الشاشةِ", () => {
    const line = previewLine(preview({ verdict: "SOMETHING_NEW", ageSeconds: null }));
    expect(line).toEqual({ show: false, key: "rider.share.preview.unknown" });
  });

  it("إحداثيّةٌ صفرٌ إحداثيّةٌ صحيحةٌ ولا تُقرأُ غياباً", () => {
    const line = previewLine(preview({ verdict: "LOCATED", lat: 0, lng: 0, ageSeconds: 0 }));
    expect(line.show).toBe(true);
  });
});

describe("مفاتيحُ الرفضِ والخطأِ", () => {
  it("لكلِّ رفضِ إصدارٍ نصُّه، والمجهولُ يُقالُ مجهولاً", () => {
    expect(startRefusalKey("ORDER_NOT_FOUND")).toBe("rider.share.refusal.notFound");
    expect(startRefusalKey("RIDE_NOT_ACTIVE")).toBe("rider.share.refusal.notActive");
    expect(startRefusalKey("LINK_COLLISION")).toBe("rider.share.refusal.collision");
    expect(startRefusalKey("WHATEVER")).toBe("rider.share.refusal.unknown");
  });

  it("«ليست لكَ» و«لا وجودَ» نصٌّ واحدٌ — الفرقُ يُخبِرُ المُجرِّبَ بوجودِها", () => {
    expect(readRefusalKey("ORDER_NOT_FOUND")).toBe("rider.share.refusal.notFound");
    expect(readRefusalKey("INVALID_ORDER_ID")).toBe("rider.share.refusal.invalidId");
  });

  // «حدثَ خطأٌ» على ميزةٍ مُطفأةٍ **كذبٌ** يُرسِلُ صاحبَه يُعيدُ المحاولةَ أبداً.
  it("الميزةُ المُطفأةُ تُقالُ مُطفأةً لا «خطأً»", () => {
    expect(shareErrorKey("SHARING_NOT_CONFIGURED")).toBe("rider.share.error.notConfigured");
    expect(shareErrorKey("SHARING_NOT_CONFIGURED")).not.toBe("rider.share.error.unknown");
  });

  it("الجلسةُ صنفٌ، والعطلُ صنفٌ، وما سواهُما مجهولٌ", () => {
    for (const code of ["SESSION_REQUIRED", "SESSION_EXPIRED", "SESSION_INVALID"]) {
      expect(shareErrorKey(code)).toBe("rider.share.error.session");
    }
    for (const code of ["RIDE_STORE_NOT_AVAILABLE", "SESSION_NOT_AVAILABLE"]) {
      expect(shareErrorKey(code)).toBe("rider.share.error.unavailable");
    }
    expect(shareErrorKey("ACCOUNT_NOT_FOUND")).toBe("rider.share.error.unknown");
  });

  it("زرُّ الإعادةِ لعطلِ خدمةٍ وحدَه — ولا يُعرَضُ لجلسةٍ منتهيةٍ", () => {
    expect(isRetryableShareError("RIDE_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableShareError("SESSION_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableShareError("SESSION_EXPIRED")).toBe(false);
    expect(isRetryableShareError("SHARING_NOT_CONFIGURED")).toBe(false);
  });
});

describe("مفاتيحُ الإفصاحِ", () => {
  it("كلُّ رمزٍ يُنسَبُ إلى موضعِه في القاموسِ حرفاً", () => {
    expect(disclosureKey("DRIVER_POSITION")).toBe("rider.share.disclosure.DRIVER_POSITION");
    expect(disclosureKey("RIDER_PHONE")).toBe("rider.share.disclosure.RIDER_PHONE");
  });

  // رمزٌ لا يُعرَفُ **يُنسَبُ ولا يُطوى**: قائمةٌ تُسقِطُ ما لا تفهمُه كانت
  // ستُخفي عن صاحبِها حقلاً يُنشَرُ فعلاً.
  it("رمزٌ جديدٌ يُنسَبُ ولا يُطوى", () => {
    expect(disclosureKey("A_NEW_FIELD")).toBe("rider.share.disclosure.A_NEW_FIELD");
  });
});
