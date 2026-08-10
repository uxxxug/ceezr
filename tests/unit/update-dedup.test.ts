/**
 * الغرض: إثبات سلوك مانع تكرار `update_id` وحدوده المعلَنة.
 * الحالة: اختبار وحدة — لا يتطلب قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على مسار الويبهوك
 * ملاحظات مستقبلية: إن نُقل المانع إلى مخزن مشترك، تُنقل حالة النسخ من هنا.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createUpdateDeduplicator,
  DEDUP_MAX_KEYS,
  DEDUP_TTL_MS,
  updateIdOf,
} from "../../apps/gateway/src/routes/update-dedup.ts";

describe("createUpdateDeduplicator", () => {
  it("يقبل الجديد ويرفض المكرَّر", () => {
    const dedup = createUpdateDeduplicator();
    expect(dedup.admit("driver", 1)).toBe(true);
    expect(dedup.admit("driver", 1)).toBe(false);
    expect(dedup.admit("driver", 1)).toBe(false);
  });

  it("يفصل بين البوتين: لكلٍّ عدّاد مستقلّ عند تلغرام", () => {
    const dedup = createUpdateDeduplicator();
    expect(dedup.admit("driver", 7)).toBe(true);
    // الرقم نفسه من بوت آخر تحديثٌ مختلف تماماً، فلا يُلغى بالأول
    expect(dedup.admit("rider", 7)).toBe(true);
  });

  it("يقبل مرّة أخرى بعد انتهاء العمر", () => {
    let clock = 0;
    const dedup = createUpdateDeduplicator(() => clock);
    expect(dedup.admit("driver", 3)).toBe(true);
    clock = DEDUP_TTL_MS - 1;
    expect(dedup.admit("driver", 3)).toBe(false);
    clock = DEDUP_TTL_MS + 1;
    expect(dedup.admit("driver", 3)).toBe(true);
  });

  it("لا تنمو الذاكرة بلا سقف: يُزاح الأقدم عند بلوغ الحدّ", () => {
    const dedup = createUpdateDeduplicator();
    for (let i = 0; i < DEDUP_MAX_KEYS + 500; i += 1) dedup.admit("driver", i);

    expect(dedup.size()).toBeLessThanOrEqual(DEDUP_MAX_KEYS);
    // الأحدث محفوظ
    expect(dedup.admit("driver", DEDUP_MAX_KEYS + 499)).toBe(false);
    // والأقدم أُزيح فيُقبل ثانية — وهذا هو الثمن المقبول للسقف
    expect(dedup.admit("driver", 0)).toBe(true);
  });
});

describe("updateIdOf", () => {
  it("يستخرج الرقم الصحيح", () => {
    expect(updateIdOf({ update_id: 42 })).toBe(42);
    expect(updateIdOf({ update_id: 0 })).toBe(0);
  });

  it("يُعيد null لما ليس عدداً صحيحاً موجباً، فلا يُرفض تحديث شرعي", () => {
    expect(updateIdOf({})).toBeNull();
    expect(updateIdOf({ update_id: "5" })).toBeNull();
    expect(updateIdOf({ update_id: 1.5 })).toBeNull();
    expect(updateIdOf({ update_id: -1 })).toBeNull();
    expect(updateIdOf({ update_id: Number.NaN })).toBeNull();
    expect(updateIdOf({ update_id: null })).toBeNull();
  });
});

describe("حدّ النسخة الواحدة — الشرط الذي يقوم عليه المانع", () => {
  /**
   * المانع في الذاكرة، فصحّته معلَّقة على `numInstances: 1`. ولو رُفع العدد
   * صامتاً لصار المانع ناقص الأثر بلا أن ينبّه أحد. فهذا الاختبار يفشل عند
   * التغيير، ليكون التغيير قراراً واعياً لا انزلاقاً.
   */
  it("render.yaml يُثبّت النسخة الواحدة للبوّابة", () => {
    const yaml = readFileSync(join(import.meta.dir, "../../render.yaml"), "utf-8");
    const instances = [...yaml.matchAll(/numInstances:\s*(\d+)/g)].map((m) => Number(m[1]));

    expect(instances.length).toBeGreaterThan(0);
    for (const count of instances) {
      // إن فشل هذا: راجع apps/gateway/src/routes/update-dedup.ts قبل رفع العدد.
      // المانع في الذاكرة لا يُشارَك بين النسخ، فيلزم نقله إلى مخزن مشترك.
      expect(count).toBe(1);
    }
  });
});
