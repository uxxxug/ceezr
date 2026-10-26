/**
 * الغرض: اختبارُ أدواتِ LOAD-01-GAP-PROBE-RUN2 (2026-10-27) — مِجسُّ الحلقةِ المشتركُ، وحقولُ
 *   الجسرِ الجديدةُ (requestLeadMs/inflightAtEntry/connSeq/loopOverdueAtEntryMs)، وحقولُ المولّدِ
 *   (invokeMs/inflightAtInvoke/headersOverdueMs) وسطرا `gen_env`/`gen_loop`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 *
 * إثباتٌ محلّيٌّ لدلالةِ الحقولِ ولغيابِها حينَ لا يُطلبُ القياس — لا دليلَ سعةٍ ولا أثرَ A/B.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHttpBridge,
  type HttpGapTiming,
  stampRequestEvents,
} from "../../apps/gateway/src/realtime/http-bridge.ts";
import {
  type LoopSample,
  percentile,
  readMainThreadTimes,
  startLoopProbe,
} from "../../packages/infrastructure/observability/loop-probe.ts";

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("قيمةٌ غائبةٌ في الاختبار");
  return x;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("RUN2 — مِجسُّ الحلقة", () => {
  test("percentile: فارغٌ ⇒ null، والرتبُ على المرتَّب", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.99)).toBe(4);
  });

  test("انسدادٌ معلومٌ يظهرُ في lagMax وoverdueMs، وELU الصفريُّ يُسجَّلُ غيرَ متاحٍ لا صفرًا", async () => {
    const samples: LoopSample[] = [];
    const probe = startLoopProbe({
      intervalMs: 5,
      sampleMs: 200,
      emit: (s) => samples.push(s),
      elu: () => ({ idle: 0, active: 0 }), // كما في Bun 1.4: أصفار
    });
    await sleep(30);
    // انسدادٌ متزامنٌ 40ms: النبضةُ التاليةُ تتأخّرُ ≈ 35ms على الأقلّ.
    const t0 = performance.now();
    while (performance.now() - t0 < 40) {
      /* انشغال */
    }
    const overdue = probe.overdueMs();
    expect(overdue).toBeGreaterThan(25);
    await sleep(260);
    probe.stop();
    expect(samples.length).toBeGreaterThanOrEqual(1);
    const first = must(samples[0]);
    expect(first.ticks).toBeGreaterThan(0);
    expect(first.lagMaxMs).not.toBeNull();
    expect(must(first.lagMaxMs)).toBeGreaterThan(25);
    expect(first.eluAvailable).toBe(false);
    expect(first.elu).toBeNull();
    expect(first.pid).toBe(process.pid);
  });

  test("ELU غيرُ صفريٍّ يُحسبُ نسبةً، وقراءةُ خيطٍ غائبةٌ ⇒ null لا صفر", async () => {
    let active = 0;
    let idle = 0;
    const samples: LoopSample[] = [];
    const probe = startLoopProbe({
      intervalMs: 5,
      sampleMs: 60,
      emit: (s) => samples.push(s),
      readThread: () => null,
      elu: () => {
        active += 1;
        idle += 3;
        return { idle, active };
      },
    });
    await sleep(100);
    probe.stop();
    const s = must(samples[0]);
    expect(s.eluAvailable).toBe(true);
    expect(s.elu).toBe(0.25);
    expect(s.mainThreadCpuPct).toBeNull();
    expect(s.mainThreadRunqWaitPct).toBeNull();
  });

  test("أزمنةُ الخيطِ الرئيسيِّ تُقرأُ على لينكس", () => {
    const t = readMainThreadTimes();
    if (process.platform === "linux") {
      expect(t).not.toBeNull();
      expect(must(t).cpuSec).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("RUN2 — حقولُ الجسرِ الجديدة", () => {
  const gaps: HttpGapTiming[] = [];
  let url = "";
  let server: http.Server;
  let detach: () => void = () => {};
  beforeAll(async () => {
    server = http.createServer(
      createHttpBridge(
        {
          onGap: (g) => gaps.push(g),
          loopOverdueMs: () => 2.5,
          fetch: async (req: Request) => {
            if (new URL(req.url).pathname === "/slow") await sleep(80);
            return new Response("{}", { headers: { "X-Request-Id": "r" } });
          },
        },
        0,
      ),
    );
    detach = stampRequestEvents(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a !== null ? a.port : 0}`;
  });
  afterAll(async () => {
    detach();
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  test("requestLeadMs ≥ 0 بختمِ حدثِ الطلب، والمؤشّرُ ينتقلُ كما هو", async () => {
    gaps.length = 0;
    await (await fetch(`${url}/a`)).text();
    await sleep(20);
    const g = must(gaps[0]);
    expect(g.requestLeadMs).not.toBeNull();
    expect(must(g.requestLeadMs)).toBeGreaterThanOrEqual(0);
    expect(must(g.requestLeadMs)).toBeLessThan(1000);
    expect(g.loopOverdueAtEntryMs).toBe(2.5);
    expect(g.inflightAtEntry).toBeGreaterThanOrEqual(1);
  });

  test("inflightAtEntry يرى الطلباتِ المتزامنة، ويعودُ العدّادُ إلى الصفرِ بعدها", async () => {
    gaps.length = 0;
    await Promise.all([1, 2, 3].map(() => fetch(`${url}/slow`).then((r) => r.text())));
    await sleep(20);
    expect(gaps).toHaveLength(3);
    expect(Math.max(...gaps.map((g) => g.inflightAtEntry))).toBe(3);
    gaps.length = 0;
    await (await fetch(`${url}/a`)).text();
    await sleep(20);
    expect(must(gaps[0]).inflightAtEntry).toBe(1);
  });

  test("connSeq: الطلبُ الثاني على الاتصالِ نفسِهِ ⇒ 2", async () => {
    gaps.length = 0;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const get = (p: string) =>
      new Promise<void>((resolve, reject) => {
        http
          .get(`${url}${p}`, { agent }, (res) => {
            res.resume();
            res.on("end", () => resolve());
          })
          .on("error", reject);
      });
    await get("/a");
    await get("/a");
    agent.destroy();
    await sleep(20);
    expect(gaps.map((g) => g.connSeq)).toEqual([1, 2]);
  });

  test("بلا stampRequestEvents ⇒ requestLeadMs = null (لا يُستنتجُ)، وبلا loopOverdueMs ⇒ null", async () => {
    const local: HttpGapTiming[] = [];
    const s = http.createServer(
      createHttpBridge({ onGap: (g) => local.push(g), fetch: async () => new Response("x") }, 0),
    );
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const a = s.address();
    await (
      await fetch(`http://127.0.0.1:${typeof a === "object" && a !== null ? a.port : 0}/`)
    ).text();
    await sleep(20);
    s.closeAllConnections?.();
    await new Promise<void>((r) => s.close(() => r()));
    expect(must(local[0]).requestLeadMs).toBeNull();
    expect(must(local[0]).loopOverdueAtEntryMs).toBeNull();
  });
});

describe("RUN2 — حقولُ المولّد", () => {
  let base = "";
  let srv: ReturnType<typeof Bun.serve>;
  const runDir = mkdtempSync(join(tmpdir(), "run2-gen-"));
  beforeAll(() => {
    srv = Bun.serve({
      port: 0,
      fetch: async (req) => {
        if (new URL(req.url).pathname === "/slow") await sleep(60);
        return Response.json({ ok: true }, { headers: { "X-Request-Id": "g1" } });
      },
    });
    base = `http://127.0.0.1:${srv.port}`;
    process.env.GATEWAY_URL = base;
    process.env.RUN_DIR = runDir;
  });
  afterAll(() => {
    srv.stop(true);
    delete process.env.DISPATCH_TRACE_FILE;
  });

  test("invokeMs وinflightAtInvoke تُقاسانِ، وheadersOverdueMs = null بلا مِجسّ", async () => {
    const { http: call } = await import("../../deploy/capacity-run/load/lib.ts");
    const r = await call("/a");
    expect(r.ok).toBe(true);
    expect(r.invokeMs).not.toBeNull();
    expect(must(r.invokeMs)).toBeGreaterThanOrEqual(0);
    expect(must(r.invokeMs)).toBeLessThanOrEqual(must(r.ttfbMs));
    expect(r.inflightAtInvoke).toBe(1);
    expect(r.headersOverdueMs).toBeNull();
    const all = await Promise.all([call("/slow"), call("/slow"), call("/slow")]);
    expect(Math.max(...all.map((x) => x.inflightAtInvoke ?? 0))).toBe(3);
    // العدُّ يعودُ بعدَ قراءةِ الجسم.
    expect((await call("/a")).inflightAtInvoke).toBe(1);
  });

  test("خطأُ شبكةٍ: العدّادُ لا يتسرّب", async () => {
    const { http: call } = await import("../../deploy/capacity-run/load/lib.ts");
    const saved = process.env.GATEWAY_URL;
    process.env.GATEWAY_URL = "http://127.0.0.1:1";
    const bad = await call("/x", { timeoutMs: 2000 });
    process.env.GATEWAY_URL = saved;
    expect(bad.networkError).not.toBeNull();
    expect(bad.headersOverdueMs).toBeNull();
    expect((await call("/a")).inflightAtInvoke).toBe(1);
  });

  test("startClientLoopProbe: بلا علمٍ null، وبالعلمِ gen_env ثمَّ gen_loop ومؤشّرٌ في http", async () => {
    const lib = await import("../../deploy/capacity-run/load/lib.ts");
    delete process.env.DISPATCH_TRACE_FILE;
    expect(lib.startClientLoopProbe("p", "g")).toBeNull();
    const ev = `${runDir}/evidence/load-events.jsonl`;
    expect(existsSync(ev)).toBe(false);
    process.env.DISPATCH_TRACE_FILE = "/tmp/run2-on.jsonl";
    const { mkdirSync } = await import("node:fs");
    mkdirSync(`${runDir}/evidence`, { recursive: true });
    const stop = lib.startClientLoopProbe("p", "g", { intervalMs: 5, sampleMs: 50 });
    expect(stop).not.toBeNull();
    const r = await lib.http("/a");
    expect(r.headersOverdueMs).not.toBeNull();
    await sleep(120);
    must(stop)();
    expect((await lib.http("/a")).headersOverdueMs).toBeNull();
    const rows = readFileSync(ev, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(must(rows[0]).event).toBe("gen_env");
    expect(must(rows[0]).pid).toBe(process.pid);
    expect("maxHttpRequestsEnv" in must(rows[0])).toBe(true);
    const loops = rows.filter((x) => x.event === "gen_loop");
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(typeof must(loops[0]).lagP99Ms === "number" || must(loops[0]).lagP99Ms === null).toBe(
      true,
    );
  });
});

describe("RUN2 — أثرُ البوّابة (loop1s وhttpgap)", () => {
  test("loop1s يُصبُّ كلَّ ثانيةٍ، والحقولُ الجديدةُ تصلُ httpgap كما هي", async () => {
    const { createLoadTrace } = await import("../../apps/gateway/src/background/load-trace.ts");
    const file = join(mkdtempSync(join(tmpdir(), "run2-gw-")), "trace");
    const trace = must(createLoadTrace(file));
    expect(typeof trace.loopOverdueMs()).toBe("number");
    trace.onGap({
      requestId: "q1",
      method: "GET",
      pathname: "/v1/x",
      fetchMs: 1,
      writeHeadMs: 1.1,
      firstWriteMs: 1.2,
      endMs: 1.3,
      finishMs: 1.4,
      closed: false,
      requestLeadMs: 0.05,
      inflightAtEntry: 4,
      connSeq: 3,
      loopOverdueAtEntryMs: 0.7,
    });
    await sleep(1_250);
    await trace.stop();
    const rows = readFileSync(`${file}.load.jsonl`, "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const gap = must(rows.find((r) => r.k === "httpgap"));
    expect(gap.requestLeadMs).toBe(0.05);
    expect(gap.inflightAtEntry).toBe(4);
    expect(gap.connSeq).toBe(3);
    expect(gap.loopOverdueAtEntryMs).toBe(0.7);
    const loop = rows.filter((r) => r.k === "loop1s");
    expect(loop.length).toBeGreaterThanOrEqual(1);
    expect(must(loop[0]).eluAvailable === true || must(loop[0]).elu === null).toBe(true);
  });
});
