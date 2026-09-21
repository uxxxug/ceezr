/**
 * الغرض: اختبارُ وحدةٍ لبوّابةِ دخولِ قروبِ غيرِ المشتركينَ (`PD-001` ·
 *   `ADR 0157`) — كلُّ فروعِ الحكمِ مزدوجاتٍ في الذاكرةِ: القروبُ المجهولُ،
 *   غيرُ المسجَّلِ، المدينةُ الأخرى، غيرُ الموثَّقِ، الموثَّقُ، والعجزُ التقنيُّ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI — والتكاملُ الكاملُ على قاعدةٍ حقيقيةٍ في
 *   tests/integration/group-join-gate.test.ts.
 * ملاحظات مستقبلية: فشلُ تلغرامَ المُعادُ هنا قرارُ عجزٍ لا قرارَ رفضٍ —
 *   الاختبارُ يُثبِتُ أنَّ الفرقَ بينهما محفوظٌ في القيمةِ المُعادةِ.
 */
import { describe, expect, it } from "bun:test";
import type { DriverDirectory } from "../../packages/application/bots/types.ts";
import {
  type GroupJoinGateDependencies,
  type GroupMembershipDecision,
  handleDriverGroupJoinRequest,
  type TelegramGroupGatePort,
  type UnsubscribedGroupCityDirectory,
} from "../../packages/application/groups/group-join-gate.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY_A = "11111111-1111-4111-8111-111111111111";
const CITY_B = "22222222-2222-4222-8222-222222222222";
const GROUP = "-1001234";
const USER = "900";
const USER_CHAT = "900";

function directory(group: string | null): UnsubscribedGroupCityDirectory {
  return {
    findByGroupChatId: async (chatId) =>
      ok(
        group === null || chatId !== group ? null : { cityId: CITY_A as never, groupChatId: group },
      ),
  };
}

function drivers(
  profile: null | { id: string; cityId: string; isVerified: boolean },
): DriverDirectory {
  return {
    findByTelegramId: async () =>
      ok(
        profile === null
          ? null
          : {
              id: profile.id as never,
              cityId: profile.cityId as never,
              telegramUserId: USER,
              fullName: "سائق",
              phone: "+966500000000",
              isVerified: profile.isVerified,
              isAvailable: true,
              hasLocation: true,
            },
      ),
    // بقيةُ المنفذِ لا تمسُّها البوّابةُ — أنجزُها بذاتِها حيثُ تُستعملُ فقط.
  } as unknown as DriverDirectory;
}

interface GateLog {
  approved: string[];
  declined: string[];
  messaged: { chatId: string; text: string }[];
  link: string | null;
}

function gate(log: GateLog, approveOk = true, declineOk = true): TelegramGroupGatePort {
  return {
    approve: async (groupChatId, telegramUserId) => {
      if (!approveOk) return false;
      log.approved.push(`${groupChatId}:${telegramUserId}`);
      return true;
    },
    decline: async (groupChatId, telegramUserId) => {
      if (!declineOk) return false;
      log.declined.push(`${groupChatId}:${telegramUserId}`);
      return true;
    },
    messageUser: async (userChatId, text) => {
      log.messaged.push({ chatId: userChatId, text });
      return true;
    },
    registrationLink: async () => log.link,
  };
}

function memberships(): {
  written: GroupMembershipDecision[];
  store: GroupJoinGateDependencies["memberships"];
} {
  const written: GroupMembershipDecision[] = [];
  return {
    written,
    store: {
      recordDecision: async (d) => {
        written.push(d);
        return ok(undefined);
      },
    },
  };
}

const REQUEST = {
  groupChatId: GROUP,
  telegramUserId: USER,
  userChatId: USER_CHAT,
  languageHint: "ar",
};

