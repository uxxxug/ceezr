/**
 * الغرض: LOAD-01 (الدفعةُ 32) — نطاقُ المسارِ في أثرِ الحِملِ (`load-path-scope.ts`) وسجلّا `pdb`/`pagg`
 *   وحقولُ البوّابةِ في سطرِ الوظيفة:
 *   (١) بلا تفعيلٍ: `withLoadPath` تُنفِّذُ مباشرةً ولا نطاقَ، فلا سلوكٌ يتغيّرُ ولا كلفة.
 *   (٢) النطاقُ المُعلَنُ يحجُبُ الموروثَ ويبقى عبرَ `await`، ولكلِّ نطاقٍ عدّادٌ مستقلّ.
 *   (٣) نوعُ التحديثِ من مفاتيحِ الحمولةِ وحدَها (`contact` = إثباتُ الهاتف).
 *   (٤) على بوّابةٍ بمقعدٍ واحد: انتظارُ المقعدِ يُنسَبُ إلى المسارِ الذي انتظرَ لا إلى غيره، ويظهرُ
 *       في `pagg` لكلِّ مسار؛ و`rsig` يبقى بمعناه القديم (مسارُ HTTP الموروث).
 *   (٥) وظيفةُ الدرينرِ تحملُ `kind` و`gateAcq`/`gateWaitMs`/`gateHoldMs` من نطاقِها.
 * ينتمي إلى: tests/unit
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type postgres from "postgres";
import {
  currentLoadPath,
  enableLoadPathScope,
  telegramUpdateKind,
  withLoadPath,
} from "../../apps/gateway/src/background/load-path-scope.ts";
import { createLoadTrace } from "../../apps/gateway/src/background/load-trace.ts";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { withQueryDeadline } from "../../packages/infrastructure/db/query-deadline.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type AnySql = postgres.Sql<Record<string, never>>;

/** استعلامٌ مزدوجٌ كسولٌ بشكلِ `Query` في `postgres`: ينفِّذُ في `handle()` ويُحسَمُ بعدَ `ms`. */
class LazyQuery extends Promise<unknown> {
  static override get [Symbol.species]() {
    return Promise;
  }
  declare resolve: (value: unknown) => void;
  private started = false;
  constructor(private readonly ms: number) {
    let res: (value: unknown) => void = () => {};
    super((resolve) => {
      res = resolve;
    });
    this.resolve = res;
  }
  handle(): Promise<void> {
    if (!this.started) {
      this.started = true;
      setTimeout(() => this.resolve([]), this.ms);
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

function lazySql(ms: number): AnySql {
  const s = ((..._a: unknown[]) => new LazyQuery(ms)) as unknown as Record<string, unknown>;
  s.options = { max: 1 };
  return s as unknown as AnySql;
}

const rows = (file: string): Record<string, unknown>[] =>
  readFileSync(`${file}.load.jsonl`, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

afterEach(() => enableLoadPathScope(false));

describe("LOAD-01 ب32 — نطاقُ المسار", () => {
  test("بلا تفعيلٍ: تنفيذٌ مباشرٌ ولا نطاق", async () => {
    enableLoadPathScope(false);
    expect(withLoadPath("drainer:sweep", () => 7)).toBe(7);
    expect(await withLoadPath("x", async () => currentLoadPath())).toBeUndefined();
  });

  test("النطاقُ المُعلَنُ يحجُبُ الموروثَ ويبقى عبرَ await، وعدّادُه مستقلّ", async () => {
    enableLoadPathScope(true);
    await withLoadPath("http:POST /webhook/telegram/driver", async () => {
      const outer = currentLoadPath();
      await withLoadPath("drainer:job:driver:contact", async () => {
        await new Promise((r) => setTimeout(r, 1));
        const inner = currentLoadPath();
        expect(inner?.path).toBe("drainer:job:driver:contact");
        if (inner !== undefined) inner.gate.acquisitions += 1;
      });
      expect(currentLoadPath()?.path).toBe("http:POST /webhook/telegram/driver");
      expect(outer?.gate.acquisitions).toBe(0);
    });
  });

  test("نوعُ التحديثِ من المفاتيحِ وحدَها", () => {
    expect(telegramUpdateKind({ message: { contact: { phone_number: "x" } } })).toBe("contact");
    expect(telegramUpdateKind({ callback_query: {} })).toBe("callback");
    expect(telegramUpdateKind({ message: { text: "/start" } })).toBe("command");
    expect(telegramUpdateKind({ message: { text: "hi" } })).toBe("message");
    expect(telegramUpdateKind({ my_chat_member: {} })).toBe("other");
    expect(telegramUpdateKind(null)).toBe("other");
  });
});

describe("LOAD-01 ب32 — انتظارُ المقعدِ لكلِّ مسار", () => {
  test("على مقعدٍ واحد: المنتظِرُ هوَ من يُنسَبُ إليه الانتظار، ويظهرُ في pagg", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "b32-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    const sql = withQueryDeadline(lazySql(40), { deadlineMs: 5_000, slots: 1, label: "ceezr:t" });
    let jobGate: { waitMs: number; holdMs: number; acquisitions: number } | undefined;
    await Promise.all([
      trace.inRoute("/v1/rides", "POST", async () => {
        await (sql`select 1` as unknown as Promise<unknown>);
      }),
      trace.drainer.scope?.("drainer:job:driver:contact", async () => {
        await new Promise((r) => setTimeout(r, 5)); // يصلُ بعدَ أن احتُجِزَ المقعد
        await (sql`select 2` as unknown as Promise<unknown>);
        jobGate = { ...(trace.drainer.gateOf?.() ?? { waitMs: -1, holdMs: -1, acquisitions: -1 }) };
      }),
    ]);
    await trace.stop();
    const pagg = rows(file).filter((r) => r.k === "pagg");
    const http = pagg.find((r) => r.path === "http:POST /v1/rides");
    const job = pagg.find((r) => r.path === "drainer:job:driver:contact");
    expect(http?.n).toBe(1);
    expect(job?.n).toBe(1);
    expect(job?.pool).toBe("ceezr:t");
    expect(Number(job?.waitSumMs)).toBeGreaterThan(20); // انتظرَ احتجازَ الأوّل (~35ms)
    expect(Number(http?.waitSumMs)).toBeLessThan(10);
    expect(Number(job?.runSumMs)).toBeGreaterThan(30);
    expect(jobGate?.acquisitions).toBe(1);
    expect(jobGate?.waitMs ?? 0).toBeGreaterThan(20);
    expect(jobGate?.holdMs ?? 0).toBeGreaterThan(30);
    // النطاقُ يُعطَّلُ عندَ الإيقاف.
    expect(withLoadPath("x", () => currentLoadPath())).toBeUndefined();
  });
});

describe("LOAD-01 ب32 — حقولُ البوّابةِ في سطرِ الوظيفة", () => {
  test("وظيفةُ إثباتِ الهاتفِ تحملُ kind=contact وحجوزاتِها", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "b32-")), "trace");
    const trace = createLoadTrace(file);
    if (trace === null) throw new Error("الأثرُ معطَّل");
    const sql = withQueryDeadline(lazySql(3), { deadlineMs: 5_000, slots: 2, label: "ceezr:t" });
    const jobs: ClaimedTelegramUpdateJob[] = [
      {
        bot: "driver",
        updateId: 1,
        payload: { message: { from: { id: 9 }, contact: { phone_number: "0" } } },
        claimToken: "t1",
        attempts: 1,
        maxAttempts: 5,
      },
    ];
    const queue: TelegramUpdateQueue = {
      claim: async () => ({ job: jobs.shift() ?? null }),
      claimFor: async () => ({ job: jobs.shift() ?? null }),
      claimBatchFor: async (_bot, limit) => ({ jobs: jobs.splice(0, limit) }),
      finish: async () => true,
      abandon: async () => true,
    };
    await drainTelegramUpdateJobsOnce({
      queue,
      handler: {
        handle: async () => {
          await (sql`select 1` as unknown as Promise<unknown>);
          await (sql`select 2` as unknown as Promise<unknown>);
          return true;
        },
      },
      timing: trace.drainer,
    } as unknown as Parameters<typeof drainTelegramUpdateJobsOnce>[0]);
    await trace.stop();
    const job = rows(file).find((r) => r.k === "job");
    expect(job?.kind).toBe("contact");
    expect(job?.gateAcq).toBe(2);
    expect(Number(job?.gateHoldMs)).toBeGreaterThan(0);
    const pagg = rows(file).filter((r) => r.k === "pagg");
    expect(pagg.some((r) => r.path === "drainer:job:driver:contact" && r.n === 2)).toBe(true);
  });
});
