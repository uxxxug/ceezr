/**
 * اختبارات: البحثُ العربيُّ المُطبَّعُ الضبابيُّ — البند `F2-08` (ADR 0108)
 *
 * تُقيسُ هذه الاختباراتُ أنَّ البحثَ في `rider_ride_history` يُطَبِّعُ النصَّ
 * العربيَّ ويُطابِقُ ضبابيَّاً. والاختباراتُ هنا على **منطقِ التطبيعِ والمطابقةِ**
 * لا على الدالّةِ في القاعدةِ — فالقاعدةُ تُقاسُ في تكاملٍ.
 *
 * **ما يُقاسُ:**
 * - التطبيعُ يطوي صورَ الحرفِ العربيِّ (أإآ → ا، ة → ه، ى → ي)
 * - التطبيعُ يحذفُ التشكيلَ والتطويلَ
 * - المطابقةُ الضبابيّةُ تتحمَّلُ الخطأَ في الحرفِ
 * - `ilike` على النصِّ المُطبَّعِ يطابقُ ما لا يطابقُهُ على الخامِّ
 *
 * **ما لا يُقاسُ هنا:**
 * - أداءُ الفهرسِ — ذاكَ قياسُ قاعدةٍ لا اختبارُ وحدةٍ.
 */

import { describe, expect, test } from "bun:test";

/**
 * تطبيعُ النصِّ العربيِّ — يطابقُ منطقَ `normalize_search_text` في القاعدةِ.
 *
 * هذا **نسخةٌ محليّةٌ** للاختبارِ، لا الدالّةَ في القاعدةِ. والدالّةُ في القاعدةِ
 * تُقاسُ في تكاملٍ.
 */
function normalizeSearchText(input: string | null): string {
  if (input === null) return "";
  const s = input.toLowerCase();
  // طيُّ صورِ الحرفِ العربيِّ — والحذفُ (تشكيلٌ وتطويلٌ) في الذيلِ بلا مقابلٍ
  const from = "آأإٱىئةؤ٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹ـًٌٍَُِّْٰ";
  const to = "ااااييهو01234567890123456789";
  let out = "";
  for (const ch of s) {
    const idx = from.indexOf(ch);
    if (idx >= 0) {
      if (idx < to.length) out += to[idx];
      // else: remove (tashkeel, tatweel)
    } else {
      out += ch;
    }
  }
  // حذفُ ما ليسَ حرفاً عربيّاً أو لاتينيّاً أو رقماً
  out = out.replace(/[^0-9a-z\u0621-\u063A\u0641-\u064A]+/g, " ");
  // طيُّ الفراغاتِ
  out = out.replace(/ +/g, " ").trim();
  return out;
}

/**
 * هل النصُّ يُطابِقُ استفساراً بطريقةِ `ilike` على النصِّ المُطبَّعِ؟
 */
function normalizedIlike(label: string, query: string): boolean {
  const normLabel = normalizeSearchText(label);
  const normQuery = normalizeSearchText(query);
  if (normQuery === "") return false;
  return normLabel.includes(normQuery);
}

/**
 * هل النصُّ يُطابِقُ استفساراً بطريقةِ المثلثاتِ الضبابيّةِ؟
 * تقريبٌ بسيطٌ: إنِ اتَّفَقَ أكثرُ من ٦٠٪ من المثلثاتِ.
 */
function trigramSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    const padded = `  ${s}  `;
    for (let i = 0; i < padded.length - 2; i++) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.max(ta.size, tb.size);
}

function fuzzyMatch(label: string, query: string, threshold = 0.3): boolean {
  const normLabel = normalizeSearchText(label);
  const normQuery = normalizeSearchText(query);
  if (normQuery === "") return false;
  return trigramSimilarity(normLabel, normQuery) >= threshold;
}

