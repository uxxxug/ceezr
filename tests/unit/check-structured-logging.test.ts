/**
 * الغرض: قياسُ حاجزِ السجلاتِ المُهيكلةِ (`F8-03` · ADR 0078) — **كلُّ قاعدةٍ فيه
 *    تُسقِطُ خرقَها**، ولا تُسقِطُ ما ليسَ خرقاً. والحالاتُ السالبةُ ههنا أكثرُ من
 *    الموجَبةِ عن قصدٍ: حاجزٌ يمرُّ على المستودعِ ولا تُقاسُ إسقاطاتُه حاجزٌ
 *    بالاسمِ لا بالحكمِ.
 * الحالة: منفّذ فعلياً — اختبار وحدة.
 * ينتمي إلى: tests/unit
 * الحاكم: ADR 0078 · البند `F8-03`
 * ملاحظات مستقبلية: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ تُقابِلُها حالةٌ سالبةٌ ههنا.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  argumentsAt,
  blankComments,
  EMITTER,
  EVENT_CODE_PATTERN,
  findViolations,
  firstStringLiteral,
  isConsoleQualified,
  isTransparentForward,
  personalFieldNames,
  scannedFiles,
} from "../../scripts/check-structured-logging.ts";

const EMITTER_SOURCE = readFileSync(EMITTER, "utf8");
const FILE = "apps/gateway/src/probe.ts";

/** علامةُ الاستبدالِ تُبنى ولا تُكتَبُ نصّاً — وإلّا حسبَها المُدقِّقُ قالباً مقصوداً. */
const DOLLAR = "$";

/** يفحصُ ملفّاً واحداً مُشوَّهاً مع مُصدِرٍ سليمٍ — فيُعزَلُ محلُّ القياسِ. */
function inspect(source: string, emitter = EMITTER_SOURCE): ReturnType<typeof findViolations> {
  return findViolations(
    (path) => {
      if (path === EMITTER) return emitter;
      if (path === FILE) return source;
      throw new Error(`ملفٌّ غيرُ متوقَّعٍ: ${path}`);
    },
    [FILE],
  );
}

function rules(source: string, emitter = EMITTER_SOURCE): string[] {
  return inspect(source, emitter).violations.map((violation) => violation.rule);
}

describe("المستودعُ القائمُ", () => {
  test("١) لا خرقَ في المستودعِ كما هوَ، وعددُ المواضعِ ليسَ صفراً", () => {
    const { violations, logCallSites } = findViolations();
    expect(violations).toEqual([]);
    expect(logCallSites).toBeGreaterThan(100);
  });
});

describe("القاعدةُ الأولى: `console` محصورٌ في المُصدِرِ", () => {
  test("٢) `console.log` خارجَ المُصدِرِ يُسقِطُ البناءَ", () => {
    expect(rules('log("gateway.started");\nconsole.log("x");')).toContain(
      "console-outside-emitter",
    );
  });

  test("٣) كلُّ صيغةٍ من `console` تُلتقَطُ لا `log` وحدَها", () => {
    for (const method of ["log", "error", "warn", "info", "debug", "trace"]) {
      expect(rules(`log("gateway.started");\nconsole.${method}("x");`)).toContain(
        "console-outside-emitter",
      );
    }
  });

  test("٤) المُصدِرُ نفسُه يملكُ `console` — وإلّا لم يُكتَبْ سطرٌ أبداً", () => {
    const { violations } = findViolations(
      (path) => (path === EMITTER ? EMITTER_SOURCE : ""),
      [EMITTER],
    );
    expect(violations.filter((v) => v.rule === "console-outside-emitter")).toEqual([]);
  });

  test("٥) `console` في تعليقٍ شارحٍ **ليسَ خرقاً** — ولا بلاغَ كاذباً", () => {
    expect(rules('log("gateway.started");\n// console.log("x");')).toEqual([]);
    expect(rules('log("gateway.started");\n/* console.error("x"); */')).toEqual([]);
  });
});

