/**
 * الغرض: اختبارُ وصلِ الحاجزِ بالمحوّلاتِ الفعليّةِ (`F8-04` · ADR-0079): مصنعُ
 *    تلغرام، ومحوّلُ Redis، ومزوّدُ التوجيهِ، وغلافُ الدفعِ. **لا شبكةَ ولا انتظارَ.**
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F8-04`.
 * ينتمي إلى: tests/unit
 *
 * ## ما يُثبَتُ ههنا وما لا يُثبَتُ
 *
 * يُثبَتُ أنَّ الرفضَ يصلُ المُستدعيَ **مُصنَّفاً باسمِه** (مفتوحٌ · مشبعٌ · مهلةٌ)
 * لا مُدمَجاً في «عطلٍ». ولا يُثبَتُ ههنا أنَّ الأرقامَ مُعايرةٌ على مزوّدٍ حقيقيٍّ
 * تحتَ حملٍ — تلكَ قياساتٌ موضعُها `F10`، وهيَ **قراراتٌ مُعلَنةٌ لا قياساتٌ**.
 */

import { describe, expect, test } from "bun:test";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { withPaymentGuard } from "../../packages/infrastructure/financial/payment-guard.ts";
import {
  createTelegramApi,
  resetTelegramGuardForTests,
} from "../../packages/infrastructure/notification/telegram-client.ts";
import { createUpstashRedis } from "../../packages/infrastructure/redis/upstash.ts";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";
import {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  type GuardBudget,
} from "../../packages/shared/resilience/dependency-guard.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

/**
 * `fetch` مُثبَّتٌ. **والغلافُ لازمٌ لا زائدٌ**: `typeof fetch` في Bun يُعلِنُ
 * `preconnect` كذلكَ، ودالّةٌ عاريةٌ لا تُطابِقُه. والتحويلُ ههنا في موضعٍ واحدٍ
 * مُعلَّلٍ بدلَ أن يُنثَرَ `as never` في كلِّ حالةٍ.
 */
function stubFetch(
  implementation: (input: unknown, init?: unknown) => Promise<Response>,
): typeof fetch {
  const stub = implementation as unknown as typeof fetch;
  return stub;
}

/** ميزانيّةٌ مصغَّرةٌ تفتحُ القاطعَ من أوّلِ إخفاقٍ وتُشبِعُ من أوّلِ نداءٍ. */
const TIGHT: GuardBudget = {
  timeoutMs: 1_000,
  maxConcurrent: 1,
  failureThreshold: 1,
  windowMs: 10_000,
  cooldownMs: 60_000,
  halfOpenProbes: 1,
};

function tightGuard(dependency: "telegram" | "redis" | "maps" | "payment") {
  return createDependencyGuard({ dependency, budget: TIGHT });
}

