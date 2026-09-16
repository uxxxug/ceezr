/**
 * الغرض: حراسةُ حدِّ المحوِّلِ في `BUG-008` بلا قاعدةٍ: أنّ حكمَ «إعادةُ تسليمٍ
 *   لنفسِ المطالِبِ الفائز» يُقرأ من **مغلَّفِ القاعدةِ** (`duplicate`) لا يُستنبَط
 *   في `JS`، وأنّ فشلَ المطالبةِ يخرج `duplicate = false` فلا يُشتبَه بتكرارٍ،
 *   وأنّ مغلَّفاً قديماً بلا الحقلِ يُقرأ إسناداً أوّلَ كما كان قبلَ البندِ.
 * الحالة: اختبار فعلي — بديلٌ للـ`sql` يسجّل النصَّ والمعاملات؛ لا قاعدةَ ههنا.
 *   والحكمُ نفسُه — أيُّ سائقٍ يفوز، ومتى تكون الإعادةُ تكراراً حقّاً — لا يُقاس
 *   إلَّا على `PostgreSQL` حقيقيٍّ، وموضعُه
 *   `tests/integration/claim-ride-duplicate-delivery.test.ts`. فهذا الملفُّ يحرسُ
 *   **ترجمةَ المغلَّفِ**، وذاك يحرسُ الحكمَ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: لا يُضاف ههنا استنباطٌ للتكرارِ من الحالةِ أو من الإسنادِ ولو
 *   محاكاةً — حَكَمٌ ثانٍ في مزدوجِ اختبارٍ يُخفي اختلافَ المزدوجِ عن القاعدةِ
 *   (ADR 0053 §٦).
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createDispatchRpc } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeSql(result: unknown | { readonly throws: true }): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const tagged = async (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    if (typeof result === "object" && result !== null && "throws" in result) {
      throw new Error("فشلُ اتصالٍ مُصنَّع");
    }
    return [{ result }];
  };
  // `F8-01`: صارت الدعوةُ تجري داخلَ معاملةٍ (`withRequestContext`)، فالمُزيَّفُ
  // يلزمُه `begin` يُمرِّرُ المُوسومَ نفسَه. ولا سياقَ ارتباطٍ في هذا الاختبارِ،
  // فلا `set_config` يُسجَّلُ — وهوَ ما يُثبتُه `calls` بطولِه ونصِّه.
  const sql = Object.assign(tagged, {
    begin: (run: (tx: unknown) => unknown) => run(sql),
  }) as unknown as Sql;
  return { sql, calls };
}

const ORDER = "22222222-2222-4222-8222-222222222222" as OrderId;
const DRIVER = "11111111-1111-4111-8111-111111111111" as DriverId;

const RIDER = {
  telegram_id: 900_100,
  language_code: "ar",
  full_name: "راكبٌ للتجربة",
};

describe("ترجمةُ مغلَّفِ claim_ride على حدِّ المحوِّل — BUG-008", () => {
  it("إسنادٌ أوّلُ: `duplicate = false` والراكبُ يخرج للإخطار", async () => {
    const { sql, calls } = fakeSql({
      ok: true,
      duplicate: false,
      city_id: "33333333-3333-4333-8333-333333333333",
      rider: RIDER,
      driver_name: "سائقُ التجربة",
      driver_plate: "أ ب ج 1001",
      driver_vehicle: "sedan",
    });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(true);
    expect(result.value.duplicate).toBe(false);
    expect(String(result.value.rider?.telegramId)).toBe("900100");
    expect(result.value.driverPlate).toBe("أ ب ج 1001");
    // المعرِّفانِ يُمرَّرانِ معاملَينِ لا موصولَينِ في نصِّ الجملةِ.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual([ORDER, DRIVER]);
    expect(calls[0]?.text).not.toContain(ORDER);
  });

  it("إعادةُ تسليمٍ لنقرةِ الفائز: `duplicate = true` ونجاحٌ لا فشل", async () => {
    const { sql } = fakeSql({
      ok: true,
      duplicate: true,
      city_id: "33333333-3333-4333-8333-333333333333",
      rider: null,
      driver_name: "سائقُ التجربة",
      driver_plate: "أ ب ج 1001",
      driver_vehicle: "sedan",
    });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // المطالبةُ قائمةٌ — فلا يُقال للفائزِ «سبقك سائقٌ آخر».
    expect(result.value.claimed).toBe(true);
    expect(result.value.duplicate).toBe(true);
    expect(result.value.reason).toBeNull();
    // ولا راكبَ يخرج، فيمتنعُ الإخطارُ الثاني من مصدرِه لا بفحصٍ لاحق.
    expect(result.value.rider).toBeNull();
  });

  it("فشلُ المطالبةِ: `duplicate = false` والسببُ يخرج كما جاء", async () => {
    const { sql } = fakeSql({ ok: false, error: "ORDER_NOT_CLAIMABLE" });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimed).toBe(false);
    expect(result.value.duplicate).toBe(false);
    expect(result.value.reason).toBe("ORDER_NOT_CLAIMABLE");
    expect(result.value.rider).toBeNull();
    expect(result.value.cityId).toBeNull();
  });

  it("مغلَّفٌ قديمٌ بلا حقلِ `duplicate` يُقرأ إسناداً أوّلَ لا تكراراً", async () => {
    const { sql } = fakeSql({
      ok: true,
      city_id: "33333333-3333-4333-8333-333333333333",
      rider: RIDER,
      driver_name: "سائقُ التجربة",
      driver_plate: "أ ب ج 1001",
      driver_vehicle: "sedan",
    });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.duplicate).toBe(false);
    expect(result.value.claimed).toBe(true);
  });

  it("حقلٌ غيرُ منطقيٍّ لا يُقرأ صدقاً: `duplicate` نصّاً يخرج `false`", async () => {
    const { sql } = fakeSql({
      ok: true,
      duplicate: "true",
      city_id: "33333333-3333-4333-8333-333333333333",
      rider: RIDER,
      driver_name: "سائقُ التجربة",
      driver_plate: "أ ب ج 1001",
      driver_vehicle: "sedan",
    });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.duplicate).toBe(false);
  });

  it("ردٌّ غيرُ مفهومٍ عطلٌ صريحٌ لا نجاحٌ ولا تكرار", async () => {
    const { sql } = fakeSql("ليس مغلَّفاً");

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(false);
  });

  it("فشلُ الاتّصالِ يخرج عطلاً ولا يُلفَّق نجاحاً مكرَّراً", async () => {
    const { sql } = fakeSql({ throws: true });

    const result = await createDispatchRpc(sql).claimRide(ORDER, DRIVER);

    expect(result.ok).toBe(false);
  });
});
