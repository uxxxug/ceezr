/**
 * الغرض: اختبارُ حاجزِ `scripts/check-tracking-event-carrier.ts` نفسِه — أنَّ
 *    المستودعَ القائمَ يمرُّ، **وأنَّ كلَّ قاعدةٍ من قواعدِه الأربعِ تُسقِطُ خرقَها
 *    فعلاً**، وأنَّ المفتاحَ مصدرُ حقيقةٍ واحدٌ تقرؤهُ العمليّتانِ كلتاهما.
 * الحالة: اختبار فعلي — دوالٌّ خالصةٌ تُمرَّرُ لها نصوصٌ مُصطنَعة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 *
 * **ولمَ حالاتٌ سالبةٌ:** حاجزٌ لا تُختبَرُ حالاتُه السالبةُ حاجزٌ بالاسمِ — يمرُّ
 * أبداً ولا يُدرى أنَّه توقَّفَ عن الرؤية. فكلُّ حالةٍ ههنا تُشوِّهُ نصّاً تشويهاً
 * واقعيّاً (نصٌّ حرفيٌّ عائدٌ، غلافٌ محذوفٌ، ماسحٌ غيرُ مُشغَّلٍ، بانٍ ثانٍ،
 * مجرىً ثانٍ) وتُطالِبُ الحاجزَ بخرقٍ.
 *
 * **وحدُّ الملفِّ مُعلَنٌ:** يقيسُ قراءةَ النصِّ لا عبورَ الحدثِ بينَ النسخ — ذاكَ
 * في `tests/unit/redis-stream-event-bus.test.ts` واختباراتِ Redis الحقيقيّ.
 */

import { describe, expect, it } from "bun:test";
import { TRACKING_EVENT_STREAM_KEY } from "../../packages/infrastructure/tracking/redis-stream-event-bus.ts";
import {
  CARRIER_MODULE,
  carrierContainers,
  countCalls,
  DISTRIBUTED_FACTORY,
  findViolations,
  isCommentLine,
  KEY_CONSTANT,
  KEY_LITERAL,
  LOCAL_FACTORY,
  readSources,
  type SourceFile,
} from "../../scripts/check-tracking-event-carrier.ts";

/** المستودعُ كما هوَ — أساسٌ لا تُشتَقُّ منه الحالاتُ السالبةُ إلّا بتشويهٍ واحدٍ. */
const REAL = readSources();

/** حاويةٌ سليمةٌ مُصطنَعةٌ: أقلُّ نصٍّ يُمرِّرُ القواعدَ الأربعَ كلَّها. */
const SOUND_CONTAINER = `
import { ${LOCAL_FACTORY} } from "../../../packages/infrastructure/tracking/event-bus.ts";
import { ${DISTRIBUTED_FACTORY}, ${KEY_CONSTANT} } from "../../../${CARRIER_MODULE}";

const local = ${LOCAL_FACTORY}(log);
const distributed = redis !== null
  ? ${DISTRIBUTED_FACTORY}({ local, redis, streamKey: ${KEY_CONSTANT}, instanceId: id })
  : null;
if (distributed !== null) distributed.start();
`;

function files(...overrides: readonly SourceFile[]): readonly SourceFile[] {
  return [{ path: "apps/gateway/src/container.ts", source: SOUND_CONTAINER }, ...overrides];
}

describe("F4-03 — حاجزُ المجرى المشترك: المستودعُ القائمُ", () => {
  it("١) لا خرقَ في المستودعِ كما هوَ", () => {
    expect(findViolations(REAL)).toEqual([]);
  });

  it("٢) العمليّتانِ كلتاهما تبنيانِ ناقلاً — لا واحدةٌ ولا صفرٌ", () => {
    const carriers = carrierContainers(REAL);

    expect(carriers).toContain("apps/gateway/src/container.ts");
    expect(carriers).toContain("apps/admin/src/container.ts");
  });

  it("٣) المفتاحُ يُقرأُ من الثابتِ المُصدَّرِ، وقيمتُه هيَ المُتوقَّعة", () => {
    // لو صارَ الثابتُ اسماً بلا قيمةٍ صحيحةٍ لمرَّ الحاجزُ ونحنُ في مجرىً آخر.
    expect(TRACKING_EVENT_STREAM_KEY).toBe(KEY_LITERAL);
  });

  it("٤) التعليقُ يجوزُ أن يذكرَ المفتاحَ نصّاً، والشيفرةُ لا", () => {
    expect(isCommentLine(` * مفتاحُ ${KEY_LITERAL} يُذكرُ شرحاً`)).toBe(true);
    expect(isCommentLine(`  // ${KEY_LITERAL}`)).toBe(true);
    expect(isCommentLine(`  streamKey: "${KEY_LITERAL}",`)).toBe(false);
  });

  it("٥) عدُّ النداءاتِ يُميّزُ النداءَ من ذكرِ الاسمِ في استيرادٍ", () => {
    expect(countCalls(`import { ${LOCAL_FACTORY} } from "x";`, LOCAL_FACTORY)).toBe(0);
    expect(countCalls(`${LOCAL_FACTORY}(a); ${LOCAL_FACTORY}(b);`, LOCAL_FACTORY)).toBe(2);
  });
});

