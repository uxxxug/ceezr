import { describe, expect, it } from "bun:test";
import { readEntryTarget } from "./entry-target.ts";

describe("readEntryTarget (ADR 0213)", () => {
  it("يقرأ open من الاستعلام", () => {
    expect(readEntryTarget("?open=history")).toBe("history");
    expect(readEntryTarget("?x=1&open=offer_abc")).toBe("offer_abc");
  });
  it("لا معامل ⇒ null", () => {
    expect(readEntryTarget("")).toBeNull();
    expect(readEntryTarget(undefined)).toBeNull();
    expect(readEntryTarget("?open=")).toBeNull();
  });
});
