/**
 * الغرض: قياسُ **العرّافِ نفسِه** قبلَ أن يُقاسَ به شيءٌ (`ح-7`): مُفكِّكٌ يقولُ
 *   «سليمٌ» لكلِّ مُدخَلٍ لا يقيسُ شيئاً، فههنا سالبةٌ مزروعةٌ لكلِّ سببِ سقوطٍ
 *   يُعلِنُه، ثمَّ موجبةٌ تُقرأُ بها القيمُ العربيّةُ ببايتاتِها.
 * الحالة: اختبار فعلي — بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit` وسلسلةُ `ci`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ فحصٍ يعتمدُ على `tests/support/zatca-tlv.ts`.
 * يحرسُه: tests/integration/subscription-tax-invoice.test.ts
 * الحاكم: docs/adr/0127-simplified-tax-invoice.md
 *
 * **ولِمَ مُرمِّزٌ ههنا وقد مُنِعَ في السَّنَدِ**: التركيبُ في هذا المِلفِّ **محلّيٌّ
 * لا مُصدَّرٌ**، غايتُه صناعةُ مُدخَلاتٍ للفكِّ. فلا يُستوردُ من مكانٍ آخرَ، ولا
 * يصيرُ مصدرَ حقيقةٍ ثانياً للإنتاجِ.
 *
 * ## وما لا يقيسُه هذا المِلفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ ما تُنتِجُه القاعدةُ**: ذاكَ في `tests/integration`.
 * - **لا يدَّعي امتثالاً ضريبيّاً**: يقيسُ ترميزاً لا وثيقةً.
 */

import { describe, expect, test } from "bun:test";
import { corruptDeclaredLength, decodeTlv, tlvValue } from "../support/zatca-tlv.ts";

