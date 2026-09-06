/**
 * الغرض: إثباتُ أنّ `/ready` يُشغّلُ الفحوصَ **بالتوازي** لا بالتسلسل، وأنّ لكلِّ فحصٍ
 *   مهلةً مستقلّة تمنعُ تعليقَ الردِّ، وأنّه يرتدُّ `503` فوراً عند بدءِ التصريف.
 *   وهو نصُّ البندِ `F5-05` / `CAP-008`: «`/ready` متوازٍ بمهلة قصوى».
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (`bun run test`).
 * ملاحظات مستقبلية: التوازيُ يُثبتُ بالزمنِ لا بالتزامنِ — زمنُ الفحصَين معاً أقلُّ
 *   من مجموعِهما، فلا يُفسَّر إلا بالتوازي.
 */

import { describe, expect, it } from "bun:test";
import { createHealthRoutes, type ReadinessProbe } from "../../apps/gateway/src/routes/health.ts";

/** بيئةٌ كاملةُ المفاتيح حتى لا يُفسدَ «نقصُ بيئةٍ» نتيجةَ الفحوصِ. */
function fullEnv(): Record<string, string | undefined> {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "key",
    DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "token",
    DRIVER_BOT_TOKEN: "111:t",
    RIDER_BOT_TOKEN: "222:t",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "999",
  };
}

function buildRoutes(options?: {
  readonly probes?: readonly ReadinessProbe[];
  readonly isDraining?: () => boolean;
  readonly probeTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}) {
  const deps: Parameters<typeof createHealthRoutes>[0] = {
    now: () => new Date(),
    startedAt: new Date(),
    env: fullEnv(),
    readinessChecks: options?.probes ?? [],
    ...(options?.isDraining !== undefined ? { isDraining: options.isDraining } : {}),
    ...(options?.probeTimeoutMs !== undefined ? { probeTimeoutMs: options.probeTimeoutMs } : {}),
    ...(options?.sleep !== undefined ? { sleep: options.sleep } : {}),
  };
  return createHealthRoutes(deps);
}

async function ready(routes: ReturnType<typeof buildRoutes>): Promise<Response> {
  return routes.request(new Request("http://localhost/ready"));
}

describe("/ready — التوازيُ والمهلةُ والتصريف (F5-05 / CAP-008)", () => {
  it("التوازي: فحصانِ بطيئانِ ينتهيانِ معاً في زمنٍ أقلَّ من مجموعِهما", async () => {
    const probeMs = 40;
    const calls: string[] = [];
    const probes: ReadinessProbe[] = [
      {
        name: "slow-a",
        check: async () => {
          calls.push("start-a");
          await Bun.sleep(probeMs);
          calls.push("end-a");
          return true;
        },
      },
      {
        name: "slow-b",
        check: async () => {
          calls.push("start-b");
          await Bun.sleep(probeMs);
          calls.push("end-b");
          return true;
        },
      },
    ];

    const start = Date.now();
    const routes = buildRoutes({ probes, probeTimeoutMs: 1_000 });
    const res = await ready(routes);
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // التوازي: < مجموعِ الفحصَين (80ملّي) بسعةٍ واسعة. التسلسلُ كان سيتجاوزُ 75ملّي.
    expect(elapsed).toBeLessThan(probeMs * 2 - 10);
    // وكلاهما بدأ قبلَ أن ينتهيَ الآخرُ — برهانُ التداخل.
    expect(calls.indexOf("start-b")).toBeLessThan(calls.indexOf("end-a"));
  });

  it("المهلة: فحصٌ لا يُحلُّ يُعدُّ فاشلاً ضمنَ المهلةِ ولا يُعلِّقُ الردَّ", async () => {
    const probes: ReadinessProbe[] = [
      {
        name: "fast-ok",
        check: async () => true,
      },
      {
        name: "hanging",
        check: async () => {
          await Bun.sleep(500);
          return true;
        },
      },
    ];

    const start = Date.now();
    const routes = buildRoutes({ probes, probeTimeoutMs: 30 });
    const res = await ready(routes);
    const elapsed = Date.now() - start;
    const body = (await res.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
      checkDetails: Record<string, string>;
    };

    // الفحصُ المعلَّقُ فشلَ بالمهلة، فالجاهزيةُ مرفوضةٌ 503.
    expect(res.status).toBe(503);
    expect(body.failedChecks).toContain("hanging");
    expect(body.checkDetails.hanging).toContain("انقضت المهلة");
    // والردُّ عادَ ضمنَ المهلةِ لا بعدَ 5 ثوان.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("التصريف: عند isDraining يرتدُّ 503 فوراً بلا تشغيلِ أيِّ فحص", async () => {
    let probeCalled = false;
    const probes: ReadinessProbe[] = [
      {
        name: "never",
        check: async () => {
          probeCalled = true;
          return true;
        },
      },
    ];
    const routes = buildRoutes({ probes, isDraining: () => true });

    const start = Date.now();
    const res = await ready(routes);
    const elapsed = Date.now() - start;
    const body = (await res.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
      checkDetails: Record<string, string>;
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("draining");
    expect(probeCalled).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it("التصنيفُ سليمٌ: فحصٌ ناجحٌ وفحصٌ فاشلٌ حرجٌ يُسقطُ الجاهزية", async () => {
    const probes: ReadinessProbe[] = [
      { name: "ok", check: async () => true },
      { name: "bad", check: async () => ({ ok: false, detail: "اتصالٌ مرفوض" }) },
    ];
    const routes = buildRoutes({ probes, probeTimeoutMs: 500 });
    const res = await ready(routes);
    const body = (await res.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
      checkDetails: Record<string, string>;
    };

    expect(res.status).toBe(503);
    expect(body.status).toBe("not_ready");
    expect(body.failedChecks).toEqual(["bad"]);
    expect(body.checkDetails.bad).toBe("اتصالٌ مرفوض");
  });

  it("التبعيّةُ غيرُ الحرجة: فشلُها يُبقي الجاهزيةَ «متدهورة» لا «مرفوضة»", async () => {
    const probes: ReadinessProbe[] = [
      { name: "ok", check: async () => true },
      { name: "optional", critical: false, check: async () => false },
    ];
    const routes = buildRoutes({ probes, probeTimeoutMs: 500 });
    const res = await ready(routes);
    const body = (await res.json()) as {
      status: string;
      failedChecks: string[];
      degradedChecks: string[];
      checkDetails: Record<string, string>;
    };

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.degradedChecks).toEqual(["optional"]);
  });
});
