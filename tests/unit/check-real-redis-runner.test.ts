/**
 * الغرض: إثباتُ أنَّ حاجزَ «وظيفةُ Redis الحقيقيِّ تملكُ خادمَها» (`S-3` · ADR 0096)
 *   **يُسقِطُ** فعلاً عندَ كلِّ صنفٍ من الانحرافِ الذي يزعمُ منعَه: خادمٌ محذوفٌ،
 *   وقشرةٌ محذوفةٌ، وقشرةٌ تُخاطِبُ خادماً آخرَ، ومنفذٌ منحرفٌ، ورمزٌ منحرفٌ،
 *   وشرطُ تفعيلٍ مُطفَأٌ، وجهوزيّةٌ محذوفةٌ، ووظيفةٌ محذوفةٌ بكاملِها.
 *   وحاجزٌ لا يُختبَرُ سقوطُه حاجزٌ مزعومٌ.
 * الحالة: اختبارُ وحدةٍ فعليٌّ — يقرأُ مسارَ CI الحقيقيَّ ثمَّ يزرعُ فيه الخللَ نصّاً.
 * ينتمي إلى: tests/unit · البند `S-3`.
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على وظيفةِ `real-redis`.
 * ملاحظات مستقبلية: لو نُقِلَ الخادمُ إلى مُزوِّدٍ مُستضافٍ بقرارِ ADR فتُستبدَلُ
 *   هذه الحالاتُ بحالاتِ التهيئةِ الجديدةِ — لا تُحذَفُ لتُقرَأَ الوظيفةُ خضراءَ.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { auditRealRedisRunner } from "../../scripts/lib/real-redis-runner.ts";

const WORKFLOW = readFileSync(".github/workflows/ci.yml", "utf8");

const joined = (violations: readonly string[]) => violations.join(" | ");

describe("حاجزُ خادمِ Redis في الشغلةِ — أخضرُ على المستودعِ كما هوَ", () => {
  test("لا مخالفةَ واحدةً في مسارِ CI الحقيقيِّ", () => {
    expect(auditRealRedisRunner(WORKFLOW)).toEqual([]);
  });
});

describe("حاجزُ خادمِ Redis — سقوطٌ مزروعٌ لكلِّ انحرافٍ", () => {
  test("حذفُ صورةِ خادمِ Redis يُسقِطُ", () => {
    const broken = WORKFLOW.replace("image: redis:7-alpine", "image: busybox:latest");
    expect(joined(auditRealRedisRunner(broken))).toContain("لا خدمةَ خادمِ Redis حقيقيٍّ");
  });

  test("حذفُ قشرةِ REST يُسقِطُ", () => {
    const broken = WORKFLOW.replace(
      "image: hiett/serverless-redis-http:latest",
      "image: busybox:latest",
    );
    expect(joined(auditRealRedisRunner(broken))).toContain("لا قشرةَ REST");
  });

  test("قشرةٌ تُخاطِبُ خادماً خارجَ الوظيفةِ تُسقِطُ", () => {
    const broken = WORKFLOW.replace(
      "SRH_CONNECTION_STRING: redis://redis:6379",
      "SRH_CONNECTION_STRING: rediss://someone-else.upstash.io:6379",
    );
    expect(joined(auditRealRedisRunner(broken))).toContain("لا خدمةَ");
  });

  test("انحرافُ المنفذِ بينَ القشرةِ والاختبارِ يُسقِطُ", () => {
    const broken = WORKFLOW.replace('ports: ["8079:80"]', 'ports: ["8080:80"]');
    expect(joined(auditRealRedisRunner(broken))).toContain("UPSTASH_REDIS_REST_URL");
  });

  test("انحرافُ الرمزِ بينَ القشرةِ والاختبارِ يُسقِطُ", () => {
    const broken = WORKFLOW.replace(
      "SRH_TOKEN: waslah-ci-real-redis",
      "SRH_TOKEN: another-token-entirely",
    );
    expect(joined(auditRealRedisRunner(broken))).toContain("SRH_TOKEN");
  });

  test("عودةُ النقطةِ إلى سِرٍّ خارجيٍّ تُسقِطُ", () => {
    const broken = WORKFLOW.replace(
      "UPSTASH_REDIS_REST_URL: http://localhost:8079",
      `UPSTASH_REDIS_REST_URL: $\u007b{ secrets.UPSTASH_REDIS_REST_URL }}`,
    );
    expect(joined(auditRealRedisRunner(broken))).toContain("UPSTASH_REDIS_REST_URL");
  });

  test("إطفاءُ شرطِ التفعيلِ يُسقِطُ", () => {
    const broken = WORKFLOW.replace('REQUIRE_REAL_REDIS: "1"', 'REQUIRE_REAL_REDIS: "0"');
    expect(joined(auditRealRedisRunner(broken))).toContain("REQUIRE_REAL_REDIS");
  });

  test("حذفُ خطوةِ الجهوزيّةِ يُسقِطُ", () => {
    const broken = WORKFLOW.replace("-d '[\"PING\"]'", '-d \'["ECHO","x"]\'').replace(
      `✅ Redis حقيقيٌّ مُجيبٌ عبرَ REST بعدَ $\u007bi} محاولةً`,
      "ok",
    );
    expect(joined(auditRealRedisRunner(broken))).toContain("جهوزيّةٍ");
  });

  test("حذفُ الوظيفةِ نفسِها يُسقِطُ ولا يُقرَأُ نجاحاً", () => {
    const broken = WORKFLOW.replace("\n  real-redis:\n", "\n  real-redis-disabled:\n");
    expect(joined(auditRealRedisRunner(broken))).toContain("لا وظيفةَ");
  });

  test("مسارٌ بلا وظائفَ ألبتّةَ يُسقِطُ", () => {
    expect(joined(auditRealRedisRunner("name: CI\non: push\n"))).toContain("لا كتلةَ");
  });

  test("وظيفةٌ بلا خدماتٍ ألبتّةَ تُسقِطُ", () => {
    expect(joined(auditRealRedisRunner("jobs:\n  real-redis:\n    steps: []\n"))).toContain(
      "بلا `services`",
    );
  });
});
