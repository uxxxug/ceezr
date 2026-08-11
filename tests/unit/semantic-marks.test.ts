/**
 * الغرض: حراسة الرموز الدلالية — البند 6.3.
 * الحالة: منفّذ فعلياً.
 *
 * لماذا اختبار لا مراجعة عين؟ لأن الرموز تُكتب في ثلاثة قواميس مستقلّة، ومن يضيف
 * مفتاح رفضٍ جديداً بالعربية وحدها لا يرى ما فعله المترجم بعده. والعطب لا يظهر
 * في أي اختبار سلوك: البوت يعمل، والمستخدم وحده يرى رمزين لمعنى واحد.
 */

import { describe, expect, test } from "bun:test";
import { allItemsFor, helpKeyboard } from "../../packages/application/bots/main-menu.ts";
import { getSupportedLanguages } from "../../packages/application/i18n-translation/index.ts";
import {
  isCallbackDataValid,
  RETIRED_MARKS,
  SEMANTIC_MARKS,
  SEMANTIC_TEXT_INTENTS,
} from "../../packages/infrastructure/notification/telegram-markup.ts";
import { t } from "../../packages/shared/i18n/index.ts";

const LANGUAGES = getSupportedLanguages().map((option) => option.code);

describe("الرموز الدلالية موحَّدة في كل اللغات", () => {
  test("ثلاث لغات مدعومة على الأقل تُفحص فعلاً", () => {
    // اختبارٌ يمرّ على قائمة فارغة لا يحرس شيئاً
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(SEMANTIC_TEXT_INTENTS).length).toBeGreaterThan(10);
  });

  for (const [key, intent] of Object.entries(SEMANTIC_TEXT_INTENTS)) {
    test(`${key} يبدأ برمز «${intent}» في كل لغة`, () => {
      const mark = SEMANTIC_MARKS[intent];
      for (const language of LANGUAGES) {
        const text = t(language)(key);
        expect(text.startsWith(`${mark} `)).toBe(true);
      }
    });
  }

  test("لا يظهر رمز متقاعد في أي نصّ بأي لغة", () => {
    for (const language of LANGUAGES) {
      const dictionary = t(language);
      for (const key of Object.keys(SEMANTIC_TEXT_INTENTS)) {
        for (const retired of RETIRED_MARKS) {
          expect(dictionary(key).includes(retired)).toBe(false);
        }
      }
    }
  });

  test("زوج «بدء الاستقبال / إيقاف الاستقبال» يُقرأ قبولاً ورفضاً لا قبولاً ومنعاً", () => {
    // هذا الزوج هو موضع العطب الأصلي: ✅ مقابل ⛔ في صفٍّ واحد من نفس اللوحة
    for (const language of LANGUAGES) {
      const tr = t(language);
      expect(tr("menu.driver.available").startsWith(`${SEMANTIC_MARKS.accept} `)).toBe(true);
      expect(tr("menu.driver.unavailable").startsWith(`${SEMANTIC_MARKS.reject} `)).toBe(true);
    }
  });

  test("رمز الموقع لم يبق دالّاً على التتبّع", () => {
    // 📍 صار لطلب الموقع وحده، والتتبّع صار ℹ️ — وإلا بحث العميل عن زرّ موقع في تقرير حالة
    for (const language of LANGUAGES) {
      const tr = t(language);
      expect(tr("rider.location_required").includes("📍")).toBe(true);
      expect(tr("menu.rider.status").includes("📍")).toBe(false);
      expect(tr("rider.status_heading").includes("📍")).toBe(false);
    }
  });

  test("بيانات أزرار /help تحت حدّ تلغرام في كل لغة ولكل جمهور", () => {
    // 64 بايت حدٌّ من خادم تلغرام لا منّا، وزرٌّ يتجاوزه يُرفض إرساله كلّه
    for (const audience of ["driver", "rider"] as const) {
      for (const language of LANGUAGES) {
        const keyboard = helpKeyboard(audience, language, { hasActiveOrder: true });
        if (keyboard.kind !== "inline") throw new Error("لوحة /help يجب أن تكون inline");
        const buttons = keyboard.rows.flat();
        expect(buttons.length).toBe(allItemsFor(audience).length);
        for (const button of buttons) {
          expect(isCallbackDataValid(button.data)).toBe(true);
          expect(button.label.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
