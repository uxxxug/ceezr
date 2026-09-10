/**
 * الغرض: اختبارُ حاجزِ عزلِ مسارِ استقبالِ الاستغاثةِ (`F8-05` · ADR-0077):
 *    يُثبِتُ أنَّ المستودعَ اليومَ نظيفٌ، و**أنَّ الحاجزَ يُخفِقُ فعلاً عندَ كلِّ
 *    صورةٍ من صورِ الخرقِ الخمسِ** — لا أنَّه يُنفَّذُ فحسبُ.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-05`.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا الأغلبُ سالبٌ
 *
 * حاجزٌ يُثبَتُ نجاحُه على شيفرةٍ سليمةٍ لم يُثبَتْ منه شيءٌ: تعليقٌ يُنفَّذُ يفعلُ
 * ذلك. والقيمةُ كلُّها في السالبِ — أن نُغذِّيَه نصّاً مخروقاً فيصرخَ. والصورةُ
 * السالبةُ الأولى ههنا هيَ **العطبُ الأصليُّ حرفاً**: `/sos` فرعاً في `switch`
 * تحتَ قراءةِ الدليلِ.
 */

import { describe, expect, test } from "bun:test";
import {
  ALLOWED_AWAIT,
  awaitCount,
  awaitedCalls,
  DISPATCHERS,
  DRIVER_MODULE,
  FORBIDDEN_CASE,
  FORBIDDEN_READS,
  findViolations,
  functionBody,
  INTAKE_SITES,
  NULL_ORDER_LITERAL,
  type Reader,
  RIDER_MODULE,
  stripComments,
} from "../../scripts/check-sos-intake-isolation.ts";

/** نسخةٌ سليمةٌ مُصغَّرةٌ من حوارِ الراكبِ — أساسُ الحالاتِ السالبةِ. */
const CLEAN_RIDER = `
async function handleRiderSos(sender, state, deps) {
  if (deps.safety === undefined) return [reply(sender, tr("common.unknown_command"))];
  const result = await triggerSos(
    { ${NULL_ORDER_LITERAL}, actorTelegramId: sender.telegramUserId, reporterRole: "rider" },
    deps.safety.trigger,
  );
  return [reply(sender, tr("safety.sent"))];
}

async function handleSosCallback(parts, sender, state, deps) {
  const [action] = parts;
  if (action !== "trigger") return [];
  const result = await triggerSos(
    { ${NULL_ORDER_LITERAL}, actorTelegramId: sender.telegramUserId, reporterRole: "rider" },
    deps.safety.trigger,
  );
  return [reply(sender, tr("safety.sent"))];
}

async function handleCommand(command, sender, state, deps) {
  const name = command.split(/\\s+/)[0] ?? command;
  if (name === "/sos") return handleRiderSos(sender, state, deps);
  const existing = await deps.riders.findByTelegramId(sender.telegramUserId);
  switch (name) {
    case "/status":
      return handleStatus(sender, state, deps);
  }
}
`;

/** نسخةٌ سليمةٌ مُصغَّرةٌ من حوارِ السائقِ. */
const CLEAN_DRIVER = `
async function handleDriverSos(sender, state, deps) {
  if (deps.safety === undefined) return [reply(sender, tr("common.unknown_command"))];
  const raised = await triggerSos(
    { ${NULL_ORDER_LITERAL}, actorTelegramId: sender.telegramUserId, reporterRole: "driver" },
    deps.safety.trigger,
  );
  return [reply(sender, tr("safety.sent"))];
}

async function handleCommand(command, sender, state, deps) {
  const name = command.split(/\\s+/)[0] ?? command;
  if (name === "/sos") return handleDriverSos(sender, state, deps);
  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  switch (name) {
    case "/activate":
      return handleActivate(sender, state, deps);
  }
}
`;

const CLEAN_FILES: Record<string, string> = {
  [RIDER_MODULE]: CLEAN_RIDER,
  [DRIVER_MODULE]: CLEAN_DRIVER,
};

function readerFor(files: Record<string, string | null>): Reader {
  return (path) => files[path] ?? null;
}

