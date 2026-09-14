/**
 * الغرض: قياسُ نموذجِ عرضِ الدعمِ — سقوطُ الرمزِ المجهولِ إلى نصٍّ مفهومٍ،
 *   ونغمةُ الشارةِ، وحرسُ الزرِّ، وعدُّ المتبقّي بالمحارفِ (البند `F2-12` · `SR-11`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-12`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * يُتوقع أن يستخدمه لاحقاً: `SD-10` لو شارَكَ السائقُ النموذجَ.
 * الحاكم: docs/adr/0114-a-support-ticket-is-a-spoken-reference-not-a-uuid.md
 *
 * ## لماذا يُقاسُ **السقوطُ** قبلَ المعروفِ
 *
 * لأنَّ النسخةَ الحاضرةَ في هاتفِ إنسانٍ **أقدمُ من الخادمِ دائماً**: التطبيقُ
 * المُصغَّرُ يُحمَّلُ مخزوناً، والخادمُ يُنشَرُ كلَّ يومٍ. فأوّلُ رمزٍ جديدٍ
 * يصلُ شاشةً لا تعرفُه، وشاشةٌ بلا سقوطٍ تعرضُ فراغاً — في اللحظةِ التي يشكو
 * فيها. **فالسقوطُ ليسَ حالةً حدّيّةً بل الحالةَ المتوقّعةَ.**
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ وجودُ النصوصِ**: ذاكَ حكمُ `check-support-intake-contract.ts`
 *    الذي يقرأُ القواميسَ الثلاثةَ — ولا يُكرَّرُ سؤالٌ في موضعَينِ.
 * ــ **لا تُقاسُ الشاشةُ نفسُها**: لا مُصيِّرَ DOM في هذه الحزمةِ، والسلوكُ
 *    المرئيُّ دَينٌ مُعلَنٌ على اختبارِ سطحٍ لاحقٍ.
 */

import { describe, expect, it } from "bun:test";
import type { ApiSupportTicket } from "../../apps/miniapp/src/surfaces/rider/support/support-contract.ts";
import {
  canSubmit,
  categoryKey,
  isRetryableSupportError,
  MAX_SUPPORT_MESSAGE_CHARS,
  remainingChars,
  statusKey,
  statusTone,
  supportErrorKey,
  toTicketRow,
} from "../../apps/miniapp/src/surfaces/rider/support/support-view.ts";
import { RIDER_SUPPORT_PUBLIC_ERROR_CODES } from "../../packages/application/support/rider-support.ts";
import { SUPPORT_TICKET_STATUSES } from "../../packages/domain/support/rider-support.ts";

