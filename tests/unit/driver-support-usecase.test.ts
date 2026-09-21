/**
 * الغرض: قياسُ ما **يفترقُ** في دعمِ السائقِ عن دعمِ الراكبِ (`F3-08` · `SD-10`):
 *   مجالُ أصنافِه مغلقٌ على أربعٍ وصنفَينِ مشتركَينِ، و«راكبٌ مسيءٌ» وحدَها
 *   تلزمُها رحلةٌ، وأنَّ **نواةَ الاستقبالِ واحدةٌ** فالحكمُ نفسُه لا نسخةٌ ثانيةٌ.
 * الحالة: منفَّذٌ فعليّاً — البند `F3-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لِمَ يُقاسُ «أنَّ النواةَ واحدةٌ» ولا يُكتَفى بأنَّها كذلكَ في الشِفرةِ
 *
 * لأنَّ الوحدةَ **تُنقَضُ بسطرٍ**: يكفي أن يُنسَخَ حكمٌ في مسارٍ ليصيرَ للحدِّ
 * حكمانِ. فالمقيسُ ههنا أنَّ رفضاً واحداً من القاعدةِ يُترجَمُ في الدورَينِ إلى
 * **الرمزِ نفسِه**، وأنَّ حدَّ المحارفِ والمؤشِّرَ والحدَّ الأعلى تُردُّ بالرموزِ
 * نفسِها — فإن افترقَ جوابٌ سقطَ الاختبارُ ولو صحَّ كلٌّ منهما وحدَه.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ ما هوَ مقيسٌ في الراكبِ**: الجلسةُ وترجمةُ الرفضِ شاملةً
 *    مقيسةٌ في `rider-support-usecase.test.ts` على **النواةِ نفسِها** — وتكرارُ
 *    السؤالِ في موضعَينِ يُتيحُ لجوابَيهِ أن يفترقا.
 * ــ **لا يُقاسُ حكمُ الدورِ في القاعدةِ**: `NOT_A_DRIVER` مقيسٌ على قاعدةٍ
 *    حقيقيّةٍ في `tests/integration/driver-support-intake.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import {
  listDriverSupportTickets,
  openDriverSupportTicket,
} from "../../packages/application/support/driver-support.ts";
import type {
  DriverSupportStore,
  SupportStoreRejection,
} from "../../packages/application/support/ports.ts";
import {
  listRiderSupportTickets,
  openRiderSupportTicket,
} from "../../packages/application/support/rider-support.ts";
import {
  DRIVER_CATEGORIES_REQUIRING_ORDER,
  DRIVER_SUPPORT_CATEGORIES,
  driverCategoryRequiresOrder,
  isDriverSupportCategory,
} from "../../packages/domain/support/driver-support.ts";
import { MAX_SUPPORT_MESSAGE_CHARS } from "../../packages/domain/support/rider-support.ts";
import {
  isSupportTicketType,
  SUPPORT_TICKET_TYPES,
} from "../../packages/domain/support/ticket-types.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const NOW = new Date("2027-04-02T10:00:00.000Z");
const TOKEN = "session-token";
const TELEGRAM_ID = "7770009";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

function sessions(): MiniAppSessionReader {
  return {
    read: async () =>
      ok({ telegramUserId: TELEGRAM_ID }) as unknown as ReturnType<MiniAppSessionReader["read"]>,
    readSync: () =>
      ok({ telegramUserId: TELEGRAM_ID }) as unknown as ReturnType<
        MiniAppSessionReader["readSync"]
      >,
  } as MiniAppSessionReader;
}

const OPENED = {
  ticketId: "9a1b2c3d-4e5f-4a1b-8c2d-3e4f5a6b7c8d",
  reference: "WSL-000321",
  category: "deduction",
} as const;

const PAGE = {
  tickets: [],
  hasMore: false,
  nextCursor: null,
  expectedResponseMinutes: 90,
} as const;

function store(
  overrides: Partial<DriverSupportStore> = {},
): DriverSupportStore & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    openTicket: async (input) => {
      calls.push(input);
      return ok(OPENED);
    },
    listTickets: async (input) => {
      calls.push(input);
      return ok(PAGE);
    },
    ...overrides,
  } as DriverSupportStore & { readonly calls: unknown[] };
}

function rejectedStore(rejection: SupportStoreRejection, retryAfterSeconds: number | null = null) {
  return store({
    openTicket: async () => err({ rejection, retryAfterSeconds }) as never,
    listTickets: async () => err({ rejection, retryAfterSeconds }) as never,
  });
}

async function open(
  input: { category?: unknown; message?: unknown; orderId?: unknown },
  deps: Partial<{ store: DriverSupportStore }> = {},
) {
  return openDriverSupportTicket(
    {
      sessions: sessions(),
      now: () => NOW,
      store: deps.store ?? store(),
    },
    {
      accessToken: TOKEN,
      category: "category" in input ? input.category : "deduction",
      message: "message" in input ? input.message : "خُصِمَ منّي مبلغٌ لا أعرفُ سببَه",
      orderId: "orderId" in input ? input.orderId : null,
    },
  );
}

describe("مجالُ أصنافِ السائقِ — مغلقٌ ومقابلٌ للقاعدةِ", () => {
  it("الأصنافُ الأربعةُ المنصوصةُ في `SD-10` كلُّها في المجالِ", () => {
    for (const category of ["subscription", "deduction", "rider_conduct", "vehicle"]) {
      expect(isDriverSupportCategory(category)).toBe(true);
    }
  });

  it("أصنافُ الراكبِ الخاصّةُ **ليسَت** في مجالِ السائقِ — ولا تُعرَضُ له", () => {
    for (const category of ["ride_dispute", "lost_item", "driver_conduct"]) {
      expect(isDriverSupportCategory(category)).toBe(false);
    }
  });

  it("قيمٌ مُصطنَعةٌ تُردُّ — ولا يُقبَلُ نصٌّ لأنَّه نصٌّ", () => {
    for (const value of ["", "DEDUCTION", "deduction ", "salary", 3, null, undefined, {}]) {
      expect(isDriverSupportCategory(value)).toBe(false);
    }
  });

  it("كلُّ صنفٍ في مجالِ السائقِ **قيمةٌ في النوعِ** — ولا صنفَ لا وجودَ له", () => {
    for (const category of DRIVER_SUPPORT_CATEGORIES) {
      expect(isSupportTicketType(category)).toBe(true);
      expect(SUPPORT_TICKET_TYPES).toContain(category);
    }
  });

  it("«راكبٌ مسيءٌ» وحدَها تلزمُها رحلةٌ — لا الخصمُ ولا المركبةُ ولا الاشتراكُ", () => {
    expect(DRIVER_CATEGORIES_REQUIRING_ORDER).toEqual(["rider_conduct"]);
    expect(driverCategoryRequiresOrder("rider_conduct")).toBe(true);
    for (const category of [
      "subscription",
      "deduction",
      "vehicle",
      "app_problem",
      "other",
    ] as const) {
      expect(driverCategoryRequiresOrder(category)).toBe(false);
    }
  });
});

describe("فتحُ شكوى سائقٍ — حدُّ الطبقةِ قبلَ الشبكةِ", () => {
  it("صنفُ راكبٍ يُردُّ `CATEGORY_UNKNOWN` **ولا يُنادى المخزنُ**", async () => {
    const fake = store();
    const result = await open({ category: "lost_item" }, { store: fake });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CATEGORY_UNKNOWN");
    expect(fake.calls).toHaveLength(0);
  });

  it("«راكبٌ مسيءٌ» بلا رحلةٍ يُردُّ `ORDER_REQUIRED` — والقاعدةُ لا تُستَشارُ", async () => {
    const fake = store();
    const result = await open({ category: "rider_conduct", orderId: null }, { store: fake });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ORDER_REQUIRED");
    expect(fake.calls).toHaveLength(0);
  });

  it("«راكبٌ مسيءٌ» برحلةٍ تُقبَلُ ويُمرَّرُ معرّفُها كما جاءَ", async () => {
    const fake = store();
    const result = await open({ category: "rider_conduct", orderId: ORDER_ID }, { store: fake });
    expect(result.ok).toBe(true);
    expect(fake.calls[0]).toMatchObject({ category: "rider_conduct", orderId: ORDER_ID });
  });

  it("خصمٌ بلا رحلةٍ يُقبَلُ — فلا يُلزَمُ اعتراضٌ ماليٌّ برحلةٍ بعينِها", async () => {
    const result = await open({ category: "deduction", orderId: null });
    expect(result.ok).toBe(true);
  });

  it("نصٌّ فارغٌ أو أطولُ من الحدِّ يُردُّ — والحدُّ **بالمحارفِ** لا بالبايتاتِ", async () => {
    const empty = await open({ message: "   " });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("MESSAGE_EMPTY");

    // نصٌّ عربيٌّ بطولِ الحدِّ **يُقبَلُ** وإن كانَ ضِعفَه بالبايتاتِ.
    const atLimit = await open({ message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS) });
    expect(atLimit.ok).toBe(true);

    const tooLong = await open({ message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS + 1) });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("MESSAGE_TOO_LONG");
  });

  it("`NOT_A_DRIVER` من القاعدةِ يُقرأُ «أكمِلْ تسجيلَكَ» لا «انتهت جلستُكَ»", async () => {
    const result = await open({}, { store: rejectedStore("NOT_A_DRIVER") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_REGISTERED");
  });

  it("التهدئةُ تحملُ ثانيتَها كما جاءَت من القاعدةِ — لا تُحسَبُ ههنا", async () => {
    const result = await open({}, { store: rejectedStore("COOLDOWN_ACTIVE", 214) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("COOLDOWN_ACTIVE");
      expect(result.error.retryAfterSeconds).toBe(214);
    }
  });
});

describe("النواةُ واحدةٌ — والدورانِ لا يفترقُ جوابُهما فيما لا يخصُّ الدورَ", () => {
  const riderDeps = () => ({
    sessions: sessions(),
    now: () => NOW,
    store: store() as never,
  });
  const driverDeps = () => ({ sessions: sessions(), now: () => NOW, store: store() });

  it("حدٌّ خارجَ المدى يُردُّ بالرمزِ نفسِه في الدورَينِ", async () => {
    const asRider = await listRiderSupportTickets(riderDeps(), {
      accessToken: TOKEN,
      limit: 51,
      cursorCreatedAt: null,
      cursorId: null,
    });
    const asDriver = await listDriverSupportTickets(driverDeps(), {
      accessToken: TOKEN,
      limit: 51,
      cursorCreatedAt: null,
      cursorId: null,
    });
    expect(asRider.ok).toBe(false);
    expect(asDriver.ok).toBe(false);
    if (!asRider.ok && !asDriver.ok) expect(asDriver.error).toEqual(asRider.error);
  });

  it("مؤشِّرٌ نصفُه يُردُّ بالرمزِ نفسِه في الدورَينِ", async () => {
    const half = {
      accessToken: TOKEN,
      limit: null,
      cursorCreatedAt: NOW.toISOString(),
      cursorId: "",
    };
    const asRider = await listRiderSupportTickets(riderDeps(), half);
    const asDriver = await listDriverSupportTickets(driverDeps(), half);
    expect(asRider.ok).toBe(false);
    expect(asDriver.ok).toBe(false);
    if (!asRider.ok && !asDriver.ok) expect(asDriver.error).toEqual(asRider.error);
  });

  it("جلسةٌ غائبةٌ تُردُّ بالرمزِ نفسِه في الدورَينِ **ولا يُنادى مخزنٌ**", async () => {
    const riderStore = store();
    const driverStore = store();
    const asRider = await openRiderSupportTicket(
      { sessions: sessions(), now: () => NOW, store: riderStore as never },
      { accessToken: undefined, category: "other", message: "نصٌّ", orderId: null },
    );
    const asDriver = await openDriverSupportTicket(
      { sessions: sessions(), now: () => NOW, store: driverStore },
      { accessToken: undefined, category: "other", message: "نصٌّ", orderId: null },
    );
    expect(asRider.ok).toBe(false);
    expect(asDriver.ok).toBe(false);
    if (!asRider.ok && !asDriver.ok) expect(asDriver.error).toEqual(asRider.error);
    expect(riderStore.calls).toHaveLength(0);
    expect(driverStore.calls).toHaveLength(0);
  });

  it("صفحةُ السائقِ تُعادُ كما جاءَت من المخزنِ بلا نقصٍ", async () => {
    const result = await listDriverSupportTickets(driverDeps(), {
      accessToken: TOKEN,
      limit: null,
      cursorCreatedAt: null,
      cursorId: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(PAGE);
  });
});
