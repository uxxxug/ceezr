import { afterEach, describe, expect, test } from "bun:test";
import {
  installFakeDocument,
  installFakeHost,
  removeFakeDocument,
  removeFakeHost,
} from "./test-host.ts";
import {
  applyThemeFromTelegram,
  describeInitData,
  getHostInfo,
  getRawInitData,
  isInsideTelegram,
} from "./webapp.ts";

afterEach(() => {
  removeFakeHost();
  removeFakeDocument();
});

describe("host detection", () => {
  test("outside Telegram nothing is claimed and nothing throws", () => {
    removeFakeHost();
    expect(isInsideTelegram()).toBe(false);
    expect(getRawInitData()).toBeNull();
    expect(getHostInfo()).toBeNull();
    expect(describeInitData()).toEqual({ present: false, length: 0, keys: [] });
    expect(() => applyThemeFromTelegram()).not.toThrow();
  });

  test("an empty initData is not treated as being inside Telegram", () => {
    installFakeHost({ initData: "" });
    expect(isInsideTelegram()).toBe(false);
    expect(getRawInitData()).toBeNull();
  });

  test("host info exposes version and platform only", () => {
    installFakeHost({}, "8.0");
    expect(getHostInfo()).toEqual({ version: "8.0", platform: "tdesktop", colorScheme: "light" });
  });
});

describe("initData is treated as a credential", () => {
  test("describeInitData returns key names, never values or the hash", () => {
    const host = installFakeHost();
    const described = describeInitData();
    expect(described.present).toBe(true);
    expect(described.keys).toEqual(["auth_date", "hash", "user"]);
    expect(described.length).toBe(host.webApp.initData.length);
    const serialized = JSON.stringify(described);
    expect(serialized).not.toContain("abc"); // the hash value
    expect(serialized).not.toContain("%7B"); // the encoded user object
    expect(serialized).not.toContain('"id"');
  });

  test("the raw string is returned only for the server to verify", () => {
    installFakeHost();
    expect(getRawInitData()).toContain("hash=");
  });
});

describe("theme application", () => {
  test("writes CSS variables and version-gates the color setters", () => {
    const written = installFakeDocument();
    const host = installFakeHost(
      { themeParams: { bg_color: "#101010", bottom_bar_bg_color: "#202020" } },
      "7.10",
    );

    applyThemeFromTelegram();

    expect(written.get("--tg-bg-color")).toBe("#101010");
    expect(written.get("--tg-bottom-bar-bg-color")).toBe("#202020");
    expect(host.names()).toContain("ready");
    expect(host.names()).toContain("expand");
    expect(host.names()).toContain("setBackgroundColor");
    expect(host.names()).toContain("setBottomBarColor");
  });

  test("an old client gets no call it cannot answer", () => {
    installFakeDocument();
    const host = installFakeHost(
      { themeParams: { bg_color: "#101010", bottom_bar_bg_color: "#202020" } },
      "6.0",
    );

    applyThemeFromTelegram();

    expect(host.names()).toContain("ready");
    expect(host.names()).not.toContain("setBackgroundColor");
    expect(host.names()).not.toContain("setBottomBarColor");
  });
});
