/**
 * الغرض: قياسُ تقييمِ الراكبِ الإحصائيّ على لوحِ عروضِ السائقِ (`WR-30`) — من
 *   المُعدِّلِ والعددِ في القاعدةِ إلى السطرِ في الشاشةِ، بكلِّ حالاتِ الغيابِ.
 * الحالة: منفَّذٌ فعليّاً — البندُ `WR-30`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ## لِمَ يُقاسُ «الغيابُ» أكثرَ من «الوجودِ»
 *
 * لأنَّ الخطرَ في هذا البندِ ليسَ إظهارَ تقييمٍ بل إخفاءَ لوحٍ أو اختراعَ تقييمٍ:
 * راكبٌ بلا تقييمٍ بعدُ (`rating_count = 0`) لو عُرِضَ معدَّلُه صفراً لَقُرِئَ
 * «صفرُ نجومٍ» وهو بريءٌ — فالغيابُ يُنقَلُ غياباً. والحقولُ القديمةُ (بوّابةٌ
 * أقدم) تبقِي البطاقةَ كما كانت لا تُسقِطُ اللوحَ.
 */

import { describe, expect, it } from "bun:test";
import {
  riderRatingLine,
  riderRatingText,
  toOfferCard,
  toOfferDetail,
} from "../../apps/miniapp/src/surfaces/driver/offers/offers-view.ts";
import { composeDriverOfferBoard } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import { parseOrderPlaceExtrasRow } from "../../packages/infrastructure/transport/order-place-extras.ts";

/** بطاقةُ دالّةِ القاعدةِ كما تُخرِجُها `driver_offer_board` — قبلَ الإغناءِ. */
function boardPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    server_time: "2026-11-03T09:00:00.000Z",
    is_available: true,
    is_blocked: false,
    block_reasons: [],
    offers: [
      {
        offer_id: "11111111-2222-3333-4444-555555555555",
        order_id: "99999999-8888-7777-6666-555555555555",
        round: 1,
        service: "transport",
        seconds_left: 120,
        rider_distance: null,
        trip_distance: null,
        pickup_label: "البلد",
        dropoff_label: "الروضة",
      },
    ],
    ...overrides,
  };
}

/** صفُّ ملاحقِ الطلبِ كما يبنيهِ استعلامُ القراءةِ الموحّدةِ. */
function extrasRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "99999999-8888-7777-6666-555555555555",
    pickup_link: null,
    pickup_notes: null,
    pickup_lat: null,
    pickup_lng: null,
    has_dropoff: false,
    dropoff_link: null,
    dropoff_notes: null,
    dropoff_lat: null,
    dropoff_lng: null,
    rider_offer_mode: null,
    rider_offer_sar: null,
    pickup_at: null,
    rider_rating_average: null,
    rider_rating_count: null,
    ...overrides,
  };
}

describe("WR-30 — تقييمُ الراكبِ على لوحِ العروضِ", () => {
  it("الإغناءُ: معدَّلٌ وعددٌ يصلانِ البطاقةَ كما قالتهما القاعدةُ", () => {
    const extras = parseOrderPlaceExtrasRow(
      extrasRow({ rider_rating_average: 4.5, rider_rating_count: 12 }) as never,
    );
    const board = composeDriverOfferBoard(boardPayload(), {
      extrasMap: new Map([["99999999-8888-7777-6666-555555555555", extras]]),
      eligibilityReasons: [],
    });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const card = board.value.offers[0];
    expect(card?.riderRating).toEqual({ average: 4.5, count: 12 });
  });

  it("راكبٌ بلا تقييمٍ بعدُ: لا مفتاحَ لا صفرَ — البطاقةُ كما هي", () => {
    const extras = parseOrderPlaceExtrasRow(extrasRow() as never);
    expect(extras.riderRating).toBeNull();
    const board = composeDriverOfferBoard(boardPayload(), {
      extrasMap: new Map([["99999999-8888-7777-6666-555555555555", extras]]),
      eligibilityReasons: [],
    });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    const card = board.value.offers[0];
    expect(card?.riderRating).toBeUndefined();
    expect("riderRating" in (card ?? {})).toBe(false);
  });

  it("بوّابةٌ أقدم (لا ملاحقَ): البطاقةُ بلا تقييمٍ ولا سقوطَ للوحِ", () => {
    const board = composeDriverOfferBoard(boardPayload(), {
      extrasMap: new Map(),
      eligibilityReasons: [],
    });
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.value.offers[0]?.riderRating).toBeUndefined();
  });

  it("المحلّلُ يرفضُ ما لا يكونُ تقييماً: عددٌ صفرٌ أو معدَّلٌ خارجَ [١، ٥]", () => {
    // عددٌ صفرٌ: راكبٌ جديدٌ لا «صفرُ نجومٍ».
    expect(
      parseOrderPlaceExtrasRow(
        extrasRow({ rider_rating_average: 0, rider_rating_count: 0 }) as never,
      ).riderRating,
    ).toBeNull();
    // معدَّلٌ خارجَ سُلَّمِ التقييمِ: عطبُ بياناتٍ لا حكمَ سائقينَ.
    expect(
      parseOrderPlaceExtrasRow(
        extrasRow({ rider_rating_average: 5.5, rider_rating_count: 3 }) as never,
      ).riderRating,
    ).toBeNull();
    // عددٌ كسريٌّ: عددُ تقييماتٍ لا يكونُ إلا عدداً صحيحاً.
    expect(
      parseOrderPlaceExtrasRow(
        extrasRow({ rider_rating_average: 4, rider_rating_count: 2.5 }) as never,
      ).riderRating,
    ).toBeNull();
    // معدَّلٌ بلا عددٍ يُروى: كذبٌ إحصائيٌّ.
    expect(
      parseOrderPlaceExtrasRow(
        extrasRow({ rider_rating_average: 4, rider_rating_count: null }) as never,
      ).riderRating,
    ).toBeNull();
  });
});

