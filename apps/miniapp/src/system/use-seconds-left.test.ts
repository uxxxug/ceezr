import { describe, expect, test } from "bun:test";
import { nextTickDelayMs, secondsUntil } from "./use-seconds-left.ts";

describe("secondsUntil — ADR 0296", () => {
  test("ثلاثون ثانيةً كاملة تُعرض 30", () => {
    expect(secondsUntil(30_000, 0)).toBe(30);
  });
  test("السقفُ: 29.2 ثانية تُعرض 30، و0.1 تُعرض 1", () => {
    expect(secondsUntil(30_000, 800)).toBe(30);
    expect(secondsUntil(30_000, 29_900)).toBe(1);
  });
  test("بعدَ الموعد صفرٌ لا سالب، وبلا موعدٍ صفر", () => {
    expect(secondsUntil(30_000, 31_000)).toBe(0);
    expect(secondsUntil(null, 0)).toBe(0);
    expect(secondsUntil(Number.NaN, 0)).toBe(0);
  });
});

describe("nextTickDelayMs", () => {
  test("ينتظرُ حتى تتغيّرَ الثانيةُ الظاهرة", () => {
    expect(nextTickDelayMs(30_000, 800)).toBe(200);
    expect(nextTickDelayMs(30_000, 0)).toBe(1000);
  });
  test("لا يقلّ عن 50ms ولا يزيد على ثانية", () => {
    expect(nextTickDelayMs(30_000, 29_990)).toBe(50);
    expect(nextTickDelayMs(30_000, 40_000)).toBe(1000);
  });
});