describe("F4-03 — حاجزُ المجرى المشترك: كلُّ قاعدةٍ تُسقِطُ خرقَها", () => {
  it("١) نصٌّ حرفيٌّ للمفتاحِ في شيفرةٍ خارجَ وحدةِ الناقلِ → خرقٌ", () => {
    const violations = findViolations(
      files({
        path: "apps/workers/src/relay.ts",
        source: `const key = "${KEY_LITERAL}";`,
      }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe("apps/workers/src/relay.ts");
    expect(violations[0]?.why).toContain(KEY_CONSTANT);
  });

  it("٢) وحدةُ الناقلِ نفسُها تُعرِّفُ المفتاحَ نصّاً بلا خرقٍ", () => {
    expect(
      findViolations(
        files({ path: CARRIER_MODULE, source: `export const ${KEY_CONSTANT} = "${KEY_LITERAL}";` }),
      ),
    ).toEqual([]);
  });

  it("٣) حاويةٌ ببناءِ ناقلٍ محليٍّ بلا غلافٍ موزَّعٍ → خرقٌ", () => {
    const violations = findViolations([
      { path: "apps/admin/src/container.ts", source: `const bus = ${LOCAL_FACTORY}(log);` },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain(DISTRIBUTED_FACTORY);
  });

  it("٤) غلافٌ موزَّعٌ بلا `.start()` → خرقٌ (ماسحٌ لا يدورُ لا يُسلِّمُ شيئاً)", () => {
    const violations = findViolations([
      {
        path: "apps/admin/src/container.ts",
        source: `
const local = ${LOCAL_FACTORY}(log);
const bus = ${DISTRIBUTED_FACTORY}({ local, streamKey: ${KEY_CONSTANT} });
`,
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain(".start()");
  });

  it("٥) بانيانِ محليّانِ في العمليةِ نفسِها → خرقٌ", () => {
    const violations = findViolations([
      {
        path: "apps/gateway/src/container.ts",
        source: `${SOUND_CONTAINER}\nconst second = ${LOCAL_FACTORY}(log);`,
      },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("**واحدٌ**");
  });

  it("٦) `streamKey` بمفتاحٍ ثانٍ → خرقان: النصُّ الحرفيُّ والمفتاحُ غيرُ الثابتِ", () => {
    const violations = findViolations([
      {
        path: "apps/gateway/src/container.ts",
        source: SOUND_CONTAINER.replace(
          `streamKey: ${KEY_CONSTANT}`,
          `streamKey: "${KEY_LITERAL}:v2"`,
        ),
      },
    ]);

    // النصُّ الحرفيُّ يحملُ المفتاحَ بادئةً، فالقاعدتانِ ترصدانِه — وهذا مقصودٌ:
    // البادئةُ عينُ الانشقاقِ الصامتِ الذي بُنيَ الحاجزُ له.
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some((v) => v.why.includes("`streamKey` غير"))).toBe(true);
  });

  it("٧) بناءُ الناقلِ خارجَ الحاويةِ (حوارٌ أو مسارٌ) → خرقٌ", () => {
    const violations = findViolations(
      files({
        path: "packages/application/bots/driver/tracking-flow.ts",
        source: `const bus = ${LOCAL_FACTORY}(log);`,
      }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("container.ts");
  });

  it("٨) الاختباراتُ تبني ناقلاً محليّاً بحرّيّةٍ — عزلُ الحالةِ لا انشقاقُ إنتاجٍ", () => {
    expect(
      findViolations(files({ path: "tests/unit/x.test.ts", source: `${LOCAL_FACTORY}(log);` })),
    ).toEqual([]);
  });

  it("٩) غيابُ الناقلِ كلّيّاً → خرقٌ لا نجاحٌ (ح-5)", () => {
    const violations = findViolations([
      { path: "apps/gateway/src/index.ts", source: "export {};" },
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.why).toContain("ح-5");
  });
});
