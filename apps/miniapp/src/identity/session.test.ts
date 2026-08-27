import { describe, expect, test, beforeEach } from "bun:test";
import {
  clearSession,
  getSession,
  hasValidSession,
  setSession,
  type WaslahSession,
} from "./session.ts";

const sample: WaslahSession = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresAt: Date.now() + 60_000,
  role: "rider",
};

beforeEach(() => {
  clearSession();
});

describe("Waslah session holder (F1-01)", () => {
  test("starts empty", () => {
    expect(getSession()).toBeNull();
    expect(hasValidSession()).toBe(false);
  });

  test("accepts a session issued by the server", () => {
    setSession(sample);
    expect(getSession()?.accessToken).toBe("access");
    expect(hasValidSession()).toBe(true);
  });

  test("rejects expired session", () => {
    setSession({ ...sample, expiresAt: Date.now() - 1 });
    expect(hasValidSession()).toBe(false);
  });

  test("clear removes holder only", () => {
    setSession(sample);
    clearSession();
    expect(getSession()).toBeNull();
  });
});
