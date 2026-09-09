/**
 * الغرض: سقفُ شوطِ الدرينرِ (F6-06). كانتِ الحلقةُ `for(;;)` تستنزفُ الطابورَ
 *    حتّى يفرُغَ، فطابورٌ يمتلئُ أسرعَ ممّا يُستنزَفُ يجعلُ الشوطَ **بلا نهايةٍ
 *    عمليّةٍ**: لا `stop()` يُسمَعُ، ولا مؤقّتٌ يعودُ، ولا حدُّ تزامنٍ يُحترَمُ.
 *    والسقفُ يُقاسُ بالملتقَطِ لا بالمختومِ، وما بقيَ يُعلَنُ `truncated` لا يُبتلَعُ.
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { BotKind } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

/** طابورٌ لا يفرُغُ أبداً — الحالةُ التي كانت تُنتِجُ شوطاً بلا نهايةٍ. */
function endlessQueue(counters: { claims: number; finishes: number }): TelegramUpdateQueue {
  return {
    claim: async () => {
      counters.claims += 1;
      const job: ClaimedTelegramUpdateJob = {
        bot: "driver",
        updateId: counters.claims,
        payload: { update_id: counters.claims },
        claimToken: `token-${counters.claims}`,
        attempts: 1,
        maxAttempts: 5,
      };
      return { job };
    },
    finish: async () => {
      counters.finishes += 1;
      return true;
    },
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
}

/** طابورٌ فيهِ عددٌ محدودٌ من الوظائفِ ثمّ يفرُغُ. */
function finiteQueue(count: number, counters: { claims: number }): TelegramUpdateQueue {
  return {
    claim: async () => {
      if (counters.claims >= count) return { job: null };
      counters.claims += 1;
      const job: ClaimedTelegramUpdateJob = {
        bot: "rider",
        updateId: counters.claims,
        payload: { update_id: counters.claims },
        claimToken: `token-${counters.claims}`,
        attempts: 1,
        maxAttempts: 5,
      };
      return { job };
    },
    finish: async () => true,
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
}

const alwaysHandles = { handle: async (_bot: BotKind, _payload: unknown) => true };

describe("سقفُ شوطِ درينرِ تحديثاتِ تيليجرام", () => {
  test("طابورٌ لا يفرُغُ: الشوطُ ينتهي عندَ السقفِ ويُعلِنُ القطعَ", async () => {
    const counters = { claims: 0, finishes: 0 };
    const report = await drainTelegramUpdateJobsOnce({
      queue: endlessQueue(counters),
      handler: alwaysHandles,
      maxJobsPerRun: 4,
    });

    expect(report.claimed).toBe(4);
    expect(report.done).toBe(4);
    expect(report.truncated).toBe(true);
    // ولا التقاطَ خامسٌ: السقفُ يُفحَصُ **قبلَ** الالتقاطِ لا بعدَه.
    expect(counters.claims).toBe(4);
  });

  test("طابورٌ يفرُغُ دونَ السقفِ: لا قطعَ يُعلَنُ", async () => {
    const counters = { claims: 0 };
    const report = await drainTelegramUpdateJobsOnce({
      queue: finiteQueue(2, counters),
      handler: alwaysHandles,
      maxJobsPerRun: 10,
    });

    expect(report.claimed).toBe(2);
    expect(report.truncated).toBe(false);
  });

  test("السقفُ يُقاسُ بالملتقَطِ لا بالمختومِ", async () => {
    // وظائفُ تفشلُ كلُّها: `done` صفرٌ و`failed` أربعٌ — والسقفُ بلغَ مع ذلك،
    // فالمستهلِكُ شُغِلَ بأربعٍ سواءٌ نجحَت أم فشلَت.
    const counters = { claims: 0, finishes: 0 };
    const report = await drainTelegramUpdateJobsOnce({
      queue: endlessQueue(counters),
      handler: { handle: async () => false },
      maxJobsPerRun: 4,
    });

    expect(report.claimed).toBe(4);
    expect(report.done).toBe(0);
    expect(report.failed).toBe(4);
    expect(report.truncated).toBe(true);
  });

  test("سقفٌ قدرُه واحدٌ: وظيفةٌ واحدةٌ في الشوطِ — لا صفرَ يُجمِّدُ الاستنزافَ", async () => {
    const counters = { claims: 0, finishes: 0 };
    const report = await drainTelegramUpdateJobsOnce({
      queue: endlessQueue(counters),
      handler: alwaysHandles,
      maxJobsPerRun: 1,
    });

    expect(report.claimed).toBe(1);
    expect(report.truncated).toBe(true);
  });
});
