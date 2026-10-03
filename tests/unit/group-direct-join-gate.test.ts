/**
 * الغرض: اختبارُ وحدةٍ لـ`GRP-GATE-02` — من دخلَ قروبَ السائقينَ مباشرةً (الرابطُ العامُّ)
 *   يُحكَمُ فيه بمعيارِ طلبِ الانضمامِ: الموثَّقُ في مدينةِ القروبِ يبقى، وغيرُه يُخرَجُ
 *   (إخراجٌ لا حظرٌ) ويُراسَلُ خاصّةً؛ والمشرفُ والبوتُ والقروبُ المجهولُ لا تُمَسُّ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { toIncomingUpdate } from "../../apps/gateway/src/bots/shared/telegram-mapper.ts";
import type { DriverDirectory } from "../../packages/application/bots/types.ts";
import {
  type GroupJoinGateDependencies,
  handleDriverGroupDirectJoin,
  type TelegramGroupGatePort,
} from "../../packages/application/groups/group-join-gate.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY_A = "11111111-1111-4111-8111-111111111111";
const CITY_B = "22222222-2222-4222-8222-222222222222";
const GROUP = "-1001234";
const USER = "900";

type Profile = null | { cityId: string; isVerified: boolean };

function deps(
  profile: Profile,
  opts: { admin?: boolean | null; knownGroup?: boolean } = {},
): { deps: GroupJoinGateDependencies; removed: string[]; messaged: string[] } {
  const removed: string[] = [];
  const messaged: string[] = [];
  const gate: TelegramGroupGatePort = {
    approve: async () => true,
    decline: async () => true,
    remove: async (g, u) => {
      removed.push(`${g}:${u}`);
      return true;
    },
    isGroupAdmin: async () => (opts.admin === undefined ? false : opts.admin),
    messageUser: async (_chat, text) => {
      messaged.push(text);
      return true;
    },
    registrationLink: async () => "https://t.me/example_bot?start=register",
  };
  const drivers = {
    findByTelegramId: async () =>
      ok(
        profile === null
          ? null
          : {
              id: "d1",
              cityId: profile.cityId,
              telegramUserId: USER,
              fullName: "سائق",
              phone: "+966500000000",
              isVerified: profile.isVerified,
              isAvailable: true,
              hasLocation: true,
            },
      ),
  } as unknown as DriverDirectory;
  return {
    removed,
    messaged,
    deps: {
      cities: {
        findByGroupChatId: async (chatId) =>
          ok(
            opts.knownGroup === false || chatId !== GROUP
              ? null
              : { cityId: CITY_A as never, groupChatId: GROUP },
          ),
      },
      drivers,
      memberships: { recordDecision: async () => ok(undefined) },
      gate,
    },
  };
}

const join = { groupChatId: GROUP, telegramUserId: USER, languageHint: "ar", isBot: false };

describe("GRP-GATE-02 — الدخولُ المباشرُ إلى قروبِ السائقين", () => {
  it("السائقُ الموثَّقُ في مدينةِ القروبِ يبقى بلا رسالة", async () => {
    const t = deps({ cityId: CITY_A, isVerified: true });
    expect(await handleDriverGroupDirectJoin(join, t.deps)).toBe("kept");
    expect(t.removed).toEqual([]);
    expect(t.messaged).toEqual([]);
  });

  it("غيرُ المسجَّلِ يُخرَجُ ويصلُه رابطُ التسجيل", async () => {
    const t = deps(null);
    expect(await handleDriverGroupDirectJoin(join, t.deps)).toBe("removed");
    expect(t.removed).toEqual([`${GROUP}:${USER}`]);
    expect(t.messaged[0]).toContain("?start=register");
  });

  it("سائقُ مدينةٍ أخرى وغيرُ الموثَّقِ يُخرَجانِ بنصِّ الأهليّة", async () => {
    for (const p of [
      { cityId: CITY_B, isVerified: true },
      { cityId: CITY_A, isVerified: false },
    ]) {
      const t = deps(p);
      expect(await handleDriverGroupDirectJoin(join, t.deps)).toBe("removed");
      expect(t.messaged[0]).toContain("الموثّقين");
    }
  });

  it("المشرفُ والبوتُ والقروبُ المجهولُ وتعذُّرُ قراءةِ الإشرافِ: لا إخراج", async () => {
    const admin = deps(null, { admin: true });
    expect(await handleDriverGroupDirectJoin(join, admin.deps)).toBe("skipped");
    const unknownAdmin = deps(null, { admin: null });
    expect(await handleDriverGroupDirectJoin(join, unknownAdmin.deps)).toBe("skipped");
    const bot = deps(null);
    expect(await handleDriverGroupDirectJoin({ ...join, isBot: true }, bot.deps)).toBe("skipped");
    const unknown = deps(null, { knownGroup: false });
    expect(await handleDriverGroupDirectJoin(join, unknown.deps)).toBe("skipped");
    for (const t of [admin, unknownAdmin, bot, unknown]) expect(t.removed).toEqual([]);
  });

  it("المُطابِقُ: دخولٌ من «غادرَ» إلى «عضو» وحدَه، ولا يُعادُ الحكمُ فيمن دخلَ بطلبِ انضمام", () => {
    const base = {
      update_id: 1,
      chat_member: {
        chat: { id: Number(GROUP), type: "supergroup" },
        old_chat_member: { status: "left" },
        new_chat_member: {
          status: "member",
          user: { id: 900, is_bot: false, language_code: "ar" },
        },
      },
    };
    const mapped = toIncomingUpdate(base);
    expect(mapped?.kind).toBe("member_joined");
    expect(
      toIncomingUpdate({ ...base, chat_member: { ...base.chat_member, via_join_request: true } }),
    ).toBeNull();
    expect(
      toIncomingUpdate({
        ...base,
        chat_member: {
          ...base.chat_member,
          old_chat_member: { status: "member" },
          new_chat_member: { status: "left", user: { id: 900 } },
        },
      }),
    ).toBeNull();
  });
});
