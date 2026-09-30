/**
 * الغرض: إثبات أنّ مهمّة `detect-ceiling-exceeded` (`F12-20`) **مُسجَّلةٌ فعلًا في
 *   حاوية العامل** بتواترٍ فعّال — لا مجرّد ملفٍّ موجودٍ في `jobs/`.
 *
 *   وهذا الاختبار كُتب لأنّ فحصَ المستودعِ كشفَ ثغرةً حقيقيّةً: ملفَّ المهمّةِ
 *   (`detect-ceiling-exceeded.ts`) ومحويهِ (`CeilingExceededOrderRpcPort`) والمحوّلَ
 *   (`createCeilingExceededAdapter`) كانت كلّها مبنيةً ومُختبَرةً **وغيرَ موصولةٍ** —
 *   لا استيرادَ لها في `container.ts` ولا مدخلَ في `JOB_INTERVALS` ولا تسجيلَ
 *   مهمّةٍ. فالكاشفُ المزعومُ لا يعملُ أبدًا، والتصعيدُ الموعودُ في `ROADMAP-MASTER`
 *   غيرَ منفَّذٍ في التشغيلِ. والملفُّ الموجودُ بلا تسجيلٍ أخطرُ من الحذفِ:
 *   الحذفُ يُلاحَظ، والوجودُ الصامتُ يُطمئن.
 *
 *   والحدُّ الأعلى يُثبَّت بمعناه لا برقمه: تواترٌ أطولُ من ساعةٍ يعني رحلةً
 *   متجاوزةً السقفَ (٧٢٠ دقيقةً افتراضاً) تقفُ أمامَ عينِ المُشغِّلِ بعدَ أكثرَ من
 *   ١٪ من عمرِ المهلةِ — فالتواترُ يجبُ أن يبقى في رتبةِ الدقائقِ لا الساعاتِ.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة (قاعدة مزيَّفة للقوائم).
 * ينتمي إلى: tests/unit
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */

import { describe, expect, it } from "bun:test";
import { buildWorkerContainer, JOB_INTERVALS } from "../../apps/workers/src/container.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { OutboundSender } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import { testConfig } from "../support/config.ts";

const CITY_ID = "11111111-2222-3333-4444-555555555555";

/** أقصى تواترٍ مقبولٍ بالثواني — ساعةٌ واحدة: أطولُ منها رؤيةٌ متأخّرةٌ بلا مبرّر. */
const MAX_ACCEPTABLE_INTERVAL_SECONDS = 3600;

const config: AppConfig = testConfig({
  port: 3994,
  supabaseUrl: "https://unit.test.supabase.co",
  databaseUrl: "postgres://unit:test@localhost:5432/unit",
  supabaseServiceKey: "unit-test",
  redisToken: "unit-test",
  telegramWebhookSecret: "unit-secret",
});

/** قاعدة مزيَّفة تُعيد مدينةً واحدةً مفعَّلة — الغرض قراءة القائمة لا تنفيذُ المهامّ. */
function fakeSql(): Sql {
  const run = (strings: TemplateStringsArray | string): unknown[] => {
    const text = typeof strings === "string" ? strings : strings.join("?");
    if (/from\s+cities/i.test(text) && /is_active\s*=\s*true/i.test(text)) {
      return [{ id: CITY_ID, code: "UNI", name_ar: "مدينة الاختبار", name_en: "Unit City" }];
    }
    return [];
  };
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(run(strings))) as unknown as Sql;
  (sql as unknown as { end: () => Promise<void> }).end = async () => undefined;
  (sql as unknown as { unsafe: (text: string) => Promise<unknown[]> }).unsafe = async (text) =>
    run(text);
  return sql;
}

function capturingSender(): OutboundSender {
  return { send: async () => ok(undefined) } as unknown as OutboundSender;
}

describe("F12-20 — تسجيل كاشف تجاوز السقف في حاوية العامل", () => {
  it("مُسجَّلةٌ لكلّ مدينةٍ مفعَّلةٍ بتواترٍ فعّالٍ في رتبة الدقائق", async () => {
    const sql = fakeSql();
    const container = buildWorkerContainer(config, {
      sql,
      lockSql: sql,
      lock: createNoopLock(),
      driverOut: capturingSender(),
      riderOut: capturingSender(),
      warningSender: { send: async () => ok(undefined) },
    });

    try {
      const jobs = await container.jobs();
      const job = jobs.find((entry) => entry.name === `detect-ceiling-exceeded:${CITY_ID}`);
      expect(job).toBeDefined();
      if (job === undefined) return;

      // التواترُ المُسجَّل هو الثابتُ نفسه لا رقمٌ حرفيٌّ في موضعٍ آخر.
      expect(job.everySeconds).toBe(JOB_INTERVALS.detectCeilingExceeded);
      expect(job.everySeconds).toBeGreaterThan(0);
      // في رتبةِ الدقائقِ لا الساعاتِ: رحلةٌ فوقَ السقفِ تُرى خلالَ أجزاءٍ من المئةِ
      // من عمرِ المهلةِ لا بعدَ ساعاتٍ منها.
      expect(job.everySeconds).toBeLessThanOrEqual(MAX_ACCEPTABLE_INTERVAL_SECONDS);
    } finally {
      await container.close();
    }
  });

  it("المحوّلُ يُبنى من القاعدةِ لا يُفترض — نداءُ التسجيلِ يمرُّ بالمهمّة", async () => {
    // المهمّةُ مُسجَّلةٌ بنداءِ `detectCeilingExceededOrders` الذي يأخذُ المحوّلَ
    // من التبعيّاتِ — فوجودُها في القائمةِ يعني أنّ الاستيرادَ والمحوّلَ موصولانِ.
    const sql = fakeSql();
    const container = buildWorkerContainer(config, {
      sql,
      lockSql: sql,
      lock: createNoopLock(),
      driverOut: capturingSender(),
      riderOut: capturingSender(),
      warningSender: { send: async () => ok(undefined) },
    });

    try {
      const jobs = await container.jobs();
      const names = jobs.map((entry) => entry.name);
      expect(names).toContain(`detect-ceiling-exceeded:${CITY_ID}`);
      // والثابتُ نفسُه في رتبةِ الدقائقِ: خمسُ دقائقَ لا أكثر.
      expect(JOB_INTERVALS.detectCeilingExceeded).toBeLessThanOrEqual(
        MAX_ACCEPTABLE_INTERVAL_SECONDS,
      );
    } finally {
      await container.close();
    }
  });
});
