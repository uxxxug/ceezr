/**
 * الغرض: `OPS-017` — **سقوطُ حاجزِ شاهدِ الترتيبِ مقيسٌ بسالباتٍ مزروعةٍ**، لا
 *   بما يصادفُه القرصُ. فحاجزٌ يُقاسُ على المستودَعِ كما هوَ يمرُّ أخضرَ وهوَ
 *   معطوبٌ (`ح-7`).
 * الحالة: اختبارُ وحدةٍ — بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI — الخطوةُ المجاورةُ لِـ`scripts/check-sequence-witness-order.ts`.
 * الحاكم: docs/adr/0147-no-delivery-order-witness-in-a-concurrent-test.md
 *
 * **وهذا الملفُّ مُستثنىً بالاسمِ** في `PLANTED_NEGATIVE_FILES`، لأنَّ واجبَه أن
 * يحملَ النمطَ الممنوعَ نصّاً — ومنهُ **الأسطرُ الثلاثةُ التي أسقطَت CI فعلاً**.
 */

import { describe, expect, it } from "bun:test";
import {
  PLANTED_NEGATIVE_FILES,
  sequenceWitnessViolationsIn,
} from "../../scripts/lib/sequence-witness-order.ts";

const FILE = "tests/integration/example-race.test.ts";

/** غلافٌ متزامنٌ: بلا `Promise.all` لا حكمَ للحاجزِ، وهذا مقيسٌ بحالةٍ خاصّةٍ. */
function concurrent(body: string): string {
  return ["await Promise.all([first(), second()]);", body].join("\n");
}

describe("حاجزُ شاهدِ الترتيبِ — لا توكيدَ يقيسُ الجدولةَ (OPS-017)", () => {
  it("١ — `at(-1)` مقابلَ `last_sequence` في ملفٍّ متزامنٍ: مخالفةٌ", () => {
    const source = concurrent("expect(positions.at(-1)?.sequence).toBe(row.last_sequence);");
    const violations = sequenceWitnessViolationsIn(FILE, source);
    expect(violations.length).toBe(1);
    expect(violations[0]?.line).toBe(2);
  });

  it("٢ — السطرُ الذي أسقطَ `main` حرفاً (التشغيلُ 35431980350): مخالفةٌ", () => {
    const source = concurrent(
      "expect(byChannel.get(firstRow.id)?.at(-1)).toBe(firstRow.last_sequence);",
    );
    expect(sequenceWitnessViolationsIn(FILE, source).length).toBe(1);
  });

  it("٣ — الاتّجاهُ المعكوسُ (`last_sequence` أوّلاً): مخالفةٌ أيضاً", () => {
    const source = concurrent("expect(row.last_sequence).toBe(positions.at(-1)?.sequence);");
    expect(sequenceWitnessViolationsIn(FILE, source).length).toBe(1);
  });

  it("٤ — `pop()` و`[x.length - 1]` صيغتانِ للشيءِ نفسِه: مخالفتانِ", () => {
    const popped = concurrent("expect(sequences.pop()).toBe(row.last_sequence);");
    const indexed = concurrent("expect(sequences[sequences.length - 1]).toBe(row.last_sequence);");
    expect(sequenceWitnessViolationsIn(FILE, popped).length).toBe(1);
    expect(sequenceWitnessViolationsIn(FILE, indexed).length).toBe(1);
  });

  it("٥ — التوكيدُ الممتدُّ على أسطرٍ يُقرأُ عبارةً واحدةً: مخالفةٌ", () => {
    const source = concurrent(
      ["expect(", "  byChannel.get(row.id)?.at(-1),", ").toBe(row.last_sequence);"].join("\n"),
    );
    expect(sequenceWitnessViolationsIn(FILE, source).length).toBe(1);
  });

  it("٦ — البديلُ الصادقُ `Math.max(...)`: سليمٌ", () => {
    const source = concurrent("expect(Math.max(...sequences)).toBe(row.last_sequence);");
    expect(sequenceWitnessViolationsIn(FILE, source)).toEqual([]);
  });

  it("٧ — `at(-1)` بلا حالةِ صفٍّ: سليمٌ — الحاجزُ لا يمنعُ قراءةَ آخرِ عنصرٍ", () => {
    const source = concurrent('expect(driverSent.at(-1)?.text).toContain("مرحباً");');
    expect(sequenceWitnessViolationsIn(FILE, source)).toEqual([]);
  });

  it("٨ — ملفٌّ متتابعٌ بلا `Promise.all`: سليمٌ — الترتيبُ محتومٌ فيهِ", () => {
    const source = "expect(positions.at(-1)?.sequence).toBe(row.last_sequence);";
    expect(sequenceWitnessViolationsIn(FILE, source)).toEqual([]);
  });

  it("٩ — النمطُ داخلَ تعليقٍ: سليمٌ — التعليقُ لا يُنفَّذُ", () => {
    const line = "// expect(positions.at(-1)?.sequence).toBe(row.last_sequence);";
    const block = "/* expect(p.at(-1)).toBe(row.last_sequence); */";
    expect(sequenceWitnessViolationsIn(FILE, concurrent(line))).toEqual([]);
    expect(sequenceWitnessViolationsIn(FILE, concurrent(block))).toEqual([]);
  });

  it("١٠ — كلُّ سباقٍ يُحسَبُ: مخالفتانِ في ملفٍّ واحدٍ تُسمَّيانِ معاً", () => {
    const source = concurrent(
      [
        "expect(first.at(-1)).toBe(firstRow.last_sequence);",
        "expect(second.at(-1)).toBe(secondRow.last_sequence);",
      ].join("\n"),
    );
    expect(sequenceWitnessViolationsIn(FILE, source).length).toBe(2);
  });

  it("١١ — `Promise.allSettled` و`Promise.race` تزامنٌ أيضاً", () => {
    const settled = [
      "await Promise.allSettled([a(), b()]);",
      "expect(p.at(-1)).toBe(row.last_sequence);",
    ].join("\n");
    const raced = [
      "await Promise.race([a(), b()]);",
      "expect(p.at(-1)).toBe(row.last_sequence);",
    ].join("\n");
    expect(sequenceWitnessViolationsIn(FILE, settled).length).toBe(1);
    expect(sequenceWitnessViolationsIn(FILE, raced).length).toBe(1);
  });

  it("١٢ — ملفُّ السالباتِ هذا مُستثنىً بالاسمِ، ولا يُستثنى غيرُه", () => {
    const planted = "tests/unit/check-sequence-witness-order.test.ts";
    expect(PLANTED_NEGATIVE_FILES.has(planted)).toBe(true);
    expect(PLANTED_NEGATIVE_FILES.size).toBe(1);
    const source = concurrent("expect(p.at(-1)).toBe(row.last_sequence);");
    expect(sequenceWitnessViolationsIn(planted, source)).toEqual([]);
    expect(sequenceWitnessViolationsIn("tests/integration/other.test.ts", source).length).toBe(1);
  });

  it("١٣ — الملفُّ الحقيقيُّ الذي أسقطَ CI نظيفٌ الآنَ", async () => {
    const path = "tests/integration/location-race-conditions.test.ts";
    const source = await Bun.file(path).text();
    expect(sequenceWitnessViolationsIn(path, source)).toEqual([]);
  });
});
