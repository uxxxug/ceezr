/**
 * الغرض: يُثبت أنّ بوّابةَ دورةِ حياةِ حاوياتِ الاختبار تكتشف النمطَ المعيبَ فعلاً
 *   وتقبل النمطَ السليم — بوّابةٌ لا يُثبَت أنّها تُخفق عند العيب حراسةٌ وهمية.
 * الحالة: منفّذ فعلياً
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: —
 * ملاحظات مستقبلية: —
 */

import { describe, expect, it } from "bun:test";
import {
  analyseSource,
  hookBody,
  scanRepository,
} from "../../scripts/check-test-container-lifecycle.ts";

const LEAKY = `
import { afterAll, beforeEach, describe, it } from "bun:test";
let container: ReturnType<typeof buildContainer>;
describe("x", () => {
  beforeEach(async () => {
    container = buildContainer(config, sql);
  });
  afterAll(async () => {
    await container.close();
    await sql.end({ timeout: 5 });
  });
});
`;

const SOUND = `
import { afterAll, afterEach, beforeEach, describe, it } from "bun:test";
let container: ReturnType<typeof buildContainer>;
describe("x", () => {
  beforeEach(async () => {
    container = buildContainer(config, sql);
  });
  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });
});
`;

const ONCE_PER_FILE = `
import { afterAll, beforeAll, describe, it } from "bun:test";
describe("x", () => {
  beforeAll(async () => {
    container = buildContainer(config, sql);
  });
  afterAll(async () => {
    await container.close();
  });
});
`;

describe("بوّابةُ دورةِ حياةِ حاوياتِ الاختبار", () => {
  it("تكتشف بناءً لكلِّ اختبارٍ بإغلاقٍ واحدٍ في النهاية", () => {
    const finding = analyseSource("tests/integration/x.test.ts", LEAKY);
    expect(finding).not.toBeNull();
    expect(finding?.reason).toContain("beforeEach");
  });

  it("تقبل الإغلاقَ لكلِّ اختبارٍ ولو كان عبر سلسلةٍ اختيارية", () => {
    expect(analyseSource("tests/integration/x.test.ts", SOUND)).toBeNull();
  });

  it("لا تعترض على حاويةٍ واحدةٍ للملفِّ كلِّه — لا تراكمَ هناك", () => {
    expect(analyseSource("tests/integration/x.test.ts", ONCE_PER_FILE)).toBeNull();
  });

  it("تقتطع جسمَ الخُطّافِ بموازنةِ الأقواسِ لا بأوّلِ قوسٍ مغلق", () => {
    const body = hookBody("beforeEach(async () => { if (a) { b(); } c(); });", "beforeEach");
    expect(body).toContain("c();");
  });

  it("المستودعُ نفسُه نظيفٌ الآن", () => {
    expect(scanRepository()).toEqual([]);
  });
});
