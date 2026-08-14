/**
 * الغرض: إثباتُ مسار «قبول السائق ⇢ إخطار الراكب ⇢ رابط تتبّع» بسلوكٍ فعليّ لا
 *   بوجود دوالّ: هويّةُ الراكب الصحيحة، ورسالةٌ واحدة لا اثنتان، ورابطٌ صحيح،
 *   وفشلُ الإخطار لا يُفسد القبول.
 * الحالة: اختبار فعلي — أُضيف في 2026-08-14 (§4.2 من أمر الإطلاق التجاري).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: يوم يُرسل الرابط للسائق أيضاً يُضاف اختبارٌ لعدم تسريب رمز
 *   الراكب إليه — لا يُوسَّع اختبارٌ قائم.
 *
 * ## لماذا وحدويّةٌ لا تكامليّة؟
 *
 * السؤالُ هنا سؤالُ تنسيقٍ لا سؤالُ قاعدة: هل نادى الحوارُ المُخطِر مرّةً واحدة،
 * وبمعرّفٍ من مغلّف `claim_ride` لا من الجلسة؟ وذرّيةُ الإسناد وشرطُ الملكية
 * يُثبتان في اختبارات التكامل على قاعدةٍ حقيقيّة — فتكرارُهما هنا بأضعافٍ من
 * الوقت لا يُضيف حرفاً.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../packages/application/bots/driver-dialog.ts";
import type { IncomingUpdate, Keyboard, Sender } from "../../packages/application/bots/types.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { IssueTrackingTokenDeps } from "../../packages/application/tracking/issue-tracking-token.ts";
import type {
  IssueTokenOutcome,
  TrackingTokenRpcPort,
} from "../../packages/application/tracking/tracking-token-ports.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  driverDirectory,
  JEDDAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-14T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };
const ORDER = "order-77" as OrderId;
const RIDER_TELEGRAM = "5551234";
const EXPIRES = new Date("2026-08-14T12:20:00.000Z");

const tr = (language: string, key: string, params: Record<string, string | number> = {}) =>
  translate(language, key, params);

function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, data };
}

/** الرسائلُ الخارجة إلى بوتٍ آخر — تُجمع لتُعدّ لا لتُقرأ فقط: التكرارُ عيبٌ يُقاس. */
interface Sent {
  readonly telegramId: string;
  readonly text: string;
  readonly keyboard: Keyboard | null;
}

function riderClaim(overrides: Record<string, unknown> = {}) {
  return {
    claimed: true,
    reason: null,
    cityId: JEDDAH.id as CityId,
    rider: {
      riderId: "rider-9",
      telegramId: RIDER_TELEGRAM,
      languageCode: "ur",
      fullName: "سميرة",
    },
    driverName: "أحمد العمري",
    driverPlate: "أ ب ج 1234",
    driverVehicle: "sedan",
    ...overrides,
  };
}

/** منفذُ رموزٍ لا يفعل شيئاً إلّا ما يُطلب منه في كل اختبار على حدة. */
function tokenPort(
  issue: (
    orderId: OrderId,
    telegramId: number,
    token: string,
  ) => Promise<Result<IssueTokenOutcome, PortFailureError>>,
): TrackingTokenRpcPort {
  return {
    issue,
    revoke: async () => ok(false),
    revokeForOrder: async () => ok(0),
    read: async () => ok({ kind: "invalid" as const }),
    expireEnded: async () => ok(0),
  };
}

let sent: Sent[];
let claims: { orderId: OrderId; driverId: DriverId }[];
let issuedFor: { orderId: OrderId; telegramId: number }[];
let deps: DriverBotDependencies;

function links(): IssueTrackingTokenDeps {
  return {
    tokens: tokenPort(async (orderId, telegramId, token) => {
      issuedFor.push({ orderId, telegramId });
      return ok({ ok: true, row: { token, cityId: JEDDAH.id as CityId, expiresAt: EXPIRES } });
    }),
    mint: { mint: () => "tok_abcdefghijklmnop" },
    baseUrl: "https://t.waslah.app/",
  };
}

