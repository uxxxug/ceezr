import { describe, expect, test } from "bun:test";
import {
  CITY_CENTERS,
  CITY_LIST,
  perCityConcurrency,
} from "../../deploy/capacity-run/load/miniapp-load.ts";

/**
 * `LOAD-01M` — هدفُ المدنِ الخمسِ المكمِّلُ: المولّدُ يوزّعُ تزامنَ المرحلةِ حصصًا
 * ثابتةً على المدنِ، ونقطةُ كلِّ مدينةٍ داخلَ مستطيلِ خدمتِها المهاجَرِ
 * (`supabase/migrations/20260913170000_*` لجدّة و`20261003000000_ui_city_01_service_areas.sql`
 * للبقيّة) بهامشٍ يتّسعُ لاهتزازِ الرحلةِ ±0.02 — وإلّا نقلَ `WR-13` السائقَ أو رُفضَ الطلب.
 */
const ENVELOPES: Record<string, [number, number, number, number]> = {
  JED: [39.05, 21.25, 39.4, 21.85],
  MKK: [39.7, 21.25, 40.0, 21.6],
  RUH: [46.45, 24.4, 47.1, 25.1],
  TIF: [40.25, 21.1, 40.65, 21.55],
  MED: [39.45, 24.3, 39.8, 24.65],
};

describe("LOAD-01M — حصص التزامن لكل مدينة", () => {
  test("الحصة = التزامن ÷ عدد المدن عند القسمة التامة", () => {
    expect(perCityConcurrency(2500, 5)).toBe(500);
    expect(perCityConcurrency(750, 5)).toBe(150);
    expect(perCityConcurrency(500, 1)).toBe(500);
  });
  test("القسمة غير التامة تُرفض لا تُقرَّب صامتة (لا مدينة تأخذ أقل من حصتها)", () => {
    expect(() => perCityConcurrency(751, 5)).toThrow();
    expect(() => perCityConcurrency(10, 0)).toThrow();
  });
  test("غياب CITIES = مدينة واحدة هي CITY (سلوك LOAD-01 الرسمي لا يتغير)", () => {
    if (process.env.CITIES === undefined) {
      expect(CITY_LIST).toEqual([process.env.CITY ?? "JED"]);
    }
  });
  test("نقطة كل مدينة ±0.02 داخل مستطيل خدمتها، وخارج مستطيلات المدن الأخرى", () => {
    for (const [code, c] of Object.entries(CITY_CENTERS)) {
      const env = ENVELOPES[code];
      if (env === undefined) throw new Error(`مدينة بلا مستطيل: ${code}`);
      const [x0, y0, x1, y1] = env;
      expect(c.lng - 0.02).toBeGreaterThan(x0);
      expect(c.lng + 0.02).toBeLessThan(x1);
      expect(c.lat - 0.02).toBeGreaterThan(y0);
      expect(c.lat + 0.02).toBeLessThan(y1);
      for (const [other, [ox0, oy0, ox1, oy1]] of Object.entries(ENVELOPES)) {
        if (other === code) continue;
        const inside = c.lng >= ox0 && c.lng <= ox1 && c.lat >= oy0 && c.lat <= oy1;
        expect(inside).toBe(false);
      }
    }
  });
});

describe("LOAD-01M — تفصيل المدن والعدالة من المآلات", () => {
  test("نسبة الإنجاز والفرق بين المدن وأسباب الفشل لكل مدينة", async () => {
    const { perCity } = await import("../../deploy/capacity-run/load/multi-city-report.ts");
    const out = perCity([
      { kind: "verified", city: "JED", orderCreatedAt: 0, offerFoundAt: 1000 },
      { kind: "verified", city: "JED", orderCreatedAt: 0, offerFoundAt: 3000 },
      { kind: "verified", city: "MKK" },
      { kind: "undecided", city: "MKK", reason: "driver_onboarding_failed" },
    ]);
    const jed = out.rows.find((r) => r.city === "JED");
    const mkk = out.rows.find((r) => r.city === "MKK");
    if (jed === undefined || mkk === undefined) throw new Error("مدينة مفقودة من التفصيل");
    expect(jed.completionRate).toBe(1);
    expect(jed.offerAppearP95Ms).toBe(3000);
    expect(mkk.completionRate).toBe(0.5);
    expect(mkk.topReasons).toEqual([["driver_onboarding_failed", 1]]);
    expect(out.fairnessGap).toBe(0.5);
  });
  test("مآل بلا مدينة يُحصى UNKNOWN لا يُسقَط", async () => {
    const { perCity } = await import("../../deploy/capacity-run/load/multi-city-report.ts");
    const out = perCity([{ kind: "rejected" }]);
    expect(out.rows[0]?.city).toBe("UNKNOWN");
    expect(out.rows[0]?.launched).toBe(1);
  });
});
