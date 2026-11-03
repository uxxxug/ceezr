/**
 * الغرض: WR-35 — صياغةُ رسالةِ انتهاءِ التجربةِ بالرابطِ وبدونِه، بثلاثِ لغات،
 *   وحارسُ شكلِ الرابطِ في طبقةِ التطبيقِ، وعدُّ ما خرجَ بلا رابطٍ في ملخّصِ الشوط.
 * الحالة: اختبارُ وحدةٍ — بلا قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `noticeText` أو مفاتيحِ
 *   `driver.notice_group_*`.
 * ملاحظات مستقبلية: القياسُ على قاعدةٍ حقيقيّةٍ في
 *   `tests/integration/wr-35-unsubscribed-group-links.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  deliverSubscriptionNotices,
  noticeText,
  usableGroupLink,
} from "../../packages/application/subscription/deliver-notices.ts";
import type {
  SubscriptionNotice,
  SubscriptionNoticePayload,
} from "../../packages/application/subscription/notice-ports.ts";
import { ok } from "../../packages/shared/result/index.ts";

const JED = "https://t.me/ODD_Jeddah_drivers";

function notice(
  payload: SubscriptionNoticePayload,
  languageCode = "ar",
  kind: SubscriptionNotice["kind"] = "trial_expired",
): SubscriptionNotice {
  return {
    noticeId: "n-1",
    kind,
    claimToken: "t-1",
    chatId: "1001",
    languageCode,
    payload: { ends_at: "2026-11-01T10:00:00Z", plan: "transport", ...payload },
    attempts: 1,
    maxAttempts: 5,
  };
}

const withLink: SubscriptionNoticePayload = {
  group_link: JED,
  group_link_status: "ok",
  city_name_ar: "جدة",
  city_name_en: "Jeddah",
};

describe("WR-35 — نصُّ انتهاءِ التجربةِ برابطِ قروبِ المدينة", () => {
  it("العربيّة: الرابطُ واسمُ المدينةِ وأنّ القروبَ لسائقيها، ونفيُ إعادةِ التجربةِ أو التفعيل", () => {
    const text = noticeText(notice(withLink));
    expect(text).toContain(JED);
    expect(text).toContain("قروب سائقي جدة غير المشتركين");
    expect(text).toContain("مخصّص لسائقي هذه المدينة");
    expect(text).toContain("لا يعيد الفترة المجانية ولا يفعّل اشتراكاً");
    expect(text).toContain("2026-11-01");
    expect(text).not.toContain("{city}");
    expect(text).not.toContain("{link}");
  });

  it("الإنجليزيّة والأرديّة: الرابطُ والنفيُ الصريح", () => {
    const en = noticeText(notice(withLink, "en"));
    expect(en).toContain(JED);
    expect(en).toContain("group for Jeddah");
    expect(en).toContain("does not restore your free trial or activate a subscription");
    const ur = noticeText(notice(withLink, "ur"));
    expect(ur).toContain(JED);
    expect(ur).toContain("جدة");
    expect(ur).toContain("مفت آزمائشی مدت واپس نہیں ملتی");
  });

  it("بلا رابطٍ: إحالةٌ إلى /support بثلاثِ لغاتٍ ولا t.me", () => {
    for (const lang of ["ar", "en", "ur"]) {
      const text = noticeText(
        notice({ group_link: "", group_link_status: "missing", city_name_ar: "جدة" }, lang),
      );
      expect(text).toContain("/support");
      expect(text).not.toContain("t.me");
      expect(text).not.toContain("{city}");
    }
  });

  it("غيابُ اسمِ المدينةِ يقرأ «مدينتك» لا قالبًا فارغًا", () => {
    expect(noticeText(notice({ group_link: JED }))).toContain("قروب سائقي مدينتك");
    expect(noticeText(notice({ group_link: JED }, "en"))).toContain("group for your city");
  });

  it("حارسُ الشكلِ: لا يُرسَلُ إلا رابطُ t.me سليمٌ وحالتُه ok", () => {
    expect(usableGroupLink(notice(withLink))).toBe(JED);
    expect(usableGroupLink(notice({ group_link: "https://t.me/+AbCdEfGh123" }))).toBe(
      "https://t.me/+AbCdEfGh123",
    );
    for (const bad of [
      "",
      "   ",
      "http://t.me/ODD_Jeddah_drivers",
      "https://evil.example/ODD_Jeddah_drivers",
      "https://t.me.evil.example/x",
      "https://t.me/ab",
      "https://t.me/ODD_Jeddah_drivers?start=x",
      "-1003",
    ]) {
      expect(usableGroupLink(notice({ group_link: bad }))).toBeNull();
    }
    expect(usableGroupLink(notice({ group_link: JED, group_link_status: "invalid" }))).toBeNull();
    expect(
      usableGroupLink(notice({ group_link: JED, group_link_status: "driver_not_verified" })),
    ).toBeNull();
  });

  it("التفعيلُ لا يحملُ قروبًا، والشوطُ يعدُّ إشعاراتِ النهايةِ الخارجةَ بلا رابط", async () => {
    expect(noticeText(notice(withLink, "ar", "activated"))).not.toContain(JED);
    const batch: SubscriptionNotice[] = [
      notice(withLink),
      { ...notice({ group_link: "", group_link_status: "missing" }), noticeId: "n-2" },
      { ...notice({}, "ar", "activated"), noticeId: "n-3" },
    ];
    const result = await deliverSubscriptionNotices("city", {
      notices: {
        claim: async () => ok(batch),
        finish: async () => ok(true),
      },
      publisher: { publish: async () => ok({ messageId: "1" }) },
    });
    if (!result.ok) throw new Error("فشل الشوط");
    expect(result.value.sent).toBe(3);
    expect(result.value.withoutGroupLink).toBe(1);
  });
});