/** يُطبِّقُ إبدالاً واحداً على ملفٍّ واحدٍ ويُعيدُ قارئاً للمجموعةِ المخروقةِ. */
function mutate(module: string, from: string, to: string): Reader {
  const source = CLEAN_FILES[module] as string;
  expect(source.includes(from)).toBe(true); // الإبدالُ يجبُ أن يُصيبَ فعلاً
  return readerFor({ ...CLEAN_FILES, [module]: source.replace(from, to) });
}

describe("حاجزُ عزلِ الاستغاثةِ — المستودعُ الحقيقيُّ", () => {
  test("لا خرقَ في المستودعِ كما هوَ الآنَ", () => {
    expect(findViolations()).toEqual([]);
  });

  test("المواضعُ المحروسةُ مُعلَنةٌ ولا قائمةَ فارغةً", () => {
    expect(INTAKE_SITES.length).toBeGreaterThan(0);
    expect(DISPATCHERS.length).toBe(2);
  });

  test("كلُّ موضعِ استقبالٍ مُعلَنٍ موجودٌ فعلاً في ملفِّه", async () => {
    for (const site of INTAKE_SITES) {
      const source = await Bun.file(site.module).text();
      expect(functionBody(source, site.fn)).not.toBeNull();
    }
  });

  test("النسختانِ السليمتانِ المُصغَّرتانِ تمرّانِ — وإلّا فالحالاتُ السالبةُ بلا معنى", () => {
    expect(findViolations(readerFor(CLEAN_FILES))).toEqual([]);
  });
});

describe("حاجزُ عزلِ الاستغاثةِ — الصورةُ الأولى: انتظارٌ زائدٌ", () => {
  test("قراءةُ الدليلِ تعودُ إلى جسمِ الاستقبالِ ⇒ خرقانِ: انتظارٌ ثانٍ وقارئٌ محظورٌ", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        '  if (deps.safety === undefined) return [reply(sender, tr("common.unknown_command"))];\n  const result = await triggerSos(',
        "  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);\n  const result = await triggerSos(",
      ),
    );
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some((v) => v.why.includes("انتظاراً"))).toBe(true);
    expect(violations.some((v) => v.why.includes("findByTelegramId"))).toBe(true);
  });

  test("قراءةُ الطلبِ النشطِ في مسارِ الزرِّ ⇒ خرقٌ باسمِ `activeOrdersOf`", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        '  if (action !== "trigger") return [];',
        '  if (action !== "trigger") return [];\n  const active = await deps.activeOrdersOf(rider.id);',
      ),
    );
    expect(violations.some((v) => v.why.includes("activeOrdersOf"))).toBe(true);
  });

  test("بطاقةُ الرحلةِ تعودُ شرطاً في مسارِ السائقِ ⇒ خرقٌ باسمِ `tripCards`", () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        "  const raised = await triggerSos(",
        "  if (deps.tripCards === undefined) return [];\n  const raised = await triggerSos(",
      ),
    );
    expect(violations.some((v) => v.why.includes("tripCards"))).toBe(true);
  });

  test("`cardOf` انتظاراً قبلَ النداءِ ⇒ خرقانِ", () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        "  const raised = await triggerSos(",
        "  const trip = await deps.tripCards.cardOf({ driverId: driver.id });\n  const raised = await triggerSos(",
      ),
    );
    expect(violations.some((v) => v.why.includes("cardOf"))).toBe(true);
    expect(violations.some((v) => v.why.includes("انتظاراً"))).toBe(true);
  });

  test("انتظارٌ **بعدَ** النداءِ خرقٌ كذلكَ: الإخفاقُ بعدَه يُضيِّعُ الجوابَ", () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        '  return [reply(sender, tr("safety.sent"))];\n}\n\nasync function handleCommand',
        '  await deps.sessions.save(state);\n  return [reply(sender, tr("safety.sent"))];\n}\n\nasync function handleCommand',
      ),
    );
    expect(violations.some((v) => v.why.includes("انتظاراً"))).toBe(true);
  });

  test("حذفُ النداءِ رأساً ⇒ خرقٌ لا نجاحٌ: صفرُ انتظارٍ ليسَ عزلاً", () => {
    const violations = findViolations(
      mutate(DRIVER_MODULE, "await triggerSos(", "buildReplyOnly("),
    );
    expect(violations.some((v) => v.why.includes(ALLOWED_AWAIT))).toBe(true);
  });

  test("استبدالُ النداءِ بنداءٍ آخرَ ⇒ خرقٌ يُسمّي المُنتظَرَ الخاطئَ", () => {
    const violations = findViolations(
      mutate(DRIVER_MODULE, "await triggerSos(", "await notifySupport("),
    );
    expect(violations.some((v) => v.why.includes("notifySupport"))).toBe(true);
  });
});

