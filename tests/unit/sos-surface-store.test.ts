/**
 * الغرض: قياسُ محوّلِ قراءةِ حالِ سطحِ الاستغاثةِ — النداءُ الواحدُ، وتحويلُ
 *   الحمولةِ، وتصنيفُ الرفضِ، و**إعلانُ العطبِ بدلَ ادّعاءِ الغيابِ**
 *   (البند `F2-10` · `SR-14`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-10`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 *
 * ولماذا يُقاسُ بمحرِّكٍ مُصنَّعٍ: هذا المِلفُّ حدُّ النظامِ معَ القاعدةِ، والمقيسُ
 * ههنا **شكلُ النداءِ وتحويلُ الحمولةِ** لا سلوكُ PostgreSQL.
 *
 * وأثقلُ ما يُقاسُ ههنا **أنَّ الحمولةَ المعطوبةَ تُعلَنُ عطباً ولا تُقرأُ «لا
 * سطحَ»**: بطاقةٌ تغيبُ لأنَّ حقلاً تكسَّرَ تُقرأُ في الشاشةِ كأنَّها حكمٌ صحيحٌ
 * بألّا استغاثةَ — وذاكَ أسوأُ من رسالةِ عطلٍ صريحةٍ في لحظةِ خوفٍ.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createSosSurfaceReader } from "../../packages/infrastructure/safety/sos-surface-store.ts";

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const TELEGRAM_ID = "7412589630";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeSql(result: unknown | { readonly throws: true }): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    if (typeof result === "object" && result !== null && "throws" in result) {
      throw new Error("فشلُ اتصالٍ مُصنَّع");
    }
    return [{ result }];
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    role: "rider",
    order_id: ORDER_ID,
    origin: "ACTIVE_ORDER",
    eligible: true,
    reason: null,
    post_ride_window_minutes: 30,
    post_ride_window_source: "SETTING",
    incident: null,
    disclosure: ["SOS_SHARES_ROLE", "SOS_NO_PHONE_CALL"],
    ...overrides,
  };
}

function readerFor(result: unknown): {
  read: () => Promise<unknown>;
  calls: Recorded[];
} {
  const { sql, calls } = fakeSql(result);
  const reader = createSosSurfaceReader(sql);
  return {
    read: () => reader.read({ telegramUserId: TELEGRAM_ID, role: "rider" }),
    calls,
  };
}

describe("محوّلُ سطحِ الاستغاثةِ — النداءُ", () => {
  it("نداءٌ واحدٌ إلى `sos_surface_state` بمُعامِلَينِ مربوطَينِ", async () => {
    const { read, calls } = readerFor(state());
    await read();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("sos_surface_state($1, $2)");
    expect(calls[0]?.values).toEqual([TELEGRAM_ID, "rider"]);
  });

  /**
   * ولمَ يُفحَصُ النصُّ قبلَ الإرسالِ: `bigint` يرفضُ ما ليسَ رقماً بخطأٍ يُقرأُ
   * عطبَ مخزنٍ، فيصيرُ مُعرِّفٌ مشوَّهٌ في جلسةٍ «عطلاً» لا «حساباً مجهولاً».
   */
  it("مُعرِّفٌ غيرُ رقميٍّ لا يصلُ القاعدةَ ويُقرأُ «لا حسابَ»", async () => {
    const { sql, calls } = fakeSql(state());
    const reader = createSosSurfaceReader(sql);
    const result = await reader.read({ telegramUserId: "not-a-number", role: "rider" });
    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("USER_NOT_FOUND");
  });

  it("إخفاقُ الاتّصالِ يُعلَنُ عطبَ مخزنٍ لا غياباً", async () => {
    const { read } = readerFor({ throws: true });
    const result = (await read()) as { ok: boolean; error?: { reason: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.reason).toBe("STORE_ERROR");
  });

  it("صفٌّ بلا حمولةٍ يُعلَنُ عطبَ مخزنٍ", async () => {
    const { read } = readerFor(null);
    const result = (await read()) as { ok: boolean; error?: { reason: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.reason).toBe("STORE_ERROR");
  });
});

describe("محوّلُ سطحِ الاستغاثةِ — الحالُ الجائزُ", () => {
  it("حالٌ سليمٌ يُحوَّلُ إلى شكلِ النطاقِ كاملاً", async () => {
    const { read } = readerFor(state());
    const result = (await read()) as {
      ok: boolean;
      value?: { found: boolean; state: Record<string, unknown> };
    };
    expect(result.ok).toBe(true);
    expect(result.value?.found).toBe(true);
    expect(result.value?.state).toEqual({
      eligible: true,
      orderId: ORDER_ID,
      origin: "ACTIVE_ORDER",
      postRideWindowMinutes: 30,
      postRideWindowSource: "SETTING",
      incident: null,
      disclosure: ["SOS_SHARES_ROLE", "SOS_NO_PHONE_CALL"],
    });
  });

  it("نافذةٌ بمصدرِ احتياطٍ تُنقَلُ باسمِها لا تُطوى", async () => {
    const { read } = readerFor(
      state({ post_ride_window_source: "FALLBACK_DEFAULT", origin: "RECENT_ORDER" }),
    );
    const result = (await read()) as { value?: { state: Record<string, unknown> } };
    expect(result.value?.state.postRideWindowSource).toBe("FALLBACK_DEFAULT");
    expect(result.value?.state.origin).toBe("RECENT_ORDER");
  });

  it("عددُ الدقائقِ نصّاً من `jsonb` يُقرأُ رقماً", async () => {
    const { read } = readerFor(state({ post_ride_window_minutes: "45" }));
    const result = (await read()) as { value?: { state: Record<string, unknown> } };
    expect(result.value?.state.postRideWindowMinutes).toBe(45);
  });

  it("بلاغٌ قائمٌ يُنقَلُ بعُمرِه المقيسِ في القاعدةِ", async () => {
    const { read } = readerFor(
      state({ incident: { id: "inc-1", status: "received", age_seconds: 42 } }),
    );
    const result = (await read()) as { value?: { state: Record<string, unknown> } };
    expect(result.value?.state.incident).toEqual({
      incidentId: "inc-1",
      status: "received",
      ageSeconds: 42,
    });
  });

  it("حالٌ ممنوعٌ بسببٍ مُصنَّفٍ يُقرأُ حكماً لا عطباً", async () => {
    const { read } = readerFor(
      state({ eligible: false, reason: "NO_ACTIVE_ORDER", order_id: null, origin: null }),
    );
    const result = (await read()) as {
      ok: boolean;
      value?: { found: boolean; state: Record<string, unknown> };
    };
    expect(result.ok).toBe(true);
    expect(result.value?.state).toEqual({
      eligible: false,
      reason: "NO_ACTIVE_ORDER",
      incident: null,
      disclosure: ["SOS_SHARES_ROLE", "SOS_NO_PHONE_CALL"],
    });
  });
});

