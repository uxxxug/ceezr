/**
 * الغرض: إثباتُ أنَّ تطبيعَ نصِّ البحثِ في **النطاقِ** يفعلُ ما تَعِدُ به وثيقتُه
 *   حرفاً بحرفٍ، وأنَّ مطابقةَ بدايةِ الكلمةِ تقبلُ ما يقصدُه الكاتبُ وترفضُ ما
 *   لا يقصدُه — على مجموعةٍ مُسمّاةٍ لا على أمثلةٍ مُختارةٍ تُجمِّلُ النتيجةَ.
 * الحالة: اختبار فعلي — دوالُّ نقيّةٌ بلا قاعدةٍ ولا شبكةٍ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI
 * يُتوقع أن يستخدمه لاحقاً: كلُّ بندٍ يزيدُ محرفاً إلى جدولِ الطيِّ.
 * ملاحظات مستقبلية: **التطابقُ مع PostgreSQL ليسَ ههنا** — هوَ في
 *   `tests/integration/destinations.test.ts`. وهذا الملفُّ يُثبِتُ الطرفَ
 *   التايبسكربتيَّ وحدَه، ولا يُدَّعى أنَّه يُثبِتُ الطرفَينِ.
 */

import { describe, expect, it } from "bun:test";
import {
  ALLOWED_CHARACTER_CLASS,
  foldingFrom,
  foldingTo,
  MAX_SEARCH_QUERY_LENGTH,
  MIN_SEARCH_QUERY_LENGTH,
  NORMALIZATION_CORPUS,
  normalizeSearchText,
  readSearchQuery,
  SEARCH_FOLDING,
  wordStartMatch,
} from "../../packages/domain/destinations/search-text.ts";

/**
 * المخرَجُ المتوقَّعُ **مكتوبٌ ههنا حرفاً** لا مُستنبَطٌ بإعادةِ نداءِ الدالّةِ:
 * اختبارٌ يُقارِنُ الدالّةَ بنفسِها يمرُّ على كلِّ عطبٍ. و`NORMALIZATION_CORPUS`
 * مُدخَلاتٌ فقط — لأنَّ حَكَمَها الأخيرَ PostgreSQL في اختبارِ التكاملِ.
 */
const EXPECTED: readonly (readonly [string, string])[] = [
  ["جدة", "جده"],
  ["جده", "جده"],
  ["جِـدَّةُ البَلَد", "جده البلد"],
  ["الإسلامي", "الاسلامي"],
  ["أحمد", "احمد"],
  ["آل سعود", "ال سعود"],
  ["ٱلبلد", "البلد"],
  ["على", "علي"],
  ["مصطفى", "مصطفي"],
  ["مسجدٌ", "مسجد"],
  ["شارع ١٢٣", "شارع 123"],
  ["شارع ۱۲۳", "شارع 123"],
  ["  King   Fahd's  Fountain ", "king fahd s fountain"],
  ["RED SEA MALL", "red sea mall"],
  ["جدة-المدينة", "جده المدينه"],
  ["مطار / الملك", "مطار الملك"],
  ["", ""],
];

