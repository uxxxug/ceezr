/**
 * الغرض: إثبات أنّ موتَ العامل يظهر في `/ready` نفسه — لا في الحكم المجرَّد وحده
 *   (§4.3): بلا نبضةٍ يردّ المسارُ 503 و`failedChecks` تسمّي `critical_jobs` وتفصيلُه
 *   يسمّي المهمّة، وببياتٍ يردّ 200 بحالة `degraded` فلا يُقطع توجيهُ الحركة.
 * الحالة: اختبار وحدة حقيقي بلا قاعدة ولا شبكة — أُضيف في 2026-08-14.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (bun test)، وكلّ تعديل على تصنيف الفحصَين.
 *
 * لماذا يمرّ الاختبار بمسار `/ready` الحقيقي لا بالدالّة الخالصة: التصنيف
 * (`critical` أو لا) هو الفرق بين «إنذارٌ مرئي» و«انقطاعٌ كامل تُسبّبه المراقبة»،
 * وهو لا يظهر إلّا في رمز الاستجابة الذي يقرؤه Render.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createJobHealthProbes } from "../../apps/gateway/src/job-health.ts";
import { createHealthRoutes } from "../../apps/gateway/src/routes/health.ts";
import { jobHealthExpectations } from "../../apps/workers/src/container.ts";
import type {
  JobHeartbeatReaderPort,
  JobHeartbeatRow,
} from "../../packages/application/scheduling/job-heartbeat.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";

const CITY = "11111111-2222-3333-4444-555555555555" as CityId;
const NOW = new Date("2026-08-14T10:00:00.000Z");
const BOOTED_LONG_AGO = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

/**
 * بيئةٌ كاملةُ المفاتيح: `/ready` يفشل أيضاً على المفاتيح الناقصة، ولو نقص مفتاحٌ
 * لصار الاختبارُ يُثبت شيئاً آخر غير الذي يزعم إثباته.
 */
const FULL_ENV: Record<string, string> = {
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

function reader(rows: readonly JobHeartbeatRow[]): JobHeartbeatReaderPort {
  return { list: async () => rows };
}

function beat(jobName: string, lastRunAt: Date): JobHeartbeatRow {
  return { jobName, cityId: CITY, lastRunAt, lastStatus: "ok", detail: null };
}

/** كلُّ المهامّ الحرجة نابضةً الآن — أساسٌ تُعدَّل منه كلّ حالة. */
function allHealthy(at: Date): JobHeartbeatRow[] {
  return jobHealthExpectations([CITY]).required.map((entry) => beat(entry.jobName, at));
}

function appWith(rows: readonly JobHeartbeatRow[]): Hono {
  const app = new Hono();
  app.route(
    "/",
    createHealthRoutes({
      now: () => NOW,
      startedAt: BOOTED_LONG_AGO,
      env: FULL_ENV,
      readinessChecks: createJobHealthProbes({
        heartbeats: reader(rows),
        expectations: async () => jobHealthExpectations([CITY]),
        now: () => NOW,
        startedAt: BOOTED_LONG_AGO,
        // بلا تخزينٍ في الاختبار: لقطةٌ محفوظة بين الحالات كانت ستجعل النتيجة
        // تعتمد على ترتيب الاختبارات.
        cacheMs: 0,
      }),
    }),
  );
  return app;
}

describe("فحوص نبضة المهامّ في /ready", () => {
  test("عاملٌ لم يعمل قطّ (RUN_WORKER_IN_GATEWAY=false بلا خدمة عامل) ⇒ 503 يسمّي المهامّ", async () => {
    const response = await appWith([]).request("/ready");
    const body = (await response.json()) as {
      status: string;
      failedChecks: string[];
      checkDetails?: Record<string, string>;
    };

    expect(response.status).toBe(503);
    expect(body.status).not.toBe("ready");
    expect(body.failedChecks).toContain("critical_jobs");
    expect(body.checkDetails?.critical_jobs ?? "").toContain(`expire-offers:${CITY}`);
  });

  test("كلُّ المهامّ الحرجة نابضة ⇒ ready بلا إخفاق ولا تدهوّر", async () => {
    const response = await appWith(allHealthy(NOW)).request("/ready");
    const body = (await response.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.failedChecks).toEqual([]);
    expect(body.degradedChecks).toEqual([]);
  });

  test("مهمّةٌ واحدة بائتة ⇒ 200 مع degraded: لا يُقطع توجيه الحركة لأجل مهمّة متعثّرة", async () => {
    const rows = allHealthy(NOW).map((row) =>
      row.jobName === `expire-offers:${CITY}`
        ? beat(row.jobName, new Date(NOW.getTime() - 10 * 60 * 1000))
        : row,
    );
    const response = await appWith(rows).request("/ready");
    const body = (await response.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
      checkDetails?: Record<string, string>;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.failedChecks).toEqual([]);
    expect(body.degradedChecks).toContain("critical_jobs_freshness");
    expect(body.checkDetails?.critical_jobs_freshness ?? "").toContain(`expire-offers:${CITY}`);
  });

  test("النسخُ الاحتياطي غير المفعَّل لا يُسقط الجهوزية — مهمّةٌ مشروطة لا واجبة", async () => {
    const response = await appWith(allHealthy(NOW)).request("/ready");
    const body = (await response.json()) as { status: string; failedChecks: string[] };

    expect(body.failedChecks).not.toContain("critical_jobs");
    expect(body.status).toBe("ready");
    expect(jobHealthExpectations([CITY]).optional.map((entry) => entry.jobName)).toContain(
      "backup-database",
    );
  });

  test("توقّعاتُ المهامّ تتبع المدن المفعَّلة: بلا مدينةٍ تبقى العامّةُ وحدها منتظَرة", () => {
    const withCity = jobHealthExpectations([CITY]).required.map((entry) => entry.jobName);
    const withoutCity = jobHealthExpectations([]).required.map((entry) => entry.jobName);

    expect(withCity).toContain(`expire-offers:${CITY}`);
    expect(withCity).toContain("expire-subscriptions");
    expect(withoutCity).toEqual(["expire-subscriptions"]);
  });
});
