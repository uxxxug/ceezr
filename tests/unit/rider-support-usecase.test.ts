/**
 * الغرض: قياسُ حالتَي استعمالِ الدعمِ — فتحُ شكوى وقراءةُ تذاكري: بوّابةُ
 *   الجلسةِ، وحدُّ المحارفِ لا البايتاتِ، وشرطُ الطلبِ في الأصنافِ التي لا معنى
 *   لها بلا رحلةٍ، وترجمةُ رفضِ القاعدةِ **شاملةً حرفاً** (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` (دعمُ السائقِ) إذ يمرُّ بالبوّابةِ نفسِها.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا تُقاسُ **شمولُ الترجمةِ** ههنا بالذاتِ
 *
 * لأنَّ رمزاً لا تُترجِمُه هذه الطبقةُ يمرُّ خاماً إلى شاشةٍ يقرأُها إنسانٌ
 * يشكو. و`switch` المُستنفَدُ يحمي في زمنِ البناءِ من **رمزٍ يُنسى**، ولا يحميْ
 * من **رمزٍ يُترجَمُ خطأً**: أن يُقالَ لصاحبِ حسابٍ لم يُنشَأْ بعدُ «انتهت
 * جلستُكَ» فيُعيدَ الدخولَ عشرَ مرّاتٍ ولا يُنشَأُ صفُّه أبداً. فالمقيسُ ههنا
 * أنَّ كلَّ سببٍ يقعُ في خانتِه — لا أنَّه لا يسقطُ فقط.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا تُقاسُ ذرّيّةُ التهدئةِ ولا تفرُّدُ المرجعِ**: ذاكَ حكمُ القاعدةِ،
 *    وموضعُه `tests/integration/rider-support-intake.test.ts`.
 * ــ **لا تُقاسُ رموزُ HTTP**: تلكَ خريطةُ البوّابةِ، ومقيسةٌ في التكاملِ.
 */

import { describe, expect, it } from "bun:test";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import type {
  RiderSupportStore,
  SupportStoreRejection,
} from "../../packages/application/support/ports.ts";
import {
  listRiderSupportTickets,
  openRiderSupportTicket,
  RIDER_SUPPORT_PUBLIC_ERROR_CODES,
  type RiderSupportPublicErrorCode,
} from "../../packages/application/support/rider-support.ts";
import { MAX_SUPPORT_MESSAGE_CHARS } from "../../packages/domain/support/rider-support.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const NOW = new Date("2027-04-02T10:00:00.000Z");
const TOKEN = "session-token";
const TELEGRAM_ID = "7770001";
const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

function sessions(
  outcome: Result<{ telegramUserId: string }, { reason: string }> = ok({
    telegramUserId: TELEGRAM_ID,
  }),
): MiniAppSessionReader {
  return {
    read: () => outcome as unknown as ReturnType<MiniAppSessionReader["read"]>,
  } as MiniAppSessionReader;
}

const OPENED = {
  ticketId: "9a1b2c3d-4e5f-4a1b-8c2d-3e4f5a6b7c8d",
  reference: "WSL-000123",
  category: "app_problem",
} as const;

const PAGE = {
  tickets: [],
  nextCursor: null,
  expectedResponseMinutes: 120,
} as const;

/** مخزنٌ مصنوعٌ: يُجيبُ بما يُطلَبُ منه ويسجِّلُ ما استُدعِيَ به. */
function store(
  overrides: Partial<RiderSupportStore> = {},
): RiderSupportStore & { readonly calls: unknown[] } {
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
  } as RiderSupportStore & { readonly calls: unknown[] };
}

function rejected(rejection: SupportStoreRejection, retryAfterSeconds: number | null = null) {
  return err({ rejection, retryAfterSeconds } as never);
}

async function open(
  input: Partial<{
    accessToken: string | undefined;
    category: unknown;
    message: unknown;
    orderId: unknown;
  }>,
  deps: Partial<{ sessions: MiniAppSessionReader; store: RiderSupportStore }> = {},
) {
  return openRiderSupportTicket(
    {
      sessions: deps.sessions ?? sessions(),
      store: deps.store ?? store(),
      now: () => NOW,
    },
    {
      accessToken: TOKEN,
      category: "app_problem",
      message: "التطبيقُ لا يفتحُ خريطتَه",
      orderId: null,
      ...input,
    },
  );
}

