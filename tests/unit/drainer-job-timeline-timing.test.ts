/**
 * الغرض: LOAD-01M (الدورةُ الرابعة) — قياسُ زمنِ كلِّ وظيفةٍ claim → send → finish في الدرينر.
 *   (١) رحلةُ الالتقاطِ الدُّفعيِّ تُلحَقُ بكلِّ وظيفةٍ (مدّتُها وحجمُها وموضعُها)، (٢) لكلِّ ردٍّ
 *   سطرٌ بمسارِه (pool/inline/overflow/background) وترتيبِ لحظاتِه، (٣) غيابُ `timing` لا يغيّرُ
 *   النتيجةَ ولا يستدعي شيئًا. قياسٌ فقط: لا ترتيبَ ولا حدَّ يتغيّر.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import type { TelegramReplyPool } from "../../apps/gateway/src/background/telegram-reply-pool.ts";
import {
  type DrainerJobTiming,
  type DrainerReplyTiming,
  type DrainerTiming,
  drainTelegramUpdateJobsOnce,
  drainTelegramUpdateRepliesOnce,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  PendingUpdateReplies,
  TelegramUpdateEffectLedger,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

function job(updateId: number, userId: number): ClaimedTelegramUpdateJob {
  return {
    bot: "driver",
    updateId,
    payload: { message: { from: { id: userId }, text: "/start" } },
    claimToken: `t${updateId}`,
    attempts: 1,
    maxAttempts: 5,
  };
}

function ledgerOf(pendingBack: PendingUpdateReplies[] = []): TelegramUpdateEffectLedger {
  return {
    effectRecorded: async () => false,
    recordEffect: async (lease) => ({ ok: true, first: true, replyToken: `r${lease.updateId}` }),
    finishReplies: async () => "done",
    claimReplies: async () => pendingBack.splice(0),
  };
}

function queueOf(jobs: ClaimedTelegramUpdateJob[], ledger: TelegramUpdateEffectLedger) {
  const all = [...jobs];
  const queue: TelegramUpdateQueue = {
    claim: async () => ({ job: all.shift() ?? null }),
    claimFor: async () => ({ job: all.shift() ?? null }),
    claimBatchFor: async (_bot, limit) => {
      await new Promise((r) => setTimeout(r, 3));
      return { jobs: all.splice(0, limit) };
    },
    finish: async () => true,
    abandon: async () => true,
    ledger,
  };
  return queue;
}

const handler = {
  handle: async () => true,
  prepare: async () => ({ handled: true, replies: [{ text: "a" }, { text: "b" }] }),
  deliver: async (_bot: unknown, replies: readonly unknown[]) => {
    await new Promise((r) => setTimeout(r, 2));
    return { sent: replies.length, error: null };
  },
};

function recorder() {
  const jobs: DrainerJobTiming[] = [];
  const replies: DrainerReplyTiming[] = [];
  const timing: DrainerTiming = {
    onJob: (t) => jobs.push(t),
    onSweep: () => {},
    onReply: (t) => replies.push(t),
  };
  return { jobs, replies, timing };
}

/** مُرسِلٌ فوريٌّ صغيرٌ: يُشغِّلُ فورًا أو يرفضُ (امتلاء). */
function poolOf(accept: boolean): TelegramReplyPool & { runs: Promise<unknown>[] } {
  const runs: Promise<unknown>[] = [];
  return {
    runs,
    submit: (_lane, run) => {
      if (!accept) return false;
      runs.push(run());
      return true;
    },
    stats: () => ({ queued: 0, running: 0, expiredLocal: 0, sent: 0 }),
    idle: async () => {
      await Promise.all(runs);
    },
  };
}

