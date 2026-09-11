/**
 * الغرض: قياسُ شوطِ تصريفِ صادرِ MOVE: السقفُ، والتوقُّفُ عندَ الفراغِ، وتصنيفُ
 *   كلِّ حكمٍ، والتوقُّفُ عندَ عطلِ بابٍ بلا كتمانٍ.
 * الحالة: اختبار وحدة — 2026-09-12.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test tests/unit`.
 * ملاحظات مستقبلية: لا قاعدةَ ههنا — الوصلُ بالقاعدةِ مقيسٌ في
 *   `tests/integration/wasla-core-transport.test.ts`.
 *
 * ## لِمَ يُقاسُ العدُّ لا مجرَّدُ عدمِ الرمي
 *
 * لأنَّ سطرَ سجلِّ العاملِ هوَ المرصدُ الوحيدُ على هذا المسارِ في الإنتاجِ: شوطٌ
 * يقولُ `delivered=5` وهوَ لم يُسلِّمْ إلّا واحداً يُعمي الرصدَ أشدَّ من غيابِه.
 */

import { describe, expect, it } from "bun:test";
import type {
  DeliveryReport,
  FulfillmentLifecycle,
  LifecycleFailure,
  MoveEventShipper,
} from "../../packages/application/wasla/fulfillment-lifecycle.ts";
import { shipDueMoveEvents } from "../../packages/application/wasla/ship-due-move-events.ts";
import { err, isErr, isOk, ok, type Result } from "../../packages/shared/result/index.ts";

const shipper = {
  ship: async () => ok({ firstDelivery: true }),
} as unknown as MoveEventShipper;

/** دورةُ حياةٍ مزدوجةٌ لا تُنفِّذُ إلّا `deliverOnce` — وحدَه المقيسُ ههنا. */
function lifecycleReturning(results: readonly Result<DeliveryReport | null, LifecycleFailure>[]): {
  readonly lifecycle: FulfillmentLifecycle;
  readonly calls: () => number;
} {
  let index = 0;
  const lifecycle = {
    deliverOnce: async () => {
      const result = results[index] ?? ok(null);
      index += 1;
      return result;
    },
  } as unknown as FulfillmentLifecycle;
  return { lifecycle, calls: () => index };
}

function report(verdict: DeliveryReport["verdict"]): Result<DeliveryReport, LifecycleFailure> {
  return ok({ eventId: `e-${verdict}`, eventType: "move.job.accepted", attempts: 1, verdict });
}

describe("شوطُ تصريفِ صادرِ MOVE", () => {
  it("صندوقٌ فارغٌ: نداءٌ واحدٌ ولا شيءَ محجوزٌ ولا اقتطاعَ", async () => {
    const { lifecycle, calls } = lifecycleReturning([ok(null)]);
    const result = await shipDueMoveEvents({ lifecycle, shipper, maxEvents: 10 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      claimed: 0,
      delivered: 0,
      retried: 0,
      dead: 0,
      contractRejected: 0,
      truncated: false,
    });
    expect(calls()).toBe(1);
  });

  it("كلُّ حكمٍ يُعَدُّ في خانتِه لا في خانةِ غيرِه", async () => {
    const { lifecycle } = lifecycleReturning([
      report("delivered"),
      report("retry"),
      report("dead"),
      report("contract_rejected"),
      report("delivered"),
      ok(null),
    ]);
    const result = await shipDueMoveEvents({ lifecycle, shipper, maxEvents: 50 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toEqual({
      claimed: 5,
      delivered: 2,
      retried: 1,
      dead: 1,
      contractRejected: 1,
      truncated: false,
    });
  });

  it("السقفُ يُحترَمُ: ثلاثةٌ لا أكثرُ، والاقتطاعُ مُعلَنٌ", async () => {
    const { lifecycle, calls } = lifecycleReturning([
      report("delivered"),
      report("delivered"),
      report("delivered"),
      report("delivered"),
    ]);
    const result = await shipDueMoveEvents({ lifecycle, shipper, maxEvents: 3 });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.claimed).toBe(3);
    expect(result.value.truncated).toBe(true);
    expect(calls()).toBe(3);
  });

  it("سقفٌ باطلٌ (صفرٌ أو سالبٌ) يُقرأُ صفّاً واحداً لا حلقةً ولا رمياً", async () => {
    const { lifecycle, calls } = lifecycleReturning([report("delivered"), report("delivered")]);
    const result = await shipDueMoveEvents({ lifecycle, shipper, maxEvents: 0 });

    expect(isOk(result) && result.value.claimed).toBe(1);
    expect(calls()).toBe(1);
  });

  it("عطلُ بابٍ يُوقِفُ الشوطَ ويُرَدُّ كما هوَ: لا كتمانَ ولا استمرارَ", async () => {
    const failure: LifecycleFailure = {
      kind: "port",
      error: { code: "port_failure", detail: "القاعدةُ عاطلةٌ" } as never,
    };
    const { lifecycle, calls } = lifecycleReturning([
      report("delivered"),
      err(failure),
      report("delivered"),
    ]);
    const result = await shipDueMoveEvents({ lifecycle, shipper, maxEvents: 10 });

    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error.kind).toBe("port");
    expect(calls()).toBe(2);
  });
});
