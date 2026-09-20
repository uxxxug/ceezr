import { describe, expect, it } from "bun:test";
import {
  checkSystemStateFreshness,
  daysBetween,
  extractLastUpdated,
  type SystemStateCheckInput,
} from "../../scripts/check-system-state.ts";

const VALID_CONTENT = `# وثيقة حالة النظام

| | |
|---|---|
| **آخر تحديث** | 2026-09-20 — تحديثٌ بسيطٌ |
| **commit** | abc123 |
`;

const baseInput = (overrides: Partial<SystemStateCheckInput>): SystemStateCheckInput => ({
  fileContent: VALID_CONTENT,
  today: new Date("2026-09-20T00:00:00Z"),
  ...overrides,
});

describe("حاجزُ حداثةِ وثيقةِ حالةِ النظامِ", () => {
  it("يستخرجُ التاريخَ من سطرِ «آخر تحديث»", () => {
    expect(extractLastUpdated(VALID_CONTENT)).toBe("2026-09-20");
  });

  it("يُرجِعُ null إن لم يُوجَدِ السطر", () => {
    expect(extractLastUpdated("# وثيقة بلا تاريخ")).toBeNull();
  });

  it("يُرجِعُ null إن لم يُوجَدِ تاريخٌ بصيغةٍ صحيحة", () => {
    const content = VALID_CONTENT.replace("2026-09-20", "غير مؤرخ");
    expect(extractLastUpdated(content)).toBeNull();
  });

  it("يحسبُ الفرقَ بينَ تاريخينِ بالأيّامِ", () => {
    expect(daysBetween("2026-09-10", new Date("2026-09-20T00:00:00Z"))).toBe(10);
  });

  it("يُرجِعُ null لتاريخٍ غيرِ صالح", () => {
    expect(daysBetween("not-a-date", new Date())).toBeNull();
  });

  it("يمرُّ إن كانَ التاريخُ طازجًا", () => {
    const result = checkSystemStateFreshness(baseInput({}));
    expect(result.stale).toBe(false);
    expect(result.lastUpdated).toBe("2026-09-20");
    expect(result.ageDays).toBe(0);
  });

  it("يمرُّ إن كانَ التاريخُ ضمنَ الحدِّ المسموح", () => {
    const result = checkSystemStateFreshness(
      baseInput({ today: new Date("2026-10-01T00:00:00Z") }),
    );
    expect(result.stale).toBe(false);
    expect(result.ageDays).toBe(11);
  });

  it("يسقطُ إن تجاوزَ التاريخُ الحدَّ المسموح (14 يومًا)", () => {
    const result = checkSystemStateFreshness(
      baseInput({ today: new Date("2026-10-05T00:00:00Z") }),
    );
    expect(result.stale).toBe(true);
    expect(result.ageDays).toBe(15);
  });

  it("يسقطُ إن لم يُوجَدِ التاريخُ أصلاً", () => {
    const result = checkSystemStateFreshness(baseInput({ fileContent: "# وثيقة بلا تاريخ" }));
    expect(result.stale).toBe(true);
    expect(result.lastUpdated).toBeNull();
  });

  it("يسقطُ إن كانَ التاريخُ غيرَ قابلٍ للقراءة", () => {
    const content = VALID_CONTENT.replace("2026-09-20", "garbage-date");
    const result = checkSystemStateFreshness(baseInput({ fileContent: content }));
    expect(result.stale).toBe(true);
  });

  it("الحدُّ المسموحُ 14 يومًا — اليومُ الرابعَ عشرَ يمرّ", () => {
    const result = checkSystemStateFreshness(
      baseInput({ today: new Date("2026-10-04T00:00:00Z") }),
    );
    expect(result.stale).toBe(false);
    expect(result.ageDays).toBe(14);
  });

  it("اليومُ الخامسَ عشرَ يسقط", () => {
    const result = checkSystemStateFreshness(
      baseInput({ today: new Date("2026-10-05T00:00:00Z") }),
    );
    expect(result.stale).toBe(true);
    expect(result.ageDays).toBe(15);
  });
});
