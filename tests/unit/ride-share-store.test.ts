/**
 * الغرض: قياسُ محوّلِ قراءةِ حالِ المشاركةِ — النداءُ الواحدُ، وصرامةُ قراءةِ
 *   الحمولةِ، ورفضُ التسريبِ في المحوّلِ نفسِه (البند `F2-09` · `SR-13`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إن قرأَ الروابطَ الساريةَ في شاشةِ الطوارئِ.
 *
 * ولماذا بمحرِّكٍ مُصنَّعٍ: المقيسُ ههنا **شكلُ النداءِ وحكمُ القارئِ على حمولةٍ
 * مشوَّهةٍ** لا سلوكُ PostgreSQL. وأمّا صدقُ الحمولةِ فيُقاسُ على قاعدةٍ حقيقيّةٍ
 * في `tests/integration/ride-share.test.ts`.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ الصلاحيّاتُ**: `has_function_privilege` حكمُ قاعدةٍ لا نصٍّ.
 * ــ **لا يُقاسُ انتهاءُ الرابطِ**: الثانيةُ الباقيةُ حسابُ ساعةِ القاعدةِ.
 */

import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createRideShareReader } from "../../packages/infrastructure/transport/ride-share-store.ts";

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const TELEGRAM_ID = "5550001";

interface Recorded {
  readonly text: string;
  readonly values: readonly unknown[];
}

function fakeSql(
  result: unknown,
  options: { readonly throws?: boolean } = {},
): {
  sql: Sql;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const unsafe = async (text: string, values: readonly unknown[] = []) => {
    calls.push({ text, values });
    if (options.throws === true) throw new Error("فشلُ اتصالٍ مُصنَّع");
    return [{ result }];
  };
  return { sql: { unsafe } as unknown as Sql, calls };
}

function located(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    order_id: ORDER_ID,
    can_share: true,
    max_lifetime_minutes: 60,
    grace_minutes: 10,
    links: [{ id: "a1", created_at: "2027-03-01T09:00:00.000Z", seconds_remaining: 1200 }],
    preview: {
      active: true,
      position: {
        verdict: "LOCATED",
        lat: 21.49,
        lng: 39.19,
        age_seconds: 6,
        max_age_seconds: 90,
        max_age_source: "SETTING",
      },
    },
    ...overrides,
  };
}

function hidden(verdict: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return located({
    preview: {
      active: true,
      position: {
        verdict,
        age_seconds: verdict === "TOO_OLD" ? 400 : null,
        max_age_seconds: 90,
        max_age_source: "SETTING",
        ...over,
      },
    },
  });
}

