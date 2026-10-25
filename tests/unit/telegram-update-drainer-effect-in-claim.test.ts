/**
 * الغرض: LOAD-01 · C1 (2026-10-25) — حاجزُ «فحصِ الأثرِ داخلَ الالتقاطِ». بعدَ هجرةِ
 *   `20261025140000` تُعيدُ دوالُّ التقاطِ وظائفِ تحديثِ تيليجرام قيمةَ `effect_recorded`
 *   لكلِّ وظيفةٍ ملتقَطة، فيستغني `processDurably` عن نداءِ `ledger.effectRecorded`
 *   المنفصلِ — حجزُ مقعدِ مجمّعِ `gatewayRequest` واحدٌ أقلُّ لكلِّ وظيفةٍ (الخريطةُ المُقاسةُ:
 *   4.15–4.21 حجزًا لكلِّ وظيفةٍ، `docs/evidence/capacity/LOAD01-POOL-ACQ-20261025/RESULT.md`).
 *
 *   الحالاتُ الثلاثُ (تصميمُ C1):
 *   (أ) وظيفةٌ ملتقَطةٌ بحقلٍ `effectRecorded: true` ⇒ لا نداءَ للفحصِ ولا تحضيرَ للردِّ،
 *       ويُختَمُ الأثرُ مُعادًا (`recordEffect` بالإجاباتِ الفارغةِ) كما كانَ مسارُ الإعادةِ.
 *   (ب) وظيفةٌ ملتقَطةٌ بحقلٍ `effectRecorded: false` ⇒ لا نداءَ للفحصِ كذلكَ (القيمةُ قُرئت في
 *       معاملةِ الالتقاطِ)، ويُحضَّرُ الردُّ ويُختمُ الأثرُ بالإجاباتِ المُحضَّرة.
 *   (ج) وظيفةٌ بلا حقلٍ (قاعدةٌ قبلَ الهجرة، أو طابورٌ وهميّ) ⇒ نداءُ الفحصِ كما كان —
 *       فالشيفرةُ تحتملُ المخطَّطَ القديمَ والجديدَ معًا.
 *
 *   والتكافؤُ الدلاليُّ (لماذا لا يخدعُ حقلُ الالتقاط): الكاتبُ الوحيدُ لعمودِ
 *   `effect_recorded_at` هو `record_telegram_update_effect` ويشترطُ رمزَ إيجارٍ حيًّا،
 *   فلا يتغيّرُ العمودُ ما دامَ الإيجارُ لنا، وعندَ انقضائِه يقرأُه الملتقطُ التالي
 *   بقيمةٍ طازجة. البرهانُ الحيُّ على قاعدةٍ حقيقيةٍ في اختباراتِ التكاملِ
 *   (`tests/integration/telegram-update-claim-effect-in-claim.test.ts`).
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateEffectLedger,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

interface HarnessState {
  effectChecks: number;
  prepares: number;
  replayStamps: number;
  preparedStamps: number;
  done: boolean;
}

/** بناءُ الحالةِ والمُشغِّلِ معًا كي يُقاسَ ما جرى فعلًا بعدَ الجريان. */
function runnable(job: ClaimedTelegramUpdateJob) {
  const state: HarnessState = {
    effectChecks: 0,
    prepares: 0,
    replayStamps: 0,
    preparedStamps: 0,
    done: false,
  };
  const ledger: TelegramUpdateEffectLedger = {
    effectRecorded: async () => {
      state.effectChecks += 1;
      return false;
    },
    recordEffect: async (_lease, replies) => {
      if (replies.length === 0) state.replayStamps += 1;
      else state.preparedStamps += 1;
      return { ok: true, first: true, replyToken: null };
    },
    finishReplies: async () => "done",
    claimReplies: async () => [],
  };
  let remaining = 1;
  const queue = {
    claim: async () => ({ job: remaining-- > 0 ? job : null }),
    finish: async () => {
      state.done = true;
      return true;
    },
    abandon: async () => true,
    ledger,
  } as unknown as TelegramUpdateQueue;
  const handler = {
    handle: async () => true,
    prepare: async () => {
      state.prepares += 1;
      return { handled: true, replies: [{ text: "r" }] };
    },
    deliver: async () => ({ sent: 1, error: null }),
  };
  return { state, run: () => drainTelegramUpdateJobsOnce({ queue, handler }) };
}

function jobOf(effectRecorded?: boolean): ClaimedTelegramUpdateJob {
  return {
    bot: "driver",
    updateId: 42,
    payload: { update_id: 42, message: { from: { id: 7 } } },
    claimToken: "t42",
    attempts: 1,
    maxAttempts: 5,
    ...(effectRecorded === undefined ? {} : { effectRecorded }),
  };
}

describe("LOAD-01 · C1 — فحصُ الأثرِ داخلَ الالتقاط", () => {
  test("(أ) حقلٌ صادقٌ ⇒ لا فحصَ منفصلًا ولا تحضيرَ، وختمُ إعادةٍ بالإجاباتِ الفارغة", async () => {
    const { state, run } = runnable(jobOf(true));
    const r = await run();
    expect(r).toEqual({ claimed: 1, done: 1, failed: 0, truncated: false });
    expect(state.effectChecks).toBe(0);
    expect(state.prepares).toBe(0);
    expect(state.replayStamps).toBe(1);
    expect(state.preparedStamps).toBe(0);
    // الوظيفةُ تُختَمُ داخلَ `recordEffect` نفسِهِ (معاملةٌ واحدة) لا عبرَ `queue.finish`.
  });

  test("(ب) حقلٌ كاذبٌ ⇒ لا فحصَ منفصلًا، ويُحضَّرُ الردُّ ويُختمُ به", async () => {
    const { state, run } = runnable(jobOf(false));
    const r = await run();
    expect(r).toEqual({ claimed: 1, done: 1, failed: 0, truncated: false });
    expect(state.effectChecks).toBe(0);
    expect(state.prepares).toBe(1);
    expect(state.preparedStamps).toBe(1);
    expect(state.replayStamps).toBe(0);
  });

  test("(ج) غيابُ الحقلِ (مخطَّطٌ قديم) ⇒ الفحصُ المنفصلُ كما كان", async () => {
    const { state, run } = runnable(jobOf(undefined));
    const r = await run();
    expect(r).toEqual({ claimed: 1, done: 1, failed: 0, truncated: false });
    expect(state.effectChecks).toBe(1);
    expect(state.prepares).toBe(1);
    expect(state.preparedStamps).toBe(1);
  });
});
