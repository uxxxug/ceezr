import { describe, expect, it } from "bun:test";
import {
  createJobStatusPoller,
  type JobStatusRow,
} from "../../deploy/capacity-run/load/job-status-poller.ts";

/** ساعةٌ وجدولةٌ يدويّتان: كلُّ دورةٍ تُنفَّذُ صراحةً، فالإيقاعُ والمهلةُ مُتحكَّمٌ بهما حرفًا. */
function harness(statusOf: (id: number, round: number) => string | undefined) {
  let t = 0;
  let round = 0;
  const pending: Array<() => void> = [];
  const calls: number[][] = [];
  const poller = createJobStatusPoller({
    intervalMs: 400,
    chunk: 3,
    now: () => t,
    schedule: (fn) => {
      pending.push(fn);
    },
    query: async (ids) => {
      calls.push([...ids]);
      const out: JobStatusRow[] = [];
      for (const id of ids) {
        const s = statusOf(id, round);
        if (s !== undefined) out.push({ updateId: id, status: s });
      }
      return out;
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    poller,
    calls,
    async advance(ms: number) {
      t += ms;
      round += 1;
      const fn = pending.shift();
      fn?.();
      await flush();
      await flush();
    },
    flush,
  };
}

describe("LOAD-01 · انتظارُ المهامِّ بجملةٍ واحدةٍ لكلِّ دورة (أثرُ المراقِب)", () => {
  it("done ⇒ ok، وdead ⇒ dead، والغائبُ حتى المهلة ⇒ timeout — دلالةُ الحلقةِ القديمةِ نفسُها", async () => {
    const h = harness((id, round) =>
      id === 1 && round >= 1 ? "done" : id === 2 ? "dead" : "pending",
    );
    const a = h.poller.wait(1, 1000);
    const b = h.poller.wait(2, 1000);
    const c = h.poller.wait(3, 1000);
    await h.flush();
    // الدورةُ الأولى بدأت فورًا بالمنتظِرِ الأوّل؛ الدورةُ التاليةُ تجمعُ الثلاثة
    await h.advance(400);
    expect(await a).toBe("ok");
    expect(await b).toBe("dead");
    await h.advance(400);
    expect(h.poller.stats().pending).toBe(1);
    await h.advance(400);
    expect(await c).toBe("timeout");
    expect(h.poller.stats().pending).toBe(0);
  });

  it("كلُّ المنتظِرين في جملةٍ واحدةٍ لكلِّ دورة (مقطّعةٍ بـchunk) — لا جملةَ لكلِّ سائق", async () => {
    const h = harness(() => "pending");
    const ws = [10, 11, 12, 13, 14].map((id) => h.poller.wait(id, 10_000));
    await h.flush();
    expect(h.calls).toEqual([[10]]);
    await h.advance(400);
    // دورةٌ واحدةٌ = جملتان فقط لخمسةِ منتظِرين (chunk=3)، لا خمسُ جمل
    expect(h.calls.slice(1)).toEqual([
      [10, 11, 12],
      [13, 14],
    ]);
    expect(h.poller.stats().pending).toBe(5);
    void ws;
  });

  it("المهمّةُ المرئيّةُ done في الدورةِ التي تبلغُ فيها المهلةُ ⇒ ok لا timeout (الحالةُ قبلَ المهلة)", async () => {
    const h = harness((_id, round) => (round >= 2 ? "done" : "pending"));
    const w = h.poller.wait(5, 800);
    await h.flush();
    await h.advance(400);
    await h.advance(400);
    expect(await w).toBe("ok");
  });

  it("خطأُ القراءةِ يُرمى إلى المنتظِر (لا يُبتلَعُ ولا يُحسَبُ نجاحًا)", async () => {
    const poller = createJobStatusPoller({
      query: async () => {
        throw new Error("db down");
      },
      schedule: () => undefined,
    });
    await expect(poller.wait(7, 1000)).rejects.toThrow("db down");
  });

  it("بلا منتظِرين لا جملَ — الحلقةُ تتوقّفُ ثمَّ تستأنفُ عندَ أوّلِ انتظار", async () => {
    const h = harness(() => "done");
    expect(await h.poller.wait(1, 1000)).toBe("ok");
    const n = h.calls.length;
    await h.advance(400);
    expect(h.calls.length).toBe(n);
    expect(await h.poller.wait(2, 1000)).toBe("ok");
    expect(h.calls.length).toBe(n + 1);
  });
});
