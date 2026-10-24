/**
 * الغرض: `SOAK-02` — حسابُ الإطلاقاتِ المستحقّةِ في وضعِ معدّلِ الوصولِ الثابت.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit.
 */
import { describe, expect, test } from "bun:test";
import { dueLaunches } from "../../deploy/capacity-run/load/miniapp-load.ts";

describe("SOAK-02 — dueLaunches", () => {
  test("معدّلٌ صفريٌّ أو زمنٌ غيرُ موجبٍ لا يطلقُ شيئًا", () => {
    expect(dueLaunches(10_000, 0, 0)).toBe(0);
    expect(dueLaunches(0, 5, 0)).toBe(0);
    expect(dueLaunches(-5, 5, 0)).toBe(0);
  });
  test("يلحقُ بالمعدّلِ المعلن دونَ تجاوز", () => {
    expect(dueLaunches(1_000, 6, 0)).toBe(6);
    expect(dueLaunches(1_500, 6, 6)).toBe(3);
    expect(dueLaunches(1_500, 6, 9)).toBe(0);
    expect(dueLaunches(1_500, 6, 12)).toBe(0);
  });
  test("على ساعةٍ كاملةٍ يساوي المعدّلَ × الزمن", () => {
    expect(dueLaunches(3_600_000, 4.5, 0)).toBe(16_200);
  });
});
