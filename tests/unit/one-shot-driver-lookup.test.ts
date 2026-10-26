/**
 * الغرض: LOAD-01 · C2 — إثبات عقدِ الاستهلاكِ الأحاديِّ للقراءةِ المدمجةِ: أولُ بحثٍ
 *   عن المرسلِ يُجيبُ بالقيمةِ المُحمَّلةِ سلفاً، وكلُّ بحثٍ بعدهُ (أياً كان سببُه) يمرُّ
 *   إلى المنفذِ الأصليِّ، والبحثُ عن مُرسِلٍ آخرَ لا يستهلِكُ القيمةَ أصلًا.
 * الحالة: اختبار فعلي — بند LOAD-01 (C2).
 * ينتمي إلى: tests/unit
 * ملاحظات مستقبلية: إذا اتّسعَ الاستهلاكُ لأكثرَ من بحثٍ فذلك قرارٌ يُتَّخَذُ بقياسٍ لا بتوسيعِ هذا العقد.
 */
import { describe, expect, it } from "bun:test";
import { oneShotDriverLookup } from "../../packages/application/bots/one-shot-driver-lookup.ts";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import type { PortFailureError } from "../../packages/application/ports/index.ts";
import { ok, type Result } from "../../packages/shared/result/index.ts";
import { verifiedDriver } from "../support/bot-doubles.ts";

type Lookup = (telegramUserId: string) => Promise<Result<DriverProfile | null, PortFailureError>>;

/** منفذٌ يعدُّ نداءاته ويُعيدُ قيمةً قابلةً للتمييزِ عن القيمةِ المُحمَّلةِ سلفاً. */
function countingUnderlying(): { lookup: Lookup; calls: () => number } {
  let calls = 0;
  return {
    lookup: async () => {
      calls += 1;
      return ok(verifiedDriver({ fullName: "من المنفذ الأصلي" }));
    },
    calls: () => calls,
  };
}

const SENDER = "900";

describe("استهلاك أحادي لقراءة السائق المدمجة (LOAD-01 · C2)", () => {
  it("أول بحث عن المرسل يُجيب بالقيمة المحمّلة ولا يلمس المنفذ الأصلي", async () => {
    const underlying = countingUnderlying();
    const wrapped = oneShotDriverLookup(underlying.lookup, SENDER, null);

    const first = await wrapped(SENDER);

    expect(first.ok && first.value).toBe(null);
    expect(underlying.calls()).toBe(0);
  });

  it("البحث الثاني عن المرسل نفسه يمرّ إلى المنفذ الأصلي — لا تجميد", async () => {
    const underlying = countingUnderlying();
    const wrapped = oneShotDriverLookup(underlying.lookup, SENDER, null);

    await wrapped(SENDER);
    const second = await wrapped(SENDER);

    expect(second.ok && second.value?.fullName).toBe("من المنفذ الأصلي");
    expect(underlying.calls()).toBe(1);
  });

  it("البحث عن مرسل آخر لا يستهلك القيمة المحمّلة أصلًا", async () => {
    const underlying = countingUnderlying();
    const wrapped = oneShotDriverLookup(underlying.lookup, SENDER, null);

    const other = await wrapped("901");

    expect(other.ok && other.value?.fullName).toBe("من المنفذ الأصلي");
    // القيمةُ ما زالتْ بكراً للمُرسِلِ المقصودِ بها.
    const mine = await wrapped(SENDER);
    expect(mine.ok && mine.value).toBe(null);
    expect(underlying.calls()).toBe(1);
  });

  it("قيمة محمّلة غير فارغة تُعاد كما هي — لا مصانعة ولا إعادة قراءة", async () => {
    const underlying = countingUnderlying();
    const preloaded = verifiedDriver({ fullName: "المحمّلة سلفاً" });
    const wrapped = oneShotDriverLookup(underlying.lookup, SENDER, preloaded);

    const first = await wrapped(SENDER);

    expect(first.ok && first.value?.fullName).toBe("المحمّلة سلفاً");
    expect(underlying.calls()).toBe(0);
  });
});