describe("حاجزُ عزلِ الاستغاثةِ — الصورةُ الثانيةُ: الطلبُ يُمرَّرُ من الأعلى", () => {
  test("مُعرِّفٌ صريحٌ من بياناتِ الزرِّ ⇒ خرقٌ", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        `{ ${NULL_ORDER_LITERAL}, actorTelegramId`,
        "{ orderId, actorTelegramId",
      ),
    );
    expect(violations.some((v) => v.why.includes(NULL_ORDER_LITERAL))).toBe(true);
  });

  test("`orderId: orderId ?? null` لا يكفي: التمريرُ من الأعلى قائمٌ", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        `{ ${NULL_ORDER_LITERAL}, actorTelegramId`,
        "{ orderId: fromButton ?? null, actorTelegramId",
      ),
    );
    expect(violations.some((v) => v.why.includes(NULL_ORDER_LITERAL))).toBe(true);
  });
});

describe("حاجزُ عزلِ الاستغاثةِ — الصورةُ الثالثةُ: موضعُ التوزيعِ", () => {
  /** العطبُ الأصليُّ حرفاً: الفرعُ تحتَ قراءةِ الدليلِ. */
  test('`case "/sos"` يعودُ فرعاً في `switch` ⇒ خرقٌ', () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        '    case "/activate":',
        '    case "/sos":\n      return handleDriverSos(sender, state, deps);\n    case "/activate":',
      ),
    );
    expect(violations.some((v) => v.why.includes(FORBIDDEN_CASE))).toBe(true);
  });

  test("التوزيعُ يهبطُ تحتَ قراءةِ الدليلِ ⇒ خرقُ «انتظارٌ قبلَ التوزيعِ»", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        '  if (name === "/sos") return handleRiderSos(sender, state, deps);\n  const existing = await deps.riders.findByTelegramId(sender.telegramUserId);',
        '  const existing = await deps.riders.findByTelegramId(sender.telegramUserId);\n  if (name === "/sos") return handleRiderSos(sender, state, deps);',
      ),
    );
    expect(violations.some((v) => v.why.includes("قبلَ** توزيعِ"))).toBe(true);
  });

  test("سقوطُ التوزيعِ من المُوزِّعِ رأساً ⇒ خرقٌ يُسمّي الهدفَ", () => {
    const violations = findViolations(
      mutate(
        RIDER_MODULE,
        '  if (name === "/sos") return handleRiderSos(sender, state, deps);\n',
        "",
      ),
    );
    expect(violations.some((v) => v.why.includes("لا يُوزِّعُ إلى"))).toBe(true);
  });

  test("انتظارٌ في المُوزِّعِ بعدَ التوزيعِ لا يُعَدُّ خرقاً: النداءُ خرجَ قبلَه", () => {
    const violations = findViolations(readerFor(CLEAN_FILES));
    expect(violations).toEqual([]);
  });
});

