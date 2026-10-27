#!/usr/bin/env bun
/**
 * LOAD01-NOTICE-TRACE · الملحق د: كلفةُ أدواتِ CLAIM-WAIT نفسِها على postgres.js الحقيقيّ (محلّيًّا، لا مقعد).
 * يقيسُ زمنَ `select 1` الجداريَّ بأربعِ صيغٍ متناوبةٍ في كتل: خام، وProxy العدّ، وobserveQuery، وكلاهما.
 * والتناوبُ يوزّعُ انجرافَ الآلةِ على الصيغِ بالتساوي. والناتجُ تقديرٌ محلّيٌّ لا قياسٌ على المقعد.
 * الاستعمال: TEST_DATABASE_URL=… bun claim-wait-overhead.ts [N=4000] [conc=1]
 */
import { createSql } from "../../../packages/infrastructure/db/client.ts";
import {
  createCalibratedClock,
  instrumentPoolSql,
  observeQuery,
} from "../../../packages/infrastructure/notification/claim-split-probe.ts";

const url = process.env.TEST_DATABASE_URL;
if (url === undefined) throw new Error("TEST_DATABASE_URL");
const N = Number(process.argv[2] ?? 4000);
const CONC = Number(process.argv[3] ?? 1);
const raw = createSql({ connectionString: url, max: 5, prepare: false });
const pooled = instrumentPoolSql(raw);
const clock = createCalibratedClock();
clock.calibrate();
const now = () => clock.realtimeMs();
type Mode = "raw" | "proxy" | "observe" | "both";
const modes: Mode[] = ["raw", "proxy", "observe", "both"];
const lat: Record<Mode, number[]> = { raw: [], proxy: [], observe: [], both: [] };
for (let i = 0; i < 200; i++) await raw`select 1`;
const one = async (m: Mode) => {
  const s = m === "proxy" || m === "both" ? pooled.sql : raw;
  const t0 = performance.now();
  const q = s`select 1`;
  if (m === "observe" || m === "both") observeQuery(q, now);
  await q;
  return performance.now() - t0;
};
const BLOCK = 100;
for (let b = 0; b < N / BLOCK; b++) {
  for (const m of b % 2 === 0 ? modes : [...modes].reverse()) {
    for (let i = 0; i < BLOCK / CONC; i++) {
      const xs = await Promise.all(Array.from({ length: CONC }, () => one(m)));
      lat[m].push(...xs);
    }
  }
}
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};
const r3 = (x: number) => Math.round(1000 * x) / 1000;
const out = Object.fromEntries(
  modes.map((m) => {
    const xs = lat[m];
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return [m, { n: xs.length, meanMs: r3(mean), p50Ms: r3(q(xs, 0.5)), p99Ms: r3(q(xs, 0.99)) }];
  }),
);
const base = (out.raw as { meanMs: number }).meanMs;
console.log(
  JSON.stringify({
    conc: CONC,
    perMode: out,
    deltaVsRawUs: Object.fromEntries(
      modes.map((m) => [m, Math.round(((out[m] as { meanMs: number }).meanMs - base) * 1000)]),
    ),
    counterAfter: pooled.counter.read(),
    runtime: `bun ${Bun.version}`,
  }),
);
await raw.end();
