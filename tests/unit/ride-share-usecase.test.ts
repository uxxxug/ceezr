/**
 * الغرض: قياسُ حالاتِ استعمالِ المشاركةِ — القراءةُ والإصدارُ والإيقافُ:
 *   بوّابةُ الجلسةِ، وتصنيفُ الرفضِ حكماً لا عطباً، والعكسُ (البند `F2-09`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-09`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إذ يمرُّ بالبوّابةِ نفسِها.
 *
 * ## لماذا يُقاسُ **الفرقُ بينَ الحكمِ والعطلِ** ههنا بالذاتِ
 *
 * «لا يجوزُ لكَ» و«عطلَت خدمتُنا» جوابانِ مختلفانِ تماماً لمن يضغطُ الزرَّ:
 * الأوّلُ يُنهي المحاولةَ، والثاني يدعو لإعادتِها. وخلطُهما يجعلُ راكبةً تظنُّ
 * أنَّ المشاركةَ ممنوعةٌ وهيَ متاحةٌ، أو تُعيدُ الضغطَ على بابٍ مُغلَقٍ أبداً.
 * فالمقيسُ ههنا أنَّ كلَّ سببٍ يقعُ في خانتِه — **حرفاً**.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ ذرّيّةُ الإصدارِ**: تلكَ حكمُ دالّةِ القاعدةِ، وموضعُها
 *    `tests/integration/ride-share.test.ts`.
 * ــ **لا تُقاسُ صياغةُ الرابطِ**: `trackingUrl` مقيسٌ في اختباراتِ التتبّعِ.
 */

import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type { PortFailureError } from "../../packages/application/ports/index.ts";
import type {
  IssuedTokenRow,
  IssueTokenOutcome,
  IssueTokenRejection,
  TrackingTokenRpcPort,
} from "../../packages/application/tracking/tracking-token-ports.ts";
import {
  type RideSharePublicErrorCode,
  readRideShare,
  startRideShare,
  stopRideShare,
} from "../../packages/application/transport/ride-share.ts";
import type { RideShareReader } from "../../packages/application/transport/ride-share-ports.ts";
import type { RideShareState } from "../../packages/domain/transport/ride-share.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const NOW = new Date("2027-03-01T09:05:00.000Z");
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";
const TOKEN = "session-token";
const TELEGRAM_ID = "5550001";

function sessions(
  outcome: Result<{ telegramUserId: string }, { reason: string }> = ok({
    telegramUserId: TELEGRAM_ID,
  }),
): MiniAppSessionReader {
  return {
    read: () => outcome as unknown as ReturnType<MiniAppSessionReader["read"]>,
  } as MiniAppSessionReader;
}

function state(): RideShareState {
  return {
    orderId: ORDER_ID,
    availability: "CAN_SHARE",
    links: [],
    sharingNow: false,
    lifetime: {
      verdict: "LIVE_RIDE_ACTIVE",
      graceMinutes: 10,
      graceSource: "SETTING",
    },
    soonestCeilingSeconds: null,
    maxLifetimeMinutes: 60,
    graceMinutes: 10,
    preview: {
      verdict: "NEVER_REPORTED",
      active: true,
      ageSeconds: null,
      maxAgeSeconds: 90,
      maxAgeSource: "SETTING",
    },
  };
}

function shares(
  reply: Awaited<ReturnType<RideShareReader["read"]>>,
  calls: unknown[] = [],
): RideShareReader {
  return {
    read: async (input) => {
      calls.push(input);
      return reply;
    },
  };
}

function portFailure(detail: string): PortFailureError {
  return { code: "PORT_FAILURE", detail } as unknown as PortFailureError;
}

function tokensPort(
  issue: Result<IssueTokenOutcome, PortFailureError>,
  revokeForOrder: Result<number, PortFailureError> = ok(0),
): TrackingTokenRpcPort {
  return {
    issue: async () => issue,
    revoke: async () => ok(true),
    revokeForOrder: async () => revokeForOrder,
    read: async () => ok({ kind: "invalid" }),
    expireEnded: async () => ok(0),
  };
}

function issuing(issue: Result<IssueTokenOutcome, PortFailureError>) {
  return {
    tokens: tokensPort(issue),
    mint: { mint: () => "a".repeat(43) },
    baseUrl: "https://t.example.com/",
  };
}

function rejection(reason: IssueTokenRejection): Result<IssueTokenOutcome, PortFailureError> {
  return ok({ ok: false, rejection: reason });
}

