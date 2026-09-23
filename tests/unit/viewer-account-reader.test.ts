/**
 * الغرض: اختبارُ محوّلِ قراءةِ حسابِ صاحبِ الجلسة (`F1-05`): أنّه **يقرأ ولا
 *   يكتب**، وأنّ الاستعلامَ مُمَعلَمٌ لا مبنيٌّ بالوصل، وأنّ معرّفاً غيرَ رقميٍّ
 *   لا يُرسَل إلى القاعدةِ أصلاً، وأنّ دوراً مجهولاً خطأٌ معلَنٌ لا تخشين.
 * الحالة: اختبار فعلي — بديلٌ للـ`sql` يسجّل النصَّ والمعاملات؛ لا قاعدةَ ههنا.
 *   والاتصالُ بقاعدةٍ حقيقيةٍ يجري في وظيفةِ التكاملِ لا في هذا الملف.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يومَ يُقرَّر ربطُ المستخدمِ عندَ أوّلِ جلسةٍ (القسم 9.8 خطوة 4)
 *   فذاك منفذٌ آخرُ يكتب، ويبقى هذا قارئاً كما هو.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";

interface Recorded {
  readonly text: string;
  readonly params: readonly unknown[];
}

function fakeSql(rows: readonly Record<string, unknown>[] | { readonly throws: true }): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, params: readonly unknown[] = []) => {
    calls.push({ text, params });
    if ("throws" in rows) throw new Error("فشلُ اتصالٍ مُصنَّع");
    return rows;
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

describe("قارئُ حسابِ صاحبِ الجلسة: القراءة", () => {
  it("١) يعيد الدورَ والحجبَ من الصفِّ المقروء", async () => {
    const { sql } = fakeSql([{ role: "driver", is_blocked: false, language_code: "ar" }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("متوقَّع نجاح");
    expect(result.value).toEqual({ role: "driver", isBlocked: false, languageCode: "ar" });
  });

  it("٢) الاستعلامُ مُمَعلَمٌ ويقرأ ثلاثةَ أعمدةٍ فقط", async () => {
    const { sql, calls } = fakeSql([{ role: "rider", is_blocked: false }]);
    await createViewerAccountReader(sql).findByTelegramUserId("5550001");

    expect(calls.length).toBe(1);
    const call = calls[0];
    if (call === undefined) throw new Error("متوقَّع استعلام");
    expect(call.params).toEqual(["5550001"]);
    expect(call.text).toContain("$1");
    // المعرّفُ لا يُوصَل داخلَ النصِّ: الوصلُ هو طريقُ الحقنِ لا التمعيل.
    expect(call.text).not.toContain("5550001");
  });

  it("٣) لا `insert` ولا `update` ولا `delete` في نصِّ الاستعلام", async () => {
    const { sql, calls } = fakeSql([{ role: "rider", is_blocked: false }]);
    await createViewerAccountReader(sql).findByTelegramUserId("5550001");

    const text = (calls[0]?.text ?? "").toLowerCase();
    expect(text.startsWith("select")).toBe(true);
    for (const forbidden of ["insert", "update", "delete", "upsert"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("٤) لا صفَّ = `null` لا خطأً", async () => {
    const { sql } = fakeSql([]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");
    expect(result.ok && result.value).toBeNull();
  });

  it("٥) حسابٌ محجوبٌ يُعاد بحقلِ حجبٍ صحيحٍ لا يُطوى", async () => {
    const { sql } = fakeSql([{ role: "admin", is_blocked: true, language_code: "ar" }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");
    expect(result.ok && result.value).toEqual({
      role: "admin",
      isBlocked: true,
      languageCode: "ar",
    });
  });

  it("٦) `support` دورٌ معروفٌ في القاعدةِ يُعاد كما هو", async () => {
    const { sql } = fakeSql([{ role: "support", is_blocked: false }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");
    expect(result.ok && result.value?.role).toBe("support");
  });
});

describe("قارئُ حسابِ صاحبِ الجلسة: الرفض", () => {
  it("٧) معرّفٌ غيرُ رقميٍّ لا يُرسَل إلى القاعدةِ إطلاقاً", async () => {
    const { sql, calls } = fakeSql([{ role: "admin", is_blocked: false }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001; drop");

    expect(result.ok && result.value).toBeNull();
    expect(calls).toEqual([]);
  });

  it("٨) معرّفٌ فارغٌ لا يُرسَل ولا يُعيد حساباً", async () => {
    const { sql, calls } = fakeSql([{ role: "admin", is_blocked: false }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("");
    expect(result.ok && result.value).toBeNull();
    expect(calls).toEqual([]);
  });

  it("٩) دورٌ لا يعرفه الكودُ = `UNSUPPORTED_ROLE` لا تخشينٌ إلى راكب", async () => {
    const { sql } = fakeSql([{ role: "wizard", is_blocked: false }]);
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("متوقَّع رفض");
    expect(result.error).toEqual({ code: "VIEWER_LOOKUP_FAILED", reason: "UNSUPPORTED_ROLE" });
  });

  it("١٠) فشلُ القاعدةِ = `READER_ERROR` بلا نصِّ خطأٍ ولا معرّفٍ في العائد", async () => {
    const { sql } = fakeSql({ throws: true });
    const result = await createViewerAccountReader(sql).findByTelegramUserId("5550001");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("متوقَّع رفض");
    expect(result.error).toEqual({ code: "VIEWER_LOOKUP_FAILED", reason: "READER_ERROR" });
    expect(JSON.stringify(result.error)).not.toContain("5550001");
  });
});
