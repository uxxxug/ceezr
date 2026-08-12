/**
 * الغرض: إثبات أن مجدول المهامّ الدورية يعمل فعلاً داخل عملية البوابة: أن المتغيّر
 *   RUN_WORKER_IN_GATEWAY يُقرأ صحيحاً، وأن الإقلاع المدمج يُسجّل مهامّ المدينة
 *   المفعَّلة والمهامّ العامّة بالأسماء نفسها التي تُسجّلها خدمة العامل المستقلّة،
 *   وأن مهمّة واحدة على الأقل تُنفَّذ فعلاً لا تُسجَّل فقط، وأن الإيقاف يُغلق كل شيء.
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على apps/gateway/src/embedded-worker.ts أو على
 *   قراءة RUN_WORKER_IN_GATEWAY في packages/shared/config
 * ملاحظات مستقبلية: يوم تُنشأ خدمة waslah-worker مستقلّة يبقى هذا الاختبار صالحاً —
 *   فهو يختبر المسار المدمج لا وجودَ الخدمة.
 */

import { describe, expect, it } from "bun:test";
import { startEmbeddedWorker } from "../../apps/gateway/src/embedded-worker.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { OutboundSender } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { type AppConfig, tryLoadConfig } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY_ID = "11111111-2222-3333-4444-555555555555";

const BASE_ENV: Record<string, string> = {
  SUPABASE_URL: "https://unit.test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "unit-test",
  DATABASE_URL: "postgres://unit:test@localhost:5432/unit",
  UPSTASH_REDIS_REST_URL: "http://localhost",
  UPSTASH_REDIS_REST_TOKEN: "unit-test",
  DRIVER_BOT_TOKEN: "driver-token",
  RIDER_BOT_TOKEN: "rider-token",
  TELEGRAM_WEBHOOK_SECRET: "unit-secret",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
};

const config: AppConfig = {
  env: "test",
  port: 3994,
  supabaseUrl: BASE_ENV.SUPABASE_URL as string,
  databaseUrl: BASE_ENV.DATABASE_URL as string,
  supabaseServiceKey: "unit-test",
  redisUrl: "http://localhost",
  redisToken: "unit-test",
  sessionStore: "memory",
  driverBotToken: "driver-token",
  riderBotToken: "rider-token",
  telegramWebhookSecret: "unit-secret",
  bootstrapAdminTelegramId: "990001",
  translationProvider: "none",
  translationApiKey: null,
  translationContactEmail: null,
  runWorkerInGateway: true,
  // المرحلة ١٠: حقول الخريطة. `none` هو الافتراضي في الضبط الحقيقي، فالاختبارات
  // تعبّر عن نفس الحال: لا خريطة، ولا مفتاح، ولا نمط.
  mapProvider: "none",
  mapStyleUrl: null,
  mapTilesPublicKey: null,
  maplibreSri: null,
  // المرحلة ١٥ — لا مزوّد توجيه في الاختبارات الافتراضية: زمن الوصول يُمتنع صريحاً.
  routingProvider: "none",
  osrmBaseUrl: null,
};

interface FakeSqlLog {
  readonly queries: string[];
}

/**
 * قاعدة مزيَّفة على مستوى النصّ لا على مستوى المحوّل: الغرض إثبات أن المهامّ سُجِّلت
 * ونُفِّذت داخل عملية البوابة، لا إعادة اختبار محوّلات القاعدة — تلك لها اختبارات
 * تكامل على قاعدة حقيقية. تُعيد صفّ مدينة واحدة مفعَّلة، وصفوفاً فارغة لما بعدها،
 * فينتهي كل شوط مهمّة بنتيجة صفرية صحيحة لا بخطأ.
 */
function fakeSql(log: FakeSqlLog): Sql {
  const run = (strings: TemplateStringsArray | string): unknown[] => {
    const text = typeof strings === "string" ? strings : strings.join("?");
    log.queries.push(text.replace(/\s+/g, " ").trim());
    if (/from\s+cities/i.test(text) && /is_active\s*=\s*true/i.test(text)) {
      return [{ id: CITY_ID, code: "UNI", name_ar: "مدينة الاختبار", name_en: "Unit City" }];
    }
    return [];
  };

  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) =>
    Promise.resolve(run(strings))) as unknown as Sql;
  // `end` وحده هو ما يستدعيه الإغلاق فعلاً؛ بقية الواجهة غير مطلوبة لهذا المسار.
  (sql as unknown as { end: () => Promise<void> }).end = async () => undefined;
  (sql as unknown as { unsafe: (text: string) => Promise<unknown[]> }).unsafe = async (text) =>
    run(text);
  return sql;
}

