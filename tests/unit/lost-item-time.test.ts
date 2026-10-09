/**
 * الغرض: LOST-AT · ADR 0253 — حكمُ طبقةِ التطبيقِ على وقتِ الفقدِ التقريبيّ، وسطرُه في بطاقةِ الدعم،
 *   ومحوِّلاتُ حقلِ `datetime-local` في الواجهة. لا وقتَ يُخترَعُ حينَ يغيب.
 * الحالة: منفّذ فعلياً.
 */

import { describe, expect, it } from "bun:test";
import {
  formatLostAt,
  localInputNow,
  lostAtFromLocalInput,
} from "../../apps/miniapp/src/surfaces/support/ticket-view.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type { RiderSupportStore } from "../../packages/application/support/ports.ts";
import { openRiderSupportTicket } from "../../packages/application/support/rider-support.ts";
import type { SupportTicket } from "../../packages/domain/dispute/entity.ts";
import { createSupportCardPublisher } from "../../packages/infrastructure/notification/telegram-support-notifier.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const NOW = new Date("2026-10-09T12:00:00.000Z");
const sessions = {
  read: async () => ok({ telegramUserId: "42", expiresAtMs: NOW.getTime() + 60_000 }),
} as unknown as MiniAppSessionReader;

function deps(seen: unknown[]) {
  const store: RiderSupportStore = {
    openTicket: async (input) => {
      seen.push(input);
      return ok({
        ticketId: "t-1",
        reference: "TK-20261009-0001",
        category: input.category,
        cityId: "c",
        groupId: "-1",
      } as never);
    },
    listTickets: async () => err({ reason: "STORE_ERROR" }),
  };
  return { sessions, store, now: () => NOW };
}

const base = {
  accessToken: "token",
  message: "نسيت حقيبة",
  orderId: "88888888-0000-0000-0000-0000000002a1",
} as const;

describe("LOST-AT — طبقةُ التطبيق", () => {
  it("بلا وقتٍ ⇒ لا حقلَ يصلُ المخزن (لا وقتَ مخترَع)", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await openRiderSupportTicket(deps(seen), { ...base, category: "lost_item" });
    expect(result.ok).toBe(true);
    expect("lostAt" in (seen[0] as object)).toBe(false);
    const withNull = await openRiderSupportTicket(deps(seen), {
      ...base,
      category: "lost_item",
      lostAt: null,
    });
    expect(withNull.ok).toBe(true);
    expect("lostAt" in (seen[1] as object)).toBe(false);
  });

  it("وقتٌ صالحٌ بمنطقةٍ صريحة ⇒ يُطبَّعُ إلى UTC ويُمرَّر", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await openRiderSupportTicket(deps(seen), {
      ...base,
      category: "lost_item",
      lostAt: "2026-10-09T13:15:00+03:00",
    });
    expect(result.ok).toBe(true);
    expect(seen[0]?.lostAt).toBe("2026-10-09T10:15:00.000Z");
  });

  it("صيغةٌ بلا منطقةٍ أو غيرُ نصٍّ ⇒ LOST_AT_INVALID، وصنفٌ آخر ⇒ LOST_AT_NOT_ALLOWED، ومستقبلٌ ⇒ LOST_AT_IN_FUTURE", async () => {
    const seen: unknown[] = [];
    for (const [category, lostAt, code] of [
      ["lost_item", "2026-10-09T10:15", "LOST_AT_INVALID"],
      ["lost_item", 1_700_000_000, "LOST_AT_INVALID"],
      ["lost_item", "yesterday", "LOST_AT_INVALID"],
      ["ride_dispute", "2026-10-09T10:15:00Z", "LOST_AT_NOT_ALLOWED"],
      ["lost_item", "2026-10-09T12:30:00Z", "LOST_AT_IN_FUTURE"],
    ] as const) {
      const result = await openRiderSupportTicket(deps(seen), { ...base, category, lostAt });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.code).toBe(code);
    }
    expect(seen).toEqual([]);
  });

  it("هامشُ ساعةِ الجهاز: أربعُ دقائقَ في المستقبلِ تُقبَل", async () => {
    const seen: Record<string, unknown>[] = [];
    const result = await openRiderSupportTicket(deps(seen), {
      ...base,
      category: "lost_item",
      lostAt: "2026-10-09T12:04:00Z",
    });
    expect(result.ok).toBe(true);
  });
});

describe("LOST-AT — بطاقةُ الدعم", () => {
  const ticket = (lostAt: Date | null): SupportTicket => ({
    id: "abcdef12-0000-0000-0000-000000000000",
    type: "lost_item",
    status: "open",
    cityName: "جدة",
    message: "حقيبة",
    attachmentFileId: null,
    orderId: null,
    createdAt: NOW,
    lostAt,
    owner: {
      fullName: "راكب",
      phone: "",
      telegramId: "42",
      telegramUsername: null,
      languageCode: "ar",
    },
    subscription: null,
  });
  const publish = async (value: Date | null) => {
    const texts: string[] = [];
    const publisher = createSupportCardPublisher({
      sendReturningId: async (_chat: string, text: string) => {
        texts.push(text);
        return "1";
      },
      sendPhotoReturningId: async () => "1",
    } as never);
    await publisher.publish({ groupId: "-1", ticket: ticket(value), actions: [] });
    return texts[0] ?? "";
  };

  it("وقتٌ مقدَّمٌ ⇒ سطرٌ بتوقيتِ السعوديّة، وغيابُه ⇒ لا سطر", async () => {
    expect(await publish(new Date("2026-10-09T10:15:00Z"))).toContain("2026-10-09 13:15 (UTC+3)");
    expect(await publish(null)).not.toContain("UTC+3");
  });
});

describe("LOST-AT — محوِّلاتُ الواجهة", () => {
  it("الفارغُ `null`، والمشوَّهُ `undefined`، والصالحُ لحظةٌ ISO", () => {
    expect(lostAtFromLocalInput("")).toBeNull();
    expect(lostAtFromLocalInput("   ")).toBeNull();
    expect(lostAtFromLocalInput("10/09/2026")).toBeUndefined();
    const iso = lostAtFromLocalInput("2026-10-09T10:15");
    expect(typeof iso).toBe("string");
    expect(iso).toBe(new Date("2026-10-09T10:15").toISOString());
  });

  it("حدُّ `max` بالدقيقة، والعرضُ لا يسقطُ على لحظةٍ مشوّهة", () => {
    expect(localInputNow(new Date(2026, 9, 9, 7, 5))).toBe("2026-10-09T07:05");
    expect(formatLostAt("not-a-date", "ar")).toBeNull();
    expect(formatLostAt("2026-10-09T10:15:00.000Z", "en")).toBeString();
  });
});
