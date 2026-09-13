/**
 * الغرض: إثباتُ أنَّ نموذجَ العرضِ لشاشةِ الوجهةِ **يصدُقُ فيما يُخفيه** كما
 *   يصدُقُ فيما يُظهِرُه: لا صفَّ بلا لافتةٍ، ولا إبرازَ مُزاحٌ، ولا «قربَ كذا»
 *   لمعلَمٍ بعيدٍ، ولا سقوطَ على رمزِ رفضٍ لا يعرفُه هذا الإصدارُ.
 * الحالة: اختبار فعلي — دوالُّ نقيّةٌ بلا DOM ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: بندُ الخريطةِ حينَ يصيرُ للنقطةِ رسمٌ.
 * ملاحظات مستقبلية: هذا الملفُّ يُثبِتُ نموذجَ العرضِ لا الشاشةَ. وأنَّ الشاشةَ
 *   تُركِّبُ هذه الصفوفَ فعلاً يُثبَتُ في اختبارِ الشاشةِ، **ولا يُدَّعى ههنا**
 *   أنَّ أحداً رآها: لا نشرَ حيَّ (ADR 0099).
 */

import { describe, expect, it } from "bun:test";
import type {
  ApiAcceptedDestination,
  ApiDestinationSuggestion,
} from "../../apps/miniapp/src/surfaces/rider/destination/destination-contract.ts";
import {
  acceptedSummary,
  destinationErrorKey,
  highlightRange,
  isRetryableDestinationError,
  isSearchable,
  labelFor,
  locationRefusalKey,
  offersLocationSettings,
  refusalView,
  SEARCH_HINT_MIN_LENGTH,
  suggestionRows,
} from "../../apps/miniapp/src/surfaces/rider/destination/destination-view.ts";
import { NEAREST_LANDMARK_DESCRIBES_WITHIN_M } from "../../packages/domain/destinations/landmark-kinds.ts";

function suggestion(over: Partial<ApiDestinationSuggestion> = {}): ApiDestinationSuggestion {
  return {
    source: "landmark",
    refId: "1",
    kind: "airport",
    labelAr: "مطار الملك عبدالعزيز الدولي",
    labelEn: "King Abdulaziz International Airport",
    lat: 21.67944,
    lng: 39.15667,
    matchRank: 0,
    ...over,
  } as ApiDestinationSuggestion;
}

function accepted(over: Partial<ApiAcceptedDestination> = {}): ApiAcceptedDestination {
  return {
    lat: 21.5,
    lng: 39.17,
    city: { id: 1, code: "JED", nameAr: "جدة", nameEn: "Jeddah" },
    areaVersion: "jed-envelope-v1",
    nearest: {
      kind: "landmark",
      nameAr: "نافورة الملك فهد",
      nameEn: "King Fahd's Fountain",
      straightDistanceM: 6.6,
    },
    ...over,
  } as ApiAcceptedDestination;
}

