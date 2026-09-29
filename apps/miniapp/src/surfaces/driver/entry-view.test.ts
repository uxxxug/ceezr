import { describe, expect, it } from "bun:test";
import { driverEntryView } from "./entry-view.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("driverEntryView (ADR 0213)", () => {
  it("offer_<id> ⇒ تفاصيلُ العرضِ نفسِه", () => {
    expect(driverEntryView(`offer_${ID}`)).toEqual({ kind: "offer", offerId: ID });
  });
  it("الشاشاتُ البسيطةُ تُفتَحُ باسمِها", () => {
    for (const kind of ["job", "subscription", "support", "documents", "vehicle", "account"]) {
      expect(driverEntryView(kind)).toEqual({ kind } as never);
    }
  });
  it("لا هدفَ أو هدفُ راكبٍ ⇒ لوحُ العروضِ", () => {
    expect(driverEntryView(null)).toEqual({ kind: "offers" });
    expect(driverEntryView("history")).toEqual({ kind: "offers" });
    expect(driverEntryView(`ride_${ID}`)).toEqual({ kind: "offers" });
  });
});
