/**
 * الغرض: LOAD-01 (الدفعةُ 32 · ذراعُ P) — أولويّةُ الحجزِ في بوّابةِ التجمُّعِ (`runWithGatePriority`):
 *   (١) بلا نطاقٍ: ترتيبُ الوصولِ حرفاً. (٢) منتظِرُ الأولويّةِ يُقدَّمُ على منتظرٍ عاديٍّ وصلَ قبلَه.
 *   (٣) السعةُ لا تُتجاوَزُ أبداً (لا مقاعدَ إضافيّة). (٤) مهلةُ منتظِرِ الأولويّةِ تسحبُه (57014) ولا
 *   تُفسِدُ الصفَّ العاديّ. (٥) أشواطُ الدرينرِ — الالتقاطُ والمعالجُ — تجري بالأولويّة، وما خارجَها لا.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
  drainTelegramUpdateJobsOnce,
  startTelegramUpdateDrainer,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import {
  hasGatePriority,
  runWithGatePriority,
  withQueryDeadline,
} from "../../packages/infrastructure/db/query-deadline.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type AnySql = postgres.Sql<Record<string, never>>;

interface Stats {
  inFlight: number;
  maxInFlight: number;
}

class TimedQuery extends Promise<unknown> {
  static override get [Symbol.species]() {
    return Promise;
  }
  declare resolve: (value: unknown) => void;
  declare reject: (cause: unknown) => void;
  private started = false;
  constructor(
    private readonly ms: number,
    private readonly stats: Stats,
  ) {
    let res: (value: unknown) => void = () => {};
    let rej: (cause: unknown) => void = () => {};
    super((resolve, reject) => {
      res = resolve;
      rej = reject;
    });
    this.resolve = res;
    this.reject = rej;
  }
  handle(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.stats.inFlight += 1;
      this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.stats.inFlight);
      setTimeout(() => {
        this.stats.inFlight -= 1;
        this.resolve([]);
      }, this.ms);
    }
    return Promise.resolve();
  }
  cancel(): Promise<void> {
    return Promise.resolve();
  }
  // biome-ignore lint/suspicious/noThenProperty: يحاكي `Query` في `postgres` الذي ينفِّذُ في `then`.
  override then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    void this.handle();
    return super.then(onFulfilled, onRejected);
  }
}

function gated(slots: number, ms: (i: number) => number, deadlineMs = 5_000) {
  const stats: Stats = { inFlight: 0, maxInFlight: 0 };
  let i = 0;
  const raw = ((..._a: unknown[]) => new TimedQuery(ms(i++), stats)) as unknown as Record<
    string,
    unknown
  >;
  raw.options = { max: slots };
  const sql = withQueryDeadline(raw as unknown as AnySql, { deadlineMs, slots });
  const q = (): Promise<unknown> => sql`select 1` as unknown as Promise<unknown>;
  return { q, stats };
}

const tick = () => new Promise((r) => setTimeout(r, 2));

describe("LOAD-01 ب32 (P) — أولويّةُ الحجزِ في البوّابة", () => {
  test("بلا نطاقٍ: ترتيبُ الوصول", async () => {
    const { q } = gated(1, () => 20);
    const order: string[] = [];
    const hold = q().then(() => "held"); // الاستعلامُ كسولٌ: `then` يُطلقُه فيحتجزُ المقعد.
    await tick();
    const a = q().then(() => order.push("a"));
    const b = q().then(() => order.push("b"));
    await Promise.all([hold, a, b]);
    expect(order).toEqual(["a", "b"]);
  });

  test("منتظِرُ الأولويّةِ يُقدَّمُ على عاديٍّ وصلَ قبلَه", async () => {
    const { q } = gated(1, () => 20);
    const order: string[] = [];
    const hold = q().then(() => "held"); // الاستعلامُ كسولٌ: `then` يُطلقُه فيحتجزُ المقعد.
    await tick();
    const a = q().then(() => order.push("normal"));
    await tick();
    const b = runWithGatePriority(() => q().then(() => order.push("priority")));
    await Promise.all([hold, a, b]);
    expect(order).toEqual(["priority", "normal"]);
  });

  test("السعةُ لا تُتجاوَز: مزيجٌ من الصفّين على مقعدين", async () => {
    const { q, stats } = gated(2, () => 5);
    const all: Promise<unknown>[] = [];
    for (let k = 0; k < 20; k++) {
      all.push(k % 3 === 0 ? runWithGatePriority(() => q()) : q());
    }
    await Promise.all(all);
    expect(stats.maxInFlight).toBe(2);
    expect(stats.inFlight).toBe(0);
  });

  test("مهلةُ منتظِرِ الأولويّةِ تسحبُه، والعاديُّ يُمنَحُ بعدَه", async () => {
    const { q } = gated(1, (i) => (i === 0 ? 120 : 5), 40);
    const hold = q().catch(() => "held-timeout");
    await tick();
    const p = runWithGatePriority(() =>
      q().then(
        () => "ok",
        (e: { code?: string }) => e.code,
      ),
    );
    expect(await p).toBe("57014");
    await hold;
    // البوّابةُ سليمةٌ بعدَ السحب: استعلامٌ عاديٌّ يُمنَح.
    expect(await q().then(() => "ok")).toBe("ok");
  });

  test("أشواطُ الدرينرِ بالأولويّة، وما خارجَها لا", async () => {
    expect(hasGatePriority()).toBe(false);
    const seen: boolean[] = [];
    const jobs: ClaimedTelegramUpdateJob[] = [
      {
        bot: "driver",
        updateId: 1,
        payload: { message: { from: { id: 1 } } },
        claimToken: "t",
        attempts: 1,
        maxAttempts: 5,
      },
    ];
    const queue: TelegramUpdateQueue = {
      claim: async () => {
        seen.push(hasGatePriority());
        return { job: jobs.shift() ?? null };
      },
      claimFor: async () => {
        seen.push(hasGatePriority());
        return { job: jobs.shift() ?? null };
      },
      claimBatchFor: async (_b, limit) => {
        seen.push(hasGatePriority());
        return { jobs: jobs.splice(0, limit) };
      },
      finish: async () => true,
      abandon: async () => true,
    };
    // الشوطُ يُغلَّفُ في `startTelegramUpdateDrainer`؛ هنا يُستدعى كما يستدعيه الشوطُ تحتَ النطاق.
    await runWithGatePriority(() =>
      drainTelegramUpdateJobsOnce({
        queue,
        handler: {
          handle: async () => {
            seen.push(hasGatePriority());
            return true;
          },
        },
      } as unknown as Parameters<typeof drainTelegramUpdateJobsOnce>[0]),
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((x) => x)).toBe(true);
    expect(hasGatePriority()).toBe(false);
  });

  test("الدرينرُ المُشغَّلُ (`kick`) يلتقطُ ويعالجُ بالأولويّةِ من غيرِ تغليفٍ خارجيّ", async () => {
    const seen: boolean[] = [];
    const jobs: ClaimedTelegramUpdateJob[] = [
      {
        bot: "driver",
        updateId: 2,
        payload: { message: { from: { id: 2 } } },
        claimToken: "t2",
        attempts: 1,
        maxAttempts: 5,
      },
    ];
    const claimed = (n: number) => {
      seen.push(hasGatePriority());
      return jobs.splice(0, n);
    };
    const queue: TelegramUpdateQueue = {
      claim: async () => ({ job: claimed(1)[0] ?? null }),
      claimFor: async () => ({ job: claimed(1)[0] ?? null }),
      claimBatchFor: async (_b, limit) => ({ jobs: claimed(limit) }),
      finish: async () => true,
      abandon: async () => true,
    };
    let handled = false;
    const drainer = startTelegramUpdateDrainer(
      {
        queue,
        handler: {
          handle: async () => {
            seen.push(hasGatePriority());
            handled = true;
            return true;
          },
        },
      } as unknown as Parameters<typeof startTelegramUpdateDrainer>[0],
      { intervalMs: 60_000 },
    );
    drainer.kick();
    for (let k = 0; k < 50 && !handled; k++) await tick();
    await drainer.stop();
    expect(handled).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((x) => x)).toBe(true);
    expect(hasGatePriority()).toBe(false);
  });
});
