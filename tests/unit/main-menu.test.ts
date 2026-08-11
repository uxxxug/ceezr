/**
 * الغرض: إثبات أن القائمة الدائمة دائمةٌ فعلاً، وأن كل زرّ فيها له أمر قائم،
 *   وأن نصّ الزرّ يُترجَم إلى أمره بأي لغة مدعومة.
 * الحالة: منفّذ فعلياً — البند 2.1.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  allItemsFor,
  botCommandsFor,
  commandForMenuText,
  DRIVER_MENU_ITEMS,
  mainMenuKeyboard,
  menuItemsFor,
  RIDER_MENU_ITEMS,
  RIDER_ORDER_MENU_ITEMS,
} from "../../packages/application/bots/main-menu.ts";
import { SUPPORTED_LANGUAGES } from "../../packages/domain/i18n-translation/index.ts";
import { toTelegramMarkup } from "../../packages/infrastructure/notification/telegram-markup.ts";
import { t } from "../../packages/shared/i18n/index.ts";

const AUDIENCES = ["driver", "rider"] as const;

describe("القائمة الرئيسية الدائمة", () => {
  it("تحمل نصّاً مترجَماً لا مفاتيح خام في كل لغة مدعومة", () => {
    for (const audience of AUDIENCES) {
      for (const language of SUPPORTED_LANGUAGES) {
        const keyboard = mainMenuKeyboard(audience, language);
        if (keyboard.kind !== "reply") throw new Error("القائمة الدائمة يجب أن تكون reply");
        const labels = keyboard.rows.flat();
        expect(labels.length).toBe(menuItemsFor(audience).length);
        for (const label of labels) {
          // المفتاح الخام يظهر للمستخدم حين تنقص الترجمة — وهو أسوأ من غياب الزرّ
          expect(label.startsWith("menu.")).toBe(false);
          expect(label.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("لا تضع أكثر من زرّين في صفّ فلا يُقطع النصّ العربي", () => {
    for (const audience of AUDIENCES) {
      const keyboard = mainMenuKeyboard(audience, "ar");
      if (keyboard.kind !== "reply") throw new Error("متوقَّع reply");
      for (const row of keyboard.rows) expect(row.length).toBeLessThanOrEqual(2);
      expect(keyboard.rows.some((row) => row.length === 0)).toBe(false);
    }
  });

  /**
   * هذا هو جوهر «الزرّ الدائم»: تلغرام يُخفي لوحة الردّ بعد ضغطة واحدة إن كان
   * one_time_keyboard=true، وهو ما كان مكتوباً ثابتاً في المحوّل. فبلا هذا
   * الاختبار يُعاد الثابت يوماً فتختفي القائمة بعد أول ضغطة ولا يكشفه شيء.
   */
  it("تُترجَم إلى لوحة تلغرام دائمة: one_time_keyboard=false و is_persistent=true", () => {
    const markup = toTelegramMarkup(mainMenuKeyboard("driver", "ar")) as unknown as Record<
      string,
      unknown
    >;
    expect(markup.one_time_keyboard).toBe(false);
    expect(markup.is_persistent).toBe(true);
    expect(markup.resize_keyboard).toBe(true);
  });

  it("اللوحة غير الدائمة تبقى على سلوكها القديم — لا تغيير عابر", () => {
    const markup = toTelegramMarkup({
      kind: "reply",
      rows: [["أ"]],
    }) as unknown as Record<string, unknown>;
    expect(markup.one_time_keyboard).toBe(true);
    expect(markup.is_persistent).toBeUndefined();
  });
});

describe("ترجمة نصّ الزرّ إلى أمر", () => {
  it("تُطابق كل زرّ بلغته هو", () => {
    for (const audience of AUDIENCES) {
      for (const language of SUPPORTED_LANGUAGES) {
        for (const item of menuItemsFor(audience)) {
          const label = t(language)(item.key);
          expect(commandForMenuText(audience, label)).toBe(item.command);
        }
      }
    }
  });

  /**
   * الحالة التي تكسر المطابقة بلغة الجلسة وحدها: لوحة قديمة بالعربية باقية على
   * جهاز مستخدم صارت جلسته إنجليزية. لو لم نفهم زرّه رأى «لم أفهم» بعد تغيير
   * اللغة مباشرة، فظنّ أن تغيير اللغة أعطب البوت.
   */
  it("تُطابق زرّاً بلغة أخرى غير لغة الجلسة — اللوحة القديمة تبقى صالحة", () => {
    expect(commandForMenuText("driver", t("en")("menu.support"))).toBe("/support");
    expect(commandForMenuText("driver", t("ur")("menu.support"))).toBe("/support");
    expect(commandForMenuText("rider", t("en")("menu.rider.ride"))).toBe("/ride");
  });

  it("تتجاهل المسافات الزائدة حول النصّ", () => {
    expect(commandForMenuText("rider", `  ${t("ar")("menu.support")}  `)).toBe("/support");
  });

  it("تعيد null لنصّ ليس زرّاً فلا تسرق رسائل المستخدم العادية", () => {
    expect(commandForMenuText("driver", "أحمد العمري")).toBeNull();
    expect(commandForMenuText("driver", "")).toBeNull();
    expect(commandForMenuText("driver", "   ")).toBeNull();
    // زرّ العميل لا يعمل في بوت السائق ولا العكس
    expect(commandForMenuText("driver", t("ar")("menu.rider.ride"))).toBeNull();
    expect(commandForMenuText("rider", t("ar")("menu.driver.available"))).toBeNull();
  });
});