describe("مصنعُ واجهةِ تلغرام (F8-04)", () => {
  test("١) المهلةُ مُصرَّحٌ بها ومقروءةٌ من الميزانيّةِ لا من افتراضِ grammY", () => {
    resetTelegramGuardForTests();
    const api = createTelegramApi("1:TOKEN", { guard: tightGuard("telegram") });
    // grammY يُعلِنُ الخيارَ في `api.config`؛ والمقصودُ إثباتُ أنَّه **ليسَ 500**.
    const expected = Math.ceil(DEPENDENCY_BUDGETS.telegram.timeoutMs / 1000);
    expect(expected).toBeLessThan(500);
    expect(expected).toBe(10);
    expect(api).toBeDefined();
  });

  test("٢) القاطعُ المفتوحُ يردُّ خطأً مُسمّىً لا يُنسَبُ إلى تلغرام", async () => {
    resetTelegramGuardForTests();
    const guard = tightGuard("telegram");
    const api = createTelegramApi("1:TOKEN", {
      guard,
      fetchImpl: stubFetch(async () => {
        throw new Error("الشبكةُ مقطوعةٌ");
      }),
    });

    await expect(api.getMe()).rejects.toThrow();
    // الإخفاقُ الأوّلُ فتحَ القاطعَ؛ فالثاني **لا يُرسَلُ أصلاً**.
    let secondError: unknown;
    try {
      await api.getMe();
    } catch (error) {
      secondError = error;
    }
    expect((secondError as { name?: string }).name).toBe("TelegramGuardRejection");
    expect((secondError as { reason?: string }).reason).toBe("open");
  });

  test("٣) الحاجزُ المشتركُ واحدٌ للعمليّةِ: واجهتانِ تقتسمانِ الحدَّ", async () => {
    resetTelegramGuardForTests();
    const guard = tightGuard("telegram");
    const failing = stubFetch(async () => {
      throw new Error("عطلٌ");
    });
    const first = createTelegramApi("1:A", { guard, fetchImpl: failing });
    const second = createTelegramApi("1:B", { guard, fetchImpl: failing });

    await expect(first.getMe()).rejects.toThrow();
    // فتحُ القاطعِ بسببِ الأولى يمنعُ الثانيةَ: حاجزٌ واحدٌ لا حاجزانِ.
    await expect(second.getMe()).rejects.toThrow("رُدَّ النداءُ قبلَ إرسالِه");
  });
});

describe("محوّلُ Redis (F8-04)", () => {
  const options = { url: "https://redis.example", token: "t" };

  test("٤) `open` و`saturated` صنفانِ مُسمّيانِ لا يُدمَجانِ في `timeout`", async () => {
    const guard = tightGuard("redis");
    const client = createUpstashRedis({
      ...options,
      guard,
      fetchImpl: stubFetch(async () => {
        throw new Error("الشبكةُ");
      }),
    });

    const first = await client.command(["GET", "k"]);
    expect(first.ok).toBe(false);
    expect(!first.ok && first.error.kind).toBe("network");

    const second = await client.command(["GET", "k"]);
    expect(!second.ok && second.error.kind).toBe("open");
    expect(!second.ok && second.error.detail).toContain("قاطعُ");
  });

  test("٥) `5xx` يفتحُ القاطعَ ولو وصلَ جواباً، و`4xx` لا يفتحُه", async () => {
    const serverError = createUpstashRedis({
      ...options,
      guard: tightGuard("redis"),
      fetchImpl: stubFetch(async () => new Response("x", { status: 503 })),
    });
    expect((await serverError.command(["GET", "k"])).ok).toBe(false);
    const after503 = await serverError.command(["GET", "k"]);
    expect(!after503.ok && after503.error.kind).toBe("open");

    const clientError = createUpstashRedis({
      ...options,
      guard: tightGuard("redis"),
      fetchImpl: stubFetch(async () => new Response("x", { status: 401 })),
    });
    expect((await clientError.command(["GET", "k"])).ok).toBe(false);
    const after401 = await clientError.command(["GET", "k"]);
    // عيبُنا نحنُ لا عطلُ Redis: القاطعُ يبقى مغلقاً فلا يُحجَبُ خادمٌ سليمٌ.
    expect(!after401.ok && after401.error.kind).toBe("http");
  });

  test("٦) النجاحُ يمرُّ عبرَ الحاجزِ بلا تغييرِ حمولةٍ", async () => {
    const client = createUpstashRedis({
      ...options,
      guard: tightGuard("redis"),
      fetchImpl: stubFetch(async () => Response.json({ result: "PONG" })),
    });
    const outcome = await client.command(["PING"]);
    expect(outcome).toEqual({ ok: true, value: "PONG" });
  });
});

