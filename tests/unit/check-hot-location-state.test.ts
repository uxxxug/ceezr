/**
 * الغرض: اختبارُ حاجزِ `scripts/check-hot-location-state.ts` نفسِه — أنَّ المستودعَ
 *    القائمَ يمرُّ، **وأنَّ كلَّ قاعدةٍ من قواعدِه الثمانِ تُسقِطُ الخرقَ فعلاً**.
 * الحالة: اختبار فعلي — دوالٌّ خالصةٌ تُمرَّرُ لها نصوصٌ، بلا لمسِ ملفٍّ.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **ولمَ حالاتٌ سالبةٌ:** حاجزٌ لا تُختبَرُ حالاتُه السالبةُ حاجزٌ بالاسمِ — يمرُّ
 * أبداً ولا يُدرى أنَّه توقَّفَ عن الرؤيةِ. فكلُّ حالةٍ ههنا تُشوِّهُ نصّاً واحداً
 * تشويهاً واقعيّاً (انقلابُ مُسنَدٍ، تضييقُه، حذفُ تنقيةٍ، رقمٌ احتياطيٌّ) وتُطالِبُ
 * الحاجزَ بخرقٍ.
 *
 * **وحدُّ هذا الملفِّ مُعلَنٌ:** يقيسُ **قراءةَ النصِّ** لا الأثرَ. أنَّ Redis يرفضُ
 * الأقدمَ وأنَّ الدالّةَ تُطبِّقُ الأحدثَ في اختباراتِ التكاملِ لا ههنا.
 */

import { describe, expect, it } from "bun:test";
import {
  batchFunctionBody,
  findViolations,
  issuesSingleCommand,
  luaLines,
  type RepositorySources,
  readSources,
} from "../../scripts/check-hot-location-state.ts";

/** المستودعُ كما هوَ — أساسٌ تُشتَقُّ منه الحالاتُ السالبةُ بتشويهٍ واحدٍ. */
const REAL = readSources();

function withSource(overrides: Partial<RepositorySources>): RepositorySources {
  return { ...REAL, ...overrides };
}

/**
 * تشويهُ **جسمِ الدالّةِ الذرّيّةِ وحدَه** داخلَ نصِّ الهجراتِ المجموعِ. والتشويهُ
 * على المجموعِ كلِّه كانَ سيُصيبَ دالّةً أخرى قديمةً تشترِكُ في اللفظِ نفسِه
 * (`distinct on` مثلاً) فيُختبَرَ الحاجزُ على غيرِ ما يُدَّعى.
 */
function mutateBatchFunction(find: string | RegExp, replacement: string): string {
  const body = batchFunctionBody(REAL.migrations);
  if (body === null) throw new Error("لا جسمَ للدالّةِ الذرّيّةِ — تشويهٌ بلا أصلٍ");
  const mutated = body.replace(find, () => replacement);
  if (mutated === body) throw new Error(`تشويهٌ لم يُغيِّرْ شيئاً: ${String(find)}`);
  // بدالةٌ دالّيّةٌ لا نصٌّ: `$$` في نصِّ البديلِ تُقرأُ `$` فتُفسَدُ حدودُ جسمِ الدالّةِ.
  return REAL.migrations.replace(body, () => mutated);
}

describe("F4-02 — حاجزُ الحالةِ الساخنةِ: المستودعُ القائمُ", () => {
  it("١) لا خرقَ في المستودعِ كما هوَ", () => {
    expect(findViolations(REAL)).toEqual([]);
  });

  it("٢) جسمُ الدالّةِ الذرّيّةِ يُقرأُ من الهجراتِ فعلاً", () => {
    const body = batchFunctionBody(REAL.migrations);

    expect(body).not.toBeNull();
    expect(body).toContain("distinct on");
    expect(body).toContain("p_city_id");
  });

  it("٣) قراءةُ سطورِ Lua تُلقِطُ السكربتاتَ لا التعليقاتَ", () => {
    const lines = luaLines(REAL.redisAdapter);

    expect(lines.length).toBeGreaterThan(5);
    expect(lines.some((line) => line.includes("EXPIRE"))).toBe(true);
  });

  it("٤) آخِرُ تعريفٍ للدالّةِ هوَ المقروءُ لا أوّلُه", () => {
    const two = [
      "create or replace function persist_driver_location_batch(a) returns jsonb as $$\n  select 1; -- الأولى\n$$;",
      "create or replace function persist_driver_location_batch(a) returns jsonb as $$\n  select 2; -- الثانيةُ الحاكمةُ\n$$;",
    ].join("\n");

    // في القاعدةِ آخِرُ تعريفٍ هوَ القائمُ، فقراءةُ الأوّلِ كانت ستُجيزُ نقضاً لاحقاً.
    expect(batchFunctionBody(two)).toContain("الثانيةُ الحاكمةُ");
    expect(batchFunctionBody("لا دالّةَ ههنا")).toBeNull();
  });
});