describe("أوامر البوت المُسجَّلة عند تلغرام", () => {
  it("بلا شرطة مائلة وبوصف مترجَم في كل لغة", () => {
    for (const audience of AUDIENCES) {
      for (const language of SUPPORTED_LANGUAGES) {
        const commands = botCommandsFor(audience, language);
        for (const command of commands) {
          expect(command.command.startsWith("/")).toBe(false);
          // تلغرام يقبل الأحرف الصغيرة والأرقام والشرطة السفلية وحدها
          expect(/^[a-z0-9_]{1,32}$/.test(command.command)).toBe(true);
          expect(command.description.startsWith("menu.")).toBe(false);
          expect(command.description.trim().length).toBeGreaterThan(0);
          // حدّ تلغرام لوصف الأمر 256 محرفاً
          expect(command.description.length).toBeLessThanOrEqual(256);
        }
      }
    }
  });

  it("تضمّ start وhelp إلى أزرار القائمة بلا تكرار", () => {
    for (const audience of AUDIENCES) {
      const commands = botCommandsFor(audience, "ar");
      const names = commands.map((command) => command.command);
      expect(names).toContain("start");
      expect(names).toContain("help");
      expect(new Set(names).size).toBe(names.length);
      // كل أزرار الجمهور مع المشروطة: قائمة تلغرام تُسجّل مرّة للبوت لا لكل مستخدم
      expect(names.length).toBe(allItemsFor(audience).length + 2);
    }
  });

  it("تضمّ status في بوت العميل دائماً — أمرٌ مكتوب يعمل ولو غاب زرّه", () => {
    const names = botCommandsFor("rider", "ar").map((command) => command.command);
    expect(names).toContain("status");
    expect(botCommandsFor("driver", "ar").map((c) => c.command)).not.toContain("status");
  });
});

/**
 * زرّ «أين طلبي؟» — البند 2.2. الشرطية هي المطلوب: زرّ معروض على من لا
 * طلب له جوابه الوحيد «لا يوجد طلب»، ومع ذلك تبقى مطابقة نصّه لازمة لأنّ
 * لوحة الردّ تبقى معروضة على جهاز العميل بعد انتهاء طلبه.
 */
describe("زرّ تتبّع الطلب المشروط", () => {
  const statusLabel = t("ar")("menu.rider.status");

  it("يظهر لمن له طلب نشط ولا يظهر لغيره", () => {
    const idle = mainMenuKeyboard("rider", "ar");
    const active = mainMenuKeyboard("rider", "ar", { hasActiveOrder: true });
    if (idle.kind !== "reply" || active.kind !== "reply") throw new Error("متوقَّع reply");

    expect(idle.rows.flat()).not.toContain(statusLabel);
    expect(active.rows.flat()).toContain(statusLabel);
    expect(active.rows.flat().length).toBe(idle.rows.flat().length + 1);
  });

  it("يتقدّم القائمة فلا يُطلَب من قلقٍ أن يفتّش", () => {
    const active = mainMenuKeyboard("rider", "ar", { hasActiveOrder: true });
    if (active.kind !== "reply") throw new Error("متوقَّع reply");
    expect(active.rows[0]?.[0]).toBe(statusLabel);
  });

  it("يبقى مفهوماً بعد انتهاء الطلب — لوحة قديمة لا تصير عطباً", () => {
    for (const language of SUPPORTED_LANGUAGES) {
      expect(commandForMenuText("rider", t(language)("menu.rider.status"))).toBe("/status");
    }
  });

  it("لا يوجد في بوت السائق بحال", () => {
    expect(commandForMenuText("driver", statusLabel)).toBeNull();
    expect(menuItemsFor("driver", { hasActiveOrder: true })).toEqual(DRIVER_MENU_ITEMS);
  });

  it("لا يكرّر أمراً موجوداً في القائمة الأساس", () => {
    const base = RIDER_MENU_ITEMS.map((item) => item.command);
    for (const item of RIDER_ORDER_MENU_ITEMS) expect(base).not.toContain(item.command);
  });
});

/**
 * القاعدة التي تحمي المستخدم من زرٍّ يبدو عطباً: كل زرّ في القائمة يجب أن يكون
 * أمراً يفهمه الحوار فعلاً. المصدر هنا هو switch الأوامر في كل حوار، ويُقرأ من
 * الملفّ نصّاً لأن الأوامر ليست معلنة كثابت قابل للاستيراد.
 */
describe("لا زرّ بلا أمر قائم في الحوار", () => {
  const commandsIn = async (path: string): Promise<Set<string>> => {
    const source = await Bun.file(path).text();
    const found = new Set<string>();
    for (const match of source.matchAll(/case "(\/[a-z]+)":/g)) {
      const command = match[1];
      if (command !== undefined) found.add(command);
    }
    return found;
  };

  it("كل أمر في قائمة السائق موجود في driver-dialog", async () => {
    const declared = await commandsIn("packages/application/bots/driver-dialog.ts");
    for (const item of DRIVER_MENU_ITEMS) expect(declared.has(item.command)).toBe(true);
  });

  it("كل أمر في قائمة العميل موجود في rider-dialog", async () => {
    const declared = await commandsIn("packages/application/bots/rider-dialog.ts");
    for (const item of RIDER_MENU_ITEMS) expect(declared.has(item.command)).toBe(true);
  });
});