describe("LOAD-01M الدورةُ الرابعة — زمنُ الوظيفةِ claim → send → finish", () => {
  test("الالتقاطُ الدُّفعيُّ: لكلِّ وظيفةٍ مدّةُ رحلتِها وحجمُها وموضعٌ فريدٌ فيها", async () => {
    const r = recorder();
    const jobs = [1, 2, 3, 4, 5].map((n) => job(n, 100 + n));
    const report = await drainTelegramUpdateJobsOnce({
      queue: queueOf(jobs, ledgerOf()),
      handler,
      lanes: 4,
      fairBots: ["driver", "rider"],
      maxJobsPerRun: 50,
      timing: r.timing,
      replyPool: poolOf(true),
    });
    expect(report.done).toBe(5);
    expect(r.jobs).toHaveLength(5);
    for (const t of r.jobs) {
      expect(t.claimTripMs).toBeGreaterThan(0);
      expect(t.claimBatch).toBeGreaterThanOrEqual(1);
      expect(t.claimPos).toBeLessThan(t.claimBatch as number);
    }
    // الوظائفُ التي جلبَتها رحلةٌ واحدةٌ تتقاسمُ مدّتَها، ومواضعُها 0..n-1 بلا تكرار.
    const byTrip = new Map<string, number[]>();
    for (const t of r.jobs) {
      const k = `${t.claimTripMs}:${t.claimBatch}`;
      byTrip.set(k, [...(byTrip.get(k) ?? []), t.claimPos as number]);
    }
    for (const [k, pos] of byTrip) {
      const n = Number(k.split(":")[1]);
      expect([...pos].sort()).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  test("المُرسِلُ الفوريُّ: سطرُ ردٍّ pool بترتيبِ submitted ≤ started ≤ ended ومآلِ الختم", async () => {
    const r = recorder();
    const pool = poolOf(true);
    await drainTelegramUpdateJobsOnce({
      queue: queueOf([job(7, 70)], ledgerOf()),
      handler,
      lanes: 2,
      fairBots: ["driver", "rider"],
      timing: r.timing,
      replyPool: pool,
    });
    await pool.idle();
    expect(r.replies).toHaveLength(1);
    const t = r.replies[0] as DrainerReplyTiming;
    expect(t.path).toBe("pool");
    expect(t.updateId).toBe(7);
    expect(t.sent).toBe(2);
    expect(t.total).toBe(2);
    expect(t.outcome).toBe("done");
    expect(t.error).toBe(false);
    expect(t.submittedAt).toBeLessThanOrEqual(t.startedAt as number);
    expect(t.startedAt as number).toBeLessThanOrEqual(t.endedAt as number);
    // الردُّ يُقدَّمُ بعدَ ختمِ الأثرِ: لحظةُ تقديمِه لا تسبقُ بدءَ معالجةِ الوظيفة.
    expect(t.submittedAt).toBeGreaterThanOrEqual((r.jobs[0] as DrainerJobTiming).startedAt);
  });

  test("امتلاءُ المُرسِلِ: سطرُ overflow بلا بدءٍ ولا نهاية (أُجِّلَ للخلفيّ)", async () => {
    const r = recorder();
    await drainTelegramUpdateJobsOnce({
      queue: queueOf([job(8, 80)], ledgerOf()),
      handler,
      lanes: 2,
      fairBots: ["driver", "rider"],
      timing: r.timing,
      replyPool: poolOf(false),
    });
    expect(r.replies).toHaveLength(1);
    const t = r.replies[0] as DrainerReplyTiming;
    expect(t.path).toBe("overflow");
    expect(t.startedAt).toBeNull();
    expect(t.endedAt).toBeNull();
    expect(t.sent).toBe(0);
    expect(t.total).toBe(2);
  });

  test("بلا مُرسِلٍ فوريّ: سطرُ inline؛ والمُرسِلُ الخلفيُّ: سطرُ background", async () => {
    const r = recorder();
    await drainTelegramUpdateJobsOnce({
      queue: queueOf([job(9, 90)], ledgerOf()),
      handler,
      timing: r.timing,
    });
    expect(r.replies.map((x) => x.path)).toEqual(["inline"]);

    const back: PendingUpdateReplies[] = [
      {
        bot: "driver",
        updateId: 10,
        replies: [{ text: "x" }],
        repliesSent: 0,
        replyToken: "r10",
        attempts: 1,
      },
    ];
    const ledger = ledgerOf(back);
    const rb = recorder();
    const out = await drainTelegramUpdateRepliesOnce({
      queue: queueOf([], ledger),
      handler,
      timing: rb.timing,
    });
    expect(out.done).toBe(1);
    expect(rb.replies.map((x) => [x.path, x.updateId, x.outcome])).toEqual([
      ["background", 10, "done"],
    ]);
    const t = rb.replies[0] as DrainerReplyTiming;
    expect(t.submittedAt).toBe(t.startedAt as number);
  });

  test("غيابُ timing: النتيجةُ نفسُها ولا حقولَ قياس", async () => {
    const mk = () => [1, 2, 3].map((n) => job(n, 10 + n));
    const a = await drainTelegramUpdateJobsOnce({
      queue: queueOf(mk(), ledgerOf()),
      handler,
      lanes: 3,
      fairBots: ["driver", "rider"],
      replyPool: poolOf(true),
    });
    const r = recorder();
    const b = await drainTelegramUpdateJobsOnce({
      queue: queueOf(mk(), ledgerOf()),
      handler,
      lanes: 3,
      fairBots: ["driver", "rider"],
      replyPool: poolOf(true),
      timing: r.timing,
    });
    expect(a).toEqual(b);
  });
});
