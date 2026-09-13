/**
 * الغرض: إثباتُ نموذجِ عرضِ شاشةِ الراكبِ الرئيسةِ نقيّاً بلا DOM ولا شبكةٍ
 *   (البند `F2-02`): الترتيبُ · النوعُ المجهولُ · الفراغُ · مفاتيحُ الخطأِ ·
 *   شروطُ الإرسالِ.
 * الحالة: اختبار فعلي — منطقٌ خالصٌ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: CI
 */

import { describe, expect, it } from "bun:test";
import { MAX_PLACE_LABEL_LENGTH } from "../../../../../../packages/domain/places/place-kinds.ts";
import {
  HOME_SERVICES,
  isRetryablePlacesError,
  isSubmittableDestination,
  placeKindKey,
  placeRows,
  placesErrorKey,
  recentRows,
  serviceKey,
} from "./home-view.ts";
import type { ApiSavedPlace } from "./places-api.ts";

function place(kind: string, label: string, updatedAt: string, id = label): ApiSavedPlace {
  return { id, kind, label, lat: 21.5, lng: 39.2, updatedAt };
}

describe("نموذجُ عرضِ شاشةِ الراكبِ الرئيسةِ", () => {
  it("١) المنزلُ ثمَّ العملُ ثمَّ الباقي بالأحدثِ — ولا يُعتمَدُ على ترتيبِ الردِّ", () => {
    const rows = placeRows([
      place("other", "المطار", "2026-09-01T00:00:00Z"),
      place("work", "المكتب", "2026-08-01T00:00:00Z"),
      place("other", "الملعب", "2026-09-05T00:00:00Z"),
      place("home", "البيت", "2026-07-01T00:00:00Z"),
    ]);
    expect(rows.map((row) => row.label)).toEqual(["البيت", "المكتب", "الملعب", "المطار"]);
  });

  it("٢) نوعٌ مجهولٌ لا يُسقِطُ المكانَ: يُعرَضُ بمفتاحِ «آخر» ويُرتَّبُ في الذيلِ", () => {
    const rows = placeRows([
      place("warehouse", "مستودع", "2026-09-09T00:00:00Z"),
      place("home", "البيت", "2026-01-01T00:00:00Z"),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["home", "warehouse"]);
    expect(rows[1]?.kindKey).toBe("rider.home.place.other");
    expect(placeKindKey("home")).toBe("rider.home.place.home");
    expect(placeKindKey("work")).toBe("rider.home.place.work");
  });

  it("٣) الصفُّ يحملُ الإحداثيَّينِ كما جاءا ولا يُعادُ حسابُهما", () => {
    const rows = placeRows([{ ...place("home", "البيت", "2026-09-09T00:00:00Z"), lat: 0, lng: 0 }]);
    expect(rows[0]?.lat).toBe(0);
    expect(rows[0]?.lng).toBe(0);
  });

  it("٤) الوجهاتُ الأخيرةُ لا تُقتطَعُ في العميلِ: الحدُّ حكمُ الخادمِ", () => {
    const many = Array.from({ length: 7 }, (_, index) => ({
      label: `وجهة ${index}`,
      lat: 21,
      lng: 39,
      lastUsedAt: `2026-09-0${index + 1}T00:00:00Z`,
    }));
    expect(recentRows(many)).toHaveLength(7);
  });

  it("٥) لافتةٌ فارغةٌ أو فراغاتٌ وحدَها تُسقَطُ: صفٌّ لا يُقرأُ لا يُعرَضُ", () => {
    const rows = recentRows([
      { label: "  ", lat: 21, lng: 39, lastUsedAt: "2026-09-01T00:00:00Z" },
      { label: "", lat: 21, lng: 39, lastUsedAt: "2026-09-02T00:00:00Z" },
      { label: "المطار", lat: 21, lng: 39, lastUsedAt: "2026-09-03T00:00:00Z" },
    ]);
    expect(rows.map((row) => row.label)).toEqual(["المطار"]);
  });

  it("٦) شرطُ الإرسالِ يُقاسُ بحدِّ النطاقِ بعدَ قصِّ الأطرافِ", () => {
    expect(isSubmittableDestination("")).toBe(false);
    expect(isSubmittableDestination("   ")).toBe(false);
    expect(isSubmittableDestination("م")).toBe(true);
    expect(isSubmittableDestination("م".repeat(MAX_PLACE_LABEL_LENGTH))).toBe(true);
    expect(isSubmittableDestination("م".repeat(MAX_PLACE_LABEL_LENGTH + 1))).toBe(false);
    expect(isSubmittableDestination(` ${"م".repeat(MAX_PLACE_LABEL_LENGTH)} `)).toBe(true);
  });

  it("٧) لكلِّ رمزِ رفضٍ مفتاحٌ، والمجهولُ يرتدُّ إلى «غيرُ متاحةٍ» لا إلى فراغٍ", () => {
    expect(placesErrorKey("MALFORMED")).toBe("rider.home.error.malformed");
    expect(placesErrorKey("UNKNOWN_PLACE_KIND")).toBe("rider.home.error.malformed");
    expect(placesErrorKey("ACCOUNT_NOT_FOUND")).toBe("rider.home.error.account");
    expect(placesErrorKey("PLACE_STORE_NOT_AVAILABLE")).toBe("rider.home.error.unavailable");
    expect(placesErrorKey("شيءٌ لم يُعرَف")).toBe("rider.home.error.unavailable");
  });

  it("٨) إعادةُ المحاولةِ تُعرَضُ لعُطلِ المخزنِ لا لخطأِ المستخدمِ", () => {
    expect(isRetryablePlacesError("PLACE_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryablePlacesError("SESSION_NOT_AVAILABLE")).toBe(true);
    expect(isRetryablePlacesError("MALFORMED")).toBe(false);
    expect(isRetryablePlacesError("ACCOUNT_NOT_FOUND")).toBe(false);
  });

  it("٩) الخدمتانِ هما تعدادُ القاعدةِ نفسُه، ولكلٍّ مفتاحُها", () => {
    expect(HOME_SERVICES).toEqual(["transport", "delivery"]);
    expect(serviceKey("transport")).toBe("rider.home.service.transport");
    expect(serviceKey("delivery")).toBe("rider.home.service.delivery");
  });
});
