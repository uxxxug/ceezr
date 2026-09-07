/**
 * اختباراتُ وحدةِ منفذِ طابورِ وظائفِ تيليجرام — منطقُ تحليلِ الأظرفِ والتعيينِ
 * والتقاطِ الأخطاء — **بمحاكاةِ Sql لا بقاعدةٍ حقيقيّةٍ**. هذه الاختباراتُ تجري
 * في الجولةِ `verify` بلا PostgreSQL، فتُغطّي المنفذَ الذي لا يُغطّيه إلّا
 * التكاملُ (المتخطّي بلا قاعدةٍ). المنطقُ الذرّيُّ نفسُه (الإيداع/الالتقاط/الختم)
 * مُغطّى في `tests/integration/telegram-durable-intake.test.ts` على قاعدةٍ حقيقيّةٍ.
 */
import { describe, expect, it } from "bun:test";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createPostgresTelegramUpdateQueue,
  type TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

/** يصنعُ منفّذاً بطابورٍ وهميٍّ يُعيدُ صفوفاً معلَّبةً حسبَ توقّعِ الاستعلامِ. */
function queueReturning(rows: unknown[]): TelegramUpdateQueue {
  const sql = ((strings: TemplateStringsArray) => {
    void strings; // شكلُ الاستعلامِ لا يهمُّ هنا — ردٌّ معلَّبٌ واحدٌ.
    return Promise.resolve(rows);
  }) as unknown as Sql;
  return createPostgresTelegramUpdateQueue(sql, {
    leaseTimeoutSeconds: 2,
    maxAttempts: 5,
    retryDelaySeconds: 5,
  });
}

describe("منفذُ طابورِ وظائفِ تيليجرام — تحليلُ الأظرفِ والتعيين", () => {
  it("claim يُعيّنُ الوظيفةَ من ظرفِ delivery صحيح", async () => {
    const queue = queueReturning([
      {
        result: {
          ok: true,
          delivery: {
            bot: "driver",
            update_id: 7,
            payload: { message: { from: { id: 1 } } },
            claim_token: "7c87ef10-1111-2222-3333-444455556666",
            attempts: 1,
            max_attempts: 5,
          },
        },
      },
    ]);
    const { job } = await queue.claim();
    expect(job).not.toBeNull();
    expect(job?.bot).toBe("driver");
    expect(job?.updateId).toBe(7);
    expect(job?.claimToken).toBe("7c87ef10-1111-2222-3333-444455556666");
    expect(job?.attempts).toBe(1);
    expect(job?.maxAttempts).toBe(5);
    expect(job?.payload).toEqual({ message: { from: { id: 1 } } });
  });

  it("claim يُعيدُ {job: null} حينَ يكونُ delivery غائباً (لا معلَّق)", async () => {
    const queue = queueReturning([{ result: { ok: true, delivery: null } }]);
    const { job } = await queue.claim();
    expect(job).toBeNull();
  });

  it("claim يرمي حينَ يرفضُ الظرفُ (ok: false) — خطأٌ صريحٌ لا صمتٌ", async () => {
    const queue = queueReturning([{ result: { ok: false, error: "INVALID_MAX_ATTEMPTS" } }]);
    await expect(queue.claim()).rejects.toThrow("INVALID_MAX_ATTEMPTS");
  });

  it("claim يرمي حينَ يكونُ الردُّ غيرَ ظرفٍ مفهوم", async () => {
    const queue = queueReturning([{ result: "not-an-envelope" }]);
    await expect(queue.claim()).rejects.toThrow();
  });

  it("finish يُعيدُ true حينَ يختمُ الظرفُ بنجاح", async () => {
    const queue = queueReturning([{ result: { ok: true, outcome: "done" } }]);
    const sealed = await queue.finish(
      { bot: "driver", updateId: 7, claimToken: "7c87ef10-1111-2222-3333-444455556666" },
      true,
    );
    expect(sealed).toBe(true);
  });

  it("finish يُعيدُ false حينَ يرفضُ الختمَ (رمزٌ قديمٌ لا يطابق)", async () => {
    const queue = queueReturning([{ result: { ok: false, error: "NOT_CLAIMED_BY_CALLER" } }]);
    const sealed = await queue.finish(
      { bot: "driver", updateId: 7, claimToken: "00000000-0000-0000-0000-000000000000" },
      false,
      "NOT_HANDLED",
    );
    expect(sealed).toBe(false);
  });

  it("abandon يُعيدُ true حينَ يختمُ الموتَ النهائيَّ", async () => {
    const queue = queueReturning([{ result: { ok: true } }]);
    const sealed = await queue.abandon(
      { bot: "driver", updateId: 9, claimToken: "7c87ef10-1111-2222-3333-444455556666" },
      "ABANDONED",
    );
    expect(sealed).toBe(true);
  });

  it("abandon يُعيدُ false حينَ يرفضُ الظرفُ", async () => {
    const queue = queueReturning([{ result: { ok: false, error: "NOT_CLAIMED_BY_CALLER" } }]);
    const sealed = await queue.abandon({
      bot: "rider",
      updateId: 9,
      claimToken: "00000000-0000-0000-0000-000000000000",
    });
    expect(sealed).toBe(false);
  });
});
