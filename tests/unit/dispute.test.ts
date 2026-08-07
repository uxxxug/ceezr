/**
 * الغرض: اختبار قرارات وحدة dispute النقية: قبول نصّ الشكوى، وما يُسمح على التذكرة.
 * الحالة: منفّذ فعلياً — المرحلة 2.4.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: بوابة CI
 * ملاحظات مستقبلية: أي قاعدة قرار جديدة على التذكرة تُختبر هنا لا في اختبار تكاملي بطيء.
 */

import { describe, expect, test } from "bun:test";
import {
  availableActions,
  canClaim,
  canResolve,
  comparePriority,
  isSettled,
  isSupportResolution,
  isSupportTicketType,
  parseAttachmentId,
  parseSupportMessage,
  type SupportTicket,
} from "../../packages/domain/dispute/index.ts";

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    type: "subscription",
    status: "open",
    cityName: "جدة",
    message: "حوّلت المبلغ ولم يُفعَّل الاشتراك",
    attachmentFileId: null,
    orderId: null,
    createdAt: new Date("2026-08-07T10:00:00Z"),
    owner: {
      fullName: "أحمد العمري",
      phone: "+966500000000",
      telegramId: "900001",
      telegramUsername: null,
      languageCode: "ar",
    },
    subscription: null,
    ...overrides,
  };
}

describe("نصّ الشكوى", () => {
  test("يرفض ما دون الحدّ الأدنى ويميّز السبب", () => {
    const result = parseSupportMessage("مشكلة");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("too_short");
  });

  test("يرفض الأمر ويميّزه عن النصّ القصير — لأن الردّ عليهما مختلف", () => {
    const result = parseSupportMessage("/subscription");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("is_command");
  });

  test("يرفض ما يتجاوز حدّ الرسالة الواحدة", () => {
    const result = parseSupportMessage("أ".repeat(3001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("too_long");
  });

  test("يقصّ الفراغات ولا يغيّر حرفاً من نصّ المستخدم", () => {
    const raw = "  حوّلت 250 ريال ولم يصل التفعيل  ";
    const result = parseSupportMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("حوّلت 250 ريال ولم يصل التفعيل");
  });

  test("الفراغات وحدها لا تصنع شكوى", () => {
    expect(parseSupportMessage("          ").ok).toBe(false);
  });
});

describe("معرّف المرفق", () => {
  test("الفارغ والمعدوم كلاهما لا مرفق", () => {
    expect(parseAttachmentId(null)).toBeNull();
    expect(parseAttachmentId(undefined)).toBeNull();
    expect(parseAttachmentId("   ")).toBeNull();
  });

  test("يمرَّر كما هو بلا تفسير لبنيته", () => {
    expect(parseAttachmentId(" AgACAgQAAxkBAAI = ")).toBe("AgACAgQAAxkBAAI =");
  });
});

describe("حرّاس الأنواع", () => {
  test("لا يقبلان قيمة خارج المجال", () => {
    expect(isSupportTicketType("subscription")).toBe(true);
    expect(isSupportTicketType("refund")).toBe(false);
    expect(isSupportResolution("terminate")).toBe(true);
    expect(isSupportResolution("nuke")).toBe(false);
  });
});

describe("ما يُسمح على التذكرة", () => {
  test("المحسومة لا تُستلم ولا يُتصرَّف فيها", () => {
    expect(isSettled("resolved")).toBe(true);
    expect(isSettled("rejected")).toBe(true);
    expect(canClaim("claimed")).toBe(false);
    expect(canResolve(ticket({ status: "resolved" }), "reject")).toBe(false);
  });

  test("الرفض ممكن على كل تذكرة غير محسومة — هو إقفال لا تصرّف في اشتراك", () => {
    expect(canResolve(ticket({ type: "ride_dispute", subscription: null }), "reject")).toBe(true);
  });

  test("تذكرة نزاع بلا اشتراك لا تُعرض عليها أزرار الاشتراك", () => {
    const actions = availableActions(ticket({ type: "ride_dispute", subscription: null }));
    expect(actions).toEqual(["claim", "reject"]);
  });

  test("تذكرة اشتراك باشتراك فعّال تعرض التفعيل والإنهاء معاً", () => {
    const actions = availableActions(
      ticket({
        subscription: {
          plan: "transport",
          status: "active",
          currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
          trialEndsAt: null,
          isLive: true,
        },
      }),
    );
    expect(actions).toEqual(["claim", "activate", "terminate", "reject"]);
  });

  test("المستلَمة لا يُعرض عليها زرّ الاستلام مرة أخرى", () => {
    expect(availableActions(ticket({ status: "claimed" }))).toEqual(["activate", "reject"]);
  });

  test("المحسومة بلا أزرار إطلاقاً — الزرّ الذي لا يعمل أسوأ من غيابه", () => {
    expect(availableActions(ticket({ status: "resolved" }))).toEqual([]);
  });
});

describe("ترتيب الأولوية", () => {
  test("المفتوحة قبل المستلَمة، والأقدم قبل الأحدث", () => {
    const older = ticket({ id: "a", createdAt: new Date("2026-08-07T09:00:00Z") });
    const newer = ticket({ id: "b", createdAt: new Date("2026-08-07T11:00:00Z") });
    const claimed = ticket({
      id: "c",
      status: "claimed",
      createdAt: new Date("2026-08-07T08:00:00Z"),
    });
    const sorted = [newer, claimed, older].sort(comparePriority).map((entry) => entry.id);
    expect(sorted).toEqual(["a", "b", "c"]);
  });
});