describe("WR-30 — سطرُ التقييمِ في التطبيقِ", () => {
  it("بطاقةُ اللوحِ: الحقلانِ يصيرانِ سطراً بصيغةٍ واحدةٍ", () => {
    const card = toOfferCard({
      offer_id: "11111111-2222-3333-4444-555555555555",
      order_id: "99999999-8888-7777-6666-555555555555",
      round: 1,
      service: "transport",
      seconds_left: 120,
      rider_distance: null,
      trip_distance: null,
      pickup_label: null,
      dropoff_label: null,
      rider_rating_average: 4.5,
      rider_rating_count: 12,
    });
    expect(card.riderRating).toEqual({ average: 4.5, count: 12 });
    const t = (key: string) =>
      key === "driver.offers.riderRating" ? "تقييم الراكب: {value} ★ ({count})" : key;
    expect(riderRatingText(t, card.riderRating ?? { average: 0, count: 0 })).toBe(
      "تقييم الراكب: 4.5 ★ (12)",
    );
  });

  it("تفاصيلُ العرضِ: الحقلانِ في التفاصيلِ كالبطاقةِ سواءً", () => {
    const detail = toOfferDetail({
      ok: true,
      server_time: "2026-11-03T09:00:00.000Z",
      offer_id: "11111111-2222-3333-4444-555555555555",
      order_id: "99999999-8888-7777-6666-555555555555",
      round: 1,
      service: "transport",
      offer_status: "pending",
      order_status: "searching",
      seconds_left: 120,
      is_claimable: true,
      pickup: { label: "البلد", latitude: 21.4, longitude: 39.8 },
      dropoff: null,
      rider_distance: null,
      trip_distance: null,
      notes: null,
      rider_rating_average: 3.8,
      rider_rating_count: 5,
    });
    expect(detail.riderRating).toEqual({ average: 3.8, count: 5 });
  });

  it("غيابُ الحقلينِ (بوّابةٌ أقدم) يُبقِي البطاقةَ بلا تقييمٍ", () => {
    const card = toOfferCard({
      offer_id: "11111111-2222-3333-4444-555555555555",
      order_id: "99999999-8888-7777-6666-555555555555",
      round: 1,
      service: "transport",
      seconds_left: 120,
      rider_distance: null,
      trip_distance: null,
      pickup_label: null,
      dropoff_label: null,
    });
    expect(card.riderRating).toBeNull();
  });

  it("المُصفّي لا يمرّرُ تقييماً ناقصاً أو كاذباً", () => {
    expect(riderRatingLine(4.5, 12)).toEqual({ average: 4.5, count: 12 });
    expect(riderRatingLine(4.5, 0)).toBeNull();
    expect(riderRatingLine(null, 12)).toBeNull();
    expect(riderRatingLine(4.5, null)).toBeNull();
    expect(riderRatingLine(6, 12)).toBeNull();
    expect(riderRatingLine(Number.NaN, 12)).toBeNull();
    expect(riderRatingLine(4.5, 2.5)).toBeNull();
  });
});
