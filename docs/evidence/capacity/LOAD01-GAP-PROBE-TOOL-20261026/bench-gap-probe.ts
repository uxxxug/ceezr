/**
 * الغرض: قياسُ كلفةِ رصدِ حدودِ الردّ (httpgap) محليًا — قبل/بعد (أداةُ فصلِ الفجوةِ،
 * LOAD-01 · 2026-10-26). هذا اختبارُ تطويرٍ للأداةِ على جهازٍ محليٍّ بطيّةِ عودةٍ
 * (loopback) بلا شبكةٍ ولا حملٍ حقيقيٍّ — **ليسَ دليلًا على أثرِ A/B ولا على السعةِ**،
 * وحدودُهُ مسمّاةٌ في نتائجِهِ.
 *
 * المقارنةُ: نفسُ الخادمِ ونفسُ الجسرِ ونفسُ الردِّ — بدونِ `onGap` (لا تُلتقطُ طوابعٌ
 * أصلًا) مقابلَ معَ `onGap` موصولٍ بأثرِ الحملِ الحقيقيِّ (createLoadTrace → إلحاقُ
 * سطرِ httpgap بملفٍّ) لكلِّ طلبٍ. يُقاسُ زمنُ العميلِ الكاملُ لكلِّ نداءٍ ويُحسبُ
 * الفارقُ على المتوسطِ والوسيطِ.
 *
 * الاستدعاءُ: bun docs/evidence/capacity/LOAD01-GAP-PROBE-TOOL-20261026/bench-gap-probe.ts
 */
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLoadTrace } from "../../../../apps/gateway/src/background/load-trace.ts";
import { createHttpBridge } from "../../../../apps/gateway/src/realtime/http-bridge.ts";

const N = 2000;
const CONCURRENCY = 24;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface Mode {
  onGap: boolean;
}

async function runMode(mode: Mode): Promise<number[]> {
  const dir = mkdtempSync(join(tmpdir(), "gapbench-"));
  const traceFile = join(dir, "trace.jsonl");
  const trace = createLoadTrace(traceFile);
  if (trace === null) throw new Error("الأثر معطّل");
  const app = {
    ...(mode.onGap ? { onGap: (gap: Parameters<typeof trace.onGap>[0]) => trace.onGap(gap) } : {}),
    fetch: async () =>
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json", "X-Request-Id": "bench" },
      }),
  };
  const server = http.createServer(createHttpBridge(app, 0));
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}/bench`;

  const elapsed: number[] = [];
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= N) return;
      const started = performance.now();
      const res = await fetch(url);
      await res.text();
      elapsed[i] = performance.now() - started;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await trace.stop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return elapsed;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, mean, p50: p(0.5), p95: p(0.95) };
}

const off = stats(await runMode({ onGap: false }));
await sleep(200);
const on = stats(await runMode({ onGap: true }));

console.log(
  JSON.stringify(
    {
      tool: "bench-gap-probe",
      date: new Date().toISOString(),
      limits:
        "جهازٌ محليٌّ وطيّةُ عودةٍ بلا شبكةٍ — قياسُ تطويرٍ للأداةِ لا دليلُ أثرِ A/B ولا سعةٍ",
      config: { requests: N, concurrency: CONCURRENCY },
      off: { ...off, mean: Math.round(off.mean * 1000) / 1000, p50: Math.round(off.p50 * 1000) / 1000, p95: Math.round(off.p95 * 1000) / 1000 },
      on: { ...on, mean: Math.round(on.mean * 1000) / 1000, p50: Math.round(on.p50 * 1000) / 1000, p95: Math.round(on.p95 * 1000) / 1000 },
      delta: {
        mean: Math.round((on.mean - off.mean) * 1000) / 1000,
        p50: Math.round((on.p50 - off.p50) * 1000) / 1000,
        p95: Math.round((on.p95 - off.p95) * 1000) / 1000,
      },
    },
    null,
    2,
  ),
);
