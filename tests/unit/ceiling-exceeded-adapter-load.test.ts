/**
 * الغرض: تحميلُ منافذِ ومُهايئاتِ كشفِ تجاوزِ السقفِ (`F12-20`) — اختبارُ
 *   تجميعٍ يحملُ الوحداتِ للقياسِ في `lcov`. المنطقُ مُختبَرٌ في
 *   `detect-ceiling-exceeded.test.ts`؛ وههنا لا اختبارَ نفيًّا بل تحميلٌ.
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */

import { describe, expect, it } from "bun:test";
import {
  CEILING_SOURCES,
  isKnownCeilingSource,
} from "../../packages/application/tracking/ceiling-exceeded-ports.ts";
import { createCeilingExceededAdapter } from "../../packages/infrastructure/tracking/ceiling-exceeded-adapters.ts";

describe("F12-20 — تحميلُ الوحداتِ", () => {
  it("يُنشئ مُهايئاً بلا خطأ", () => {
    const fakeSql = () => Promise.resolve([]) as Promise<unknown[]>;
    const adapter = createCeilingExceededAdapter(fakeSql as never);
    expect(typeof adapter.listCeilingExceeded).toBe("function");
  });

  it("يُميِّز مصدرَ السقفِ المعروفَ من المجهول", () => {
    expect(isKnownCeilingSource("SETTING")).toBe(true);
    expect(isKnownCeilingSource("FALLBACK_DEFAULT")).toBe(true);
    expect(isKnownCeilingSource("UNKNOWN")).toBe(false);
    expect(CEILING_SOURCES).toHaveLength(2);
  });
});