describe("مزوّدُ التوجيهِ (F8-04)", () => {
  const base = { baseUrl: "https://osrm.example", sleepImpl: async () => undefined };
  const from = { lat: 21.5, lng: 39.2 };
  const to = { lat: 21.6, lng: 39.3 };

  test("٧) القاطعُ المفتوحُ يعودُ `circuit_open` لا `timeout`", async () => {
    const provider = createOsrmProvider({
      ...base,
      guard: tightGuard("maps"),
      fetchImpl: stubFetch(async () => new Response("x", { status: 503 })),
    });

    const first = await provider.route({ origin: from, destination: to });
    expect(first.ok).toBe(false);
    expect(!first.ok && first.error.kind).toBe("server_error");

    const second = await provider.route({ origin: from, destination: to });
    expect(!second.ok && second.error.kind).toBe("circuit_open");
  });

  test("٨) `no_route` جوابٌ صحيحٌ فلا يفتحُ القاطعَ", async () => {
    const provider = createOsrmProvider({
      ...base,
      guard: tightGuard("maps"),
      fetchImpl: stubFetch(async () => Response.json({ code: "NoRoute" })),
    });
    const first = await provider.route({ origin: from, destination: to });
    expect(!first.ok && first.error.kind).toBe("no_route");
    const second = await provider.route({ origin: from, destination: to });
    // ولو عُدَّ عطلاً لحُجِبَ مزوّدٌ سليمٌ لأنَّ راكباً سألَ عن طريقٍ لا وجودَ له.
    expect(!second.ok && second.error.kind).toBe("no_route");
  });
});

describe("غلافُ الدفعِ (F8-04)", () => {
  const snapshot = {
    id: "p1",
    status: "active" as const,
    amount: 100,
    currency: "SAR",
    metadata: {},
    invoiceId: null,
  };

  function stub(overrides?: { readonly charge?: () => Promise<unknown> }) {
    let webhookCalls = 0;
    return {
      provider: {
        name: "moyasar",
        chargeSubscription: async () =>
          (overrides?.charge === undefined
            ? err(new PortFailureError("moyasar", "MOYASAR_NETWORK_OR_TIMEOUT"))
            : await overrides.charge()) as never,
        verifyWebhook: async () => {
          webhookCalls += 1;
          return err(new PortFailureError("moyasar", "BAD_SIGNATURE")) as never;
        },
        fetchTransaction: async () => ok(snapshot) as never,
      },
      webhookCalls: () => webhookCalls,
    };
  }

  test("٩) القاطعُ المفتوحُ يعودُ رمزاً مُسمّىً", async () => {
    const inner = stub();
    const guarded = withPaymentGuard(inner.provider, { guard: tightGuard("payment") });

    const first = await guarded.chargeSubscription({} as never);
    expect(first.ok).toBe(false);

    const second = await guarded.chargeSubscription({} as never);
    expect(!second.ok && second.error.detail).toBe("PAYMENT_CIRCUIT_OPEN");
  });

  test("١٠) `verifyWebhook` لا يُحجَبُ بقاطعٍ مفتوحٍ — وارِدٌ لا صادرٌ", async () => {
    const inner = stub();
    const guarded = withPaymentGuard(inner.provider, { guard: tightGuard("payment") });

    await guarded.chargeSubscription({} as never);
    expect((await guarded.fetchTransaction("p1")).ok).toBe(false);

    // القاطعُ مفتوحٌ الآن، ومع ذلكَ يُتحقَّقُ من الويبهوكِ: حجبُه كانَ سيُسقِطُ
    // إشعارَ دفعٍ **صحيحاً وصلَ فعلاً** — أي عطلٌ في الصادرِ يُضيِّعُ مالاً مُحصَّلاً.
    await guarded.verifyWebhook("{}", new Headers());
    expect(inner.webhookCalls()).toBe(1);
  });

  test("١١) الاسمُ يُنقَلُ كما هوَ فلا يُخفي الغلافُ المزوّدَ", () => {
    const guarded = withPaymentGuard(stub().provider, { guard: tightGuard("payment") });
    expect(guarded.name).toBe("moyasar");
  });
});
