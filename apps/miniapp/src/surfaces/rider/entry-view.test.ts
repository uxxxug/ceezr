import { describe, expect, it } from "bun:test";
import { isDefaultRiderEntry, riderEntryState } from "./entry-view.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("riderEntryState (ADR 0213)", () => {
  it("ride_<id> ⇒ متابعةُ الرحلةِ نفسِها", () => {
    expect(riderEntryState(`ride_${ID}`).followed).toBe(ID);
  });
  it("summary_<id> ⇒ ملخّصُها", () => {
    expect(riderEntryState(`summary_${ID}`).summarized).toBe(ID);
  });
  it("history · support · account · notifications", () => {
    expect(riderEntryState("history").browsed).toBe(true);
    expect(riderEntryState("support").support).toEqual({ orderId: null });
    expect(riderEntryState("account").account).toBe(true);
    expect(riderEntryState("notifications").notificationsOpen).toBe(true);
  });
  it("لا هدفَ أو هدفُ سائقٍ ⇒ الرئيسةُ", () => {
    const home = riderEntryState(null);
    expect(riderEntryState(`offer_${ID}`)).toEqual(home);
    expect(Object.values(home).every((v) => v === null || v === false)).toBe(true);
  });
});

/**
 * `WR-29` (ADR 0303): حكمُ «هبوطاً بلا هدفٍ صريحٍ» هو ما يُوجِبُ متابعةَ الرحلةِ
 * الجاريةِ عندَ الدخولِ الافتراضيِّ — فلا يُتبِعُ الراكبَ رحلةً لم يطلُبها، ولا
 * يفقدُ رحلتَهُ حينَ لم يطلب شيئاً.
 */
describe("isDefaultRiderEntry (WR-29)", () => {
  it("الفتحُ بلا وصلةٍ ⇒ هبوطٌ افتراضيٌّ", () => {
    expect(isDefaultRiderEntry(riderEntryState(null))).toBe(true);
    expect(isDefaultRiderEntry(riderEntryState(undefined))).toBe(true);
    expect(isDefaultRiderEntry(riderEntryState(""))).toBe(true);
  });
  it("كلُّ هدفٍ صريحٍ يُلغي الافتراضيَّ", () => {
    expect(isDefaultRiderEntry(riderEntryState(`ride_${ID}`))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState(`summary_${ID}`))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState("history"))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState("notifications"))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState("account"))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState("support"))).toBe(false);
    expect(isDefaultRiderEntry(riderEntryState("sos"))).toBe(false);
  });
  it("هدفُ سائقٍ لا يخصُّ الراكبَ ⇒ هبوطٌ افتراضيٌّ كما في `riderEntryState`", () => {
    expect(isDefaultRiderEntry(riderEntryState(`offer_${ID}`))).toBe(true);
  });
});