describe("بوّابةُ الجلسةِ — واحدةٌ للمساراتِ الثلاثةِ", () => {
  it("لا رمزَ جلسةٍ يُرَدُّ «مطلوبةٌ» قبلَ لمسِ القاعدةِ", async () => {
    const calls: unknown[] = [];
    const outcome = await readRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        shares: shares(ok({ found: true, state: state() }), calls),
      },
      { accessToken: undefined, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("SESSION_REQUIRED");
    expect(calls).toHaveLength(0);
  });

  it("رمزٌ فارغٌ ليسَ رمزاً", async () => {
    const outcome = await readRideShare(
      { sessions: sessions(), now: () => NOW, shares: shares(ok({ found: true, state: state() })) },
      { accessToken: "", orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("SESSION_REQUIRED");
  });

  // «انتهَت» و«مزوَّرةٌ» و«لا توقيعَ مضبوطٌ» ثلاثةُ أحوالٍ لا حالٌ واحدةٌ:
  // الأولى تُعالَجُ بفتحٍ جديدٍ، والثانيةُ إنذارٌ، والثالثةُ عطبُ تشغيلٍ.
  it("كلُّ سببِ رفضِ جلسةٍ يقعُ في خانتِه", async () => {
    const cases: ReadonlyArray<readonly [string, RideSharePublicErrorCode]> = [
      ["EXPIRED", "SESSION_EXPIRED"],
      ["NOT_CONFIGURED", "SESSION_NOT_AVAILABLE"],
      ["SIGNATURE_MISMATCH", "SESSION_INVALID"],
    ];
    for (const [reason, expected] of cases) {
      const outcome = await readRideShare(
        {
          sessions: sessions(err({ reason })),
          now: () => NOW,
          shares: shares(ok({ found: true, state: state() })),
        },
        { accessToken: TOKEN, orderId: ORDER_ID },
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toBe(expected);
    }
  });
});

describe("القراءةُ", () => {
  it("المعرِّفُ يُمرَّرُ من **الجلسةِ** لا من جسمِ الطلبِ", async () => {
    const calls: unknown[] = [];
    await readRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        shares: shares(ok({ found: true, state: state() }), calls),
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(calls).toEqual([{ telegramUserId: TELEGRAM_ID, orderId: ORDER_ID }]);
  });

  it("حالٌ موجودٌ يُمرَّرُ كما وصلَ بلا إعادةِ تركيبٍ", async () => {
    const value = state();
    const outcome = await readRideShare(
      { sessions: sessions(), now: () => NOW, shares: shares(ok({ found: true, state: value })) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toEqual({ found: true, state: value });
  });

  it("رفضُ القاعدةِ يُمرَّرُ حكماً، وعطلُها يُعلَنُ عطلاً", async () => {
    const refused = await readRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        shares: shares(ok({ found: false, refusal: "ORDER_NOT_FOUND" })),
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(refused.ok).toBe(true);

    const broken = await readRideShare(
      { sessions: sessions(), now: () => NOW, shares: shares(err({ reason: "STORE_ERROR" })) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toBe("RIDE_STORE_NOT_AVAILABLE");
  });
});

describe("الإصدارُ", () => {
  it("رابطٌ مُصدَرٌ يُرَدُّ برمزِه مرّةً واحدةً", async () => {
    const expiresAt = new Date("2027-03-01T10:05:00.000Z");
    const outcome = await startRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        issuing: issuing(
          ok({
            ok: true,
            row: { token: "b".repeat(43), cityId: "c", expiresAt } as IssuedTokenRow,
          }),
        ),
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || !outcome.value.issued) throw new Error("إصدارٌ لم ينجحْ");
    expect(outcome.value.link.url).toBe(`https://t.example.com/track/${"b".repeat(43)}`);
    expect(outcome.value.link.expiresAt).toEqual(expiresAt);
  });

  // الأساسُ العامُّ غيرُ مضبوطٍ **قرارُ مشغِّلٍ مُعلَنٌ** لا حقلٌ منسيٌّ: يُقالُ
  // باسمِه فلا يُبنى رابطٌ بأساسٍ مُخمَّنٍ ولا يُقالُ «حدثَ خطأٌ».
  it("ميزةٌ غيرُ مهيّأةٍ تُقالُ باسمِها ولا يُبنى رابطٌ بأساسٍ مُخمَّنٍ", async () => {
    const outcome = await startRideShare(
      { sessions: sessions(), now: () => NOW, issuing: undefined },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("SHARING_NOT_CONFIGURED");
  });

  it("«ليست لكَ» و«غيرُ موجودةٍ» رفضٌ واحدٌ — الفرقُ يُخبِرُ المُجرِّبَ بوجودِها", async () => {
    for (const reason of ["UNAUTHORIZED", "ORDER_NOT_FOUND"] as const) {
      const outcome = await startRideShare(
        { sessions: sessions(), now: () => NOW, issuing: issuing(rejection(reason)) },
        { accessToken: TOKEN, orderId: ORDER_ID },
      );
      expect(outcome.ok).toBe(true);
      if (!outcome.ok || outcome.value.issued) throw new Error("رفضٌ متوقَّعٌ لم يقعْ");
      expect(outcome.value.refusal).toBe("ORDER_NOT_FOUND");
    }
  });

  it("رحلةٌ منتهيةٌ وتصادمُ رمزٍ حكمانِ مقروءانِ لا عطبٌ", async () => {
    const notActive = await startRideShare(
      { sessions: sessions(), now: () => NOW, issuing: issuing(rejection("ORDER_NOT_ACTIVE")) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    if (!notActive.ok || notActive.value.issued) throw new Error("رفضٌ متوقَّعٌ لم يقعْ");
    expect(notActive.value.refusal).toBe("RIDE_NOT_ACTIVE");

    const collision = await startRideShare(
      { sessions: sessions(), now: () => NOW, issuing: issuing(rejection("TOKEN_COLLISION")) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    if (!collision.ok || collision.value.issued) throw new Error("رفضٌ متوقَّعٌ لم يقعْ");
    expect(collision.value.refusal).toBe("LINK_COLLISION");
  });

  // رمزٌ قصيرٌ وعطلُ منفذٍ **عطبُ خدمةٍ**: لو قُرِئا «لا يجوزُ لكَ» لَفُسِّرا
  // سياسةً، ولانتظرَ صاحبُهما أبداً بابَ إذنٍ لم يكنْ مُغلَقاً أصلاً.
  it("عطبُ الخدمةِ لا يُقرأُ سياسةً", async () => {
    const short = await startRideShare(
      { sessions: sessions(), now: () => NOW, issuing: issuing(rejection("TOKEN_TOO_SHORT")) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toBe("RIDE_STORE_NOT_AVAILABLE");

    const down = await startRideShare(
      { sessions: sessions(), now: () => NOW, issuing: issuing(err(portFailure("انقطاعٌ"))) },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error).toBe("RIDE_STORE_NOT_AVAILABLE");
  });

  it("معرِّفُ جلسةٍ ليسَ عدداً يُرَدُّ قبلَ الإصدارِ", async () => {
    const outcome = await startRideShare(
      {
        sessions: sessions(ok({ telegramUserId: "لا-عددَ" })),
        now: () => NOW,
        issuing: issuing(rejection("ORDER_NOT_FOUND")),
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("الإيقافُ", () => {
  it("يُرَدُّ **عددُ** ما أُلغيَ لا `true` — والفرقُ يراهُ الضاغطُ", async () => {
    const outcome = await stopRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        revoking: { tokens: tokensPort(rejection("ORDER_NOT_FOUND"), ok(2)) },
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe(2);
  });

  it("«لا رابطَ ساري» صفرٌ صادقٌ لا عطبٌ", async () => {
    const outcome = await stopRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        revoking: { tokens: tokensPort(rejection("ORDER_NOT_FOUND"), ok(0)) },
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value).toBe(0);
  });

  it("عطلُ المنفذِ يُعلَنُ ولا يُقرأُ «أُوقِفَت»", async () => {
    const outcome = await stopRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        revoking: {
          tokens: tokensPort(rejection("ORDER_NOT_FOUND"), err(portFailure("انقطاعٌ"))),
        },
      },
      { accessToken: TOKEN, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("RIDE_STORE_NOT_AVAILABLE");
  });

  it("الإيقافُ يمرُّ بالبوّابةِ نفسِها — لا رمزَ جلسةٍ لا إيقافَ", async () => {
    const outcome = await stopRideShare(
      {
        sessions: sessions(),
        now: () => NOW,
        revoking: { tokens: tokensPort(rejection("ORDER_NOT_FOUND"), ok(3)) },
      },
      { accessToken: undefined, orderId: ORDER_ID },
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toBe("SESSION_REQUIRED");
  });
});