describe("صفوفُ الاقتراحاتِ", () => {
  it("تحفظُ ترتيبَ القاعدةِ ولا تُعيدُ فرزَه", () => {
    // الرتبةُ حكمُ القاعدةِ (القاعدة 0.5). ولو فُرِزَ ههنا لَصارَ للترتيبِ
    // مصدرانِ يتباعدانِ بلا حاجزٍ يكشفُهما.
    const rows = suggestionRows([
      suggestion({ refId: "a", labelAr: "أوّلٌ" }),
      suggestion({ refId: "b", labelAr: "ثانٍ", matchRank: 1 }),
      suggestion({ refId: "c", labelAr: "ثالثٌ" }),
    ]);
    expect(rows.map((row) => row.labelAr)).toEqual(["أوّلٌ", "ثانٍ", "ثالثٌ"]);
  });

  it("تُبرِزُ ما طابَقَ بدايةَ كلمةٍ ولا تُعيدُ ترتيبَه", () => {
    const rows = suggestionRows([suggestion({ matchRank: 0 }), suggestion({ matchRank: 1 })]);
    expect(rows[0]?.strong).toBe(true);
    expect(rows[1]?.strong).toBe(false);
  });

  it("تطرحُ الصفَّ بلا لافتةٍ — صفٌّ لا يُقرأُ لا يُعرَضُ", () => {
    expect(suggestionRows([suggestion({ labelAr: "   " })])).toHaveLength(0);
  });

  it("تطرحُ الإحداثيّةَ التي ليست عدداً منتهياً — نقرةٌ لا تُفضي إلى شيءٍ", () => {
    expect(suggestionRows([suggestion({ lat: Number.NaN })])).toHaveLength(0);
    expect(suggestionRows([suggestion({ lng: Number.POSITIVE_INFINITY })])).toHaveLength(0);
  });

  it("تقبلُ الصفرَ إحداثيّةً — الصفرُ قيمةٌ لا غيابٌ", () => {
    expect(suggestionRows([suggestion({ lat: 0, lng: 0 })])).toHaveLength(1);
  });

  it("تطرحُ مصدراً لا يعرفُه هذا الإصدارُ ولا تسقطُ", () => {
    expect(suggestionRows([suggestion({ source: "ouija" as never })])).toHaveLength(0);
  });

  it("مفاتيحُ المصفوفةِ متفرِّدةٌ ولو تشابَهَ المعرّفُ بينَ مصدرَينِ", () => {
    const rows = suggestionRows([
      suggestion({ source: "saved", refId: "7", kind: null }),
      suggestion({ source: "landmark", refId: "7" }),
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it("لا مفتاحَ صنفٍ لِما ليسَ معلَماً", () => {
    const rows = suggestionRows([suggestion({ source: "saved", kind: null })]);
    expect(rows[0]?.kindKey).toBeNull();
  });
});

describe("اللافتةُ بلغةِ الشاشةِ", () => {
  const row = suggestionRows([suggestion()])[0];

  it("تُعيدُ الإنجليزيَّ للإنجليزيّةِ والعربيَّ للعربيّةِ", () => {
    expect(labelFor(row as never, "ar")).toContain("مطار");
    expect(labelFor(row as never, "en")).toContain("King");
  });

  it("ترتدُّ إلى العربيِّ حينَ يغيبُ الإنجليزيُّ — لا لافتةً فارغةً", () => {
    const noEnglish = suggestionRows([suggestion({ labelEn: null })])[0];
    expect(labelFor(noEnglish as never, "en")).toContain("مطار");
    expect(labelFor(noEnglish as never, "ur")).toContain("مطار");
  });
});

describe("موضعُ الإبرازِ", () => {
  it("يُبرِزُ بدايةَ الحقلِ", () => {
    expect(highlightRange("جده البلد", "جده")).toEqual({ start: 0, end: 3 });
  });

  it("يُبرِزُ بدايةَ كلمةٍ في الوسطِ", () => {
    expect(highlightRange("جده البلد", "البلد")).toEqual({ start: 4, end: 9 });
  });

  it("يسكتُ حينَ يُزيحُ التطبيعُ المواضعَ — إبرازٌ مُزاحٌ أسوأُ من لا إبرازٍ", () => {
    // «جِدَّة» ستّةُ محارفَ خامّاً وثلاثةٌ مُطبَّعةً؛ فقصُّ [0,3) على الخامِّ
    // يُبرِزُ «جِد» لا «جدة».
    expect(highlightRange("جِدَّة", "جده")).toBeNull();
  });

  it("يسكتُ على استفهامٍ فارغٍ ولا يُبرِزُ كلَّ شيءٍ", () => {
    expect(highlightRange("جده البلد", "")).toBeNull();
  });

  it("يسكتُ على ما لم يُطابِقْ بدايةَ كلمةٍ", () => {
    expect(highlightRange("جده البلد", "لبل")).toBeNull();
  });
});

describe("عتبةُ نداءِ الخادمِ", () => {
  it("لا يُنادى الخادمُ بما دونَ الحدِّ بعدَ التطبيعِ", () => {
    expect(isSearchable("ج")).toBe(false);
    expect(isSearchable("؟؟؟؟؟")).toBe(false);
    expect(isSearchable("جد")).toBe(true);
  });

  it("حدُّ الإرشادِ هوَ حدُّ النطاقِ نفسُه لا رقمٌ ثانٍ", () => {
    expect(SEARCH_HINT_MIN_LENGTH).toBe(2);
  });
});

describe("خُلاصةُ القبولِ", () => {
  it("تعرضُ «قربَ كذا» للمعلَمِ القريبِ", () => {
    const summary = acceptedSummary(accepted());
    expect(summary.nearest?.nameAr).toBe("نافورة الملك فهد");
    expect(summary.nearest?.distanceM).toBe(7);
  });

  it("تسكتُ عن معلَمٍ أبعدَ من العتبةِ — ولا تقولُ «قربَ المطارِ» لنقطةٍ بعيدةٍ", () => {
    const far = accepted({
      nearest: {
        kind: "airport",
        nameAr: "مطار",
        nameEn: "Airport",
        straightDistanceM: NEAREST_LANDMARK_DESCRIBES_WITHIN_M + 1,
      },
    } as never);
    expect(acceptedSummary(far).nearest).toBeNull();
  });

  it("تسكتُ حينَ لا معلَمَ أصلاً", () => {
    expect(acceptedSummary(accepted({ nearest: null } as never)).nearest).toBeNull();
  });

  it("تحفظُ الإحداثيّةَ كما قَبِلَتها القاعدةُ لا كما كُتِبَت", () => {
    const summary = acceptedSummary(accepted({ lat: 21.5, lng: 39.17 }));
    expect(summary.lat).toBe(21.5);
    expect(summary.lng).toBe(39.17);
    expect(summary.cityNameAr).toBe("جدة");
  });
});

describe("قراءةُ الرفضِ", () => {
  it("تُعيدُ مفتاحَ الرفضِ المعروفِ وتُخبِرُ أنَّه يُصلَحُ بنقطةٍ أخرى", () => {
    const view = refusalView({
      accepted: false,
      refusal: "OUTSIDE_SERVICE_AREA",
      city: { id: 1, code: "JED", nameAr: "جدة", nameEn: "Jeddah" },
    } as never);
    expect(view.messageKey).toBe("rider.destination.refused.OUTSIDE_SERVICE_AREA");
    expect(view.fixable).toBe(true);
    expect(view.cityNameAr).toBe("جدة");
  });

  it("لا تسقطُ على رمزٍ لا يعرفُه هذا الإصدارُ — نصٌّ عامٌّ صادقٌ لا شاشةُ عطبٍ", () => {
    const view = refusalView({
      accepted: false,
      refusal: "SERVICE_HOURS_ENDED",
      city: null,
    } as never);
    expect(view.messageKey).toBe("rider.destination.refused.UNKNOWN");
    expect(view.fixable).toBe(true);
    expect(view.cityNameAr).toBeNull();
  });

  it("ما لا يُصلَحُ بنقطةٍ أخرى لا يُعرَضُ له زرُّ «اختَرْ نقطةً أخرى»", () => {
    for (const refusal of ["CITY_NOT_SERVED", "SERVICE_AREA_NOT_DEFINED"]) {
      const view = refusalView({ accepted: false, refusal, city: null } as never);
      expect(view.fixable).toBe(false);
    }
  });
});

describe("مفاتيحُ الأخطاءِ", () => {
  it("لكلِّ رمزٍ معروفٍ مفتاحُه، ولِما سواه مفتاحٌ عامٌّ", () => {
    expect(destinationErrorKey("QUERY_TOO_SHORT")).toBe("rider.destination.error.query");
    expect(destinationErrorKey("ACCOUNT_NOT_FOUND")).toBe("rider.destination.error.account");
    expect(destinationErrorKey("مجهولٌ")).toBe("rider.destination.error.unavailable");
  });

  it("تُعادُ المحاولةُ لِما يُجدي فيه الإعادةُ وحدَه", () => {
    expect(isRetryableDestinationError("DESTINATION_STORE_NOT_AVAILABLE")).toBe(true);
    // استعلامٌ قصيرٌ لا يُصلَحُ بضغطِ الزرِّ ثانيةً — يُصلَحُ بكتابةِ حرفٍ.
    expect(isRetryableDestinationError("QUERY_TOO_SHORT")).toBe(false);
    expect(isRetryableDestinationError("MALFORMED")).toBe(false);
  });
});

describe("تعذّرُ «موقعي الحاليُّ»", () => {
  it("يُفصَلُ الرفضُ عن عدمِ الدعمِ عن الإخفاقِ", () => {
    expect(locationRefusalKey("declined")).toBe("rider.destination.location.declined");
    expect(locationRefusalKey("no-telegram")).toBe("rider.destination.location.unsupported");
    expect(locationRefusalKey("unsupported-version")).toBe(
      "rider.destination.location.unsupported",
    );
    expect(locationRefusalKey("missing-api")).toBe("rider.destination.location.unsupported");
    expect(locationRefusalKey("failed")).toBe("rider.destination.location.failed");
    expect(locationRefusalKey("سببٌ جديدٌ")).toBe("rider.destination.location.failed");
  });

  it("لا يُعرَضُ زرُّ الإعداداتِ لِما لا إعداداتِ له", () => {
    expect(offersLocationSettings("declined")).toBe(true);
    // مَن يفتحُ المُصغَّرَ في متصفِّحٍ لا إعداداتِ موقعٍ في تلجرام عندَه.
    expect(offersLocationSettings("no-telegram")).toBe(false);
    expect(offersLocationSettings("unsupported-version")).toBe(false);
    expect(offersLocationSettings("failed")).toBe(false);
  });
});
