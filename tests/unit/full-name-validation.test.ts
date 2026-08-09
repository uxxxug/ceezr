/**
 * الغرض: إثبات أن تحقّق الاسم يرفض العبث الواضح ويقبل الأسماء الحقيقية المتنوّعة.
 * الحالة: منفّذ فعلياً — القسم 1 من الأمر الشامل.
 *
 * ملاحظة منهجية: قائمة القبول أطول من قائمة الرفض عمداً. خطر هذا التحقّق ليس
 * تمرير عابث — بل حجب مستخدم حقيقي باسم غير متوقَّع، وهو عطل صامت لا يُبلَّغ عنه.
 */

import { describe, expect, test } from "bun:test";
import { nameErrorKey } from "../../packages/application/bots/name-errors.ts";
import { parseFullName } from "../../packages/domain/identity/value-objects.ts";

describe("parseFullName — يرفض العبث الواضح", () => {
  const gibberish: readonly [string, string][] = [
    ["ههههههه", "حرف عربي واحد مكرّر"],
    ["ظظظظظظ", "حرف عربي آخر مكرّر"],
    ["aaaaaa", "حرف لاتيني مكرّر"],
    ["ه ه ه ه", "نفس الحرف مفصولاً بمسافات — لا يسقط بالتكرار المتتالي وحده"],
    ["1234567", "أرقام فقط"],
    ["!!!???", "رموز فقط"],
    ["😀😀😀😀", "إيموجي فقط"],
    ["...", "نقاط فقط"],
    ["ا123", "حرف أبجدي واحد فقط وسط أرقام — طوله كافٍ فلا يسقط بالقِصَر"],
  ];

  for (const [input, why] of gibberish) {
    test(`يرفض ${JSON.stringify(input)} — ${why}`, () => {
      const result = parseFullName(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("looks_like_gibberish");
      }
    });
  }

  test("يرفض الاسم القصير جداً بسببه الخاص لا كعبث", () => {
    const result = parseFullName("ع");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("too_short");
  });

  test("يرفض الاسم الطويل جداً بسببه الخاص", () => {
    const result = parseFullName("م".repeat(200));
    expect(result.ok).toBe(false);
    // التكرار يسبق الطول في هذه الحالة — المهمّ أنه يُرفض بسبب مفهوم
    if (!result.ok) {
      expect(["too_long", "looks_like_gibberish"]).toContain(result.error.reason);
    }
  });

  test("يرفض اسماً طويلاً متنوّع الحروف بسبب الطول تحديداً", () => {
    const long = "عبدالرحمن بن محمد بن ابراهيم الشريف ".repeat(4).trim();
    const result = parseFullName(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("too_long");
  });

  test("يرفض الأمر ولا يخلطه بالعبث", () => {
    const result = parseFullName("/start");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("looks_like_command");
  });

  test("يرفض النصّ الفارغ والمسافات وحدها", () => {
    for (const input of ["", "   ", "\n\t "]) {
      expect(parseFullName(input).ok).toBe(false);
    }
  });
});

describe("parseFullName — يقبل الأسماء الحقيقية المتنوّعة", () => {
  const valid: readonly [string, string][] = [
    ["محمد", "اسم عربي مفرد"],
    ["عبدالله بن سعيد", "اسم عربي مركّب"],
    ["نور الهدى", "اسم بأل التعريف"],
    ["John Smith", "لاتيني"],
    ["Anne-Marie O'Brien", "شُرطة وفاصلة عليا"],
    ["محمد عبدالرحمن الشمري", "ثلاثي"],
    ["مُحَمَّد", "بتشكيل — الشدّة تُضاعف الحرف بصرياً لا فعلياً"],
    ["علي", "أقصر اسم عربي شائع"],
    ["Ali", "أقصر اسم لاتيني"],
    ["راجيش كومار", "منقول عن الهندية"],
    ["محمد اقبال", "أردي شائع"],
    ["José Álvarez", "حروف بعلامات"],
    ["李 明", "صيني — حرفان فقط ولا مسافة معتادة"],
    ["Abdullah Al-Otaibi", "لاتيني مركّب بشُرطة"],
  ];

  for (const [input, why] of valid) {
    test(`يقبل ${JSON.stringify(input)} — ${why}`, () => {
      const result = parseFullName(input);
      expect(result.ok).toBe(true);
    });
  }

  test("يقبل الاسم المكتوب بالكشيدة ويزيلها", () => {
    const result = parseFullName("مـــحمد");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("محمد");
  });

  test("يوحّد المسافات الزائدة بدل رفضها", () => {
    const result = parseFullName("  عبدالله    بن   سعيد  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("عبدالله بن سعيد");
  });

  test("يزيل محارف التحكّم في الاتجاه — لا تُخزَّن في القاعدة خفيّةً", () => {
    const result = parseFullName("\u202Eمحمد علي\u202C");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("محمد علي");
  });
});

describe("nameErrorKey — كل سبب له رسالته", () => {
  test("لا سببان يتقاسمان مفتاحاً واحداً", () => {
    const keys = [
      nameErrorKey("too_short"),
      nameErrorKey("too_long"),
      nameErrorKey("looks_like_command"),
      nameErrorKey("looks_like_gibberish"),
    ];
    expect(new Set(keys).size).toBe(4);
  });

  test("العبث له مفتاحه الخاص لا مفتاح القِصَر", () => {
    expect(nameErrorKey("looks_like_gibberish")).toBe("driver.name_looks_invalid");
    expect(nameErrorKey("looks_like_gibberish")).not.toBe(nameErrorKey("too_short"));
  });
});
