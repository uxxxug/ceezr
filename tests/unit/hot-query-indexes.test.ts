/**
 * الغرض: `F7-02` / `CAP-005` — ثوابتُ سجلِّ فهارسِ الاستعلاماتِ الساخنةِ ودالّتا
 *   قراءتِه: استخراجُ الأعمدةِ وشرطِ الفهرسِ الجزئيِّ، وهما ما يبني عليهِ الحاجزُ
 *   حكمَه بالتكرارِ. والاختبارُ يُثبِتُ الحدَّ كما يُثبِتُ النجاحَ.
 *
 * الحالة: اختبارُ وحدةٍ — بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: كلُّ فهرسٍ يُضافُ إلى السجلِّ.
 * ما لا يفعله: لا يُنفِّذُ `explain` ولا يتّصلُ بقاعدةٍ — الخطّةُ تُقاسُ في
 *   `tests/integration/hot-query-index-plans.test.ts` على محرِّكٍ حقيقيٍّ.
 */

import { describe, expect, it } from "bun:test";
import {
  HOT_QUERY_INDEX_PHASE,
  HOT_QUERY_INDEXES,
  hotIndexByName,
  indexColumnsOf,
  indexPredicateOf,
} from "../../scripts/lib/hot-query-indexes.ts";

describe("F7-02 — سجلُّ فهارسِ الاستعلاماتِ الساخنةِ", () => {
  it("١ — ستّةُ فهارسَ، أسماؤها ورُتبُها فريدةٌ ومتّصلةٌ من واحدٍ", () => {
    expect(HOT_QUERY_INDEXES.length).toBe(6);
    const names = HOT_QUERY_INDEXES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
    const ranks = HOT_QUERY_INDEXES.map((entry) => entry.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("٢ — لكلِّ فهرسٍ مُستدعٍ إنتاجيٌّ مُصرَّحٌ وسببٌ مكتوبٌ — القاعدةُ 0.1", () => {
    for (const entry of HOT_QUERY_INDEXES) {
      expect(entry.callers.length).toBeGreaterThan(0);
      expect(entry.why.length).toBeGreaterThan(40);
      for (const caller of entry.callers) {
        expect(caller.file.startsWith("/")).toBe(false);
        expect(caller.what.length).toBeGreaterThan(10);
      }
    }
  });

  it("٣ — اسمُ الهجرةِ طابعٌ من أربعةَ عشرَ رقماً وامتدادُه `.sql`", () => {
    for (const entry of HOT_QUERY_INDEXES) {
      expect(entry.migration).toMatch(/^[0-9]{14}_[a-z0-9_]+\.sql$/);
    }
  });

  it("٤ — الاستعلامُ المُمثِّلُ يذكرُ جدولَ الفهرسِ ولا يحملُ فاصلةً منقوطةً", () => {
    for (const entry of HOT_QUERY_INDEXES) {
      expect(entry.probe).toContain(entry.table);
      expect(entry.probe).not.toContain(";");
    }
  });

  it("٥ — الطورُ المُعلَنُ `index` وحدَه — بلا معاملةٍ (F7-07)", () => {
    expect(HOT_QUERY_INDEX_PHASE).toBe("index");
  });

  it("٦ — القراءةُ بالاسمِ تُرجِعُ الفهرسَ، وبغيرِه `undefined` لا استثناءً", () => {
    expect(hotIndexByName("orders_rider_status_idx")?.table).toBe("orders");
    expect(hotIndexByName("لا_وجودَ_لهُ")).toBeUndefined();
  });
});

describe("F7-02 — استخراجُ أعمدةِ الفهرسِ", () => {
  it("٧ — الأعمدةُ بترتيبِها، و`desc` تُنزَعُ فلا تُغيِّرُ المطابقةَ", () => {
    expect(
      indexColumnsOf("create index concurrently if not exists i on orders (a, b desc)", "orders"),
    ).toEqual(["a", "b"]);
  });

  it("٨ — الفهرسُ على جدولٍ آخرَ لا يُقرأُ على أنّهُ فهرسُ هذا الجدولِ", () => {
    expect(indexColumnsOf("create index i on riders (a)", "orders")).toBeNull();
  });

  it("٩ — `using gist` مقبولةٌ، وما ليسَ إنشاءَ فهرسٍ يُرجِعُ `null`", () => {
    expect(indexColumnsOf("create index i on orders using gist (pickup)", "orders")).toEqual([
      "pickup",
    ]);
    expect(indexColumnsOf("select 1 from orders", "orders")).toBeNull();
  });

  it("١٠ — `create unique index` كذلكَ فهرسٌ يُحاكَمُ", () => {
    expect(indexColumnsOf("create unique index u on orders (city_id, status)", "orders")).toEqual([
      "city_id",
      "status",
    ]);
  });
});

describe("F7-02 — شرطُ الفهرسِ الجزئيِّ", () => {
  it("١١ — الفهرسُ الكاملُ شرطُه فراغٌ، فلا يُخلَطُ بالجزئيِّ", () => {
    expect(indexPredicateOf("create index i on orders (rider_id, status)")).toBe("");
  });

  it("١٢ — شرطُ الجزئيِّ يُطبَّعُ فراغاً وحالةَ حرفٍ وفاصلةً منقوطةً", () => {
    expect(
      indexPredicateOf("create index i on orders (city_id)\n  WHERE status = 'searching';"),
    ).toBe("status = 'searching'");
  });

  it("١٣ — فهرسانِ بنفسِ الأعمدةِ وشرطَينِ مختلفَينِ ليسا مُكرِّرَينِ", () => {
    const partial = "create index a on orders (city_id, created_at) where status = 'searching'";
    const full = "create index b on orders (city_id, created_at)";
    expect(indexColumnsOf(partial, "orders")).toEqual(indexColumnsOf(full, "orders"));
    expect(indexPredicateOf(partial)).not.toBe(indexPredicateOf(full));
  });
});
