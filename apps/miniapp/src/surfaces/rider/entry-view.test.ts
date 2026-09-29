import { describe, expect, it } from "bun:test";
import { riderEntryState } from "./entry-view.ts";

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
