/**
 * الغرض: زرُّ «افتح وَصْلة» المُلحَقُ عند المُرسِلِ — الخاصُّ وحدَه، ولا زرّانِ (`ADR 0213`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import {
  withEntryButton,
  withMiniAppEntry,
} from "../../packages/infrastructure/notification/miniapp-entry-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import { toTelegramMarkup } from "../../packages/infrastructure/notification/telegram-markup.ts";

const ENTRY = { text: "📱 وَصْلة", web_app: { url: "https://app.example.com/" } };

describe("withEntryButton", () => {
  it("رسالةٌ خاصّةٌ بلا لوحةٍ ⇒ زرٌّ واحدٌ", () => {
    expect(withEntryButton("12345", undefined, ENTRY)).toEqual({ inline_keyboard: [[ENTRY]] });
  });

  it("لوحةُ inline قائمةٌ ⇒ يُلحَقُ صفٌّ ولا تُمسُّ أزرارُها", () => {
    const markup = { inline_keyboard: [[{ text: "قبول", callback_data: "offer:accept:1" }]] };
    expect(withEntryButton("12345", markup, ENTRY)).toEqual({
      inline_keyboard: [[{ text: "قبول", callback_data: "offer:accept:1" }], [ENTRY]],
    });
  });

  it("لوحةٌ فيها زرُّ تطبيقٍ ⇒ لا زرّانِ", () => {
    const markup = {
      inline_keyboard: [
        [{ text: "افتح العرض", web_app: { url: "https://app.example.com/?open=offers" } }],
      ],
    };
    expect(withEntryButton("12345", markup, ENTRY)).toBe(markup);
  });

  it("القروبُ (معرّفٌ سالبٌ) لا يُمسُّ", () => {
    expect(withEntryButton("-100123", undefined, ENTRY)).toBeUndefined();
  });

  it("لوحةُ الردِّ (طلبُ موقعٍ أو رقمٍ) لا تُمسُّ", () => {
    const reply = { keyboard: [[{ text: "📍", request_location: true }]], resize_keyboard: true };
    expect(withEntryButton("12345", reply, ENTRY)).toBe(reply);
    const removal = { remove_keyboard: true };
    expect(withEntryButton("12345", removal, ENTRY)).toBe(removal);
  });

  it("الغلافُ يمرِّرُ الرسالةَ ولوحتَها المعدّلةَ إلى المُرسِلِ الأصليِّ", async () => {
    const seen: unknown[] = [];
    const base: TelegramSender = {
      sendMessage: async (_chat, _text, markup) => {
        seen.push(markup);
        return "1";
      },
      sendPhoto: async (_chat, _file, _caption, markup) => {
        seen.push(markup);
        return "2";
      },
      sendLocation: async () => "3",
    };
    const wrapped = withMiniAppEntry(base, {
      miniAppUrl: "https://app.example.com/",
      label: "📱 وَصْلة",
    });
    await wrapped.sendMessage("42", "مرحبا", undefined);
    await wrapped.sendPhoto("-1001", "file", "cap", undefined);
    expect(seen).toEqual([{ inline_keyboard: [[ENTRY]] }, undefined]);
  });
});

describe("toTelegramMarkup: زرُّ web_app", () => {
  it("زرُّ التطبيقِ يصيرُ web_app لا callback_data", () => {
    expect(
      toTelegramMarkup({
        kind: "inline",
        rows: [
          [{ label: "افتح", webAppUrl: "https://app.example.com/?open=history" }],
          [{ label: "قبول", data: "offer:accept:1" }],
        ],
      }),
    ).toEqual({
      inline_keyboard: [
        [{ text: "افتح", web_app: { url: "https://app.example.com/?open=history" } }],
        [{ text: "قبول", callback_data: "offer:accept:1" }],
      ],
    });
  });
});