function ticket(overrides: Partial<ApiSupportTicket> = {}): ApiSupportTicket {
  return {
    id: "9a1b2c3d-4e5f-4a1b-8c2d-3e4f5a6b7c8d",
    reference: "WSL-000123",
    category: "app_problem",
    status: "open",
    message: "الخريطةُ لا تفتحُ",
    resolution: null,
    orderId: null,
    createdAt: "2027-04-02T10:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("مفتاحُ العطبِ", () => {
  it("**كلُّ رمزٍ ينشرُه التطبيقُ له مفتاحٌ خاصٌّ به** لا سقوطٌ", () => {
    for (const code of RIDER_SUPPORT_PUBLIC_ERROR_CODES) {
      expect(supportErrorKey(code)).toBe(`rider.support.error.${code}`);
    }
  });

  it("رمزٌ لا تعرفُه هذه النسخةُ يسقطُ إلى نصٍّ مفهومٍ", () => {
    expect(supportErrorKey("SUPPORT_MOOD_UNCLEAR")).toBe("rider.support.error.UNKNOWN");
    expect(supportErrorKey("")).toBe("rider.support.error.UNKNOWN");
  });

  it("القابلُ للإعادةِ عطلٌ لا حكمٌ — والحكمُ لا يُعادُ", () => {
    expect(isRetryableSupportError("SUPPORT_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableSupportError("UNKNOWN")).toBe(true);
    expect(isRetryableSupportError("CITY_NOT_READY")).toBe(true);
    for (const code of [
      "ACCOUNT_BLOCKED",
      "MESSAGE_TOO_LONG",
      "ORDER_NOT_YOURS",
      "COOLDOWN_ACTIVE",
    ]) {
      expect(isRetryableSupportError(code)).toBe(false);
    }
  });
});

describe("مفاتيحُ الصنفِ والحالةِ", () => {
  it("`subscription` تُقرأُ ولا تسقطُ إلى «غيرِ معروفٍ»", () => {
    expect(categoryKey("subscription")).toBe("rider.support.category.subscription");
  });

  it("صنفٌ مختلقٌ يسقطُ", () => {
    expect(categoryKey("ufo")).toBe("rider.support.category.unknown");
  });

  it("كلُّ حالةٍ ينشرُها النطاقُ لها مفتاحُها", () => {
    for (const status of SUPPORT_TICKET_STATUSES) {
      expect(statusKey(status)).toBe(`rider.support.status.${status}`);
    }
    expect(statusKey("archived")).toBe("rider.support.status.unknown");
  });
});

describe("نغمةُ الشارةِ", () => {
  it("لكلِّ حالةٍ نغمتُها ولا حالةَ بلا نغمةٍ", () => {
    expect(statusTone("open")).toBe("open");
    expect(statusTone("claimed")).toBe("working");
    expect(statusTone("resolved")).toBe("done");
    expect(statusTone("rejected")).toBe("refused");
  });

  it("حالةٌ مجهولةٌ تُعطى نغمةَ «مفتوحةٍ» — **الأحوطُ أن تُنتظَرَ لا أن تُشطَبَ**", () => {
    expect(statusTone("archived")).toBe("open");
  });
});

describe("صفُّ التذكرةِ", () => {
  it("لا معرّفَ طلبٍ خاماً على الشاشةِ بل وجودُه أو غيابُه", () => {
    const withOrder = toTicketRow(ticket({ orderId: "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f" }));
    expect(withOrder.hasOrder).toBe(true);
    expect(JSON.stringify(withOrder)).not.toContain("3f1c9a02");
    expect(toTicketRow(ticket()).hasOrder).toBe(false);
  });

  it("المرجعُ يُنقَلُ كما وردَ — لا تقصيرَ ولا تجميلَ", () => {
    expect(toTicketRow(ticket({ reference: "WSL-004242" })).reference).toBe("WSL-004242");
  });

  it("قرارُ الحلِّ `null` غيابٌ لا نصٌّ فارغٌ", () => {
    expect(toTicketRow(ticket()).resolution).toBe(null);
    expect(toTicketRow(ticket({ resolution: "أُعيدَ المبلغُ" })).resolution).toBe("أُعيدَ المبلغُ");
  });

  it("الصفُّ مفاتيحُ لا نصوصٌ", () => {
    const row = toTicketRow(ticket({ status: "claimed", category: "lost_item" }));
    expect(row.categoryKey).toBe("rider.support.category.lost_item");
    expect(row.statusKey).toBe("rider.support.status.claimed");
    expect(row.statusTone).toBe("working");
  });
});

describe("حرسُ الزرِّ", () => {
  const base = {
    category: "app_problem" as const,
    message: "الخريطةُ لا تفتحُ",
    orderId: null,
    busy: false,
  };

  it("النموذجُ التامُّ يُرسَلُ", () => {
    expect(canSubmit(base)).toBe(true);
  });

  it("لا صنفَ ⇒ لا إرسالَ", () => {
    expect(canSubmit({ ...base, category: null })).toBe(false);
  });

  it("رسالةٌ من فراغاتٍ ⇒ لا إرسالَ", () => {
    expect(canSubmit({ ...base, message: "   \n " })).toBe(false);
  });

  it("فوقَ الحدِّ ⇒ لا إرسالَ، وعندَه بالضبطِ ⇒ يُرسَلُ", () => {
    expect(canSubmit({ ...base, message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS) })).toBe(true);
    expect(canSubmit({ ...base, message: "ش".repeat(MAX_SUPPORT_MESSAGE_CHARS + 1) })).toBe(false);
  });

  it("صنفٌ لا معنى له بلا رحلةٍ ⇒ لا إرسالَ حتّى تُختارَ", () => {
    expect(canSubmit({ ...base, category: "lost_item", orderId: null })).toBe(false);
    expect(canSubmit({ ...base, category: "lost_item", orderId: "x" })).toBe(true);
  });

  it("وأثناءَ الإرسالِ لا إرسالَ ثانٍ — التهدئةُ خمسُ دقائقَ ونقرةٌ مزدوجةٌ تُحرِقُها", () => {
    expect(canSubmit({ ...base, busy: true })).toBe(false);
  });
});

describe("عدُّ المتبقّي", () => {
  it("يُعَدُّ بالمحارفِ لا بالبايتاتِ — والعربيّةُ لا تُعاقَبُ", () => {
    expect(remainingChars("شش")).toBe(MAX_SUPPORT_MESSAGE_CHARS - 2);
    expect(remainingChars("ab")).toBe(MAX_SUPPORT_MESSAGE_CHARS - 2);
  });

  it("لا رقمَ سالبَ على شاشةٍ", () => {
    expect(remainingChars("ش".repeat(MAX_SUPPORT_MESSAGE_CHARS + 50))).toBe(0);
  });
});
