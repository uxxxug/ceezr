/**
 * الغرض: غلافُ مهلةِ الاستعلامِ (`packages/infrastructure/db/query-deadline.ts` · `F11-04` · `ADR 0197`)
 *   على تجمُّعٍ مزدوجٍ يحاكي شكلَ `Query` في `postgres@3.4.9`: كسولٌ ينفِّذُ في `handle()`، و`canceller`
 *   يُصفَّرُ بعدَ أوّلِ `cancel()`، و`reject` خاصّيّةٌ على النسخةِ. والسلوكُ الحقيقيُّ على خادمٍ في
 *   `tests/integration/pg-brownout.test.ts`؛ وهنا فروعُ الغلافِ كلُّها بلا قاعدةٍ.
 * الحالة: منفّذ فعلياً.
 */
import { describe, expect, test } from "bun:test";
import type postgres from "postgres";
import {
  QUERY_CANCEL_RETRY_MS,
  queryDeadlineError,
  withQueryDeadline,
} from "../../packages/infrastructure/db/query-deadline.ts";

type AnySql = postgres.Sql<Record<string, never>>;

interface Plan {
  /** مدّةُ الاستعلامِ على «الخادمِ» بعدَ تسليمِه. */
  readonly durationMs: number;
  /** كم إلغاءً يُهمَلُ قبلَ أن يُصيبَ (فجوةُ الإلغاءِ). */
  readonly ignoredCancels?: number;
  /** بلا `canceller` داخليٍّ: الغلافُ يعودُ إلى `cancel()` العامِّ. */
  readonly noCanceller?: boolean;
}

interface Stats {
  executed: number;
  cancels: number;
  inFlight: number;
  maxInFlight: number;
}

class FakeQuery extends Promise<unknown> {
  static override get [Symbol.species]() {
    return Promise;
  }
  declare resolve: (value: unknown) => void;
  declare reject: (cause: unknown) => void;
  canceller: ((query: FakeQuery) => Promise<unknown>) | null;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ignored = 0;

  constructor(
    private readonly plan: Plan,
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
    this.canceller = plan.noCanceller === true ? null : (query) => query.serverCancel();
  }

  handle(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    this.stats.executed += 1;
    this.stats.inFlight += 1;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.stats.inFlight);
    this.timer = setTimeout(() => this.finish(null), this.plan.durationMs);
    return Promise.resolve();
  }

  serverCancel(): Promise<void> {
    this.stats.cancels += 1;
    if (this.ignored < (this.plan.ignoredCancels ?? 0)) {
      this.ignored += 1;
      return Promise.resolve();
    }
    if (this.started) this.finish(Object.assign(new Error("canceled"), { code: "57014" }));
    return Promise.resolve();
  }

  cancel(): Promise<unknown> {
    const canceller = this.canceller;
    this.canceller = null;
    return canceller === null ? this.serverCancel() : canceller(this);
  }

  private finish(cause: unknown): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stats.inFlight -= 1;
    if (cause === null) this.resolve("ok");
    else this.reject(cause);
  }

  // biome-ignore lint/suspicious/noThenProperty: المزدوجُ يحاكي `Query` في `postgres` الذي ينفِّذُ في `then` — وهوَ ما يُختبَرُ.
  override then<A = unknown, B = never>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    void this.handle();
    return super.then(onFulfilled, onRejected);
  }
}

function fakeSql(plans: Plan[], stats: Stats) {
  let next = 0;
  const make = () => new FakeQuery(plans[Math.min(next++, plans.length - 1)] as Plan, stats);
  const scope = (): Record<string, unknown> & ((...a: unknown[]) => unknown) => {
    const s = ((..._a: unknown[]) => make()) as Record<string, unknown> &
      ((...a: unknown[]) => unknown);
    s.unsafe = () => make();
    s.file = () => make();
    s.json = (value: unknown) => ({ json: value });
    s.savepoint = async (fn: (tx: unknown) => unknown) => fn(scope());
    s.options = { max: 1 };
    return s;
  };
  const root = scope();
  root.begin = async (fn: (tx: unknown) => unknown) => fn(scope());
  let released = 0;
  root.reserve = async () => {
    const reserved = scope();
    reserved.release = () => {
      released += 1;
    };
    return reserved;
  };
  return { sql: root as unknown as AnySql, released: () => released };
}