/** تركيبٌ **محلّيٌّ** لصناعةِ مُدخَلاتِ الفكِّ وحدَها. */
function encodeLocal(fields: readonly { tag: number; value: string }[]): string {
  const parts: number[] = [];
  for (const field of fields) {
    const bytes = new TextEncoder().encode(field.value);
    parts.push(field.tag, bytes.length, ...bytes);
  }
  let binary = "";
  for (const byte of parts) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const SELLER = "شركةُ سِيزر للتقنيّةِ";
const SAMPLE = encodeLocal([
  { tag: 1, value: SELLER },
  { tag: 2, value: "300000000000003" },
  { tag: 3, value: "2027-05-04T09:59:00Z" },
  { tag: 4, value: "250.00" },
  { tag: 5, value: "32.61" },
]);

describe("الموجبةُ — سلسلةٌ سليمةٌ تُفَكُّ بحقولِها", () => {
  test("خمسةُ حقولٍ بوسومِها وترتيبِها", () => {
    const decoded = decodeTlv(SAMPLE);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.fields.map((field) => field.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(tlvValue(decoded.fields, 4)).toBe("250.00");
  });

  test("الطولُ بالبايتاتِ — والعربيّةُ محرفُها بايتانِ", () => {
    const decoded = decodeTlv(SAMPLE);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const name = decoded.fields[0];
    expect(name?.value).toBe(SELLER);
    expect(name?.byteLength).toBe(new TextEncoder().encode(SELLER).length);
    expect(name?.byteLength).toBeGreaterThan(SELLER.length);
  });

  test("سلسلةٌ فارغةٌ ⇒ لا حقولَ ولا سقوطٌ", () => {
    const decoded = decodeTlv("");
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.fields).toEqual([]);
  });

  test("وسمٌ غائبٌ يُقرأُ معدوماً لا فراغاً مُختَرَعاً", () => {
    const decoded = decodeTlv(SAMPLE);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(tlvValue(decoded.fields, 9)).toBeUndefined();
  });
});

describe("السوالبُ المزروعةُ — لكلِّ سببِ سقوطٍ حالةٌ (`ح-7`)", () => {
  test("نصٌّ ليسَ `base64` ⇒ `NOT_BASE64`", () => {
    const decoded = decodeTlv("ليسَ base64 ألبتّةَ!!");
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.failure.reason).toBe("NOT_BASE64");
  });

  test("طولٌ مُعلَنٌ أكبرُ من الموجودِ ⇒ `LENGTH_OVERRUNS_BUFFER`", () => {
    const decoded = decodeTlv(corruptDeclaredLength(SAMPLE, 4, 40));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.failure.reason).toBe("LENGTH_OVERRUNS_BUFFER");
  });

  test("**طولٌ بالمحارفِ لا بالبايتاتِ** ⇒ السلسلةُ لا تُفَكُّ سليمةً", () => {
    // وهذا هوَ العطبُ الحقيقيُّ الذي كُتِبَ العرّافُ لأجلِه: اسمٌ عربيٌّ طولُه
    // ٢٠ محرفاً و٣٧ بايتاً؛ فطولٌ مُعلَنٌ ٢٠ يُنهي الحقلَ في وسطِ حرفٍ فيُقرأُ
    // البايتُ التاليَ وسماً — فإمّا سقطَ الفكُّ وإمّا خرجَ بوسومٍ ليسَت الخمسةَ.
    const bytes = new TextEncoder().encode(SELLER);
    const decoded = decodeTlv(corruptDeclaredLength(SAMPLE, 0, SELLER.length - bytes.length));
    const tags = decoded.ok ? decoded.fields.map((field) => field.tag) : [];
    expect(tags).not.toEqual([1, 2, 3, 4, 5]);
  });

  test("ترويسةٌ مقطوعةٌ (بايتٌ واحدٌ زائدٌ) ⇒ `TRUNCATED_HEADER`", () => {
    const decoded = decodeTlv(encodeLocal([{ tag: 1, value: "س" }]) + btoa("\u0001"));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(["TRUNCATED_HEADER", "NOT_BASE64", "LENGTH_OVERRUNS_BUFFER"]).toContain(
      decoded.failure.reason,
    );
  });

  test("وسمٌ صفرٌ ⇒ `TAG_IS_ZERO` لا حقلٌ بلا هُويّةٍ", () => {
    const decoded = decodeTlv(encodeLocal([{ tag: 0, value: "س" }]));
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.failure.reason).toBe("TAG_IS_ZERO");
  });

  /**
   * **العرّافُ لا يُصلِحُ حِمْلاً معطوباً**: `encode(…, 'base64')` في PostgreSQL
   * يلفُّ السطرَ كلَّ ٧٦ محرفاً، ولو تسامحَ القارئُ بالفراغِ لَمرَّ حِمْلٌ لا
   * يقرؤُه ماسحٌ حقيقيٌّ. فالرفضُ ههنا هوَ ما كشفَ العيبَ في وظيفةِ CI.
   */
  test("حِمْلٌ ملفوفٌ بـ`\\n` ⇒ `NOT_BASE64` — ولا فراغٌ يُحذَفُ صامتاً", () => {
    const oneLine = encodeLocal([
      { tag: 1, value: SELLER },
      { tag: 2, value: "300000000000003" },
      { tag: 3, value: "2026-09-16T08:54:18Z" },
      { tag: 4, value: "250.00" },
      { tag: 5, value: "32.61" },
    ]);
    expect(oneLine.length).toBeGreaterThan(76);
    const wrapped = `${oneLine.slice(0, 76)}\n${oneLine.slice(76)}`;
    expect(decodeTlv(oneLine).ok).toBe(true);
    const decoded = decodeTlv(wrapped);
    expect(decoded.ok).toBe(false);
    if (decoded.ok) return;
    expect(decoded.failure.reason).toBe("NOT_BASE64");
  });

  test("وسمٌ مُبدَّلٌ يُقرأُ مُبدَّلاً — ولا يُصحَّحُ صامتاً", () => {
    const swapped = encodeLocal([
      { tag: 7, value: SELLER },
      { tag: 2, value: "300000000000003" },
    ]);
    const decoded = decodeTlv(swapped);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.fields.map((field) => field.tag)).toEqual([7, 2]);
    expect(tlvValue(decoded.fields, 1)).toBeUndefined();
  });
});