describe("نداءُ القاعدةِ", () => {
  it("نداءٌ واحدٌ بدالّةِ الحالِ ومُعامَلانِ — لا استعلامانِ يفترقانِ", async () => {
    const { sql, calls } = fakeSql(located());
    await createRideShareReader(sql).read({ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("select rider_ride_share_state($1, $2) as result");
    expect(calls[0]?.values).toEqual([TELEGRAM_ID, ORDER_ID]);
  });

  // المعرِّفُ يُمرَّرُ **نصّاً** فلا يفقدُ معرِّفٌ فوقَ 2^53 دقّتَه صامتاً.
  it("معرِّفُ تلغرامَ يُمرَّرُ نصّاً لا عدداً", async () => {
    const { sql, calls } = fakeSql(located());
    await createRideShareReader(sql).read({
      telegramUserId: "9007199254740993",
      orderId: ORDER_ID,
    });
    expect(calls[0]?.values[0]).toBe("9007199254740993");
  });

  it("معرِّفٌ ليسَ عدداً يُرَدُّ قبلَ لمسِ القاعدةِ", async () => {
    for (const bad of ["", "12a", "-5", "لا-عددَ", "12345678901234567890"]) {
      const { sql, calls } = fakeSql(located());
      const outcome = await createRideShareReader(sql).read({
        telegramUserId: bad,
        orderId: ORDER_ID,
      });
      expect(calls).toHaveLength(0);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe("USER_NOT_FOUND");
    }
  });

  it("سقوطُ الاتصالِ يُعلَنُ عطباً ولا يُقرأُ «لا مشاركةَ»", async () => {
    const { sql } = fakeSql(located(), { throws: true });
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: "ليسَ-uuid",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe("STORE_ERROR");
  });
});

describe("تصنيفُ رفضِ القاعدةِ", () => {
  it("«ليست لكَ» و«غيرُ موجودةٍ» جوابٌ واحدٌ يُرَدُّ حكماً لا عطباً", async () => {
    const { sql } = fakeSql({ ok: false, error: "ORDER_NOT_FOUND" });
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toEqual({ found: false, refusal: "ORDER_NOT_FOUND" });
  });

  it("مُدخَلٌ فاسدٌ يُرَدُّ حكماً مُسمّىً", async () => {
    const { sql } = fakeSql({ ok: false, error: "INVALID_INPUT" });
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toEqual({ found: false, refusal: "INVALID_ORDER_ID" });
  });

  it("رمزُ خطأٍ مجهولٌ يُعلَنُ عطباً ولا يُترجَمُ «غيرَ موجودةٍ»", async () => {
    const { sql } = fakeSql({ ok: false, error: "SOMETHING_NEW" });
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe("STORE_ERROR");
  });

  it("صفٌّ معدومٌ يُعلَنُ عطباً", async () => {
    const { sql } = fakeSql(null);
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe("STORE_ERROR");
  });
});

describe("تحويلُ الحمولةِ", () => {
  it("الحالُ يُحسَبُ من الروابطِ لا من حقلٍ يُصدِّقُه المحوّلُ", async () => {
    const { sql } = fakeSql(
      located({
        links: [
          { id: "a", created_at: "2027-03-01T09:00:00.000Z", seconds_remaining: 0 },
          { id: "b", created_at: "2027-03-01T09:02:00.000Z", seconds_remaining: 300 },
        ],
      }),
    );
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.found) throw new Error("قراءةٌ لم تنجحْ");
    expect(outcome.value.state.sharingNow).toBe(true);
    expect(outcome.value.state.longestRemainingSeconds).toBe(300);
    expect(outcome.value.state.availability).toBe("CAN_SHARE");
  });

  it("رحلةٌ ليست جاريةً تُصنَّفُ منعاً مُسمّىً لا زرّاً رمادِيّاً", async () => {
    const { sql } = fakeSql(located({ can_share: false }));
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("قراءةٌ لم تنجحْ");
    expect(outcome.value.state.availability).toBe("RIDE_NOT_ACTIVE");
  });

  it("إعدادٌ غائبٌ يُنشَرُ غائباً — لا رقمَ يُخترَعُ فيُقرأَ وعداً", async () => {
    const { sql } = fakeSql(located({ max_lifetime_minutes: null, grace_minutes: null }));
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("قراءةٌ لم تنجحْ");
    expect(outcome.value.state.maxLifetimeMinutes).toBeNull();
    expect(outcome.value.state.graceMinutes).toBeNull();
  });

  it("رابطٌ ناقصٌ يُسقِطُ القراءةَ كلَّها ولا يُحذَفُ بصمتٍ", async () => {
    for (const bad of [
      { created_at: "2027-03-01T09:00:00.000Z", seconds_remaining: 10 },
      { id: "a", seconds_remaining: 10 },
      { id: "a", created_at: "2027-03-01T09:00:00.000Z" },
      { id: "a", created_at: "ليسَ لحظةً", seconds_remaining: 10 },
      { id: "a", created_at: "2027-03-01T09:00:00.000Z", seconds_remaining: -1 },
    ]) {
      const { sql } = fakeSql(located({ links: [bad] }));
      const outcome = await createRideShareReader(sql).read({
        telegramUserId: TELEGRAM_ID,
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("الروابطُ ليست مصفوفةً يُعلَنُ عطباً لا قائمةً فارغةً", async () => {
    const { sql } = fakeSql(located({ links: null }));
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("صرامةُ المعاينةِ — التسريبُ يُعلَنُ ولا يُصحَّحُ", () => {
  it("حكمٌ مجهولٌ يُعلَنُ عطباً ولا يُقرأُ «لا نقطةَ»", async () => {
    const { sql } = fakeSql(hidden("SOMETHING_ELSE"));
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    expect(outcome.ok).toBe(false);
  });

  // لو قُرِئَ «لا نقطةَ» لَقالَت المعاينةُ للمالكِ «لا يرى شيئاً» بينما الصفحةُ
  // العامّةُ تعرضُ نقطةً — وهذا **أسوأُ من العطلِ**: طمأنينةٌ كاذبةٌ.
  it("«مُحدَّدٌ» بلا إحداثيّةٍ أو بلا عُمرٍ عقدٌ مكسورٌ يُعلَنُ", async () => {
    const drops: readonly (readonly string[])[] = [["lat"], ["lng"]];
    const variants: Record<string, unknown>[] = [];
    for (const keys of drops) {
      const base = (located().preview as { position: Record<string, unknown> }).position;
      const copy: Record<string, unknown> = { ...base };
      for (const key of keys) delete copy[key];
      variants.push(copy);
    }
    variants.push({
      ...(located().preview as { position: Record<string, unknown> }).position,
      age_seconds: null,
    });
    for (const position of variants) {
      const { sql } = fakeSql(located({ preview: { active: true, position } }));
      const outcome = await createRideShareReader(sql).read({
        telegramUserId: TELEGRAM_ID,
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("حكمٌ محجوبٌ ومعَه إحداثيّةٌ **تسريبٌ** يُعلَنُ عطباً ولا تُحذَفُ بصمتٍ", async () => {
    for (const verdict of ["TOO_OLD", "NEVER_REPORTED", "NO_TIMESTAMP"]) {
      const { sql } = fakeSql(hidden(verdict, { lat: 21.49, lng: 39.19 }));
      const outcome = await createRideShareReader(sql).read({
        telegramUserId: TELEGRAM_ID,
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("حكمٌ محجوبٌ بلا إحداثيّةٍ يُقرأُ بعُمرِه أو بعَدَمِه", async () => {
    const { sql } = fakeSql(hidden("TOO_OLD"));
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("قراءةٌ لم تنجحْ");
    const preview = outcome.value.state.preview;
    expect(preview.verdict).toBe("TOO_OLD");
    if (preview.verdict === "LOCATED") throw new Error("حكمٌ غيرُ متوقَّعٍ");
    expect(preview.ageSeconds).toBe(400);
    expect(preview.maxAgeSeconds).toBe(90);
    expect(preview.maxAgeSource).toBe("SETTING");
  });

  it("حدٌّ غائبٌ أو مصدرٌ مجهولٌ يُعلَنُ عطباً — الحدُّ يُقالُ ولا يُخمَّنُ", async () => {
    for (const over of [{ max_age_seconds: null }, { max_age_source: "GUESS" }]) {
      const { sql } = fakeSql(hidden("TOO_OLD", over));
      const outcome = await createRideShareReader(sql).read({
        telegramUserId: TELEGRAM_ID,
        orderId: ORDER_ID,
      });
      expect(outcome.ok).toBe(false);
    }
  });

  it("«جاريةٌ» تُقرأُ صراحةً — وما ليسَ `true` ليسَ جارياً", async () => {
    const { sql } = fakeSql(
      located({
        preview: {
          active: "yes",
          position: {
            verdict: "NEVER_REPORTED",
            age_seconds: null,
            max_age_seconds: 90,
            max_age_source: "FALLBACK_DEFAULT",
          },
        },
      }),
    );
    const outcome = await createRideShareReader(sql).read({
      telegramUserId: TELEGRAM_ID,
      orderId: ORDER_ID,
    });
    if (!outcome.ok || !outcome.value.found) throw new Error("قراءةٌ لم تنجحْ");
    expect(outcome.value.state.preview.active).toBe(false);
  });
});
