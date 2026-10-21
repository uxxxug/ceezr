/**
 * الغرض: LOAD-01 (الدفعةُ 28) — بوّابةُ فحصِ الأثرِ في الدرينر: لا يُسألُ `effectRecorded` (حجزُ
 *   مقعدٍ من مجمّعِ `gatewayRequest`) إلّا حينَ لا يكفي جوابُ الالتقاط. أربعُ حالات:
 *   علَمٌ باطلٌ وإيجارٌ طازج ⇒ لا سؤالَ ويُنفَّذُ الأثر؛ علَمٌ صادقٌ وإيجارٌ طازج ⇒ لا سؤالَ ولا أثرَ
 *   ويُختَم؛ إيجارٌ تجاوزَ المهلة ⇒ يُسأل (ويُطاعُ جوابُه)؛ بلا علَم ⇒ يُسألُ كما كان.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

function harness(job: ClaimedTelegramUpdateJob, ledgerSays: boolean) {
  const calls = { effectRecorded: 0, prepare: 0, record: [] as number[], finishReplies: 0 };
  let served = false;
  const queue: TelegramUpdateQueue = {
    claim: async () => ({ job: null }),
    claimFor: async () => ({ job: null }),
    claimBatchFor: async () => {
      if (served) return { jobs: [] };
      served = true;
      return { jobs: [job] };
    },
    finish: async () => true,
    abandon: async () => true,
    ledger: {
      effectRecorded: async () => {
        calls.effectRecorded += 1;
        return ledgerSays;
      },
      recordEffect: async (_lease, replies) => {
        calls.record.push(replies.length);
        return { ok: true, first: replies.length > 0, replyToken: replies.length > 0 ? "r" : null };
      },
      finishReplies: async () => {
        calls.finishReplies += 1;
        return "done";
      },
      claimReplies: async () => [],
    },
  };
  const handler = {
    handle: async () => true,
    prepare: async () => {
      calls.prepare += 1;
      return { handled: true, replies: [{ text: "x" }] };
    },
    deliver: async (_b: string, replies: readonly unknown[]) => ({
      sent: replies.length,
      error: null,
    }),
  };
  return {
    calls,
    run: () =>
      drainTelegramUpdateJobsOnce({
        queue,
        handler: handler as never,
        lanes: 4,
        fairBots: ["driver", "rider"],
      }),
  };
}

const base = {
  bot: "driver",
  updateId: 1,
  payload: { update_id: 1, message: { from: { id: 7 } } },
  claimToken: "t",
  attempts: 1,
  maxAttempts: 5,
} satisfies ClaimedTelegramUpdateJob;

describe("الدفعة 28: بوّابةُ فحصِ الأثرِ", () => {
  test("علَمٌ باطلٌ وإيجارٌ طازج ⇒ لا سؤالَ، والأثرُ يُنفَّذُ ويُختَمُ ويُرسَل", async () => {
    const h = harness(
      { ...base, effectRecordedAtClaim: false, freshUntilMs: performance.now() + 60_000 },
      true, // لو سُئلَ لقالَ «مختوم» — فعدمُ السؤالِ ظاهرٌ في تنفيذِ الأثر
    );
    const r = await h.run();
    expect(h.calls.effectRecorded).toBe(0);
    expect(h.calls.prepare).toBe(1);
    expect(h.calls.record).toEqual([1]);
    expect(h.calls.finishReplies).toBe(1);
    expect(r.done).toBe(1);
  });

  test("علَمٌ صادقٌ وإيجارٌ طازج ⇒ لا سؤالَ ولا أثرَ ثانٍ، ويُختَمُ بلا ردود", async () => {
    const h = harness(
      { ...base, effectRecordedAtClaim: true, freshUntilMs: performance.now() + 60_000 },
      false,
    );
    await h.run();
    expect(h.calls.effectRecorded).toBe(0);
    expect(h.calls.prepare).toBe(0);
    expect(h.calls.record).toEqual([0]);
  });

  test("الإيجارُ تجاوزَ المهلة ⇒ يُسألُ ويُطاعُ الجوابُ ولو خالفَ علَمَ الالتقاط", async () => {
    const h = harness(
      { ...base, effectRecordedAtClaim: false, freshUntilMs: performance.now() - 1 },
      true, // حائزٌ آخرُ ختمَ بعدَ انقضاءِ إيجارِنا
    );
    await h.run();
    expect(h.calls.effectRecorded).toBe(1);
    expect(h.calls.prepare).toBe(0);
  });

  test("بلا علَمٍ من الالتقاط (هجرةٌ أقدم/التقاطٌ مفرد) ⇒ يُسألُ كما كان", async () => {
    const h = harness({ ...base }, false);
    await h.run();
    expect(h.calls.effectRecorded).toBe(1);
    expect(h.calls.prepare).toBe(1);
  });
});
