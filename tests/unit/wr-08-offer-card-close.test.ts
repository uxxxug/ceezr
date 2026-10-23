/**
 * الغرض: `WR-08` (ADR 0271) — إغلاقُ بطاقةِ العرضِ الميّت: يُكتَبُ المآلُ بلغةِ السائقِ ويُعلَّمُ
 *   مغلقًا، والخطأُ العابرُ يُعدُّ محاولةً بلا تعليم، والنهائيُّ (لا يُعدَّل، أو حُجِبَ البوت)
 *   يُعلَّمُ مغلقًا، ولا يرمي شيءٌ منها. والمآلُ يُشتقُّ من حالتَي العرضِ والطلب.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  closeDeadOfferCards,
  type DeadOfferCard,
  isTerminalOfferCardError,
  type OfferCardOutcome,
} from "../../packages/application/dispatch/close-dead-offer-cards.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { offerCardOutcome } from "../../packages/infrastructure/dispatch/offer-card-adapters.ts";
import { OutboundCongestionError } from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "c-1" as CityId;

function card(id: string, outcome: OfferCardOutcome = "expired", lang = "ar"): DeadOfferCard {
  return { deliveryId: id, chatId: "9001", messageId: `m-${id}`, languageCode: lang, outcome };
}

function setup(cards: readonly DeadOfferCard[], failWith: Record<string, string> = {}) {
  const closed: string[] = [];
  const attempts: string[] = [];
  const edits: { chatId: string; messageId: string; text: string }[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  let asked: { limit: number; maxAttempts: number } | null = null;
  const deps = {
    cards: {
      listDead: async (_city: CityId, limit: number, maxAttempts: number) => {
        asked = { limit, maxAttempts };
        return ok(cards);
      },
      markClosed: async (id: string) => {
        closed.push(id);
        return ok(undefined);
      },
      markAttemptFailed: async (id: string) => {
        attempts.push(id);
        return ok(undefined);
      },
    },
    edit: async (chatId: string, messageId: string, text: string) => {
      const failure = failWith[messageId.slice(2)];
      if (failure !== undefined) throw new Error(failure);
      edits.push({ chatId, messageId, text });
    },
    text: (outcome: OfferCardOutcome, lang: string) => `${lang}:${outcome}`,
    log: (event: string, meta: Record<string, unknown>) => logs.push({ event, meta }),
  };
  return { deps, closed, attempts, edits, logs, asked: () => asked };
}

describe("WR-08 — إغلاقُ بطاقةِ العرضِ الميّت", () => {
  test("يكتبُ المآلَ بلغةِ السائقِ على رسالتِه ثمَّ يعلّمُها، بالحدَّين الافتراضيَّين", async () => {
    const s = setup([card("a", "expired"), card("b", "taken", "en"), card("c", "cancelled")]);
    const r = await closeDeadOfferCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 3, failed: 0 });
    expect(s.edits).toEqual([
      { chatId: "9001", messageId: "m-a", text: "ar:expired" },
      { chatId: "9001", messageId: "m-b", text: "en:taken" },
      { chatId: "9001", messageId: "m-c", text: "ar:cancelled" },
    ]);
    expect(s.closed).toEqual(["a", "b", "c"]);
    expect(s.asked()).toEqual({ limit: 20, maxAttempts: 5 });
  });

  test("الخطأُ العابرُ يُعدُّ محاولةً ولا يعلّم، والباقي يمضي", async () => {
    const s = setup([card("a"), card("b")], { a: "Too Many Requests: retry after 3" });
    const r = await closeDeadOfferCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 1, failed: 1 });
    expect(s.attempts).toEqual(["a"]);
    expect(s.closed).toEqual(["b"]);
    expect(s.logs.find((l) => l.event === "offer_card.close_failed")?.meta).toEqual({
      delivery_id: "a",
      outcome: "expired",
      error: "Error",
    });
  });

  test("الخطأُ النهائيُّ يعلّمُ مغلقًا: لم يتغيّر النصّ، أو حُذفت، أو حُجبَ البوت", async () => {
    const s = setup([card("a"), card("b"), card("c")], {
      a: "Bad Request: message is not modified",
      b: "Bad Request: message to edit not found",
      c: "Forbidden: bot was blocked by the user",
    });
    const r = await closeDeadOfferCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 3, failed: 0 });
    expect(s.attempts).toEqual([]);
    expect(
      s.logs
        .filter((l) => l.meta.terminal_error === "TELEGRAM_TERMINAL")
        .map((l) => l.meta.delivery_id),
    ).toEqual(["a", "b", "c"]);
  });

  test("السجلُّ بلا معرّفِ محادثةٍ ولا رسالةٍ ولا نصّ", async () => {
    const s = setup([card("a")]);
    await closeDeadOfferCards(CITY, s.deps);
    const text = JSON.stringify(s.logs);
    expect(text).not.toContain("9001");
    expect(text).not.toContain("m-a");
  });

  test("عطلُ القراءةِ يُعادُ خطأً ولا يرمي", async () => {
    const s = setup([]);
    const deps = {
      ...s.deps,
      cards: {
        ...s.deps.cards,
        listDead: async () => err(new PortFailureError("offers.listDeadOfferCards", "down")),
      },
    };
    const r = await closeDeadOfferCards(CITY, deps);
    expect(r.ok).toBe(false);
  });

  test("المآلُ: الإلغاءُ يغلب، ثمَّ إسنادُ غيرِه، ثمَّ انتهاءُ المهلة", () => {
    expect(
      offerCardOutcome({
        offer_status: "cancelled",
        order_status: "searching",
        taken_by_other: false,
      }),
    ).toBe("cancelled");
    expect(
      offerCardOutcome({
        offer_status: "expired",
        order_status: "cancelled",
        taken_by_other: false,
      }),
    ).toBe("cancelled");
    expect(
      offerCardOutcome({ offer_status: "expired", order_status: "matched", taken_by_other: true }),
    ).toBe("taken");
    expect(
      offerCardOutcome({
        offer_status: "expired",
        order_status: "searching",
        taken_by_other: false,
      }),
    ).toBe("expired");
  });

  test("نصّا «انتهى» و«سُبِق» هما نصّا النقرةِ نفسُهما، ونصُّ الإلغاءِ في اللغاتِ الثلاث", () => {
    for (const lang of ["ar", "en", "ur"]) {
      expect(translate(lang, "driver.offer_card_cancelled")).not.toBe(
        "driver.offer_card_cancelled",
      );
    }
    expect(translate("ar", "driver.offer_expired")).toBe("انتهت مهلة هذا الطلب.");
    expect(isTerminalOfferCardError("Bad Request: chat not found")).toBe(true);
    expect(isTerminalOfferCardError("Internal Server Error")).toBe(false);
  });
  test("ازدحامُ دلوِ الإرسالِ (D8) لا يستهلكُ محاولةَ البطاقةِ — تُعادُ كاملةً المحاولاتِ في الشوطِ القادمِ", async () => {
    const s = setup([card("a"), card("b")]);
    const congest = new OutboundCongestionError(2000);
    s.deps.edit = async () => {
      throw congest;
    };
    const r = await closeDeadOfferCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 0, failed: 2 });
    // صفرُ محاولاتٍ مستهلكةٍ: البطاقاتُ لم تُعلَّمْ فاشلةً فتبقى قابلةً للإغلاقِ
    // مهما تكرّرَ الازدحامُ (لا تُتركُ أزرارُ «قبول/رفض» بعدَ خمسِ دوراتٍ).
    expect(s.attempts).toEqual([]);
    expect(s.closed).toEqual([]);
    expect(s.logs.filter((l) => l.event === "offer_card.close_congested").length).toBe(2);
  });

  test("البطاقةُ المزدحمةُ ستَّ دوراتٍ تبقى قابلةً للإغلاقِ وتُغلقُ بعدَ زوالِ الازدحامِ", async () => {
    // ميناءُ بطاقاتٍ حقيقيُّ الدلالةِ: listDead يستبعدُ ما استنفدَ محاولاتِه الخمسَ.
    const attempts = new Map<string, number>();
    let congested = true;
    const closed: string[] = [];
    const edits: string[] = [];
    const deps = {
      cards: {
        listDead: async (_city: CityId, _limit: number, maxAttempts: number) =>
          ok(cards.filter((c) => (attempts.get(c.deliveryId) ?? 0) < maxAttempts)),
        markClosed: async (id: string) => {
          closed.push(id);
          return ok(undefined);
        },
        markAttemptFailed: async (id: string) => {
          attempts.set(id, (attempts.get(id) ?? 0) + 1);
          return ok(undefined);
        },
      },
      edit: async (_chatId: string, messageId: string) => {
        if (congested) throw new OutboundCongestionError(2000);
        edits.push(messageId);
      },
      text: (outcome: OfferCardOutcome, lang: string) => `${lang}:${outcome}`,
      log: () => {},
    };
    const cards = [card("a"), card("b")];

    // ستُّ دوراتِ ازدحامٍ (فوقَ سقفِ المحاولاتِ الخمسِ): لا استهلاكَ ولا فقدانَ.
    for (let round = 0; round < 6; round += 1) {
      const r = await closeDeadOfferCards(CITY, deps);
      expect(r.ok && r.value).toEqual({ closed: 0, failed: 2 });
      expect(attempts.size).toBe(0);
    }
    // زوالُ الازدحامِ: البطاقاتُ ما زالت مختارةً وتُغلقُ في الشوطِ التالي.
    congested = false;
    const r = await closeDeadOfferCards(CITY, deps);
    expect(r.ok && r.value).toEqual({ closed: 2, failed: 0 });
    expect(closed).toEqual(["a", "b"]);
    expect(edits).toEqual(["m-a", "m-b"]);
  });

  test("فشلُ الإرسالِ الحقيقيِّ (429) يستهلكُ المحاولةَ كما كان — الازدحامُ وحدهُ المستثنى", async () => {
    const s = setup([card("a")], { a: "Too Many Requests: retry after 3" });
    const r = await closeDeadOfferCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 0, failed: 1 });
    expect(s.attempts).toEqual(["a"]);
  });
});
