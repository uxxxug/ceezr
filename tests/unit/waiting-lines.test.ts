/**
 * الغرض: تثبيتُ سلوك سطرِ الانتظار المتغيّر — ثابتٌ لنفس اللحظة، ومختلفٌ بين
 *   طلبٍ وطلب، ومن قائمةِ عائلته لا من غيرها، وبلغة المستخدم.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14.
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: زيادةُ البدائل لا تكسر هذه الاختبارات لأنها تقرأ القائمة
 *   من الوحدة نفسها لا من أرقامٍ مكتوبة هنا.
 */
import { describe, expect, it } from "bun:test";
import {
  type WaitingFamily,
  waitBucket,
  waitingLine,
  waitingVariants,
} from "../../packages/application/bots/waiting-lines.ts";

const FAMILIES: readonly WaitingFamily[] = [
  "riderSearching",
  "riderSearchingDelivery",
  "riderStillSearching",
  "driverAvailable",
];

describe("سطرُ الانتظار الحيّ", () => {
  it("نفسُ البذرة تُعطي نفسَ السطر — فلا يقفز النصّ في ردَّين لنفس الطلب", () => {
    for (const family of FAMILIES) {
      const first = waitingLine(family, "order-42", "ar");
      const second = waitingLine(family, "order-42", "ar");
      expect(second).toBe(first);
    }
  });

  it("السطرُ من قائمةِ عائلته لا من عائلةٍ أخرى", () => {
    for (const family of FAMILIES) {
      const line = waitingLine(family, "order-7", "ar");
      expect(waitingVariants(family, "ar")).toContain(line);
    }
  });

  /**
   * الغرضُ من الميزة كلِّها: ألّا يقرأ المستخدمُ الجملةَ نفسَها في كلّ طلب. فلو
   * جاءت كلُّ البذور بسطرٍ واحد لكانت الوحدةُ موجودةً بلا أثر.
   */
  it("بذورٌ مختلفة تُغطّي أكثرَ من سطرٍ واحد من العائلة", () => {
    for (const family of FAMILIES) {
      const seen = new Set<string>();
      for (let index = 0; index < 200; index += 1) {
        seen.add(waitingLine(family, `order-${index}`, "ar"));
      }
      expect(seen.size).toBe(waitingVariants(family, "ar").length);
    }
  });

  it("لكلّ عائلةٍ بدائلُ متمايزةٌ فعلاً — لا مفتاحان بنفس النصّ", () => {
    for (const family of FAMILIES) {
      const variants = waitingVariants(family, "ar");
      expect(variants.length).toBeGreaterThan(1);
      expect(new Set(variants).size).toBe(variants.length);
    }
  });

  it("يردّ بلغة المستخدم: الإنجليزية ليست العربية، والمجهولةُ تعود إلى العربية", () => {
    const english = waitingLine("riderSearching", "order-9", "en");
    expect(waitingVariants("riderSearching", "en")).toContain(english);
    expect(english).not.toBe(waitingLine("riderSearching", "order-9", "ar"));
    // اللغةُ غير المدعومة لا تُنتج مفتاحاً خاماً ولا فراغاً
    expect(waitingVariants("riderSearching", "ar")).toContain(
      waitingLine("riderSearching", "order-9", "fr"),
    );
  });

  describe("دلاءُ دقائق الانتظار", () => {
    it("ثلاثُ دقائق في دلوٍ واحد، فلا يتغيّر السطرُ مع كلّ تحديث", () => {
      expect(waitBucket(0)).toBe(waitBucket(2));
      expect(waitBucket(3)).toBe(waitBucket(5));
      expect(waitBucket(2)).not.toBe(waitBucket(3));
    });

    it("لا دلوَ سالباً — ساعةٌ مغلوطةٌ لا تُنتج مفتاحاً غريباً", () => {
      expect(waitBucket(-10)).toBe(waitBucket(0));
    });

    it("مع طول الانتظار يتغيّر السطر فعلاً لا يجمُد على جملةٍ واحدة", () => {
      const lines = new Set<string>();
      for (let minutes = 0; minutes < 60; minutes += 1) {
        lines.add(waitingLine("riderStillSearching", `order-3:${waitBucket(minutes)}`, "ar"));
      }
      expect(lines.size).toBeGreaterThan(1);
    });
  });
});