describe("محوّلُ سطحِ الاستغاثةِ — الرفضُ المُصنَّفُ", () => {
  const cases: readonly (readonly [string, string])[] = [
    ["INVALID_REPORTER_ROLE", "INVALID_ROLE"],
    ["ACTOR_NOT_FOUND", "ACCOUNT_NOT_FOUND"],
    ["ACTOR_BLOCKED", "ACCOUNT_BLOCKED"],
  ];

  for (const [code, refusal] of cases) {
    it(`«${code}» يُقرأُ رفضاً «${refusal}» لا عطباً`, async () => {
      const { read } = readerFor({ ok: false, error: code });
      const result = (await read()) as {
        ok: boolean;
        value?: { found: boolean; refusal: string };
      };
      expect(result.ok).toBe(true);
      expect(result.value?.found).toBe(false);
      expect(result.value?.refusal).toBe(refusal);
    });
  }

  /**
   * رمزُ خطأٍ لا يعرفُه المحوّلُ **لا يُطوى** في رفضٍ مطمئنٍّ: رفضٌ مخترَعٌ
   * يُقرأُ سياسةً مُقرَّرةً وهوَ عطبٌ لا يراهُ أحدٌ.
   */
  it("رمزُ خطأٍ مجهولٌ يُعلَنُ عطبَ مخزنٍ ولا يُطوى رفضاً", async () => {
    const { read } = readerFor({ ok: false, error: "SOMETHING_NEW" });
    const result = (await read()) as { ok: boolean; error?: { reason: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.reason).toBe("STORE_ERROR");
  });
});

/**
 * ## أثقلُ كتلةٍ في هذا المِلفِّ
 *
 * كلُّ حالةٍ ههنا صورةٌ لحمولةٍ **ناقصةٍ أو مشوَّهةٍ**، والمطلوبُ في كلٍّ منها
 * جوابٌ واحدٌ: `STORE_ERROR`. ولو قُرِئَ أيٌّ منها «لا سطحَ» لَغابَت البطاقةُ
 * في الشاشةِ بلا سببٍ ظاهرٍ، ولَقرأَ صاحبُها الغيابَ حكماً صحيحاً بألّا
 * استغاثةَ له.
 */
describe("محوّلُ سطحِ الاستغاثةِ — حمولةٌ معطوبةٌ تُعلَنُ ولا تُطوى", () => {
  const broken: readonly (readonly [string, Record<string, unknown>])[] = [
    ["مُعرِّفُ طلبٍ غائبٌ معَ جوازٍ", state({ order_id: null })],
    ["مصدرٌ مجهولٌ", state({ origin: "SOMEWHERE_ELSE" })],
    ["دقائقُ سالبةٌ", state({ post_ride_window_minutes: -1 })],
    ["دقائقُ كسريّةٌ", state({ post_ride_window_minutes: 2.5 })],
    ["مصدرُ نافذةٍ مجهولٌ", state({ post_ride_window_source: "GUESS" })],
    ["سببُ منعٍ مجهولٌ", state({ eligible: false, reason: "BECAUSE" })],
    ["منعٌ بلا سببٍ", state({ eligible: false, reason: null })],
    ["إفصاحٌ فارغٌ", state({ disclosure: [] })],
    ["رمزُ إفصاحٍ خارجَ المجالِ", state({ disclosure: ["SOS_SENDS_HELICOPTER"] })],
    ["إفصاحٌ ليسَ مصفوفةً", state({ disclosure: "SOS_NO_PHONE_CALL" })],
    ["بلاغٌ بلا مُعرِّفٍ", state({ incident: { status: "open", age_seconds: 1 } })],
    ["بلاغٌ بحالٍ مجهولٍ", state({ incident: { id: "i", status: "pending", age_seconds: 1 } })],
    ["بلاغٌ بلا عُمرٍ", state({ incident: { id: "i", status: "open" } })],
    ["بلاغٌ ليسَ كائناً", state({ incident: "open" })],
  ];

  for (const [label, payload] of broken) {
    it(`${label} ⇒ عطبُ مخزنٍ لا «لا سطحَ»`, async () => {
      const { read } = readerFor(payload);
      const result = (await read()) as { ok: boolean; error?: { reason: string } };
      expect(result.ok).toBe(false);
      expect(result.error?.reason).toBe("STORE_ERROR");
    });
  }
});
