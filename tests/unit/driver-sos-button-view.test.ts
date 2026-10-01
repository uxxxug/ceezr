import { describe, expect, it } from "bun:test";
import {
  isSosButtonDisabled,
  type SosButtonState,
  sosStateKey,
} from "../../apps/miniapp/src/surfaces/driver/job/job-view.ts";

describe("sosStateKey", () => {
  it("يعودُ null لـ idle", () => {
    const state: SosButtonState = { kind: "idle" };
    expect(sosStateKey(state)).toBeNull();
  });

  it("يعودُ null لـ busy", () => {
    const state: SosButtonState = { kind: "busy" };
    expect(sosStateKey(state)).toBeNull();
  });

  it("يعودُ driver.job.sos.sent لـ sent + created=true", () => {
    const state: SosButtonState = { kind: "sent", created: true };
    expect(sosStateKey(state)).toBe("driver.job.sos.sent");
  });

  it("يعودُ driver.job.sos.alreadyOpen لـ sent + created=false", () => {
    const state: SosButtonState = { kind: "sent", created: false };
    expect(sosStateKey(state)).toBe("driver.job.sos.alreadyOpen");
  });

  it("يعودُ driver.job.sos.refused لـ refused", () => {
    const state: SosButtonState = { kind: "refused", refusal: "CITY_NOT_READY" };
    expect(sosStateKey(state)).toBe("driver.job.sos.refused");
  });

  it("يعودُ driver.job.sos.failed لـ failed", () => {
    const state: SosButtonState = { kind: "failed" };
    expect(sosStateKey(state)).toBe("driver.job.sos.failed");
  });
});

describe("isSosButtonDisabled", () => {
  it("يعودُ false لـ idle", () => {
    const state: SosButtonState = { kind: "idle" };
    expect(isSosButtonDisabled(state)).toBe(false);
  });

  it("يعودُ true لـ busy", () => {
    const state: SosButtonState = { kind: "busy" };
    expect(isSosButtonDisabled(state)).toBe(true);
  });

  it("يعودُ true لـ sent", () => {
    const state: SosButtonState = { kind: "sent", created: true };
    expect(isSosButtonDisabled(state)).toBe(true);
  });

  it("يعودُ false لـ refused", () => {
    const state: SosButtonState = { kind: "refused", refusal: "REJECTED" };
    expect(isSosButtonDisabled(state)).toBe(false);
  });

  it("يعودُ false لـ failed", () => {
    const state: SosButtonState = { kind: "failed" };
    expect(isSosButtonDisabled(state)).toBe(false);
  });
});