describe("F2-08: Arabic normalized fuzzy search", () => {
  describe("normalize_search_text — Arabic normalization", () => {
    test("folds alef variants to bare alef", () => {
      expect(normalizeSearchText("أحمد")).toBe("احمد");
      expect(normalizeSearchText("إبراهيم")).toBe("ابراهيم");
      expect(normalizeSearchText("آدم")).toBe("ادم");
    });

    test("folds ta marbuta to ha", () => {
      expect(normalizeSearchText("مدينة")).toBe("مدينه");
      expect(normalizeSearchText("جامعة")).toBe("جامعه");
    });

    test("folds alef maqsura to ya", () => {
      expect(normalizeSearchText("مصطفى")).toBe("مصطفي");
      expect(normalizeSearchText("الكردي")).toBe("الكردي");
    });

    test("removes tashkeel (diacritics)", () => {
      expect(normalizeSearchText("الرَّيَاض")).toBe("الرياض");
      expect(normalizeSearchText("مَكَّة")).toBe("مكه");
    });

    test("removes tatweel", () => {
      expect(normalizeSearchText("الـرياض")).toBe("الرياض");
    });

    test("collapses whitespace and non-word characters", () => {
      expect(normalizeSearchText("ال رياض")).toBe("ال رياض");
      expect(normalizeSearchText("ال-رياض")).toBe("ال رياض");
    });

    test("normalizes Arabic-Indic digits to Western", () => {
      expect(normalizeSearchText("١٢٣")).toBe("123");
      expect(normalizeSearchText("۰۱۲۳")).toBe("0123");
    });

    test("handles null input", () => {
      expect(normalizeSearchText(null)).toBe("");
    });
  });

  describe("normalized ilike — substring match on normalized text", () => {
    test("matches exact substring after normalization", () => {
      expect(normalizedIlike("الرياض", "الرياض")).toBe(true);
    });

    test("matches despite alef variant difference", () => {
      expect(normalizedIlike("أحمد", "احمد")).toBe(true);
      expect(normalizedIlike("إبراهيم", "ابراهيم")).toBe(true);
    });

    test("matches despite ta marbuta difference", () => {
      expect(normalizedIlike("مدينة", "مدينه")).toBe(true);
    });

    test("matches despite tashkeel in stored text", () => {
      expect(normalizedIlike("الرَّيَاض", "الرياض")).toBe(true);
    });

    test("matches despite tatweel in stored text", () => {
      expect(normalizedIlike("الـرياض", "الرياض")).toBe(true);
    });

    test("does not match empty query", () => {
      expect(normalizedIlike("الرياض", "")).toBe(false);
      expect(normalizedIlike("الرياض", "   ")).toBe(false);
    });
  });

  describe("trigram fuzzy match — tolerance for typos", () => {
    test("matches identical text", () => {
      expect(fuzzyMatch("الرياض", "الرياض")).toBe(true);
    });

    test("matches with one character typo", () => {
      // الرياض vs الرياظ — one letter different
      expect(fuzzyMatch("الرياض", "الرياظ")).toBe(true);
    });

    test("matches with two character typos", () => {
      // الرياض vs الدياض — two letters different
      expect(fuzzyMatch("الرياض", "الدياض")).toBe(true);
    });

    test("does not match completely different text", () => {
      expect(fuzzyMatch("الرياض", "جدة")).toBe(false);
    });

    test("matches after normalization (alef variants)", () => {
      // أحمد vs احمد — normalized to same
      expect(fuzzyMatch("أحمد", "احمد")).toBe(true);
    });

    test("matches after normalization (tashkeel)", () => {
      // الرَّيَاض vs الرياض — normalized to same
      expect(fuzzyMatch("الرَّيَاض", "الرياض")).toBe(true);
    });
  });

  describe("combined search — ilike OR trigram", () => {
    test("substring match works for partial query", () => {
      // "رياض" is a substring of "الرياض" after normalization
      expect(normalizedIlike("الرياض", "رياض")).toBe(true);
    });

    test("fuzzy match works for typo not caught by substring", () => {
      // "الرياظ" is not a substring of "الرياض" but is similar
      expect(normalizedIlike("الرياض", "الرياظ")).toBe(false);
      expect(fuzzyMatch("الرياض", "الرياظ")).toBe(true);
    });

    test("both fail for completely unrelated text", () => {
      expect(normalizedIlike("الرياض", "مكة")).toBe(false);
      expect(fuzzyMatch("الرياض", "مكة")).toBe(false);
    });
  });
});