describe("حاجزُ عزلِ الاستغاثةِ — الحاملُ نفسُه", () => {
  test("ملفٌّ غيرُ مقروءٍ خرقٌ لا تخطٍّ (ح-5)", () => {
    const violations = findViolations(readerFor({ ...CLEAN_FILES, [RIDER_MODULE]: null }));
    expect(violations.some((v) => v.file === RIDER_MODULE && v.why.includes("غيرُ مقروءٍ"))).toBe(
      true,
    );
  });

  test("إعادةُ تسميةِ دالّةِ الاستقبالِ خرقٌ يُسمّي الدالّةَ الغائبةَ", () => {
    const violations = findViolations(
      mutate(DRIVER_MODULE, "function handleDriverSos(", "function raiseDriverAlarm("),
    );
    expect(violations.some((v) => v.why.includes("handleDriverSos"))).toBe(true);
  });

  test("غيابُ المُوزِّعِ نفسِه خرقٌ: موضعُ التوزيعِ يصيرُ غيرَ مفحوصٍ", () => {
    const violations = findViolations(
      mutate(DRIVER_MODULE, "async function handleCommand(", "async function routeCommand("),
    );
    expect(violations.some((v) => v.why.includes("غيرُ مفحوصٍ"))).toBe(true);
  });

  test("كلُّ قارئٍ محظورٍ يُصرَخُ به باسمِه لا برمزٍ عامٍّ", () => {
    for (const read of FORBIDDEN_READS) {
      const violations = findViolations(
        mutate(
          DRIVER_MODULE,
          "  const raised = await triggerSos(",
          `  const x = deps.${read};\n  const raised = await triggerSos(`,
        ),
      );
      expect(violations.some((v) => v.why.includes(read))).toBe(true);
    }
  });
});

describe("حاجزُ عزلِ الاستغاثةِ — أدواتُ القراءةِ", () => {
  test("التعليقُ السطريُّ يُبدَلُ فراغاً وعددُ الأسطرِ يُحفَظُ", () => {
    const source = "const a = 1; // await deps.riders.findByTelegramId(x)\nconst b = 2;\n";
    const clean = stripComments(source);
    expect(clean.includes("findByTelegramId")).toBe(false);
    expect(clean.split("\n").length).toBe(source.split("\n").length);
  });

  test("التعليقُ الكتليُّ يُبدَلُ فراغاً وعددُ الأسطرِ يُحفَظُ", () => {
    const source = "/**\n * await deps.activeOrdersOf(id)\n */\nconst a = 1;\n";
    const clean = stripComments(source);
    expect(clean.includes("activeOrdersOf")).toBe(false);
    expect(clean.split("\n").length).toBe(source.split("\n").length);
  });

  test("ذكرُ قارئٍ محظورٍ في تعليقٍ شرحاً لا يُعَدُّ خرقاً", () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        "  const raised = await triggerSos(",
        "  // كانَ ههنا cardOf و tripCards و findByTelegramId فزالَت\n  const raised = await triggerSos(",
      ),
    );
    expect(violations).toEqual([]);
  });

  test("`functionBody` يُطابِقُ الأقواسَ فلا يقطعُ عندَ أوّلِ `}`", () => {
    const found = functionBody(
      "async function f() {\n  if (x) { return 1; }\n  return 2;\n}\nconst after = 3;\n",
      "f",
    );
    expect(found).not.toBeNull();
    expect(found?.body.includes("return 2")).toBe(true);
    expect(found?.body.includes("after")).toBe(false);
  });

  test("`functionBody` يُعيدُ `null` لدالّةٍ غيرِ مُعلَنةٍ", () => {
    expect(functionBody("const a = 1;\n", "handleDriverSos")).toBeNull();
  });

  test("`awaitedCalls` يقرأُ النداءَ المُنقَّطَ كاملاً", () => {
    expect(awaitedCalls("const x = await deps.riders.findByTelegramId(id);")).toEqual([
      "deps.riders.findByTelegramId",
    ]);
  });

  test("`awaitCount` يُحصي انتظاراً بلا نداءٍ — فلا يُفلِتُ `await promise`", () => {
    expect(awaitCount("const x = await pending;\nconst y = await other();")).toBe(2);
    expect(awaitedCalls("const x = await pending;\nconst y = await other();")).toEqual(["other"]);
  });

  test("انتظارٌ بلا نداءٍ في جسمِ الاستقبالِ خرقٌ: لا يُفلِتُ من `awaitedCalls`", () => {
    const violations = findViolations(
      mutate(
        DRIVER_MODULE,
        "  const raised = await triggerSos(",
        "  await deferred;\n  const raised = await triggerSos(",
      ),
    );
    expect(violations.some((v) => v.why.includes("انتظاراً"))).toBe(true);
  });
});
