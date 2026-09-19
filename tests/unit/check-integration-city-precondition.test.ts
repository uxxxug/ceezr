/**
 * الغرض: إثباتُ أنَّ حاجزَ الشرطِ المسبقِ للمدينةِ المفعَّلةِ (`OPS-019` · `ADR 0116`)
 *   **يُخفِقُ فعلاً** على كلِّ افتراقٍ يدّعي منعَه — لا أنَّه يمرُّ على المستودعِ
 *   كما هوَ اليومَ. وحاجزٌ بلا حالةٍ سالبةٍ اطمئنانٌ مُشترى بلا ثمنٍ، وهوَ أخطرُ
 *   من غيابِه لأنَّه يُقرأُ إنفاذاً وهوَ نصٌّ (`ح-7`).
 * الحالة: اختبار فعلي — الحَكَمُ النقيُّ يُستدعى على مُدخلاتٍ مُصنَّعةٍ لكلِّ قاعدةٍ
 *   من قواعدِه الخمسِ، ثمَّ على المستودعِ الحقيقيِّ في آخرِ الملفِّ.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI — خطوةٌ مُسمّاةٌ في `.github/workflows/ci.yml` وسلسلةُ `ci`.
 * يُتوقع أن يستخدمه لاحقاً: كلُّ قاعدةٍ تُضافُ إلى الحاجزِ — قاعدةٌ بلا حالةٍ
 *   سالبةٍ ههنا لا تُحسَبُ مفروضةً.
 * ملاحظات مستقبلية: المُدخلاتُ المُصنَّعةُ ههنا صغيرةٌ بقصدٍ؛ والحكمُ على المستودعِ
 *   كما هوَ يبقى في آخرِ وصفٍ كي يُكشَفَ أيُّ انحرافٍ لاحقٍ في CI.
 */

import { describe, expect, it } from "bun:test";
import {
  auditActivationStatements,
  auditCityPrecondition,
  auditExemptionRegistryUniqueness,
  type CityPreconditionInput,
  ENSURE_FN,
  EXEMPTION_REGISTRY_PATH,
  HELPER_PATH,
  type PreconditionExemption,
  RESTORE_FN,
  statementAround,
  stripComments,
} from "../../scripts/lib/city-precondition-audit.ts";
import { CITY_PRECONDITION_EXEMPTIONS } from "../../scripts/lib/city-precondition-exemptions.ts";
import { readRepository } from "../../scripts/lib/city-precondition-repository.ts";

const FILE = "tests/integration/probe.test.ts";

/** معينٌ مستوفٍ لقيدِ القاعدةِ ٤ — يُستعمَلُ أساساً لا يُقاسُ هوَ. */
const SOUND_HELPER = `
export async function ${ENSURE_FN}(sql, options) {
  await sql\`select is_active, telegram_support_group_id, telegram_escalation_group_id,
                   telegram_unsubscribed_drivers_group_id from cities\`;
  await sql\`update cities set is_active = true\`;
}
export async function ${RESTORE_FN}(sql, handle) {
  await sql\`update cities set is_active = \${previous.isActive}\`;
}
`;

function input(
  source: string,
  overrides?: {
    readonly helper?: string | undefined;
    readonly exemptions?: readonly PreconditionExemption[];
    readonly scriptFiles?: readonly { readonly path: string; readonly source: string }[];
  },
): CityPreconditionInput {
  return {
    integrationFiles: [{ path: FILE, source }],
    // نفسُ الملفِّ في نطاقِ القاعدةِ ٦ كدليلٍ على أنَّ الحَكَمَ واحدٌ: مُدخَلٌ واحدٌ
    // تُحكَمُ عليهِ القواعدُ السبعُ معاً لا كلُّ قاعدةٍ بمُدخَلِها.
    activationFiles: [{ path: FILE, source }],
    scriptFiles: overrides?.scriptFiles ?? [],
    helper: overrides !== undefined && "helper" in overrides ? overrides.helper : SOUND_HELPER,
    exemptions: overrides?.exemptions ?? [],
  };
}