const freshStats = (): Stats => ({ executed: 0, cancels: 0, inFlight: 0, maxInFlight: 0 });
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (cause: { code?: string }) => cause.code ?? "none",
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("مهلةُ الاستعلامِ من العميلِ — F11-04", () => {
  test("استعلامٌ أسرعُ من المهلةِ يمرُّ ولا خطّافَ", async () => {
    const stats = freshStats();
    const hooks: number[] = [];
    const { sql } = fakeSql([{ durationMs: 5 }], stats);
    const wrapped = withQueryDeadline(sql, {
      deadlineMs: 100,
      slots: 2,
      onDeadline: ({ deadlineMs }) => hooks.push(deadlineMs),
    });
    expect(await codeOf(wrapped`select 1` as unknown as Promise<unknown>)).toBe("ok");
    expect(hooks).toEqual([]);
    expect(stats.cancels).toBe(0);
  });

  test("استعلامٌ عالقٌ يُلغى على الخادمِ عندَ المهلةِ بـ57014 ويُنادى الخطّافُ", async () => {
    const stats = freshStats();
    const hooks: number[] = [];
    const { sql } = fakeSql([{ durationMs: 5_000 }], stats);
    const wrapped = withQueryDeadline(sql, {
      deadlineMs: 30,
      slots: 2,
      onDeadline: ({ deadlineMs }) => hooks.push(deadlineMs),
    });
    const started = Date.now();
    expect(await codeOf(wrapped.unsafe("select pg_sleep(5)") as unknown as Promise<unknown>)).toBe(
      "57014",
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hooks).toEqual([30]);
    expect(stats.inFlight).toBe(0);
  });

  test("الإلغاءُ الضائعُ في فجوةٍ يُعادُ كلَّ QUERY_CANCEL_RETRY_MS حتى يُصيبَ", async () => {
    const stats = freshStats();
    const { sql } = fakeSql([{ durationMs: 5_000, ignoredCancels: 1 }], stats);
    const wrapped = withQueryDeadline(sql, { deadlineMs: 20, slots: 1 });
    const started = Date.now();
    expect(await codeOf(wrapped.file("q.sql") as unknown as Promise<unknown>)).toBe("57014");
    expect(stats.cancels).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20 + QUERY_CANCEL_RETRY_MS - 5);
  });

  test("بلا canceller داخليٍّ يعودُ إلى cancel() العامِّ مرّةً", async () => {
    const stats = freshStats();
    const { sql } = fakeSql([{ durationMs: 5_000, noCanceller: true }], stats);
    const wrapped = withQueryDeadline(sql, { deadlineMs: 20, slots: 1 });
    expect(await codeOf(wrapped`select 1` as unknown as Promise<unknown>)).toBe("57014");
    expect(stats.cancels).toBe(1);
  });

  test("البوّابةُ لا تُسلِّمُ أكثرَ من السقفِ، والمنتظِرُ يُرفَضُ بمهلتِه ولا يبلغُ الخادمَ", async () => {
    const stats = freshStats();
    const hooks: number[] = [];
    // الأوّلُ عالقٌ لا يُصيبُه الإلغاءُ طويلاً؛ الثاني ينتظرُ خلفَه في البوّابةِ.
    const { sql } = fakeSql([{ durationMs: 400, ignoredCancels: 100 }, { durationMs: 1 }], stats);
    const wrapped = withQueryDeadline(sql, {
      deadlineMs: 40,
      slots: 1,
      onDeadline: ({ deadlineMs }) => hooks.push(deadlineMs),
    });
    const first = codeOf(wrapped`select 1` as unknown as Promise<unknown>);
    const second = codeOf(wrapped`select 2` as unknown as Promise<unknown>);
    expect(await second).toBe("57014");
    expect(stats.executed).toBe(1);
    expect(stats.maxInFlight).toBe(1);
    expect(hooks).toEqual([40]);
    expect(await first).toBe("ok");
  });

  test("منتظِرٌ في البوّابةِ يُمنَحُ حينَ يتحرّرُ مقعدٌ قبلَ مهلتِه", async () => {
    const stats = freshStats();
    const { sql } = fakeSql([{ durationMs: 20 }, { durationMs: 5 }], stats);
    const wrapped = withQueryDeadline(sql, { deadlineMs: 200, slots: 1 });
    const results = await Promise.all([
      codeOf(wrapped`select 1` as unknown as Promise<unknown>),
      codeOf(wrapped`select 2` as unknown as Promise<unknown>),
    ]);
    expect(results).toEqual(["ok", "ok"]);
    expect(stats.maxInFlight).toBe(1);
  });

  test("الشظيّةُ التي لا تُنتظَرُ لا تُسلَّحُ، وما ليسَ استعلاماً يمرُّ كما هوَ", async () => {
    const stats = freshStats();
    const { sql } = fakeSql([{ durationMs: 5 }], stats);
    const wrapped = withQueryDeadline(sql, { deadlineMs: 10, slots: 1 });
    void wrapped`fragment`;
    expect(wrapped.json({ a: 1 } as never)).toEqual({ json: { a: 1 } } as never);
    expect((wrapped as unknown as { options: { max: number } }).options.max).toBe(1);
    await sleep(30);
    expect(stats.executed).toBe(0);
    expect(stats.cancels).toBe(0);
  });

  test("المعاملةُ تحتجزُ مقعداً طولَها، واستعلاماتُها ونقاطُ حفظِها مُسلَّحةٌ", async () => {
    const stats = freshStats();
    const hooks: number[] = [];
    const { sql } = fakeSql([{ durationMs: 5 }, { durationMs: 5_000 }], stats);
    const wrapped = withQueryDeadline(sql, {
      deadlineMs: 40,
      slots: 1,
      onDeadline: ({ deadlineMs }) => hooks.push(deadlineMs),
    });
    const inTx = wrapped.begin(async (tx) => {
      await tx`select 1`;
      return tx.savepoint(async (sp) =>
        codeOf(sp`select pg_sleep(5)` as unknown as Promise<unknown>),
      );
    });
    // معاملةٌ ثانيةٌ لا مقعدَ لها: انتظارُها محدودٌ بالمهلةِ.
    const blocked = codeOf(wrapped.begin(async () => "never") as Promise<unknown>);
    expect(await blocked).toBe("57014");
    expect(await inTx).toBe("57014");
    expect(hooks).toEqual([40, 40]);
    // والمقعدُ عادَ: معاملةٌ جديدةٌ تمضي.
    expect(await wrapped.begin(async () => "done")).toBe("done");
  });

  test("الاتّصالُ المحجوزُ يحتجزُ مقعداً حتى release، واستعلاماتُه مُسلَّحةٌ", async () => {
    const stats = freshStats();
    const { sql, released } = fakeSql([{ durationMs: 5_000 }], stats);
    const wrapped = withQueryDeadline(sql, { deadlineMs: 30, slots: 1 });
    const reserved = await wrapped.reserve();
    expect(await codeOf(reserved`select 1` as unknown as Promise<unknown>)).toBe("57014");
    const waiting = codeOf(wrapped.reserve() as Promise<unknown>);
    expect(await waiting).toBe("57014");
    reserved.release();
    expect(released()).toBe(1);
    const again = await wrapped.reserve();
    again.release();
    expect(released()).toBe(2);
  });

  test("إخفاقُ الحجزِ نفسِه يُعيدُ المقعدَ", async () => {
    const stats = freshStats();
    const { sql } = fakeSql([{ durationMs: 1 }], stats);
    (sql as unknown as { reserve: () => Promise<never> }).reserve = async () => {
      throw new Error("connect failed");
    };
    const wrapped = withQueryDeadline(sql, { deadlineMs: 30, slots: 1 });
    await expect(wrapped.reserve()).rejects.toThrow("connect failed");
    await expect(wrapped.reserve()).rejects.toThrow("connect failed");
  });

  test("خطأُ المهلةِ يحملُ رمزَ الخادمِ نفسَه", () => {
    const error = queryDeadlineError(8_000) as Error & { code: string };
    expect(error.code).toBe("57014");
    expect(error.message).toContain("8000ms");
  });
});
