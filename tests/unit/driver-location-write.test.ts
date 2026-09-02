/**
 * الغرض: اختبارُ الكاتبِ الوحيدِ للموقعِ القانونيِّ (`BUG-001`) بلا قاعدةٍ: أنّ
 *   شرطَ القِدَمِ **مكتوبٌ في `where` داخلَ جملةِ الكتابةِ نفسِها** لا مقارنةً في
 *   `JS`، وأنّ الطابعَ يُمرَّر معاملاً لا موصولاً في النصِّ، وأنّ جوابَ القاعدةِ
 *   يُترجَم حكماً صريحاً (`accepted` · `stale` · `no_driver`).
 * الحالة: اختبار فعلي — بديلٌ للـ`sql` يسجّل النصَّ والمعاملات؛ لا قاعدةَ ههنا.
 *   والحكمُ نفسُه — أيُّ الكتابتَين تُقبَل عندَ التزاحمِ — لا يُقاس إلَّا على
 *   `PostgreSQL` حقيقيٍّ، وموضعُه `tests/integration/driver-location-cas.test.ts`.
 *   فهذا الملفُّ يحرسُ **شكلَ الجملةِ وترجمةَ جوابِها**، وذاك يحرسُ الحكمَ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: لا يُضاف ههنا حكمٌ على «الأحدثِ» ولو محاكاةً — حَكَمٌ ثانٍ في
 *   مزدوجِ اختبارٍ يُخفي اختلافَ المزدوجِ عن القاعدةِ (ADR 0053 §٦).
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeSql(rows: readonly Record<string, unknown>[] | { readonly throws: true }): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const tagged = async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    if ("throws" in rows) throw new Error("فشلُ اتصالٍ مُصنَّع");
    return rows;
  };
  return { sql: tagged as unknown as Sql, calls };
}

const DRIVER = "11111111-1111-4111-8111-111111111111" as DriverId;
const AT_MS = Date.UTC(2024, 0, 1, 0, 0, 30);

const QUALITY = {
  recordedAtMs: AT_MS,
  accuracyMeters: 12,
  verdict: "ACCEPT",
} as const;

const POINT = { latitude: 21.4858, longitude: 39.1925 };

describe("الكاتبُ الوحيدُ للموقعِ القانونيِّ — شكلُ الجملةِ", () => {
  it("١) الشرطُ في `where` داخلَ جملةِ التحديثِ — لا قراءةٌ سابقةٌ عليها", async () => {
    const { sql, calls } = fakeSql([{ accepted: true }]);
    await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);

    // جملةٌ واحدةٌ لا اثنتانِ: قراءةٌ ثمّ كتابةٌ تتركُ نافذةَ تزاحمٍ.
    expect(calls).toHaveLength(1);
    const text = (calls[0]?.text ?? "").toLowerCase();
    expect(text).toContain("update drivers");
    expect(text).toContain("last_location_recorded_at is null or");
    expect(text).toContain("<=");
  });

  it("٢) الحكمُ على `last_location_recorded_at` لا على `last_location_at`", async () => {
    const { sql, calls } = fakeSql([{ accepted: true }]);
    await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);

    const text = (calls[0]?.text ?? "").toLowerCase();
    const guardClause = text.slice(text.indexOf(" where "));
    // `last_location_at` يتقدّم بـ`now()` مع كلِّ كتابةٍ فلا يرفض شيئاً أبداً.
    expect(guardClause).toContain("last_location_recorded_at");
    expect(guardClause).not.toContain("last_location_at is");
  });

  it("٣) لا `greatest` ولا `max` — القيمةُ تُكتَب كما وصلت أو لا تُكتَب", async () => {
    const { sql, calls } = fakeSql([{ accepted: true }]);
    await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);

    const text = (calls[0]?.text ?? "").toLowerCase();
    for (const forbidden of ["greatest(", "max(", "coalesce(d.last_location_recorded_at"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("٤) الطابعُ معاملٌ مُمَعلَمٌ لا موصولٌ في النصِّ", async () => {
    const { sql, calls } = fakeSql([{ accepted: true }]);
    await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);

    const call = calls[0];
    if (call === undefined) throw new Error("متوقَّع استعلام");
    expect(call.values).toContain(QUALITY.accuracyMeters);
    expect(call.values).toContain(QUALITY.verdict);
    const stamps = call.values.filter((v): v is Date => v instanceof Date);
    expect(stamps.length).toBeGreaterThan(0);
    for (const stamp of stamps) expect(stamp.getTime()).toBe(AT_MS);
    expect(call.text).not.toContain(String(AT_MS));
  });
});

describe("الكاتبُ الوحيدُ للموقعِ القانونيِّ — ترجمةُ جوابِ القاعدةِ", () => {
  it("٥) صفٌّ مكتوبٌ ⇒ `accepted`", async () => {
    const { sql } = fakeSql([{ accepted: true }]);
    const result = await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);
    expect(result.ok && result.value).toEqual({ kind: "accepted" });
  });

  it("٦) صفٌّ قائمٌ لم يُكتَب ⇒ `stale` لا خطأً", async () => {
    const { sql } = fakeSql([{ accepted: false }]);
    const result = await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);
    // الرفضُ ليس عطلاً: الحالةُ سليمةٌ ولم تتراجع.
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ kind: "stale" });
  });

  it("٧) لا صفَّ البتّةَ ⇒ `no_driver` — لا يُخلَط بالأقدمِ", async () => {
    const { sql } = fakeSql([]);
    const result = await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);
    expect(result.ok && result.value).toEqual({ kind: "no_driver" });
  });

  it("٨) عطلُ الاتصالِ يبقى عطلاً معلَناً لا `stale`", async () => {
    const { sql } = fakeSql({ throws: true });
    const result = await createDriverDirectory(sql).updateLocation(DRIVER, POINT, QUALITY);
    expect(result.ok).toBe(false);
  });
});
