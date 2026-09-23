/**
 * الغرض: اختبارُ محوّلِ كتابةِ لغةِ الواجهةِ (`PD-030`): أنّه **يكتب لغةً وحدَها**،
 *   وأنّ الاستعلامَ مُمَعلَمٌ لا مبنيٌّ بالوصل، وأنّ معرّفاً غيرَ رقميٍّ لا يُرسَل
 *   إلى القاعدةِ، وأنّ لغةً غيرَ مسموحةٍ تُرفَض.
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

function fakeSql(): {
  sql: Sql;
  calls: Recorded[];
  throws: boolean;
} {
  const calls: Recorded[] = [];
  const throws = false;
  const unsafe = async (text: string, params: readonly unknown[] = []) => {
    calls.push({ text, params });
    if (throws) throw new Error("فشلُ اتصالٍ مُصنَّع");
    return [];
  };
  return { sql: { unsafe } as unknown as Sql, calls, throws };
}

describe("كاتبُ لغةِ الحساب: الكتابة (PD-030)", () => {
  it("١) يكتب اللغةَ بحدٍّ مُمَعلَمٍ لا مبنيٍّ بالوصل", async () => {
    const { sql, calls } = fakeSql();
    const result = await createViewerAccountLanguageWriter(sql).updateLanguageCode("5550001", "en");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("update users set language_code = $1");
    expect(calls[0].params).toEqual(["en", "5550001"]);
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
      unsafe: (async () => {
        throw new Error("connection lost");
      }) as typeof sql.unsafe,
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
});
