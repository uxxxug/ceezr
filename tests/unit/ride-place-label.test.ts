/**
 * الغرض: قياسُ قراءةِ اسمِ المكانِ في طلبِ الرحلةِ (`RIDE-LABEL-01`) — إخباريٌّ لا
 *   حكميٌّ: ما لا يُقرأُ يسقطُ `null` ولا يرفضُ الطلبَ، والطويلُ يُقصَرُ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 */

import { describe, expect, test } from "bun:test";
import {
  PLACE_LABEL_MAX_LENGTH,
  readPlaceLabel,
} from "../../packages/application/transport/request-ride.ts";

describe("RIDE-LABEL-01 — اسمُ المكانِ", () => {
  test("يُشذَّبُ ويُقصَرُ", () => {
    expect(readPlaceLabel("  المسجد النبوي  ")).toBe("المسجد النبوي");
    expect(readPlaceLabel("ا".repeat(500))?.length).toBe(PLACE_LABEL_MAX_LENGTH);
  });

  test("الغيابُ والفراغُ والنوعُ الخاطئُ كلُّها `null`", () => {
    expect(readPlaceLabel(undefined)).toBe(null);
    expect(readPlaceLabel("   ")).toBe(null);
    expect(readPlaceLabel(42)).toBe(null);
  });
});
