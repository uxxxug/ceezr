/**
 * الغرض: إثبات أنّ مهمّة `redispatch-searching` مُسجَّلةٌ بتواترٍ **فعّال** لا بمجرّد
 *   اسمٍ في القائمة.
 *
 *   وهذا الاختبار كُتب لأنّ فحصَ التحوير كشف ثغرةً حقيقيّة: تغييرُ `everySeconds`
 *   في العامل إلى 999999 — أي تعطيلُ المهمّة تعطيلاً تامّاً في الإنتاج — لم يُسقط
 *   اختباراً واحداً في المشروع كلّه. فالمهمّةُ تبقى مُسجَّلةً باسمها، وعددُ المهامّ
 *   يبقى صحيحاً، والسجلُّ يذكرها — ولا تعمل أبداً. وهذا أخطرُ من حذفها: الحذفُ
 *   يُلاحَظ، والتعطيلُ الصامتُ يُطمئن.
 *
 *   ولذلك يُثبَّت الحدُّ الأعلى بمعناه لا برقمه: التواتر يجب أن يكون أقصرَ من مهلة
 *   العرض الافتراضيّة، لأنّ الغرضَ من المهمّة أن تُدرك العرضَ المنتهي — فتواترٌ
 *   أطولُ من المهلة يعني طلباً ينتظر مهلةً كاملةً زائدةً قبل أن يُنظَر فيه.
 *
 * الحالة: اختبار وحدة فعلي — لا يحتاج قاعدة ولا شبكة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديل على JOB_INTERVALS أو على تسجيل مهامّ العامل
 * ملاحظات مستقبلية: يوم تُقرأ التواترات من الضبط بدل الثابت يبقى التوكيد صالحاً —
 *   فهو يقرأ ما سُجِّل فعلاً لا ما كُتب في الثابت.
 */

import { describe, expect, it } from "bun:test";
import {
  buildWorkerContainer,
  JOB_INTERVALS,
  REDISPATCH_LIMIT,
} from "../../apps/workers/src/container.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import type { OutboundSender } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { NO_TRACKING_OVERRIDES } from "../../packages/shared/config/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY_ID = "11111111-2222-3333-4444-555555555555";

/** مهلةُ العرض الافتراضيّة في `platform_settings` — المرجعُ الذي يُقاس عليه التواتر. */
const DEFAULT_OFFER_TIMEOUT_SECONDS = 45;

const config: AppConfig = {
  env: "test",
  port: 3993,
  supabaseUrl: "https://unit.test.supabase.co",
  databaseUrl: "postgres://unit:test@localhost:5432/unit",
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
  runWorkerInGateway: false,
  mapProvider: "none",
  mapStyleUrl: null,
  mapTilesPublicKey: null,
  maplibreSri: null,
  // المرحلة ١٥ — لا مزوّد توجيه في الاختبارات الافتراضية: زمن الوصول يُمتنع صريحاً.
  routingProvider: "none",
  osrmBaseUrl: null,
  tracking: NO_TRACKING_OVERRIDES,
  trackingTokenBaseUrl: null,
};

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

describe("تسجيل مهمّة إعادة العرض — المرحلة ١٤", () => {
  it("مُسجَّلةٌ لكلّ مدينةٍ مفعَّلة بتواترٍ فعّالٍ أقصرَ من مهلة العرض", async () => {
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
      const job = jobs.find((entry) => entry.name === `redispatch-searching:${CITY_ID}`);
      expect(job).toBeDefined();
      if (job === undefined) return;

      // التواترُ المُسجَّل هو الثابتُ نفسه لا رقمٌ مكتوبٌ في موضع النداء: رقمٌ حرفيٌّ
      // هناك يُغيَّر بلا أن يُلاحظه من يقرأ الثابت.
      expect(job.everySeconds).toBe(JOB_INTERVALS.redispatchSearching);
      expect(job.everySeconds).toBeGreaterThan(0);
      // أقصرُ من مهلة العرض: أطولُ من ذلك يعني طلباً ينتظر مهلةً كاملةً زائدة.
      expect(job.everySeconds).toBeLessThan(DEFAULT_OFFER_TIMEOUT_SECONDS);
      // تعمل عند الإقلاع: نشرٌ جديدٌ بعد تعطّلٍ يجب أن يُدرك ما تراكم فوراً.
      expect(job.runOnStart).toBe(true);
    } finally {
      await container.close();
    }
  });

  it("حدُّ الفحص موجبٌ ومحدود — لا «كلّ الطلبات» ولا صفر", () => {
    expect(REDISPATCH_LIMIT).toBeGreaterThan(0);
    // حدٌّ ضخمٌ يُساوي انعدامَ الحدّ: شوطٌ يفتح مئاتَ دوراتِ المطابقة يستنزف
    // تجمّعَ الاتصالات فيُسقط بقيّةَ المهامّ — فيصير إصلاحُ التوزيع سببَ تعطيله.
    expect(REDISPATCH_LIMIT).toBeLessThanOrEqual(200);
  });
});
