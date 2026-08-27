import { afterEach, describe, expect, test } from "bun:test";
import {
  capabilityReport,
  compareVersions,
  hasCapability,
  isVersionAtLeast,
  resolveCapability,
  TG_CAPABILITY_MIN_VERSION,
} from "./capabilities.ts";
import { installFakeHost, removeFakeHost } from "./test-host.ts";

afterEach(() => {
  removeFakeHost();
});

describe("dotted version comparison", () => {
  test("compares numerically, not lexically", () => {
    expect(compareVersions("7.10", "7.9")).toBeGreaterThan(0);
    expect(compareVersions("6.9", "6.10")).toBeLessThan(0);
    expect(compareVersions("8.0", "8")).toBe(0);
    expect(compareVersions("9.0", "9.0")).toBe(0);
  });

  test("treats unparsable segments as zero instead of throwing", () => {
    expect(compareVersions("x.y", "0.0")).toBe(0);
  });
});

describe("version gate against the host", () => {
  test("false with no Telegram at all", () => {
    removeFakeHost();
    expect(isVersionAtLeast("6.0")).toBe(false);
  });

  test("uses the host's own isVersionAtLeast when present", () => {
    installFakeHost({}, "7.2");
    expect(isVersionAtLeast("7.2")).toBe(true);
    expect(isVersionAtLeast("7.10")).toBe(false);
  });

  test("falls back to the version string when the host has no checker", () => {
    installFakeHost({ isVersionAtLeast: undefined }, "6.4");
    expect(isVersionAtLeast("6.4")).toBe(true);
    expect(isVersionAtLeast("6.9")).toBe(false);
  });
});

describe("capability = version AND presence", () => {
  test("an old client blocks a newer capability even when the member exists", () => {
    // The fake exposes SecondaryButton, but the client reports 6.9.
    installFakeHost({}, "6.9");
    expect(TG_CAPABILITY_MIN_VERSION.secondaryButton).toBe("7.10");
    expect(hasCapability("secondaryButton")).toBe(false);
    const gate = resolveCapability("secondaryButton");
    expect(gate.host).toBeNull();
    expect(gate.host === null ? gate.reason : "").toBe("unsupported-version");
  });

  test("a new client without the member reports missing-api", () => {
    installFakeHost({ BiometricManager: undefined }, "9.0");
    expect(hasCapability("biometrics")).toBe(false);
    const gate = resolveCapability("biometrics");
    expect(gate.host === null ? gate.reason : "").toBe("missing-api");
  });

  test("no Telegram reports no-telegram, never a throw", () => {
    removeFakeHost();
    expect(hasCapability("mainButton")).toBe(false);
    const gate = resolveCapability("mainButton");
    expect(gate.host === null ? gate.reason : "").toBe("no-telegram");
  });

  test("a capability present and permitted resolves the host", () => {
    installFakeHost({}, "9.0");
    expect(hasCapability("mainButton")).toBe(true);
    expect(resolveCapability("mainButton").host).not.toBeNull();
  });

  test("every capability is false outside Telegram", () => {
    removeFakeHost();
    expect(Object.values(capabilityReport()).some((value) => value)).toBe(false);
  });

  test("the report carries no user data", () => {
    installFakeHost({}, "9.0");
    const report = capabilityReport();
    for (const value of Object.values(report)) expect(typeof value).toBe("boolean");
    expect(JSON.stringify(report)).not.toContain("hash");
  });
});