describe("handleDriverGroupJoinRequest", () => {
  it("قروبٌ لا تعرفُهُ مدينةٌ: رفضٌ بلا صفِّ عضويّةٍ", async () => {
    const log: GateLog = { approved: [], declined: [], messaged: [], link: null };
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(null),
      drivers: drivers(null),
      memberships: rows.store,
      gate: gate(log),
    });
    expect(decided).toBe(true);
    expect(log.declined).toEqual([`${GROUP}:${USER}`]);
    expect(rows.written).toEqual([]);
    expect(log.messaged).toEqual([]);
  });

  it("غيرُ المسجَّلِ: رفضٌ + إرشادٌ برابطِ التسجيلِ — ولا صفَّ عضويّةٍ", async () => {
    const log: GateLog = {
      approved: [],
      declined: [],
      messaged: [],
      link: "https://t.me/waslah_bot?start=register",
    };
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers(null),
      memberships: rows.store,
      gate: gate(log),
    });
    expect(decided).toBe(true);
    expect(rows.written).toEqual([]);
    expect(log.messaged).toHaveLength(1);
    expect(log.messaged[0]?.chatId).toBe(USER_CHAT);
    expect(log.messaged[0]?.text).toContain("https://t.me/waslah_bot?start=register");
  });

  it("غيرُ المسجَّلِ بلا رابطٍ: نصُّ الإرشادِ العاريُّ بلا وعدٍ كسيرٍ", async () => {
    const log: GateLog = { approved: [], declined: [], messaged: [], link: null };
    await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers(null),
      memberships: memberships().store,
      gate: gate(log),
    });
    expect(log.messaged[0]?.text).not.toContain("https");
    expect(log.messaged[0]?.text.length).toBeGreaterThan(10);
  });

  it("سائقٌ من مدينةٍ أخرى: رفضٌ بسببِ المدينةِ + صفٌّ مُسبَّبٌ", async () => {
    const log: GateLog = { approved: [], declined: [], messaged: [], link: null };
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers({ id: "d-1", cityId: CITY_B, isVerified: true }),
      memberships: rows.store,
      gate: gate(log),
    });
    expect(decided).toBe(true);
    expect(log.approved).toEqual([]);
    expect(rows.written).toHaveLength(1);
    expect(rows.written[0]).toMatchObject({
      status: "declined",
      reason: "city_mismatch",
      driverId: "d-1",
      cityId: CITY_A,
    });
  });

  it("سائقٌ غيرُ موثَّقٍ في مدينتِهِ: رفضٌ بسببِ التوثيقِ + صفٌّ", async () => {
    const rows = memberships();
    await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers({ id: "d-2", cityId: CITY_A, isVerified: false }),
      memberships: rows.store,
      gate: gate({ approved: [], declined: [], messaged: [], link: null }),
    });
    expect(rows.written[0]).toMatchObject({ status: "declined", reason: "driver_not_verified" });
  });

  it("سائقٌ موثَّقٌ في مدينتِهِ: قبولٌ + صفُّ عضويّةٍ", async () => {
    const log: GateLog = { approved: [], declined: [], messaged: [], link: null };
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers({ id: "d-3", cityId: CITY_A, isVerified: true }),
      memberships: rows.store,
      gate: gate(log),
    });
    expect(decided).toBe(true);
    expect(log.approved).toEqual([`${GROUP}:${USER}`]);
    expect(log.declined).toEqual([]);
    expect(rows.written).toHaveLength(1);
    expect(rows.written[0]).toMatchObject({ status: "approved", reason: null, driverId: "d-3" });
  });

  it("قبولٌ فشلَ عندَ تلغرامَ: عجزٌ لا نجاحٌ كاذبٌ — ولا صفَّ عضويّةٍ", async () => {
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers({ id: "d-4", cityId: CITY_A, isVerified: true }),
      memberships: rows.store,
      gate: gate({ approved: [], declined: [], messaged: [], link: null }, /* approveOk */ false),
    });
    expect(decided).toBe(false);
    expect(rows.written).toEqual([]);
  });

  it("رفضٌ فشلَ عندَ تلغرامَ: عجزٌ ولا صفَّ حكمٍ لم يبلغْ", async () => {
    const rows = memberships();
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: drivers({ id: "d-5", cityId: CITY_B, isVerified: true }),
      memberships: rows.store,
      gate: gate(
        { approved: [], declined: [], messaged: [], link: null },
        true,
        /* declineOk */ false,
      ),
    });
    expect(decided).toBe(false);
    expect(rows.written).toEqual([]);
  });

  it("عجزُ قراءةِ المدنِ أوِ السائقينَ: عجزٌ صريحٌ لا حكمَ جزافًا", async () => {
    const failing: UnsubscribedGroupCityDirectory = {
      findByGroupChatId: async () => err(new PortFailureError("cities", "down")),
    };
    const decided = await handleDriverGroupJoinRequest(REQUEST, {
      cities: failing,
      drivers: drivers(null),
      memberships: memberships().store,
      gate: gate({ approved: [], declined: [], messaged: [], link: null }),
    });
    expect(decided).toBe(false);

    const failingDrivers = {
      findByTelegramId: async () => err(new PortFailureError("drivers", "down")),
    } as unknown as DriverDirectory;
    const decided2 = await handleDriverGroupJoinRequest(REQUEST, {
      cities: directory(GROUP),
      drivers: failingDrivers,
      memberships: memberships().store,
      gate: gate({ approved: [], declined: [], messaged: [], link: null }),
    });
    expect(decided2).toBe(false);
  });
});