/** خروقُ قاعدةٍ بعينِها — كي لا يُقرأَ خرقُ قاعدةٍ أخرى نجاحاً للمقصودةِ. */
function rules(result: readonly { readonly rule: number }[]): readonly number[] {
  return result.map((v) => v.rule);
}

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ١ — لا شرطَ مُستعارٌ: المدينةُ تُختارُ بـ`is_active`", () => {
  const BORROWED = `
    const [city] = await sql\`
      select c.id from cities c
        join city_service_areas a on a.city_id = c.id and a.is_active
       where c.is_active limit 1\`;
  `;

  it("`where c.is_active` يُسقِطُ الحاجزَ — وهوَ النمطُ الذي أحمرَ CI فعلاً", () => {
    expect(rules(auditCityPrecondition(input(BORROWED)))).toContain(1);
  });

  it("كلُّ لَقَبٍ مُستعملٍ في المستودعِ يُكشَفُ: `ci`، `city`، `cities`", () => {
    for (const alias of ["ci", "city", "cities"]) {
      const source = `const r = await sql\`select id from cities ${alias} where ${alias}.is_active\`;`;
      expect(rules(auditCityPrecondition(input(source)))).toContain(1);
    }
  });

  it("`a.is_active` على منطقةِ الخدمةِ وحدَها لا يُقرأُ خرقاً — لا إنذارَ كاذباً", () => {
    const source = `const r = await sql\`select 1 from city_service_areas a where a.is_active\`;`;
    expect(rules(auditCityPrecondition(input(source)))).not.toContain(1);
  });

  it("النمطُ في تعليقٍ لا يُقرأُ شِفرةً — التعليقاتُ تُنزَعُ قبلَ الحكمِ", () => {
    const source = `// where c.is_active — هكذا كانَ قبلَ OPS-019\nconst x = 1;`;
    expect(stripComments(source)).not.toContain("is_active");
    expect(rules(auditCityPrecondition(input(source)))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ٢ — من فعَّلَ مدينةً ردَّها", () => {
  const ACTIVATES = `
    await sql\`update cities set is_active = true where id = \${cityId}\`;
  `;

  it("تفعيلٌ بلا ردٍّ يُسقِطُ الحاجزَ — وهوَ مصدرُ الأخضرِ المُستعارِ لِمَن بعدَه", () => {
    expect(rules(auditCityPrecondition(input(ACTIVATES)))).toContain(2);
  });

  it(`الردُّ بـ\`${RESTORE_FN}\` يُرضي القاعدةَ`, () => {
    const source = `${ACTIVATES}\nawait ${RESTORE_FN}(sql, cityHandle);`;
    expect(rules(auditCityPrecondition(input(source)))).not.toContain(2);
  });

  it("الردُّ بـ`is_active = false` صريحاً يُرضي القاعدةَ كذلك", () => {
    const source = `${ACTIVATES}\nawait sql\`update cities set is_active = false\`;`;
    expect(rules(auditCityPrecondition(input(source)))).not.toContain(2);
  });

  it("ملفٌّ يملكُ صفوفَ مدنِه (يُدخِلُها ويحذفُها) لا يُقرأُ مُستعيراً", () => {
    const owned = `
      await sql\`insert into cities (code) values ('ZY1')\`;
      ${ACTIVATES}
      await sql\`delete from cities where code = 'ZY1'\`;
    `;
    expect(rules(auditCityPrecondition(input(owned)))).not.toContain(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ٣ — منادي المعينِ يردُّ خطَّ الأساسِ", () => {
  it(`نداءُ \`${ENSURE_FN}\` بلا \`${RESTORE_FN}\` يُسقِطُ الحاجزَ`, () => {
    const source = `cityHandle = await ${ENSURE_FN}(sql, { prior: cityHandle });`;
    expect(rules(auditCityPrecondition(input(source)))).toContain(3);
  });

  it("النداءانِ معاً يُرضيانِ القاعدةَ — وهوَ عقدُ الملفّاتِ الستِّ والأربعينَ", () => {
    const source = `
      cityHandle = await ${ENSURE_FN}(sql, { prior: cityHandle });
      await ${RESTORE_FN}(sql, cityHandle);
    `;
    expect(auditCityPrecondition(input(source))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ٤ — المعينُ نفسُه مُستوفٍ، وغيابُه خرقٌ لا صمتٌ", () => {
  const CALLER = `
    cityHandle = await ${ENSURE_FN}(sql, { prior: cityHandle });
    await ${RESTORE_FN}(sql, cityHandle);
  `;

  it("غيابُ ملفِّ المعينِ يُسقِطُ الحاجزَ ولا يُقرأُ نجاحاً", () => {
    const result = auditCityPrecondition(input(CALLER, { helper: undefined }));
    expect(rules(result)).toContain(4);
    expect(result.some((v) => v.path === HELPER_PATH)).toBe(true);
  });

  it("معينٌ لا يُصدِّرُ أحدَ الدالّتينِ يُسقِطُ الحاجزَ", () => {
    for (const missing of [ENSURE_FN, RESTORE_FN]) {
      const helper = SOUND_HELPER.replace(
        `export async function ${missing}`,
        `async function ${missing}`,
      );
      expect(rules(auditCityPrecondition(input(CALLER, { helper })))).toContain(4);
    }
  });

  it("معينٌ يُغفِلُ عمودَ قروبٍ يُسقِطُ الحاجزَ — والقيدُ يرفضُ التفعيلَ بلا الثلاثةِ", () => {
    const helper = SOUND_HELPER.replace("telegram_escalation_group_id,", "");
    expect(rules(auditCityPrecondition(input(CALLER, { helper })))).toContain(4);
  });

  it("معينٌ يُفعِّلُ ولا يَردُّ من اللقطةِ يُسقِطُ الحاجزَ — وهوَ عينُ العطبِ المُصلَحِ", () => {
    const helper = SOUND_HELPER.replace("previous.isActive", "false");
    expect(rules(auditCityPrecondition(input(CALLER, { helper })))).toContain(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ٥ — لا إعفاءَ ميّتاً ولا بلا سببٍ ومالكٍ", () => {
  const BORROWED = `const r = await sql\`select id from cities c where c.is_active\`;`;
  const SOUND: PreconditionExemption = {
    path: FILE,
    rule: 1,
    reason: "سببٌ مُعلَنٌ يُقرأُ في المراجعةِ",
    owner: "uxxxug",
  };

  it("إعفاءٌ مستوفٍ يُسكِتُ القاعدةَ ١ — وهوَ المنفذُ الوحيدُ المشروعُ", () => {
    const result = auditCityPrecondition(input(BORROWED, { exemptions: [SOUND] }));
    expect(rules(result)).not.toContain(1);
    expect(rules(result)).not.toContain(5);
  });

  it("إعفاءٌ **ميّتٌ** (الملفُّ لا يحملُ النمطَ) يُسقِطُ الحاجزَ", () => {
    const result = auditCityPrecondition(input("const x = 1;", { exemptions: [SOUND] }));
    expect(rules(result)).toContain(5);
  });

  it("إعفاءٌ بلا سببٍ أو بلا مالكٍ يُسقِطُ الحاجزَ — لا ثقبَ مجهولَ النسبِ", () => {
    for (const broken of [
      { ...SOUND, reason: "   " },
      { ...SOUND, owner: "" },
    ]) {
      expect(rules(auditCityPrecondition(input(BORROWED, { exemptions: [broken] })))).toContain(5);
    }
  });

  it("إعفاءٌ لملفٍّ لا وجودَ له يُسقِطُ الحاجزَ — سجلٌّ يُشيرُ إلى لا شيءَ", () => {
    const ghost: PreconditionExemption = { ...SOUND, path: "tests/integration/ghost.test.ts" };
    expect(rules(auditCityPrecondition(input(BORROWED, { exemptions: [ghost] })))).toContain(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("المستودعُ الحقيقيُّ", () => {
  it("لا خرقَ في المستودعِ كما هوَ: الحاجزُ يُقرأُ على الشِّفرةِ لا على مُصنَّعٍ", () => {
    expect(auditCityPrecondition(readRepository())).toEqual([]);
  });

  it("المستودعُ يحملُ ملفّاتِ تكاملٍ فعلاً — حاجزٌ بلا محروسٍ أخضرُ كاذبٌ", () => {
    const repo = readRepository();
    expect(repo.integrationFiles.length).toBeGreaterThan(50);
    expect(repo.helper).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// القاعدةُ ٦ مَنقولةٌ من `check-test-city-activation.ts` في `OPS-020`، ولم تكنِ
// لها قبلَ اليومِ حالةٌ سالبةٌ واحدةٌ — فكانت تُقرأُ مفروضةً بوجودِها (`ح-7`).
describe("القاعدة ٦ — القروباتُ الثلاثةُ في نفسِ عبارةِ التفعيلِ", () => {
  const GROUPS =
    "telegram_support_group_id = coalesce(telegram_support_group_id, -1001),\n" +
    "      telegram_escalation_group_id = coalesce(telegram_escalation_group_id, -1002),\n" +
    "      telegram_unsubscribed_drivers_group_id = coalesce(telegram_unsubscribed_drivers_group_id, -1003),";

  it("تفعيلٌ مجرَّدٌ يُسقِطُ الحاجزَ — وهوَ النمطُ الذي أحمرَ CI فعلاً قبلَ `OPS-019`", () => {
    const bare = "await sql`update cities set is_active = true where id = ${cityId}`;";
    expect(rules(auditCityPrecondition(input(bare)))).toContain(6);
  });

  it("القروباتُ الثلاثةُ في نفسِ العبارةِ تُرضي القاعدةَ", () => {
    const sound = `await sql\`update cities set ${GROUPS}\n      is_active = true where id = \${cityId}\`;`;
    expect(rules(auditCityPrecondition(input(sound)))).not.toContain(6);
  });

  it("نقصُ عمودٍ واحدٍ يُسقِطُ الحاجزَ — والقيدُ يرفضُ التفعيلَ بلا الثلاثةِ", () => {
    for (const dropped of [
      "telegram_support_group_id",
      "telegram_escalation_group_id",
      "telegram_unsubscribed_drivers_group_id",
    ]) {
      const kept = GROUPS.split("\n")
        .filter((line) => !line.includes(dropped))
        .join("\n");
      const partial = `await sql\`update cities set ${kept}\n      is_active = true\`;`;
      const found = auditActivationStatements({ path: FILE, source: partial });
      expect(found.map((v) => v.rule)).toContain(6);
      expect(found[0]?.message).toContain(dropped);
    }
  });

  it("ضبطُ القروباتِ في عبارةٍ **تاليةٍ** لا يُرضي القاعدةَ — القيدُ يُفحَصُ فوراً", () => {
    const split =
      "await sql`update cities set is_active = true`;\n" +
      `await sql\`update cities set ${GROUPS.replace(/,$/, "")}\`;`;
    expect(rules(auditCityPrecondition(input(split)))).toContain(6);
  });

  it("`is_active` على جدولٍ آخرَ لا يُقرأُ خرقاً — لا قيدَ عليه أصلاً", () => {
    const other = "await sql`update city_service_areas set is_active = true`;";
    expect(rules(auditCityPrecondition(input(other)))).not.toContain(6);
  });

  it("عبارةُ التفعيلِ تُقتطَعُ من مفتحِ ``sql` `` لا من مسافةٍ جزافاً", () => {
    const source = "const a = 1;\nawait sql`update cities set is_active = true`;";
    const statement = statementAround(source, source.indexOf("is_active"));
    expect(statement.startsWith("sql`")).toBe(true);
    expect(statement).not.toContain("const a");
  });

  it("إعفاءٌ من القاعدةِ ١ لا يُسكِتُ القاعدةَ ٦ — الإعفاءُ مقيَّدٌ بقاعدتِه", () => {
    const bare = "await sql`update cities set is_active = true`;";
    const wrongRule: PreconditionExemption = {
      path: FILE,
      rule: 1,
      reason: "إعفاءٌ من قاعدةٍ أخرى لا من هذهِ",
      owner: "uxxxug",
    };
    expect(rules(auditCityPrecondition(input(bare, { exemptions: [wrongRule] })))).toContain(6);
  });

  it("إعفاءُ القاعدةِ ٦ يُسكِتُها وحدَها، وميّتُه يُسقِطُ البناءَ بالقاعدةِ ٥", () => {
    const live: PreconditionExemption = {
      path: FILE,
      rule: 6,
      reason: "يفحصُ القيدَ نفسَه فالتفعيلُ المجرَّدُ موضوعُه لا عطبُه",
      owner: "uxxxug",
    };
    const bare = "await sql`update cities set is_active = true`;";
    expect(rules(auditCityPrecondition(input(bare, { exemptions: [live] })))).not.toContain(6);
    expect(rules(auditCityPrecondition(input("const x = 1;", { exemptions: [live] })))).toContain(
      5,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("القاعدة ٧ — لا سجلَّ إعفاءاتٍ ثانٍ لعقدِ التفعيلِ", () => {
  /** هذا **شكلُ الحاجزِ القديمِ** قبلَ `OPS-020` — وهوَ السالبةُ المرجعُ. */
  const SECOND_REGISTRY = [
    "const REQUIRED_WITH_ACTIVATION = ['telegram_support_group_id'];",
    "const INTENTIONAL_BARE_ACTIVATION = new Set([",
    '  "tests/integration/pilot-city-activation.test.ts",',
    '  "tests/unit/check-integration-city-precondition.test.ts",',
    "]);",
  ].join("\n");

  it("سجلٌّ ثانٍ في `scripts/` يُسقِطُ البناءَ — وهوَ عينُ ما كانَ قائماً قبلَ `OPS-020`", () => {
    const found = auditExemptionRegistryUniqueness([
      { path: "scripts/check-test-city-activation.ts", source: SECOND_REGISTRY },
    ]);
    expect(found.map((v) => v.rule)).toContain(7);
    expect(found[0]?.message).toContain("INTENTIONAL_BARE_ACTIVATION");
  });

  it("يُقرأُ من الحَكَمِ الكاملِ كذلكَ لا من الدالّةِ وحدَها", () => {
    const result = rules(
      auditCityPrecondition(
        input("const x = 1;", {
          scriptFiles: [{ path: "scripts/check-something-else.ts", source: SECOND_REGISTRY }],
        }),
      ),
    );
    expect(result).toContain(7);
  });

  it("السجلُّ المشروعُ نفسُه لا يُسقِطُ البناءَ — ولو فعلَ لما قامَ سجلٌّ أصلاً", () => {
    expect(
      auditExemptionRegistryUniqueness([
        { path: EXEMPTION_REGISTRY_PATH, source: SECOND_REGISTRY },
      ]),
    ).toEqual([]);
  });

  it("سجلٌّ لموضوعٍ آخرَ لا يُقرأُ خرقاً — وهذا حدُّ القاعدةِ مقيساً لا مزعوماً", () => {
    const unrelated = [
      "const PLANTED_NEGATIVE_FILES = new Set([",
      '  "tests/unit/check-lazy-query-assertion.test.ts",',
      "]);",
    ].join("\n");
    expect(
      auditExemptionRegistryUniqueness([{ path: "scripts/lib/other.ts", source: unrelated }]),
    ).toEqual([]);
  });

  it("الموضوعُ وحدَه بلا سجلٍّ لا يُقرأُ خرقاً — الشرطانِ معاً لا أحدُهما", () => {
    const subjectOnly = "await sql`update cities set is_active = true`;";
    expect(
      auditExemptionRegistryUniqueness([{ path: "scripts/lib/subject.ts", source: subjectOnly }]),
    ).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("وحدةُ الحَكَمِ والسجلِّ على المستودعِ كما هوَ — `OPS-020`", () => {
  it("نطاقُ القاعدةِ ٦ **لم يُضَيَّق** بالتوحيدِ: الجذورُ الثلاثةُ محروسةٌ", () => {
    const repo = readRepository();
    expect(repo.activationFiles.length).toBeGreaterThan(repo.integrationFiles.length);
    for (const root of ["tests/integration/", "tests/e2e/", "tests/unit/"]) {
      expect(repo.activationFiles.some((f) => f.path.startsWith(root))).toBe(true);
    }
    expect(repo.scriptFiles.length).toBeGreaterThan(100);
  });

  it("سجلُّ الإعفاءاتِ **واحدٌ**، وكلُّ مُدخَلٍ فيه بقاعدةٍ وسببٍ ومالكٍ", () => {
    expect(readRepository().exemptions).toBe(CITY_PRECONDITION_EXEMPTIONS);
    for (const exemption of CITY_PRECONDITION_EXEMPTIONS) {
      expect(exemption.reason.trim().length).toBeGreaterThan(20);
      expect(exemption.owner.trim().length).toBeGreaterThan(0);
      expect([1, 6]).toContain(exemption.rule);
    }
  });
});
