/**
 * اختباراتُ توليدِ `initData` المُوقَّعةِ للقياسِ.
 * الحالة: اختبارٌ وحدويٌّ — لا متصفّحَ ولا بوّابةَ.
 */

import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import {
  signFreshInitData,
  signInitData,
  type TestTelegramUser,
} from "../../scripts/lib/telegram-test-init-data.ts";

const BOT_TOKEN = "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const USER: TestTelegramUser = {
  id: 123,
  first_name: "Test",
  username: "test_user",
  language_code: "ar",
};

describe("توليدُ initData المُوقَّعة", () => {
  it("الـhash يطابقُ بروتوكولَ تيليجرامَ الرسميَّ", () => {
    const { raw, hash } = signInitData(BOT_TOKEN, USER);

    // أعد بناءَ الـhash يدويًّا للتحقّق.
    const params = new URLSearchParams(raw);
    const pairs = [...params.entries()]
      .filter(([key]) => key !== "hash")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    const dataCheckString = pairs.join("\n");

    const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    expect(hash).toBe(expected);
  });

  it("الـraw يحتوي على hash وuser وauth_date", () => {
    const { raw } = signInitData(BOT_TOKEN, USER);
    const params = new URLSearchParams(raw);
    expect(params.has("hash")).toBe(true);
    expect(params.has("user")).toBe(true);
    expect(params.has("auth_date")).toBe(true);
    expect(params.has("query_id")).toBe(true);
  });

  it("كلُّ توليدٍ يُنتِجُ query_id وauth_date مختلفين (تفادي SEC-17)", () => {
    const results = signFreshInitData(BOT_TOKEN, USER, 3);
    expect(results).toHaveLength(3);
    const hashes = results.map((r) => r.hash);
    expect(new Set(hashes).size).toBe(3);
    const queryIds = results.map((r) => new URLSearchParams(r.raw).get("query_id"));
    expect(new Set(queryIds).size).toBe(3);
  });

  it("الحقولُ الاختياريّةُ تُضافُ عندَ وجودِها", () => {
    const { raw } = signInitData(BOT_TOKEN, { ...USER, last_name: "Last" });
    const user = JSON.parse(new URLSearchParams(raw).get("user") ?? "{}");
    expect(user.last_name).toBe("Last");
  });

  it("الحقولُ الاختياريّةُ لا تُضافُ عندَ غيابِها", () => {
    const { raw } = signInitData(BOT_TOKEN, { id: 1, first_name: "X" });
    const user = JSON.parse(new URLSearchParams(raw).get("user") ?? "{}");
    expect(user.last_name).toBeUndefined();
    expect(user.username).toBeUndefined();
  });
});