describe("فتحُ شكوى — بوّابةُ الجلسةِ", () => {
  it("بلا رمزٍ: يُطلَبُ الدخولُ ولا يُلمَسُ المخزنُ", async () => {
    const backing = store();
    const result = await open({ accessToken: undefined }, { store: backing });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_REQUIRED");
    expect(backing.calls.length).toBe(0);
  });

  it("جلسةٌ منتهيةٌ ⇒ SESSION_EXPIRED وجلسةٌ فاسدةٌ ⇒ SESSION_INVALID", async () => {
    const expired = await open({}, { sessions: sessions(err({ reason: "EXPIRED" })) });
    const invalid = await open({}, { sessions: sessions(err({ reason: "BAD_SIGNATURE" })) });
    const missing = await open({}, { sessions: sessions(err({ reason: "NOT_CONFIGURED" })) });
    expect(expired.ok === false && expired.error.code).toBe("SESSION_EXPIRED");
    expect(invalid.ok === false && invalid.error.code).toBe("SESSION_INVALID");
    expect(missing.ok === false && missing.error.code).toBe("SESSION_NOT_AVAILABLE");
  });
});

describe("فتحُ شكوى — صحّةُ المدخلِ", () => {
  it("صنفٌ مجهولٌ يُردُّ قبلَ القاعدةِ", async () => {
    const result = await open({ category: "ufo" });
    expect(result.ok === false && result.error.code).toBe("CATEGORY_UNKNOWN");
  });

  it("رسالةٌ من فراغاتٍ رسالةٌ فارغةٌ", async () => {
    const result = await open({ message: "   \n\t  " });
    expect(result.ok === false && result.error.code).toBe("MESSAGE_EMPTY");
  });

  it("الحدُّ **بالمحارفِ**: ألفُ حرفٍ عربيٍّ تمرُّ وألفٌ وواحدٌ تُردُّ", async () => {
    const pass = await open({ message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS) });
    const fail = await open({ message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS + 1) });
    expect(pass.ok).toBe(true);
    expect(fail.ok === false && fail.error.code).toBe("MESSAGE_TOO_LONG");
  });

  it("معرّفُ طلبٍ ليسَ uuid يُردُّ ههنا لا في المُحرِّكِ", async () => {
    const backing = store();
    const result = await open({ orderId: "42" }, { store: backing });
    expect(result.ok === false && result.error.code).toBe("ORDER_INVALID");
    expect(backing.calls.length).toBe(0);
  });

  it("صنفٌ لا معنى له بلا رحلةٍ يُلزِمُ الطلبَ", async () => {
    const result = await open({ category: "lost_item", orderId: null });
    expect(result.ok === false && result.error.code).toBe("ORDER_REQUIRED");
    const withOrder = await open({ category: "lost_item", orderId: ORDER_ID });
    expect(withOrder.ok).toBe(true);
  });

  it("الرسالةُ تُقلَّمُ قبلَ الكتابةِ والمرجعُ يُعادُ كما وردَ", async () => {
    const backing = store();
    const result = await open({ message: "  فقدتُ حافظتي  " }, { store: backing });
    expect(result.ok && result.value.reference).toBe("WSL-000123");
    expect((backing.calls[0] as { message: string }).message).toBe("فقدتُ حافظتي");
  });
});

describe("فتحُ شكوى — ترجمةُ رفضِ القاعدةِ", () => {
  const cases: readonly (readonly [SupportStoreRejection, RiderSupportPublicErrorCode])[] = [
    ["MESSAGE_EMPTY", "MESSAGE_EMPTY"],
    ["USER_NOT_FOUND", "NOT_REGISTERED"],
    ["NOT_REGISTERED", "NOT_REGISTERED"],
    ["NOT_A_RIDER", "NOT_REGISTERED"],
    ["NOT_A_DRIVER", "NOT_REGISTERED"],
    ["USER_BLOCKED", "ACCOUNT_BLOCKED"],
    ["CITY_GROUP_MISSING", "CITY_NOT_READY"],
    ["COOLDOWN_ACTIVE", "COOLDOWN_ACTIVE"],
    ["ORDER_NOT_YOURS", "ORDER_NOT_YOURS"],
    ["LIMIT_OUT_OF_RANGE", "LIMIT_OUT_OF_RANGE"],
    ["CURSOR_INCOMPLETE", "CURSOR_INVALID"],
  ];

  for (const [rejection, expected] of cases) {
    it(`«${rejection}» ⇒ «${expected}»`, async () => {
      const result = await open(
        {},
        { store: store({ openTicket: async () => rejected(rejection) }) },
      );
      expect(result.ok === false && result.error.code).toBe(expected);
    });
  }

  it("التهدئةُ **وحدَها** تحملُ ثانيةً — والباقي بلا وعدٍ زمنيٍّ", async () => {
    const cooling = await open(
      {},
      { store: store({ openTicket: async () => rejected("COOLDOWN_ACTIVE", 240) }) },
    );
    expect(cooling.ok === false && cooling.error.retryAfterSeconds).toBe(240);
    const blocked = await open(
      {},
      { store: store({ openTicket: async () => rejected("USER_BLOCKED", 99) }) },
    );
    expect(blocked.ok === false && blocked.error.retryAfterSeconds).toBe(null);
  });

  it("عطلٌ غيرُ محكومٍ ⇒ SUPPORT_STORE_NOT_AVAILABLE لا رمزٌ خامٌ", async () => {
    const result = await open(
      {},
      {
        store: store({
          openTicket: async () => err({ kind: "PORT_FAILURE", message: "boom" } as never),
        }),
      },
    );
    expect(result.ok === false && result.error.code).toBe("SUPPORT_STORE_NOT_AVAILABLE");
  });
});