describe("القاعدةُ الثانيةُ: رمزُ الحدثِ حرفيٌّ لاتينيٌّ منقوطٌ", () => {
  test("٦) نصٌّ عربيٌّ حرٌّ يُسقِطُ البناءَ — وهذا كانَ حالَ ٧٤ موضعاً", () => {
    expect(rules('log("رفض تحديث بسرّ غير مطابق", { bot });')).toContain("event-code-shape");
  });

  test("٧) رمزٌ بلا نقطةٍ (`snake_case` مجرَّدٌ) يُسقِطُ البناءَ", () => {
    expect(rules('log("request_shutdown_starting", { signal });')).toContain("event-code-shape");
  });

  test("٨) قالبٌ نصّيٌّ يُسقِطُ البناءَ — لا رمزَ يُبنى وقتَ التشغيلِ", () => {
    expect(rules(`log(\`outbound.${DOLLAR}{event.type}\`, { operation });`)).toContain(
      "event-not-literal",
    );
  });

  test("٩) متغيّرٌ ليسَ مُعامِلاً أوّلَ لدالّةٍ حاويةٍ يُسقِطُ البناءَ", () => {
    expect(rules("const chosen = pickEvent();\nlog(chosen, { bot });")).toContain(
      "event-not-literal",
    );
  });

  test("١٠) الناقلُ الشفّافُ يمرُّ — منعُه تعقيدٌ بلا منعِ نصٍّ حرٍّ", () => {
    expect(rules("const forward = (message, meta) => log.info(message, meta);")).toEqual([]);
    expect(
      rules("function forward(message: string, meta: Meta) {\n  log(message, meta);\n}"),
    ).toEqual([]);
  });

  test("١١) `log.info` و`log.error` و`deps.log?.()` كلُّها مواضعُ تُفحَصُ", () => {
    expect(rules('log.info("نصٌّ حرٌّ");')).toContain("event-code-shape");
    expect(rules('log.error("نصٌّ حرٌّ");')).toContain("event-code-shape");
    expect(rules('deps.log?.("نصٌّ حرٌّ");')).toContain("event-code-shape");
  });

  test("١٢) تعريفُ الدالّةِ أو النوعِ ليسَ نداءً — ولا بلاغَ كاذباً", () => {
    expect(
      rules('function log(message: string) {}\nlog("gateway.started");').filter(
        (rule) => rule !== "no-log-call-sites",
      ),
    ).toEqual([]);
    expect(rules('const catalog = (x: string) => x;\ncatalog("نصٌّ حرٌّ");')).toEqual([
      "no-log-call-sites",
    ]);
  });

  test("١٣) الرمزُ المطابقُ لا يُسقِطُ شيئاً", () => {
    for (const good of ["gateway.started", "telegram.drainer.sweep_completed", "a.b_c"]) {
      expect(EVENT_CODE_PATTERN.test(good)).toBe(true);
      expect(rules(`log("${good}", { port: 8080 });`)).toEqual([]);
    }
  });
});

describe("القاعدةُ الثالثةُ: لا حقلَ شخصيّاً في نداءِ تسجيلٍ", () => {
  test("١٤) العنوانُ الخامُ يُسقِطُ البناءَ — وهذا كانَ حالَ ثلاثةِ مواضعَ", () => {
    expect(rules('log("telegram.webhook.secret_mismatch", { bot, address });')).toContain(
      "personal-field",
    );
  });

  test("١٥) مُعرِّفُ تلغرام الخامُ يُسقِطُ البناءَ بأيِّ صيغةِ اسمٍ", () => {
    for (const field of ["actorId", "telegramId", "telegram_id", "TelegramUserId", "chatId"]) {
      expect(rules(`log("session.issued", { ${field} });`)).toContain("personal-field");
    }
  });

  test("١٦) الإحداثيّاتُ والهاتفُ والبريدُ كذلك", () => {
    for (const field of ["lat", "lng", "phone", "email", "plateNumber"]) {
      expect(rules(`log("session.issued", { ${field}: value });`)).toContain("personal-field");
    }
  });

  test("١٧) الكنيةُ تمرُّ — الحاجزُ يمنعُ الخامَ لا يمنعُ الربطَ", () => {
    expect(
      rules('log("telegram.webhook.secret_mismatch", { source: pseudonymise(address) });'),
    ).toEqual([]);
    expect(rules('log("session.issued", { actor: log.pseudonym(telegramId) });')).toEqual([]);
  });

  test("١٨) الاسمُ التشغيليُّ المشروعُ يمرُّ — لا بلاغَ كاذباً على `fileName`", () => {
    expect(rules('log("backup.record_no_cities", { fileName, jobName, cityName });')).toEqual([]);
  });

  test("١٩) القائمةُ تُقرأُ **من المُصدِرِ** لا من نسخةٍ في الحاجزِ", () => {
    const names = personalFieldNames((path) => {
      if (path === EMITTER) return EMITTER_SOURCE;
      throw new Error(path);
    });
    expect(names).toContain("address");
    expect(names).toContain("telegramId");
    expect(names.length).toBeGreaterThan(10);
  });
});

