/**
 * الغرض: إثباتُ زرّي الراكب في §4.2 بسلوكٍ فعليّ: الزرّان يظهران للطلب المُسنَد
 *   وحده، وبيانُهما معرّفُ الطلب لا الرمز، والإصدارُ يُخرج رابطاً بمدّةٍ محسوبة،
 *   والإلغاءُ يُفرّق بين «أُلغيت» و«لا روابط سارية» بلا أن يُميّز غيرَ المالك.
 * الحالة: اختبار فعلي — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يوم يُضاف زرُّ «أعِد إصدار الرابط» يُختبر أنّ القديم يُلغى قبل
 *   الجديد لا بعده — وإلّا بقي رابطان.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type {
  ActiveOrderSummary,
  IncomingUpdate,
  Sender,
} from "../../packages/application/bots/types.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { IssueTrackingTokenDeps } from "../../packages/application/tracking/issue-tracking-token.ts";
import type { TrackingTokenRpcPort } from "../../packages/application/tracking/tracking-token-ports.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  JEDDAH,
  notifierDouble,
  offerWriterDouble,
  orderWriter,
  riderDirectory,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "500", chatId: "500", languageHint: "ar" };
const ORDER_ID = "order-1" as OrderId;
const RIDER = {
  id: "rider-9" as RiderId,
  cityId: JEDDAH.id,
  telegramUserId: "500",
  fullName: "سالم",
};

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, text: value };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, data };
}

function order(status: string): ActiveOrderSummary {
  return {
    orderId: ORDER_ID,
    service: "transport",
    status,
    pickupLabel: null,
    dropoffLabel: "النسيم",
    createdAt: new Date("2026-08-14T11:50:00.000Z"),
  };
}

let revokeCalls: { orderId: OrderId; telegramId: number }[];
let issueCalls: { orderId: OrderId; telegramId: number; token: string }[];
let deps: RiderBotDependencies;

function tokenPort(overrides: Partial<TrackingTokenRpcPort> = {}): TrackingTokenRpcPort {
  return {
    issue: async (orderId, telegramId, token) => {
      issueCalls.push({ orderId, telegramId, token });
      return ok({
        ok: true,
        row: {
          token,
          cityId: JEDDAH.id as CityId,
          // ٢٠ دقيقة من «الآن» — الحوار يحسب المدّة بساعته لا بنصٍّ ثابت.
          expiresAt: new Date("2026-08-14T12:20:00.000Z"),
        },
      });
    },
    revoke: async () => ok(false),
    revokeForOrder: async (orderId, telegramId) => {
      revokeCalls.push({ orderId, telegramId });
      return ok(1);
    },
    read: async () => ok({ kind: "invalid" as const }),
    expireEnded: async () => ok(0),
    ...overrides,
  };
}

function links(overrides: Partial<TrackingTokenRpcPort> = {}): IssueTrackingTokenDeps {
  return {
    tokens: tokenPort(overrides),
    mint: { mint: () => "tok_qrstuvwxyz012345" },
    baseUrl: "https://t.waslah.app",
  };
}

function build(overrides: Partial<RiderBotDependencies> = {}): RiderBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  revokeCalls = [];
  issueCalls = [];
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    riders: riderDirectory(RIDER),
    cities: cityDirectory([JEDDAH]),
    orders: orderWriter(ORDER_ID),
    activeOrdersOf: async () => [order("matched")],
    pastOrdersOf: async () => [],
    matching: {
      orders: orderRepo([]),
      offers: offerRepo([]),
      candidates: candidateRepo([]),
      settings: settingsRepo(seededRows(JEDDAH.id)),
      offerWriter: offerWriterDouble(),
      notifier: notifierDouble(),
      clock: fixedClock(NOW),
    },
    clock: fixedClock(NOW),
    trackingLinks: links(),
  };
});

describe("§4.2 — زرّا مشاركة الرابط وإلغائه", () => {
  it("`/status` يُلحق لوحةَ الزرّين ببيانٍ هو معرّفُ الطلب لا الرمز", async () => {
    const replies = await handleRiderUpdate(text("/status"), deps);
    const last = replies[replies.length - 1];
    expect(last?.text).toBe(ar("tracking.share_prompt"));
    expect(last?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [
          { label: ar("tracking.share_button"), data: `trk:new:${ORDER_ID}` },
          { label: ar("tracking.revoke_button"), data: `trk:off:${ORDER_ID}` },
        ],
      ],
    });
  });

  it("طلبٌ مازال `searching` لا زرَّ له: لا موقعَ سائقٍ يُتابَع", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      build({ activeOrdersOf: async () => [order("searching")] }),
    );
    expect(replies.some((r) => r.text === ar("tracking.share_prompt"))).toBe(false);
  });

  it("تركيبٌ بلا أساسٍ عامّ لا يعرض زرّاً يُنتج رابطاً لا يُفتح", async () => {
    const bare = build();
    delete (bare as { trackingLinks?: unknown }).trackingLinks;
    const replies = await handleRiderUpdate(text("/status"), bare);
    expect(replies.some((r) => r.text === ar("tracking.share_prompt"))).toBe(false);
  });

  it("زرُّ المشاركة يُصدر رمزاً بمعرّف المرسِل ويعرض الرابط ومدّته", async () => {
    const replies = await handleRiderUpdate(callback(`trk:new:${ORDER_ID}`), deps);
    expect(issueCalls).toEqual([
      { orderId: ORDER_ID, telegramId: 500, token: "tok_qrstuvwxyz012345" },
    ]);
    expect(replies[0]?.text).toBe(
      ar("tracking.share_ready", {
        order: "order-1",
        minutes: "20",
        url: "https://t.waslah.app/track/tok_qrstuvwxyz012345",
      }),
    );
  });

  it("طلبٌ ليس للمرسِل أو ليس جارياً: ردٌّ واحد لا يُميّزهما فلا يصير مِسبراً", async () => {
    const unauthorized = await handleRiderUpdate(
      callback(`trk:new:${ORDER_ID}`),
      build({
        trackingLinks: links({ issue: async () => ok({ ok: false, rejection: "UNAUTHORIZED" }) }),
      }),
    );
    const inactive = await handleRiderUpdate(
      callback(`trk:new:${ORDER_ID}`),
      build({
        trackingLinks: links({
          issue: async () => ok({ ok: false, rejection: "ORDER_NOT_ACTIVE" }),
        }),
      }),
    );
    expect(unauthorized[0]?.text).toBe(ar("tracking.share_not_active"));
    expect(inactive[0]?.text).toBe(unauthorized[0]?.text);
  });

  it("عطلٌ تقنيّ في الإصدار يُفرَّق عن الرفض: «تعذّر» لا «ليس جارياً»", async () => {
    const replies = await handleRiderUpdate(
      callback(`trk:new:${ORDER_ID}`),
      build({
        trackingLinks: links({
          issue: async () => err(new PortFailureError("trackingTokens.issue", "انقطاع")),
        }),
      }),
    );
    expect(replies[0]?.text).toBe(ar("tracking.share_failed"));
  });

  it("زرُّ الإلغاء يُنادي الإلغاءَ بالطلب ويؤكّد ما وقع", async () => {
    const replies = await handleRiderUpdate(callback(`trk:off:${ORDER_ID}`), deps);
    expect(revokeCalls).toEqual([{ orderId: ORDER_ID, telegramId: 500 }]);
    expect(replies[0]?.text).toBe(ar("tracking.revoked", { order: "order-1" }));
  });

  it("لا رابطَ ساري: يُقال ذلك ولا يُؤكَّد إلغاءٌ لم يقع", async () => {
    const replies = await handleRiderUpdate(
      callback(`trk:off:${ORDER_ID}`),
      build({ trackingLinks: links({ revokeForOrder: async () => ok(0) }) }),
    );
    expect(replies[0]?.text).toBe(ar("tracking.revoke_none", { order: "order-1" }));
  });

  it("بيانُ زرٍّ ناقص أو فعلٌ مجهول لا يُنادي القاعدة", async () => {
    const bad = await handleRiderUpdate(callback("trk:new"), deps);
    const unknown = await handleRiderUpdate(callback(`trk:zap:${ORDER_ID}`), deps);
    expect(bad[0]?.text).toBe(ar("common.unknown_command"));
    expect(unknown[0]?.text).toBe(ar("common.unknown_command"));
    expect(issueCalls).toHaveLength(0);
    expect(revokeCalls).toHaveLength(0);
  });
});