describe("F4-02 — حاجزُ الحالةِ الساخنةِ: كلُّ قاعدةٍ تُسقِطُ خرقَها", () => {
  it("٥) تضييقُ مُسنَدِ المخزنِ الساخنِ إلى `>=` يُسقِطُ البناءَ", () => {
    const broken = REAL.redisAdapter.replace(
      "if newest > incoming then",
      "if newest >= incoming then",
    );
    expect(broken).not.toBe(REAL.redisAdapter);

    const violations = findViolations(withSource({ redisAdapter: broken }));
    // `>=` يرفضُ المتساويَ، والقاعدةُ تقبلُه — حَكَمانِ مختلفانِ على الإصلاحةِ الواحدةِ.
    expect(violations.some((entry) => entry.includes("newest > incoming"))).toBe(true);
  });

  it("٦) قلبُ المُسنَدِ إلى `<` — قبولُ الأقدمِ — يُسقِطُ البناءَ", () => {
    const broken = REAL.redisAdapter.replace(
      "if newest > incoming then",
      "if newest < incoming then",
    );

    const violations = findViolations(withSource({ redisAdapter: broken }));
    expect(violations.some((entry) => entry.includes("حارسِ التسلسلِ"))).toBe(true);
  });

  it("٧) حذفُ فرعِ الرفضِ كلِّه يُسقِطُ البناءَ", () => {
    const broken = REAL.redisAdapter.replace(
      "if newest > incoming then return {'stale', 0, newest} end",
      "-- حُذِفَ الحارسُ",
    );

    const violations = findViolations(withSource({ redisAdapter: broken }));
    expect(violations.some((entry) => entry.includes("BUG-001"))).toBe(true);
  });

  it("٨) حالةٌ ساخنةٌ بلا `EXPIRE` تُسقِطُ البناءَ", () => {
    const broken = REAL.redisAdapter.replace("redis.call('EXPIRE'", "redis.call('TYPE'");

    const violations = findViolations(withSource({ redisAdapter: broken }));
    expect(violations.some((entry) => entry.includes("EXPIRE"))).toBe(true);
  });

  it("٩) تضييقُ مُسنَدِ الدفعةِ إلى `<` يُسقِطُ البناءَ", () => {
    const broken = mutateBatchFunction(
      "last_location_recorded_at <=",
      "last_location_recorded_at <",
    );

    const violations = findViolations(withSource({ migrations: broken }));
    // `<` يرفضُ المتساويَ فتُهمَلُ نبضةٌ في نفسِ الملّي — وهوَ افتراقٌ عن الكتابةِ المباشرةِ.
    expect(violations.some((entry) => entry.includes("ADR 0053"))).toBe(true);
  });

  it("١٠) غيابُ الدالّةِ الذرّيّةِ كلِّها يُسقِطُ البناءَ", () => {
    const violations = findViolations(withSource({ migrations: "-- لا هجرةَ" }));

    expect(violations.some((entry) => entry.includes("القاعدةِ ٠.٥"))).toBe(true);
  });

  it("١١) دفعةٌ بلا `distinct on` تُسقِطُ البناءَ", () => {
    const broken = mutateBatchFunction("distinct on", "all --");

    const violations = findViolations(withSource({ migrations: broken }));
    expect(violations.some((entry) => entry.includes("distinct on"))).toBe(true);
  });

  it("١٢) كتابةُ دفعةٍ بلا قيدِ مدينةٍ تُسقِطُ البناءَ", () => {
    const broken = mutateBatchFunction(/city_id\s*=\s*p_city_id/g, "true");

    const violations = findViolations(withSource({ migrations: broken }));
    expect(violations.some((entry) => entry.includes("القاعدةِ ٠.٤"))).toBe(true);
  });

  it("١٣) مفتاحٌ غيرُ مبذورٍ في هجرةٍ يُسقِطُ البناءَ", () => {
    const broken = REAL.migrations.replaceAll("'driver_location_flush_batch_size'", "'x_unseeded'");

    const violations = findViolations(withSource({ migrations: broken }));
    expect(violations.some((entry) => entry.includes("driver_location_flush_batch_size"))).toBe(
      true,
    );
  });

  it("١٤) افتراضٌ رقميٌّ في تفسيرِ الحدودِ يُسقِطُ البناءَ", () => {
    const broken = REAL.limitsModule.replace(
      'const hotTtlSeconds = find("driver_location_hot_ttl_seconds");',
      'const hotTtlSeconds = find("driver_location_hot_ttl_seconds") ?? 60;',
    );
    expect(broken).not.toBe(REAL.limitsModule);

    const violations = findViolations(withSource({ limitsModule: broken }));
    // رقمٌ احتياطيٌّ في الشيفرةِ يجعلُ حِمْلَ القاعدةِ محكوماً بما لا يراهُ مالكٌ.
    expect(violations.some((entry) => entry.includes("افتراضٌ رقميٌّ"))).toBe(true);
  });

  it("١٥) أمرُ حالةٍ مفردٌ خارجَ سكربتٍ يُسقِطُ البناءَ", () => {
    const broken = `${REAL.redisAdapter}\nawait redis.command(["ZADD", "k", "1", "m"]);\n`;

    const violations = findViolations(withSource({ redisAdapter: broken }));
    expect(violations.some((entry) => entry.includes("ZADD"))).toBe(true);
    expect(issuesSingleCommand(broken, "ZADD")).toBe(true);
    // والسكربتُ نفسُه يذكرُ `ZADD` داخلَ Lua ولا يُقرأُ خرقاً — وإلّا كانَ الحاجزُ عمياءَ.
    expect(issuesSingleCommand(REAL.redisAdapter, "ZADD")).toBe(false);
  });

  it("١٦) محوُ `EVAL` — أي فكُّ الذرّيّةِ — يُسقِطُ البناءَ", () => {
    const broken = REAL.redisAdapter.replaceAll('"EVAL"', '"PING"');

    const violations = findViolations(withSource({ redisAdapter: broken }));
    expect(violations.some((entry) => entry.includes("EVAL"))).toBe(true);
  });

  it("١٧) منفذٌ ساخنٌ **مفروضٌ** في حالةِ الاستخدامِ يُسقِطُ البناءَ", () => {
    const broken = REAL.useCase.replace("readonly hotState?:", "readonly hotState:");
    expect(broken).not.toBe(REAL.useCase);

    const violations = findViolations(withSource({ useCase: broken }));
    // منفذٌ مفروضٌ يعني أنَّ عطلَ Redis يُسقِطُ استقبالَ الموقعِ كلَّه.
    expect(violations.some((entry) => entry.includes("F4-01"))).toBe(true);
  });

  it("١٨) تدهوّرٌ صامتٌ بلا خُطّافِ تسجيلٍ يُسقِطُ البناءَ", () => {
    const broken = REAL.useCase.replaceAll("onHotStateDegraded", "unusedHook");

    const violations = findViolations(withSource({ useCase: broken }));
    expect(violations.some((entry) => entry.includes("تدهوّرٌ صامتٌ"))).toBe(true);
  });

  it("١٩) تغيُّرُ مُسنَدِ الكتابةِ المباشرةِ وحدَه يُسقِطُ البناءَ", () => {
    const broken = REAL.directWrite.replaceAll("last_location_recorded_at", "last_location_at");

    const violations = findViolations(withSource({ directWrite: broken }));
    /**
     * الحاجزُ يقيسُ الدفعةَ على الكتابةِ المباشرةِ، فلو تغيَّرَت المباشرةُ وحدَها
     * صارَ القياسُ على مرجعٍ متحرِّكٍ — والخرقُ ههنا هوَ ما يمنعُ ذلكَ.
     */
    expect(violations.some((entry) => entry.includes("الكتابةِ المباشرةِ"))).toBe(true);
  });
});