describe("القاعدةُ الرابعةُ: المُصدِرُ قائمٌ بمضمونِه", () => {
  test("٢٠) غيابُ المُصدِرِ لا يُقرأُ نجاحاً", () => {
    const { violations } = findViolations(
      (path) => {
        if (path === EMITTER) throw new Error("ENOENT");
        return 'log("gateway.started");';
      },
      [FILE],
    );
    expect(violations.map((v) => v.rule)).toContain("emitter-missing");
  });

  test("٢١) نزعُ قائمةِ الأسماءِ الشخصيّةِ من المُصدِرِ يُسقِطُ البناءَ", () => {
    const gutted = EMITTER_SOURCE.replace(
      /export const PERSONAL_FIELD_NAMES: readonly string\[\] = \[[\s\S]*?\];/,
      "export const PERSONAL_FIELD_NAMES: readonly string[] = [];",
    );
    expect(rules('log("gateway.started");', gutted)).toContain("emitter-gutted");
  });

  test("٢٢) نزعُ الحجبِ أو الكنيةِ أو المِلحِ يُسقِطُ البناءَ", () => {
    for (const needle of ["REDACTED", "function pseudonym", "randomUUID", "isPersonalFieldName"]) {
      const gutted = EMITTER_SOURCE.replaceAll(needle, "REMOVED_MARKER");
      expect(rules('log("gateway.started");', gutted)).toContain("emitter-gutted");
    }
  });

  test("٢٣) انحرافُ شكلِ الرمزِ بينَ المُصدِرِ والحاجزِ يُسقِطُ البناءَ", () => {
    const drifted = EMITTER_SOURCE.replace(EVENT_CODE_PATTERN.source, "^[a-zA-Z][a-zA-Z0-9_.]*$");
    expect(rules('log("gateway.started");', drifted)).toContain("pattern-drift");
  });
});

describe("`ح-5`: صفرُ مواضعَ خرقٌ لا نجاحٌ", () => {
  test("٢٤) ملفٌّ بلا موضعِ تسجيلٍ واحدٍ يُخفِقُ بصوتٍ", () => {
    const { violations, logCallSites } = inspect("export const x = 1;\n");
    expect(logCallSites).toBe(0);
    expect(violations.map((v) => v.rule)).toEqual(["no-log-call-sites"]);
  });
});

describe("أدواتُ القراءةِ — دقّةُ الاستخراجِ", () => {
  test("٢٥) `argumentsAt` يوازنُ الأقواسَ ويحترمُ النصوصَ", () => {
    const source = 'log("a.b", { detail: f(g(1)), text: ")" });';
    const args = argumentsAt(source, source.indexOf("("));
    expect(args).toBe('"a.b", { detail: f(g(1)), text: ")" }');
  });

  test("٢٦) `firstStringLiteral` يقرأُ النصَّ ولا يقرأُ القالبَ", () => {
    expect(firstStringLiteral('"a.b", { x: 1 }')).toBe("a.b");
    expect(firstStringLiteral(`\`a.${DOLLAR}{x}\``)).toBeNull();
    expect(firstStringLiteral("variable")).toBeNull();
  });

  test("٢٧) `blankComments` يحفظُ الأطوالَ والأسطرَ ولا يمسُّ نصّاً فيه `//`", () => {
    const source = 'const url = "https://x.y";\n// تعليقٌ\nconst z = 1;';
    const blanked = blankComments(source);
    expect(blanked).toHaveLength(source.length);
    expect(blanked.split("\n")).toHaveLength(3);
    expect(blanked).toContain("https://x.y");
    expect(blanked).not.toContain("تعليقٌ");
  });

  test("٢٨) `isTransparentForward` يشترطُ أن يكونَ المُعرِّفُ مُعامِلاً أوّلَ", () => {
    const forwarding = "const f = (message, meta) => log.info(message";
    expect(isTransparentForward(forwarding, "message", forwarding.length)).toBe(true);
    const notForwarding = "const message = buildMessage();\nlog(message";
    expect(isTransparentForward(notForwarding, "message", notForwarding.length)).toBe(false);
  });
});

