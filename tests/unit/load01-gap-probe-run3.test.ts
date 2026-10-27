/**
 * الغرض: اختبارُ بوابةِ `fetch` المقيسةِ في مولّدِ الحمل (LOAD-01-GAP-PROBE-RUN3، 2026-10-27):
 *   دلالةُ السعة (FIFO، ≤ cap، الإلغاءُ، التحريرُ)، وأنَّ «بلا سعة» يبقى متزامنًا بلا تغييرٍ في السلوك، وأنَّ
 *   الانتظارَ يُسجَّلُ ولا يُخفى (`ttfbMs` يشملُه)، وسطرا `gen_env.fetchCap` و`gen_sem`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 *
 * إثباتٌ محلّيٌّ لدلالةِ الأداة — لا دليلَ سعةٍ ولا حكمَ تجربة.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FetchGate,
  fetchGate,
  parseFetchCap,
  resetFetchGateForTest,
  type SlotInfo,
  withFetchSlot,
} from "../../deploy/capacity-run/load/fetch-gate.ts";

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("قيمةٌ غائبةٌ في الاختبار");
  return x;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("RUN3 — parseFetchCap", () => {
  test("غيرُ مضبوطٍ أو فارغٌ ⇒ null؛ عددٌ صحيحٌ ⇒ نفسُه؛ غيرُ ذلك ⇒ خطأٌ صريح", () => {
    expect(parseFetchCap(undefined)).toBeNull();
    expect(parseFetchCap("")).toBeNull();
    expect(parseFetchCap("256")).toBe(256);
    for (const bad of ["0", "-1", "2.5", "abc", "65536"]) {
      expect(() => parseFetchCap(bad)).toThrow();
    }
  });
});

describe("RUN3 — FetchGate", () => {
  test("بلا سعةٍ: tryAcquire متزامنٌ دائمًا، انتظارٌ صفريّ، والعدّاداتُ تقيسُ الإرسال", () => {
    const g = new FetchGate(null);
    const slots = Array.from({ length: 300 }, () => must(g.tryAcquire()));
    expect(slots.every((s) => s.queueWaitMs === 0 && s.waitersAtInvoke === 0)).toBe(true);
    expect(must(slots[299]).activeAtSend).toBe(300);
    expect(must(slots[299]).demandAtInvoke).toBe(300);
    for (let i = 0; i < 300; i++) g.release();
    const s = g.takeSample();
    expect(s).toMatchObject({
      cap: null,
      invokes: 300,
      sends: 300,
      completions: 300,
      activeMax: 300,
    });
    expect(s.waitersMax).toBe(0);
    expect(s.waitedSends).toBe(0);
  });

  test("بسعةٍ 2: الثالثُ ينتظرُ بترتيبِ الوصول، والانتظارُ يُقاسُ بالساعةِ نفسِها، ولا يتجاوزُ الجاري السعة", async () => {
    let t = 1000;
    const g = new FetchGate(2, () => t);
    const a = must(g.tryAcquire());
    const b = must(g.tryAcquire());
    expect(g.tryAcquire()).toBeNull();
    const order: number[] = [];
    const c = g.acquire().then((s) => {
      order.push(3);
      return s;
    });
    const d = g.acquire().then((s) => {
      order.push(4);
      return s;
    });
    expect(g.waitingCount).toBe(2);
    expect([a.activeAtSend, b.activeAtSend]).toEqual([1, 2]);
    t = 1040;
    g.release();
    const sc: SlotInfo = await c;
    expect(sc.queueWaitMs).toBe(40);
    expect(sc.waitersAtInvoke).toBe(0);
    expect(sc.demandAtInvoke).toBe(3);
    expect(sc.activeAtSend).toBe(2);
    t = 1100;
    g.release();
    const sd = await d;
    expect(sd.queueWaitMs).toBe(100);
    expect(sd.waitersAtInvoke).toBe(1);
    expect(sd.demandAtInvoke).toBe(4);
    expect(order).toEqual([3, 4]);
    expect(g.activeCount).toBe(2);
    const s = g.takeSample();
    expect(s).toMatchObject({ invokes: 4, sends: 4, completions: 2, activeMax: 2, waitersMax: 2 });
    expect(s.waitedSends).toBe(2);
    expect(s.waitSumMs).toBe(140);
    expect(s.waitMaxMs).toBe(100);
    // العيّنةُ التاليةُ تبدأُ من الحالِ الآنيّ
    expect(g.takeSample()).toMatchObject({ invokes: 0, sends: 0, activeMax: 2, waitersMax: 0 });
  });

  test("طلبٌ جديدٌ لا يتخطّى المنتظرين ولو تحرّرتْ فتحة (FIFO صارم)", async () => {
    const g = new FetchGate(1);
    must(g.tryAcquire());
    const w = g.acquire();
    g.release(); // تُسلَّمُ للمنتظرِ مباشرةً
    expect(g.tryAcquire()).toBeNull();
    expect((await w).activeAtSend).toBe(1);
  });

  test("الإلغاءُ أثناءَ الانتظارِ يُخرجُ المنتظرَ بسببِ الإشارةِ نفسِه، ولا تتسرّبُ فتحة", async () => {
    const g = new FetchGate(1);
    must(g.tryAcquire());
    const ac = new AbortController();
    const p = g.acquire(ac.signal);
    ac.abort(new DOMException("t", "TimeoutError"));
    await expect(p).rejects.toMatchObject({ name: "TimeoutError" });
    expect(g.waitingCount).toBe(0);
    g.release();
    expect(g.activeCount).toBe(0);
    expect(g.takeSample().aborted).toBe(1);
    // إشارةٌ ملغاةٌ مسبقًا
    must(g.tryAcquire());
    const pre = AbortSignal.abort(new DOMException("t", "TimeoutError"));
    await expect(g.acquire(pre)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(g.waitingCount).toBe(0);
  });

  test("release بلا فتحةٍ خطأٌ صريحٌ لا عدٌّ سالب", () => {
    expect(() => new FetchGate(4).release()).toThrow();
  });

  test("withFetchSlot يحرّرُ الفتحةَ عندَ الرمي", async () => {
    process.env.LOAD_GEN_FETCH_CAP = "1";
    resetFetchGateForTest();
    await expect(
      withFetchSlot(undefined, async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(fetchGate().activeCount).toBe(0);
    delete process.env.LOAD_GEN_FETCH_CAP;
    resetFetchGateForTest();
  });
});

describe("RUN3 — http() عبرَ البوابة", () => {
  let srv: ReturnType<typeof Bun.serve>;
  let active = 0;
  let peak = 0;
  const runDir = mkdtempSync(join(tmpdir(), "run3-gen-"));
  beforeAll(() => {
    srv = Bun.serve({
      port: 0,
      fetch: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(40);
        active -= 1;
        return Response.json({ ok: true }, { headers: { "X-Request-Id": "g3" } });
      },
    });
    process.env.GATEWAY_URL = `http://127.0.0.1:${srv.port}`;
    process.env.RUN_DIR = runDir;
  });
  afterEach(() => {
    delete process.env.LOAD_GEN_FETCH_CAP;
    resetFetchGateForTest();
    peak = 0;
  });
  afterAll(() => {
    srv.stop(true);
    delete process.env.DISPATCH_TRACE_FILE;
  });

  test("بلا سعة: الحقولُ موجودة، الانتظارُ صفر، والخادمُ يرى التزامنَ كاملًا", async () => {
    const { http: call } = await import("../../deploy/capacity-run/load/lib.ts");
    const all = await Promise.all(Array.from({ length: 5 }, () => call("/a")));
    expect(all.every((r) => r.ok && r.queueWaitMs === 0 && r.fetchCap === null)).toBe(true);
    expect(Math.max(...all.map((r) => must(r.activeAtSend)))).toBe(5);
    expect(peak).toBe(5);
  });

  test("بسعة 2: الخادمُ لا يرى أكثرَ من 2، والانتظارُ مُسجَّلٌ ومشمولٌ في ttfbMs (لا يُخفى)", async () => {
    process.env.LOAD_GEN_FETCH_CAP = "2";
    resetFetchGateForTest();
    const { http: call } = await import("../../deploy/capacity-run/load/lib.ts");
    const all = await Promise.all(Array.from({ length: 6 }, () => call("/a")));
    expect(all.every((r) => r.ok && r.fetchCap === 2)).toBe(true);
    expect(peak).toBeLessThanOrEqual(2);
    expect(Math.max(...all.map((r) => must(r.activeAtSend)))).toBeLessThanOrEqual(2);
    expect(Math.max(...all.map((r) => must(r.demandAtInvoke)))).toBe(6);
    expect(Math.max(...all.map((r) => must(r.inflightAtInvoke)))).toBe(6);
    const waited = all.filter((r) => must(r.queueWaitMs) > 0);
    expect(waited.length).toBe(4);
    for (const r of all) {
      expect(must(r.ttfbMs)).toBeGreaterThanOrEqual(must(r.queueWaitMs) + must(r.invokeMs) - 0.02);
    }
    // أطولُ انتظارٍ ≈ دورتانِ من 40ms
    expect(Math.max(...waited.map((r) => must(r.queueWaitMs)))).toBeGreaterThan(60);
    expect(fetchGate().activeCount).toBe(0);
  });

  test("المهلةُ تشملُ الانتظار: منتظرٌ تنقضي مهلتُه يفشلُ بخطأِ المهلةِ نفسِه ولا يحجزُ فتحة", async () => {
    process.env.LOAD_GEN_FETCH_CAP = "1";
    resetFetchGateForTest();
    const { http: call } = await import("../../deploy/capacity-run/load/lib.ts");
    const [a, b] = await Promise.all([call("/a"), call("/a", { timeoutMs: 10 })]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.networkError).toBe("TimeoutError");
    expect(b.queueWaitMs).toBeNull();
    expect(fetchGate().activeCount).toBe(0);
    expect(fetchGate().waitingCount).toBe(0);
  });

  test("startClientLoopProbe: gen_env يسجّلُ السعةَ المفعولة، وgen_sem كلَّ فترةٍ بالعدّادات", async () => {
    process.env.LOAD_GEN_FETCH_CAP = "3";
    resetFetchGateForTest();
    const lib = await import("../../deploy/capacity-run/load/lib.ts");
    delete process.env.DISPATCH_TRACE_FILE;
    expect(lib.startClientLoopProbe("p", "g")).toBeNull();
    const ev = `${runDir}/evidence/load-events.jsonl`;
    expect(existsSync(ev)).toBe(false);
    process.env.DISPATCH_TRACE_FILE = "/tmp/run3-on.jsonl";
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    const stop = must(lib.startClientLoopProbe("p", "g", { intervalMs: 5, sampleMs: 50 }));
    await Promise.all(Array.from({ length: 5 }, () => lib.http("/a")));
    await sleep(130);
    stop();
    const rows = readFileSync(ev, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const env = must(rows.find((r) => r.event === "gen_env"));
    expect(env.fetchCapEnv).toBe("3");
    expect(env.fetchCap).toBe(3);
    const sem = rows.filter((r) => r.event === "gen_sem");
    expect(sem.length).toBeGreaterThanOrEqual(2);
    const tot = (k: string) => sem.reduce((a, r) => a + Number(r[k]), 0);
    expect(tot("invokes")).toBe(5);
    expect(tot("sends")).toBe(5);
    expect(tot("completions")).toBe(5);
    expect(tot("waitedSends")).toBe(2);
    expect(Math.max(...sem.map((r) => Number(r.activeMax)))).toBeLessThanOrEqual(3);
    expect(must(sem[0]).cap).toBe(3);
  });
});
