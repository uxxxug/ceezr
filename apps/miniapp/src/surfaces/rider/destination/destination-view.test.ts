/**
 * الغرض: إثباتُ عرضِ نتائجِ الوجهةِ والرفضِ والأخطاءِ والإذنِ دونَ DOM أو شبكةٍ.
 */

import { describe, expect, it } from "bun:test";
import type { ApiDestinationSuggestion } from "./destination-contract.ts";
import {
  destinationErrorKey,
  highlightRange,
  isRetryableDestinationError,
  isSearchable,
  locationRefusalKey,
  offersLocationSettings,
  refusalView,
  suggestionRows,
} from "./destination-view.ts";

const city = {
  code: "CITY",
  nameAr: "المدينة",
  nameEn: "City",
  areaVersion: "v1",
};

const suggestion = (
  overrides: Partial<ApiDestinationSuggestion> = {},
): ApiDestinationSuggestion => ({
  source: "landmark",
  refId: "place-1",
  kind: "airport",
  labelAr: "المطار",
  labelEn: "Airport",
  lat: 24,
  lng: 46,
  matchRank: 0,
  ...overrides,
});

describe("نموذجُ عرضِ الوجهةِ (R4)", () => {
  it("نتائجٌ صالحةٌ محفوظةُ الترتيب، والصفوفُ غيرُ المقروءةِ لا تُنتِجُ نقرةً وهميّة", () => {
    const rows = suggestionRows([
      suggestion({ refId: "saved", source: "saved", labelAr: "البيت" }),
      suggestion({ refId: "bad-coord", lat: Number.NaN }),
      suggestion({ refId: "blank", labelAr: "  " }),
      suggestion({ refId: "unknown-source", source: "new-source" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: "saved:saved",
      source: "saved",
      sourceKey: "rider.destination.source.saved",
      labelAr: "البيت",
      strong: true,
    });
    expect(suggestionRows([])).toEqual([]);
  });

  it("حدُّ البحثِ يطلبُ حرفينِ بعدَ التطبيعِ ويُبرِزُ المطابقةَ العربيةَ بلا إزاحة", () => {
    expect(isSearchable("م")).toBe(false);
    expect(isSearchable("مدينة")).toBe(true);
    expect(highlightRange("جدة", "جده")).toEqual({ start: 0, end: 3 });
    expect(highlightRange("جِدَّة", "جده")).toBeNull();
  });

  it("رفضُ التغطيةِ حالةٌ مقروءةٌ وقابلةٌ للإصلاح؛ والرفضُ المجهولُ لا يُسقطُ الشاشةَ", () => {
    const known = refusalView({
      ok: true,
      accepted: false,
      refusal: "OUTSIDE_SERVICE_AREA",
      city,
    });
    expect(known.messageKey).toBe("rider.destination.refused.OUTSIDE_SERVICE_AREA");
    expect(known.fixable).toBe(true);
    expect(known.cityNameEn).toBe("City");

    const unknown = refusalView({
      ok: true,
      accepted: false,
      refusal: "FUTURE_REFUSAL",
      city: null,
    });
    expect(unknown.messageKey).toBe("rider.destination.refused.UNKNOWN");
    expect(unknown.cityNameAr).toBeNull();
  });

  it("الخطأُ المجهولُ لا يكشفُ رمزاً خامّاً؛ والمحاولةُ للحالاتِ القابلةِ لها فقط", () => {
    expect(destinationErrorKey("DESTINATION_STORE_NOT_AVAILABLE")).toBe(
      "rider.destination.error.unavailable",
    );
    expect(destinationErrorKey("FUTURE_ERROR")).toBe("rider.destination.error.unavailable");
    expect(isRetryableDestinationError("DESTINATION_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableDestinationError("MALFORMED")).toBe(false);
  });

  it("الإذنُ المرفوضُ وحدَه يقدّمُ إعداداتٍ؛ المضيفُ غيرُ الداعمِ لا يُرسلُ إلى إعدادٍ وهميٍّ", () => {
    expect(locationRefusalKey("declined")).toBe("rider.destination.location.declined");
    expect(offersLocationSettings("declined")).toBe(true);
    expect(offersLocationSettings("no-telegram")).toBe(false);
    expect(offersLocationSettings("unsupported-version")).toBe(false);
  });
});
