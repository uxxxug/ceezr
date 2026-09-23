/**
 * الغرض: اختبارُ محوّلِ كتابةِ لغةِ الواجهةِ (`PD-030`): أنّه **يكتب لغةً وحدَها**،
 *   وأنّ الاستعلامَ مُمَعلَمٌ لا مبنيٌّ بالوصل، وأنّ معرّفاً غيرَ رقميٍّ لا يُرسَل
 *   إلى القاعدةِ، وأنّ لغةً غيرَ مسموحةٍ تُرفَض، وأنّ صفًّا غيرَ موجودٍ يُفشَل.
 * الحالة: اختبار فعلي — بديلٌ للـ`sql` يسجّل النصَّ والمعاملات؛ لا قاعدةَ ههنا.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createViewerAccountLanguageWriter } from "../../packages/infrastructure/identity/viewer-language.ts";

interface Recorded {
  readonly text: string;
  readonly params: readonly unknown[];
}

function fakeSql(rows: readonly Record<string, unknown>[] = [{ telegram_id: "123" }]): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, params: readonly unknown[] = []) => {
    calls.push({ text, params });
    return rows;
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

describe("كاتبُ لغةِ الحساب: الكتابة (PD-030)", () => {
  it("١) يكتب اللغةَ بحدٍّ مُمَعلَمٍ لا مبنيٍّ بالوصل", async () => {
    const { sql, calls } = fakeSql();
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("5550001", "en");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("update users set language_code = $1");
    expect(calls[0]?.params).toEqual(["en", "5550001"]);
  });

  it("٢) معرّفٌ غيرُ رقميٍّ لا يُرسَل إلى القاعدة", async () => {
    const { sql, calls } = fakeSql();
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("abc", "en");

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("٣) لغةٌ غيرُ مسموحةٍ تُرفَض قبلَ القاعدة", async () => {
    const { sql, calls } = fakeSql();
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("5550001", "fr");

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("٤) خطأُ القاعدةِ يُعاد سبباً مصنَّفاً لا ٥٠٠", async () => {
    const sql: Sql = {
      unsafe: (() => {
        throw new Error("connection lost");
      }) as unknown as Sql["unsafe"],
    } as unknown as Sql;
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("5550001", "ar");

    expect(result.ok).toBe(false);
  });

  it("٥) اللغاتُ المسموحةُ: ar و en و ur", async () => {
    for (const lang of ["ar", "en", "ur"]) {
      const { sql } = fakeSql();
      const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("123", lang);
      expect(result.ok).toBe(true);
    }
  });

  it("٦) صفٌّ غيرُ موجودٍ (مستخدمٌ غيرُ مسجَّلٍ) يُفشَل لا ينجحُ صامتاً", async () => {
    const { sql } = fakeSql([]); // RETURNING returns no rows
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("9999999", "en");

    expect(result.ok).toBe(false);
  });

  it("٧) الاستعلامُ يستخدم RETURNING لا update بلا تحقق", async () => {
    const { sql, calls } = fakeSql();
    await createViewerAccountLanguageWriter(sql).updateLanguageCode("123", "en");

    expect(calls[0]?.text).toContain("returning");
  });
});