/** مُرسِل يجمع بلا شبكة — لا تُفتح أي اتصال بتيليجرام في اختبار وحدة. */
function capturingSender(sent: string[]): OutboundSender {
  return {
    send: async (target: unknown, text: unknown) => {
      sent.push(`${String(target)}:${String(text)}`);
      return ok(undefined);
    },
  } as unknown as OutboundSender;
}

describe("قراءة RUN_WORKER_IN_GATEWAY", () => {
  it("الغياب يعني عدم التفعيل — لا يُشغَّل عاملٌ لمن لم يطلبه", () => {
    const result = tryLoadConfig({ ...BASE_ENV });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(false);
  });

  it("القيم المقبولة تُفعِّل، والقيمة غير المفهومة تعني عدم التفعيل", () => {
    for (const raw of ["true", "TRUE", " 1 ", "yes", "on"]) {
      const result = tryLoadConfig({ ...BASE_ENV, RUN_WORKER_IN_GATEWAY: raw });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.runWorkerInGateway).toBe(true);
    }
    for (const raw of ["false", "0", "maybe", ""]) {
      const result = tryLoadConfig({ ...BASE_ENV, RUN_WORKER_IN_GATEWAY: raw });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.runWorkerInGateway).toBe(false);
    }
  });
});

describe("العامل المدمج داخل عملية البوابة", () => {
  it("يُسجّل مهامّ المدينة المفعَّلة والمهامّ العامّة ثم يتوقّف نظيفاً", async () => {
    const log: FakeSqlLog = { queries: [] };
    const sql = fakeSql(log);
    const lines: string[] = [];
    const sent: string[] = [];

    const handle = await startEmbeddedWorker(
      config,
      {
        info: (message, fields) => lines.push(`${message} ${JSON.stringify(fields ?? {})}`),
        error: (message, fields) => lines.push(`ERROR ${message} ${JSON.stringify(fields ?? {})}`),
      },
      {
        sql,
        lockSql: sql,
        lock: createNoopLock(),
        driverOut: capturingSender(sent),
        riderOut: capturingSender(sent),
        warningSender: { send: async () => ok(undefined) },
      },
    );

    try {
      // المهامّ المدنية الستّ + العامّتان. الرقم مثبَّت عن قصد: نقصانه يعني مهمّة
      // اختفت من الإنتاج بلا أن يلاحظها أحد، وهو بالضبط العطب الذي جاء البند ليُصلحه.
      // صار ستّاً في المرحلة ١٤ بإضافة `redispatch-searching` — والحارس هو من كشف
      // الإضافة، فبقاؤه رقماً مثبَّتاً مقصود لا سهو.
      expect(handle.jobCount).toBe(8);

      const started = lines.find((line) => line.startsWith("embedded_worker.started"));
      expect(started).toBeDefined();
      for (const name of [
        `expire-offers:${CITY_ID}`,
        `redispatch-searching:${CITY_ID}`,
        `sweep-unmatched:${CITY_ID}`,
        `rotate-negotiations:${CITY_ID}`,
        `cleanup-stale:${CITY_ID}`,
        `warn-expiring:${CITY_ID}`,
        "expire-subscriptions",
        "recompute-ratings",
      ]) {
        expect(started).toContain(name);
      }

      // التسجيل ليس تنفيذاً: المشغّل يُطلق نبضة فورية عند start()، فمهامّ runOnStart
      // يجب أن تكون قد لمست القاعدة فعلاً — وإلّا كان الاختبار يثبت قائمةً لا عملاً.
      await Bun.sleep(50);
      expect(lines.some((line) => line.startsWith("job.ran"))).toBe(true);
      expect(log.queries.length).toBeGreaterThan(1);
    } finally {
      await handle.stop();
    }

    expect(lines.some((line) => line.startsWith("runner.stopped"))).toBe(true);
    expect(lines.some((line) => line.startsWith("embedded_worker.stopped"))).toBe(true);

    // الإيقاف يجب أن يكون فعلاً لا إعلاناً: نبضة بعد الإيقاف لا تُنتج استعلاماً جديداً.
    const afterStop = log.queries.length;
    await Bun.sleep(60);
    expect(log.queries.length).toBe(afterStop);
  });
});
