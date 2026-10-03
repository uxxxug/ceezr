/**
 * الغرض: `ORDER-OFFER-01` — «المدفوع» على بطاقةِ السائقِ: ما يكتبُه الراكبُ بنفسِه بالريالِ، أو
 *   «قابل للتفاوض» إن تركَه. يُثبتُ: قراءةَ الحقلِ في التطبيقِ (ومعه الأرقامُ العربيّةُ)، وحارسَ
 *   البوّابةِ، وترتيبَ السطورِ في البطاقةِ كعيّنةِ المالكِ، وأنّ المسارَ القديمَ بلا سطرٍ.
 * الحالة: اختبارُ وحدةٍ بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { offerSarFrom } from "../../apps/miniapp/src/surfaces/rider/quote/quote-view.ts";
import { readOfferSar } from "../../packages/application/transport/request-ride.ts";
import { t } from "../../packages/shared/i18n/index.ts";
import { orderTermsLines } from "../../packages/shared/order-terms/index.ts";

const ar = t("ar");

describe("ORDER-OFFER-01 — حقلُ المبلغِ في التطبيقِ", () => {
  it("الفارغُ «قابلٌ للتفاوض» لا خطأ", () => {
    expect(offerSarFrom("")).toEqual({ ok: true, value: null });
    expect(offerSarFrom("   ")).toEqual({ ok: true, value: null });
  });

  it("يقرأُ الأرقامَ الغربيّةَ والعربيّةَ الهنديّةَ والفارسيّةَ", () => {
    expect(offerSarFrom("40")).toEqual({ ok: true, value: 40 });
    expect(offerSarFrom("٤٠")).toEqual({ ok: true, value: 40 });
    expect(offerSarFrom("۴۰")).toEqual({ ok: true, value: 40 });
  });

  it("يرفضُ الصفرَ والكسورَ والنصَّ وما فوقَ السقفِ", () => {
    for (const raw of ["0", "12.5", "أربعون", "-5", "10001", "40 ريال"]) {
      expect(offerSarFrom(raw).ok).toBe(false);
    }
  });
});

describe("ORDER-OFFER-01 — حارسُ البوّابةِ", () => {
  it("يقبلُ الصحيحَ في الحدودِ عدداً أو نصّاً، وما سواه null بلا رفضٍ للطلب", () => {
    expect(readOfferSar(40)).toBe(40);
    expect(readOfferSar("40")).toBe(40);
    expect(readOfferSar(10_000)).toBe(10_000);
    for (const bad of [0, -1, 10_001, 12.5, "abc", null, undefined, {}, [], Number.NaN]) {
      expect(readOfferSar(bad)).toBeNull();
    }
  });
});

describe("ORDER-OFFER-01 — سطورُ البطاقةِ", () => {
  const at = new Date("2026-10-03T10:30:00.000Z"); // 1:30 م بتوقيتِ الرياض

  it("عيّنةُ المالكِ: «المدفوع: 40 ريال» ثمَّ وقتُ الحضورِ", () => {
    const lines = orderTermsLines(ar, "transport", { pickupAt: at, parcel: null, offerSar: 40 });
    expect(lines[0]).toBe(ar("driver.offer_card_paid", { amount: 40 }));
    expect(lines[0]).toContain("40 ريال");
    expect(lines[1]).toContain("1:30");
    expect(lines.length).toBe(2);
  });

  it("بلا مبلغٍ: «المدفوع: قابل للتفاوض»، وفي التوصيلِ يتبعُه نوعُ الطرد", () => {
    const lines = orderTermsLines(ar, "delivery", {
      pickupAt: null,
      parcel: "مستندات",
      offerSar: null,
    });
    expect(lines[0]).toBe(ar("driver.offer_card_paid_negotiable"));
    expect(lines[0]).toContain("قابل للتفاوض");
    expect(lines[1]).toBe(ar("driver.offer_card_pickup_now"));
    expect(lines[2]).toBe(ar("driver.offer_card_parcel", { parcel: "مستندات" }));
  });

  it("المسارُ الذي لم يقرأ العمودَ (`undefined`) يبقى بلا سطرِ مبلغٍ كما كان", () => {
    const lines = orderTermsLines(ar, "transport", { pickupAt: null, parcel: null });
    expect(lines).toEqual([ar("driver.offer_card_pickup_now")]);
  });
});

describe("MSG-AUDIT-02 — رمزُ العملةِ بلغةِ الرسالة", () => {
  it("«SAR» يُقرأُ «ريال» في العربيّةِ ويبقى في الإنجليزيّة، وما لا مفتاحَ له يبقى حرفاً", () => {
    expect(
      ar("driver.notice_activated", { plan: "نقل", price: 150, currency: "SAR", until: "x" }),
    ).toContain("150 ريال");
    expect(
      t("en")("driver.notice_activated", { plan: "x", price: 150, currency: "SAR", until: "x" }),
    ).toContain("150 SAR");
    expect(
      ar("driver.notice_activated", { plan: "x", price: 5, currency: "USD", until: "x" }),
    ).toContain("5 USD");
  });
});