function build(overrides: Partial<DriverBotDependencies> = {}): DriverBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  sent = [];
  claims = [];
  issuedFor = [];
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    drivers: driverDirectory(verifiedDriver()),
    cities: cityDirectory(),
    settings: settingsRepo(seededRows(JEDDAH.id)),
    subscriptions: subscriptionReader(null),
    trial: trialPort(true),
    dispatch: {
      claimRide: async (orderId, driverId) => {
        claims.push({ orderId, driverId });
        return ok(riderClaim());
      },
    },
    offers: offerDecisionPort(),
    clock: fixedClock(NOW),
    acceptNotice: {
      counterpart: {
        notify: async (telegramId, text, keyboard) => {
          sent.push({ telegramId, text, keyboard });
        },
      },
      links: links(),
    },
  };
});

describe("§4.2 — إخطارُ الراكب لحظة قبول السائق", () => {
  it("القبولُ يمرّ بالدالّة الذرّية ويُعلَن للسائق كما كان", async () => {
    const replies = await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(claims).toEqual([{ orderId: ORDER, driverId: "driver-1" as DriverId }]);
    expect(replies[0]?.text).toBe(tr("ar", "driver.offer_accepted"));
  });

  it("الإخطارُ يذهب إلى معرّف تلغرام القادم من المغلّف لا إلى المرسِل", async () => {
    await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.telegramId).toBe(RIDER_TELEGRAM);
    expect(sent[0]?.telegramId).not.toBe(SENDER.telegramUserId);
    // ولغتُه هو لا لغةُ السائق: المغلّف يحمل `language_code` للراكب.
    expect(
      sent[0]?.text.startsWith(
        tr("ur", "tracking.rider_matched", {
          order: "order-77",
          driver: "أحمد العمري",
          plate: "أ ب ج 1234",
          vehicle: "sedan",
        }).slice(0, 12),
      ),
    ).toBe(true);
  });

  it("رسالةٌ واحدة لا اثنتان: القبولُ لا يُخطِر مرّتين", async () => {
    await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(sent).toHaveLength(1);
    expect(issuedFor).toHaveLength(1);
  });

  it("الرابطُ المُصدَر بمعرّف الراكب وبالشكل `<الأساس>/track/<الرمز>` بلا شرطةٍ مزدوجة", async () => {
    await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(issuedFor).toEqual([{ orderId: ORDER, telegramId: Number(RIDER_TELEGRAM) }]);
    const expected = "https://t.waslah.app/track/tok_abcdefghijklmnop";
    expect(sent[0]?.text).toContain(expected);
    expect(sent[0]?.text).not.toContain("//track");
  });

  it("فشلُ إصدار الرابط يُبقي الإخطار: معرفةُ الراكب أولى من خريطة", async () => {
    const failing: IssueTrackingTokenDeps = {
      ...links(),
      tokens: tokenPort(async () => err(new PortFailureError("trackingTokens.issue", "انقطاع"))),
    };
    const counterpart = {
      notify: async (telegramId: string, text: string, keyboard: Keyboard | null) => {
        sent.push({ telegramId, text, keyboard });
      },
    };
    await handleDriverUpdate(
      callback(`offer:accept:${ORDER}`),
      build({ acceptNotice: { counterpart, links: failing } }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain("/track/");
  });

  it("فشلُ الإخطار نفسه لا يُفسد قبولاً وقع في القاعدة", async () => {
    const replies = await handleDriverUpdate(
      callback(`offer:accept:${ORDER}`),
      build({
        acceptNotice: {
          counterpart: {
            notify: async () => {
              throw new Error("تلغرام حجب الراكب");
            },
          },
          links: links(),
        },
      }),
    );
    expect(claims).toHaveLength(1);
    expect(replies[0]?.text).toBe(tr("ar", "driver.offer_accepted"));
  });

  it("مغلّفٌ بلا راكب لا يُنتج إخطاراً إلى مجهول", async () => {
    await handleDriverUpdate(
      callback(`offer:accept:${ORDER}`),
      build({
        dispatch: { claimRide: async () => ok(riderClaim({ rider: null })) },
      }),
    );
    expect(sent).toHaveLength(0);
  });

  it("تركيبٌ بلا `acceptNotice` يقبل الطلب ولا يُرسل شيئاً", async () => {
    const bare = build();
    delete (bare as { acceptNotice?: unknown }).acceptNotice;
    const replies = await handleDriverUpdate(callback(`offer:accept:${ORDER}`), bare);
    expect(replies[0]?.text).toBe(tr("ar", "driver.offer_accepted"));
    expect(sent).toHaveLength(0);
  });
});