/**
 * استثناءُ `console.log` كانَ نظرةً خلفيّةً متغيّرةَ الطولِ في نمطِ النداءِ،
 * وكانت تُقيَّمُ عندَ كلِّ موضعٍ فتُكلِّفُ المستودعَ أربعَ ثوانٍ ونصفاً فتنقضي
 * مهلةُ القياسِ. فصارَ الاستثناءُ مشياً إلى الخلفِ — **وهذا قياسُ أنَّ الحكمَ
 * لم يتغيَّرْ، وأنَّ الزمنَ وحدَه تغيَّرَ.**
 */
describe("استثناءُ `console` — الحكمُ نفسُه بزمنٍ ثابتٍ", () => {
  test("٢٩) `console.log(` لا يُحسَبُ موضعَ تسجيلٍ وإن طابقَ النمطَ", () => {
    const source = 'log("gateway.started");\nconsole.log("x");';
    const { logCallSites } = inspect(source);
    expect(logCallSites).toBe(1);
  });

  test("٣٠) والفراغاتُ حولَ النقطةِ لا تُفلِتُ الاستثناءَ", () => {
    const source = 'log("gateway.started");\nconsole . log("x");\nconsole\n  .log("y");';
    const { logCallSites } = inspect(source);
    expect(logCallSites).toBe(1);
  });

  test("٣١) `catalog(` ليسَ نداءَ تسجيلٍ — اللاحقةُ لا تصنعُ نداءً", () => {
    const source = 'log("gateway.started");\nconst x = catalog("y");';
    const { logCallSites } = inspect(source);
    expect(logCallSites).toBe(1);
  });

  test("٣٢) و`deps.log(` يُحسَبُ — الاستثناءُ لـ`console` لا لكلِّ ما قبلَ نقطةٍ", () => {
    const source = 'deps.log("gateway.started");';
    const { logCallSites } = inspect(source);
    expect(logCallSites).toBe(1);
  });

  test("٣٣) والحكمُ مُصدَّرٌ ويُقاسُ وحدَه على مواضعِ `log` الحرفيّةِ", () => {
    const spaced = "console . log(";
    expect(isConsoleQualified(spaced, spaced.indexOf("log("))).toBe(true);
    const bare = "log(";
    expect(isConsoleQualified(bare, 0)).toBe(false);
    const deps = "deps.log(";
    expect(isConsoleQualified(deps, deps.indexOf("log("))).toBe(false);
    const truncated = "le.log(";
    expect(isConsoleQualified(truncated, truncated.indexOf("log("))).toBe(false);
  });

  test("٣٤) والفحصُ على المستودعِ كما هوَ يتمُّ في جزءٍ من مهلةِ القياسِ", () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(100);
    const started = performance.now();
    const { logCallSites } = findViolations();
    const elapsed = performance.now() - started;
    expect(logCallSites).toBeGreaterThan(100);
    // ميزانيّةٌ مُعلَنةٌ: الفحصُ قبلَ الإصلاحِ كانَ ٤٥٠٠ مِلّي ثانيةٍ محلّيّاً
    // وأكثرَ في CI. والميزانيّةُ ههنا أوسعُ من القياسِ الحقيقيِّ عشرةَ أضعافٍ،
    // فسقوطُها يعني عودةَ التراجُعِ الأُسّيِّ لا بطءَ آلةٍ.
    expect(elapsed).toBeLessThan(2500);
  });
});
