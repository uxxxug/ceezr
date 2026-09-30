/**
 * الغرض: قياسُ أمرِ `/flag` — تعليمُ التقييمِ المسيءِ من قروبِ الدعمِ (`F16-01`):
 *   الاستعمالُ، والنجاحُ، وترجمةُ أسبابِ الرفضِ، وعطلُ المنفذِ، وغيابُهُ. الحوارُ
 *   يُترجِمُ — والحكمُ في القاعدةِ (`is_support_actor`) مقيسٌ في التكاملِ لا هنا.
 * الحالة: منفَّذٌ فعليّاً — البند `F16-01`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: CI (الوظيفة `verify`)
 * الحاكم: docs/adr/0218-activate-declared-future-modules-as-items.md
 */

import { describe, expect, it } from "bun:test";
import {
  handleFlagRatingCommand,
  type SupportDialogDependencies,
} from "../../packages/application/bots/support-dialog.ts";
import type { DialogState, Sender } from "../../packages/application/bots/types.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { RatingFlagPort } from "../../packages/application/reputation/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const GROUP_SENDER: Sender = { telegramUserId: "950", chatId: "-1001234", languageHint: "ar" };
const STATE: DialogState = { step: "idle", language: "ar" } as DialogState;
const RATING_ID = "1b2c3d4e-5f60-4a1b-8c2d-9e0f1a2b3c4d";

function flags(outcome: RatingFlagPort["flag"]): RatingFlagPort {
  return { flag: outcome };
}

function deps(port: RatingFlagPort | undefined): SupportDialogDependencies {
  return {
    sessions: {
      load: async () => ok(null) as never,
      save: async () => ok(null) as never,
      clear: async () => undefined,
    },
    open: {} as never,
    card: {} as never,
    claims: {} as never,
    resolutions: {} as never,
    ...(port === undefined ? {} : { flags: port }),
  } as unknown as SupportDialogDependencies;
}

describe("/flag — تعليم التقييم المسيء من قروب الدعم", () => {
  it("بلا معرّف: رسالة استعمال لا عطل", async () => {
    const replies = await handleFlagRatingCommand(
      "/flag",
      GROUP_SENDER,
      STATE,
      deps(flags(async () => ok({ ok: true, reason: null }))),
    );
    expect(replies[0]?.text).toBe(ar("support.flag_usage"));
    expect(replies[0]?.chatId).toBe(GROUP_SENDER.chatId);
  });

  it("النجاح: إعلانٌ للقروبِ بمَن علَّمَ لا بأيِّ تقييمٍ", async () => {
    const replies = await handleFlagRatingCommand(
      `/flag ${RATING_ID}`,
      GROUP_SENDER,
      STATE,
      deps(flags(async () => ok({ ok: true, reason: null }))),
    );
    expect(replies[0]?.chatId).toBe(GROUP_SENDER.chatId);
    expect(replies[0]?.text).toBe(ar("support.flag_done", { rating: RATING_ID.slice(0, 8) }));
  });

  it("معلَّم سابقًا أو لا وجود: خاصةٌ لا قروبٌ — ولا استكشافُ أيّهما", async () => {
    const replies = await handleFlagRatingCommand(
      `/flag ${RATING_ID}`,
      GROUP_SENDER,
      STATE,
      deps(flags(async () => ok({ ok: false, reason: "RATING_NOT_FLAGGABLE" }))),
    );
    expect(replies[0]?.chatId).toBe(GROUP_SENDER.telegramUserId);
    expect(replies[0]?.text).toBe(ar("support.flag_not_flaggable"));
  });

  it("غير المخوَّل: خاصةٌ كما أخواتُه من أزرار القروب", async () => {
    const replies = await handleFlagRatingCommand(
      `/flag ${RATING_ID}`,
      GROUP_SENDER,
      STATE,
      deps(flags(async () => ok({ ok: false, reason: "ACTOR_NOT_AUTHORIZED" }))),
    );
    expect(replies[0]?.chatId).toBe(GROUP_SENDER.telegramUserId);
    expect(replies[0]?.text).toBe(ar("support.not_authorized"));
  });

  it("عطل المنفذ: عطل فني موحَّد", async () => {
    const replies = await handleFlagRatingCommand(
      `/flag ${RATING_ID}`,
      GROUP_SENDER,
      STATE,
      deps(flags(async () => err(new PortFailureError("flag_rating", "db")))),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("غياب المنفذ: أمر غير معروف — الحاوية غير المجهَّزة لا تَعِدُ", async () => {
    const replies = await handleFlagRatingCommand(
      `/flag ${RATING_ID}`,
      GROUP_SENDER,
      STATE,
      deps(undefined),
    );
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});
