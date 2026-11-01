import { describe, expect, test } from "bun:test";
import { isSurfaceVisible } from "./surface-visibility.ts";

describe("isSurfaceVisible — ADR 0296", () => {
  test("الصفحةُ الظاهرةُ تُقِرّ", () => {
    expect(isSurfaceVisible({ visibilityState: "visible" })).toBe(true);
  });
  test("الصفحةُ المخفيّةُ (Mini App مصغّرة/الهاتف مقفل) لا تُقِرّ فيصلُ البوت", () => {
    expect(isSurfaceVisible({ visibilityState: "hidden" })).toBe(false);
  });
  test("بلا document يُعَدّ ظاهرًا", () => {
    expect(isSurfaceVisible(undefined)).toBe(true);
  });
});