describe("تطبيعُ نصِّ البحثِ", () => {
  it("يُطابِقُ كلَّ حالةٍ مكتوبةٍ حرفاً بحرفٍ", () => {
    for (const [input, expected] of EXPECTED) {
      expect(normalizeSearchText(input)).toBe(expected);
    }
  });

  it("كلُّ مُدخَلٍ في المجموعةِ يُطبَّعُ بلا إخفاقٍ", () => {
    for (const input of NORMALIZATION_CORPUS) {
      expect(typeof normalizeSearchText(input)).toBe("string");
    }
  });

  it("المجموعةُ ليسَت رمزيّةَ الحجمِ", () => {
    // مجموعةٌ من حالتَينِ تمرُّ دائماً ولا تُثبِتُ شيئاً؛ والعددُ مذكورٌ لِيُقرأَ
    // انخفاضُه في المراجعةِ لا لِيُزيَّنَ.
    expect(NORMALIZATION_CORPUS.length).toBeGreaterThanOrEqual(18);
    expect(EXPECTED.length).toBeGreaterThanOrEqual(15);
  });

  it("جدولُ الطيِّ: كلُّ مُدخَلٍ محرفٌ واحدٌ، ولا مُدخَلَ مكرَّرٌ", () => {
    const seen = new Set<string>();
    for (const [from, to] of SEARCH_FOLDING) {
      expect([...from].length).toBe(1);
      expect(seen.has(from)).toBe(false);
      seen.add(from);
      expect([...to].length).toBeLessThanOrEqual(1);
    }
  });

  it("المحذوفاتُ في ذيلِ الجدولِ لا في وسطِه", () => {
    // `translate` تحذفُ ما زادَ في `from` عن `to`، فمحرفٌ مقابلُه فراغٌ في وسطِ
    // الجدولِ يُزيحُ كلَّ ما بعدَه فيُطوى حرفٌ إلى حرفٍ لا يقصدُه أحدٌ.
    const deletionStarted = SEARCH_FOLDING.findIndex(([, to]) => to === "");
    if (deletionStarted !== -1) {
      for (const [, to] of SEARCH_FOLDING.slice(deletionStarted)) {
        expect(to).toBe("");
      }
    }
    expect(foldingTo().length).toBeLessThanOrEqual(foldingFrom().length);
  });

  it("يُسقِطُ التشكيلَ والتطويلَ", () => {
    expect(normalizeSearchText("جِـدَّةُ")).toBe("جده");
    expect(normalizeSearchText("مَطَـــار")).toBe("مطار");
  });

  it("يوحِّدُ صورَ الألفِ والياءِ والتاءِ المربوطةِ", () => {
    for (const alif of ["أ", "إ", "آ", "ٱ"]) {
      expect(normalizeSearchText(alif)).toBe("ا");
    }
    expect(normalizeSearchText("ى")).toBe("ي");
    expect(normalizeSearchText("ئ")).toBe("ي");
    expect(normalizeSearchText("ة")).toBe("ه");
    expect(normalizeSearchText("ؤ")).toBe("و");
  });

  it("يوحِّدُ الأرقامَ العربيّةَ والفارسيّةَ إلى اللاتينيّةِ", () => {
    expect(normalizeSearchText("١٢٣٤٥٦٧٨٩٠")).toBe("1234567890");
    expect(normalizeSearchText("۱۲۳")).toBe("123");
  });

  it("يجعلُ ما ليسَ حرفاً ولا رقماً فاصلاً — ولا يلصقُ كلمتَينِ", () => {
    expect(normalizeSearchText("king-fahd")).toBe("king fahd");
    expect(normalizeSearchText("King Fahd's Fountain")).toBe("king fahd s fountain");
    // ولو حُذِفَ الفاصلُ بلا إحلالٍ لَصارَت «kingfahd» كلمةً لا يكتبُها أحدٌ.
    expect(normalizeSearchText("king-fahd")).not.toBe("kingfahd");
  });

  it("يطوي الفراغَ المتكرِّرَ ويقصُّ الطرفَينِ", () => {
    expect(normalizeSearchText("   جدة    البلد   ")).toBe("جده البلد");
  });

  it("لا يُخفِقُ على مُدخَلٍ فارغٍ أو عدمٍ", () => {
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText("   ")).toBe("");
    expect(normalizeSearchText("!!!")).toBe("");
  });

  it("مُستقرٌّ عندَ التطبيقِ مرّتَينِ", () => {
    // مطابقةُ بدايةِ الكلمةِ تفترضُ نصّاً مُطبَّعاً سلفاً، ولو لم يكن التطبيعُ
    // مُستقرّاً لَاختلفَ مفتاحُ العمودِ المُولَّدِ عن مفتاحِ الاستعلامِ.
    for (const input of NORMALIZATION_CORPUS) {
      const once = normalizeSearchText(input);
      expect(normalizeSearchText(once)).toBe(once);
    }
  });

  it("صنفُ المحارفِ مُعلَنٌ نصّاً لا مُستنبَطٌ", () => {
    expect(ALLOWED_CHARACTER_CLASS).toContain("0-9a-z");
    expect(ALLOWED_CHARACTER_CLASS.startsWith("[^")).toBe(true);
    expect(ALLOWED_CHARACTER_CLASS.endsWith("]+")).toBe(true);
  });
});

describe("مطابقةُ بدايةِ الكلمةِ", () => {
  it("تُطابِقُ بدايةَ الحقلِ", () => {
    expect(wordStartMatch("جده البلد", "جده")).toBe(true);
  });

  it("تُطابِقُ بدايةَ كلمةٍ في الوسطِ — وهذا سببُ وجودِها", () => {
    // المفتاحُ يحملُ الاسمَ العربيَّ ثمَّ اللاتينيَّ، فمَن كتبَ بلوحةٍ إنجليزيّةٍ
    // لا يُطابِقُ بدايةَ الحقلِ أبداً.
    expect(wordStartMatch("نافوره الملك فهد king fahd s fountain", "king f")).toBe(true);
    expect(wordStartMatch("نافوره الملك فهد king fahd s fountain", "fountain")).toBe(true);
  });

  it("لا تُطابِقُ منتصفَ كلمةٍ", () => {
    expect(wordStartMatch("king fahd", "ing")).toBe(false);
    expect(wordStartMatch("جده البلد", "ده")).toBe(false);
  });

  it("ترفضُ المُدخَلَ الفارغَ — ولو قَبِلَته لَطابقَت كلَّ صفٍّ", () => {
    expect(wordStartMatch("أيُّ نصٍّ", "")).toBe(false);
  });

  it("لا تُخفِقُ على حقلٍ فارغٍ", () => {
    expect(wordStartMatch("", "جده")).toBe(false);
  });
});

describe("قراءةُ استعلامِ البحثِ", () => {
  it("تقبلُ استعلاماً مشروعاً وتُعيدُه مُطبَّعاً", () => {
    expect(readSearchQuery("  جِدَّة  ")).toBe("جده");
  });

  it("ترفضُ ما دونَ الحدِّ الأدنى **بعدَ** التطبيعِ", () => {
    // «؟؟؟» طولُها ثلاثةٌ قبلَ التطبيعِ وصفرٌ بعدَه؛ والحكمُ على ما يُستعلَمُ به
    // لا على ما كُتِبَ، وإلّا ذهبَ استعلامٌ فارغٌ إلى القاعدةِ.
    expect(readSearchQuery("؟؟؟")).toBeNull();
    expect(readSearchQuery("ج")).toBeNull();
    expect(readSearchQuery("")).toBeNull();
  });

  it("ترفضُ ما فوقَ الحدِّ الأقصى", () => {
    expect(readSearchQuery("ا".repeat(MAX_SEARCH_QUERY_LENGTH + 1))).toBeNull();
  });

  it("ترفضُ ما ليسَ نصّاً", () => {
    expect(readSearchQuery(undefined)).toBeNull();
    expect(readSearchQuery(null)).toBeNull();
    expect(readSearchQuery(12)).toBeNull();
  });

  it("الحدُّ الأدنى حرفانِ لا حرفٌ — ورقمٌ مُعلَنٌ لا سحريٌّ", () => {
    expect(MIN_SEARCH_QUERY_LENGTH).toBe(2);
    expect(readSearchQuery("جد")).toBe("جد");
  });
});
