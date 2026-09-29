/**
 * الغرض: قواعدُ رابطِ الدخولِ — الكاتبُ والقارئُ متطابقانِ (`ADR 0213`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import {
  declaredScreens,
  decodeMiniAppTarget,
  encodeMiniAppTarget,
  MINIAPP_TARGET_MAX_LENGTH,
  type MiniAppAudience,
  type MiniAppTarget,
  miniAppUrl,
  targetFromSearch,
} from "../../packages/shared/miniapp-link/index.ts";

const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("رابطُ الدخولِ: ذهابٌ وإيابٌ", () => {
  for (const audience of ["rider", "driver"] as const satisfies readonly MiniAppAudience[]) {
    it(`كلُّ شاشةٍ معلنةٍ لـ${audience} تعودُ كما كُتِبَت`, () => {
      const { plain, withId } = declaredScreens(audience);
      for (const screen of plain) {
        const target = { audience, screen } as MiniAppTarget;
        expect(decodeMiniAppTarget(encodeMiniAppTarget(target), audience)).toEqual(target);
      }
      for (const screen of withId) {
        const target = { audience, screen, id: UUID } as MiniAppTarget;
        const encoded = encodeMiniAppTarget(target);
        expect(encoded.length).toBeLessThanOrEqual(MINIAPP_TARGET_MAX_LENGTH);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeMiniAppTarget(encoded, audience)).toEqual(target);
      }
    });
  }

  it("رابطُ سائقٍ في سطحِ راكبٍ ⇒ لا هدفَ، لا تحويلَ", () => {
    expect(decodeMiniAppTarget(`offer_${UUID}`, "rider")).toBeNull();
    expect(decodeMiniAppTarget("history", "driver")).toBeNull();
  });

  it("المدخلُ المشوَّهُ ⇒ null", () => {
    for (const raw of [
      "",
      null,
      undefined,
      "ride_",
      "ride",
      "home_123",
      "RIDE_abc",
      "ride_../../x",
      "ride_<script>",
      `ride_${"a".repeat(80)}`,
    ]) {
      expect(decodeMiniAppTarget(raw, "rider")).toBeNull();
    }
  });

  it("الكاتبُ يرفضُ معرّفاً خارجَ الصيغةِ — خطأُ برمجةٍ لا مدخلُ مستخدمٍ", () => {
    expect(() => encodeMiniAppTarget({ audience: "rider", screen: "ride", id: "x y" })).toThrow();
  });

  it("miniAppUrl يضعُ الهدفَ في ?open= ويرفضُ غيرَ https", () => {
    const url = miniAppUrl("https://waslah-miniapp.onrender.com/", {
      audience: "driver",
      screen: "offer",
      id: UUID,
    });
    expect(url).toBe(`https://waslah-miniapp.onrender.com/?open=offer_${UUID}`);
    expect(targetFromSearch(new URL(url).search, "driver")).toEqual({
      audience: "driver",
      screen: "offer",
      id: UUID,
    });
    expect(miniAppUrl("https://waslah-miniapp.onrender.com/", null)).toBe(
      "https://waslah-miniapp.onrender.com/",
    );
    expect(() => miniAppUrl("http://insecure.example", null)).toThrow();
  });
});