describe("قراءةُ تذاكري — الحدُّ والمؤشِّرُ", () => {
  async function list(
    input: Partial<{
      accessToken: string | undefined;
      limit: unknown;
      cursorCreatedAt: unknown;
      cursorId: unknown;
    }>,
    backing: RiderSupportStore = store(),
  ) {
    return listRiderSupportTickets(
      { sessions: sessions(), store: backing, now: () => NOW },
      { accessToken: TOKEN, limit: null, cursorCreatedAt: null, cursorId: null, ...input },
    );
  }

  it("بلا حدٍّ: يُستعمَلُ الافتراضُ عشرونَ", async () => {
    const backing = store();
    const result = await list({}, backing);
    expect(result.ok).toBe(true);
    expect((backing as unknown as { calls: { limit: number }[] }).calls[0]?.limit).toBe(20);
  });

  it("حدٌّ فوقَ الخمسينَ **يُردُّ ولا يُقصَرُ صامتاً**", async () => {
    const backing = store();
    const result = await list({ limit: 100 }, backing);
    expect(result.ok === false && result.error.code).toBe("LIMIT_OUT_OF_RANGE");
    expect((backing as unknown as { calls: unknown[] }).calls.length).toBe(0);
  });

  it("حدٌّ كسريٌّ أو صفرٌ أو نصٌّ غيرُ رقمٍ يُردُّ", async () => {
    for (const limit of [0, -1, 2.5, "many"]) {
      const result = await list({ limit });
      expect(result.ok === false && result.error.code).toBe("LIMIT_OUT_OF_RANGE");
    }
  });

  it("شطرُ مؤشِّرٍ بلا شطرٍ ليسَ مؤشِّراً", async () => {
    const half = await list({ cursorCreatedAt: NOW.toISOString(), cursorId: null });
    expect(half.ok === false && half.error.code).toBe("CURSOR_INVALID");
    const other = await list({ cursorCreatedAt: null, cursorId: ORDER_ID });
    expect(other.ok === false && other.error.code).toBe("CURSOR_INVALID");
  });

  it("مؤشِّرٌ بتاريخٍ فاسدٍ أو معرّفٍ ليسَ uuid يُردُّ", async () => {
    const badDate = await list({ cursorCreatedAt: "أمسِ", cursorId: ORDER_ID });
    expect(badDate.ok === false && badDate.error.code).toBe("CURSOR_INVALID");
    const badId = await list({ cursorCreatedAt: NOW.toISOString(), cursorId: "7" });
    expect(badId.ok === false && badId.error.code).toBe("CURSOR_INVALID");
  });

  it("مؤشِّرٌ كاملٌ يُمرَّرُ كما هوَ إلى المخزنِ", async () => {
    const backing = store();
    const result = await list(
      { cursorCreatedAt: NOW.toISOString(), cursorId: ORDER_ID, limit: 5 },
      backing,
    );
    expect(result.ok).toBe(true);
    expect((backing as unknown as { calls: Record<string, unknown>[] }).calls[0]).toEqual({
      telegramUserId: TELEGRAM_ID,
      limit: 5,
      cursor: { createdAt: NOW.toISOString(), id: ORDER_ID },
    });
  });
});

describe("مجالُ الرموزِ المنشورةِ", () => {
  it("لا رمزَ مكرَّرٌ ولا رمزَ فارغٌ", () => {
    const codes = [...RIDER_SUPPORT_PUBLIC_ERROR_CODES];
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code.length > 0)).toBe(true);
  });
});
