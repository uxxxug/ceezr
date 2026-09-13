#!/usr/bin/env bun
/**
 * # قياسُ ذهابِ الشبكةِ إلى قاعدةٍ — تفكيكٌ لا انطباعٌ
 *
 * يُجيبُ سؤالاً واحداً بالأرقامِ: **هل الزمنُ زمنُ شبكةٍ أم زمنُ قاعدةٍ؟**
 *
 * - `--where`: يطبعُ موضعَ المُنفِّذِ (مدينةً ومنطقةً) من `ipinfo.io`.
 * - `--tcp <host:port>…`: وسطُ زمنِ فتحِ اتّصالٍ (TCP) لكلِّ مُضيفٍ — بلا سِرٍّ،
 *   فالمُضيفُ عامٌّ وكلمةُ السرِّ لا تُستعمَلُ ههنا.
 * - `--query`: يُفكِّكُ الزمنَ على قاعدةٍ حقيقيّةٍ من `DATABASE_URL`: استعلامٌ
 *   فارغٌ · `pg_sleep` · عشرةٌ متسلسلةً · عشرةٌ في ذهابٍ واحدٍ · زمنُ التنفيذِ
 *   داخلَ الخادمِ. فإن كانَ «عشرةٌ في ذهابٍ واحدٍ» ≈ «استعلامٌ فارغٌ»، فالثابتُ
 *   **ذهابُ شبكةٍ** لا بطءَ محرِّكٍ.
 *
 * **لا يطبعُ الرابطَ ولا كلمةَ سرِّه** في نجاحٍ ولا في فشلٍ.
 *
 * ```bash
 * bun run scripts/measure-db-rtt.ts --where --tcp aws-0-ap-southeast-2.pooler.supabase.com:5432
 * DATABASE_URL=… bun run scripts/measure-db-rtt.ts --query
 * ```
 */

import { connect } from "node:net";

const argv = process.argv.slice(2);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};
const ms = (n: number): string => `${n.toFixed(1)}ms`;

/** يفتحُ اتّصالاً ويُغلِقُه، ويُعيدُ الزمنَ بالمِلّي ثانيةِ، أو `null` عندَ تعذُّرٍ. */
async function tcpOnce(host: string, port: number): Promise<number | null> {
  return await new Promise((resolve) => {
    const started = Bun.nanoseconds();
    const socket = connect({ host, port });
    const done = (value: number | null): void => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(10_000);
    socket.once("connect", () => done((Bun.nanoseconds() - started) / 1e6));
    socket.once("timeout", () => done(null));
    socket.once("error", () => done(null));
  });
}

async function measureTcp(targets: string[]): Promise<void> {
  for (const target of targets) {
    const [host = "", portText = "5432"] = target.split(":");
    const port = Number(portText);
    const samples: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const value = await tcpOnce(host, port);
      if (value !== null) samples.push(value);
    }
    if (samples.length === 0) {
      console.log(`  ${target} · لا يُبلَغُ`);
      continue;
    }
    console.log(`  ${target} · وسطٌ ${ms(median(samples))} · ${samples.length}/7 عيّنةً`);
  }
}

async function measureWhere(): Promise<void> {
  try {
    const response = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(15_000) });
    const info = (await response.json()) as { city?: string; region?: string; country?: string };
    console.log(
      `موضعُ المُنفِّذِ: ${info.city ?? "?"} · ${info.region ?? "?"} · ${info.country ?? "?"}`,
    );
  } catch {
    console.log("موضعُ المُنفِّذِ: لم يُقرَأْ (لا منفذَ خارجيَّ أو مهلةٌ).");
  }
}

async function measureQuery(): Promise<void> {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error("لا `DATABASE_URL` ولا `TEST_DATABASE_URL` — لا قياسَ استعلامٍ.");
    process.exitCode = 2;
    return;
  }
  const { SQL } = await import("bun");
  const sql = new SQL({ url, max: 1, idleTimeout: 5 });
  const timed = async (fn: () => Promise<unknown>, n: number): Promise<number> => {
    const samples: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const started = Bun.nanoseconds();
      await fn();
      samples.push((Bun.nanoseconds() - started) / 1e6);
    }
    return median(samples);
  };
  await sql`select 1`;
  const empty = await timed(() => sql`select 1`, 7);
  const sleep = await timed(() => sql`select pg_sleep(0.5)`, 3);
  const serial = await timed(async () => {
    for (let i = 0; i < 10; i += 1) await sql`select 1`;
  }, 3);
  const batched = await timed(() => sql`select generate_series(1,10)`, 5);
  const [row] = await sql`
    select extract(epoch from (clock_timestamp() - statement_timestamp())) * 1000 as server_ms
  `;
  await sql.end();
  console.log(`  استعلامٌ فارغٌ           ${ms(empty)}`);
  console.log(`  pg_sleep(0.5)          ${ms(sleep)} · الثابتُ ${ms(sleep - 500)}`);
  console.log(`  عشرةٌ متسلسلةً           ${ms(serial)}`);
  console.log(`  عشرةٌ في ذهابٍ واحدٍ      ${ms(batched)}`);
  console.log(`  تنفيذٌ داخلَ الخادمِ      ${Number(row?.server_ms ?? 0).toFixed(3)}ms`);
  const networkBound = Math.abs(batched - empty) < empty * 0.25;
  console.log(
    networkBound
      ? "الحُكمُ: الثابتُ **ذهابُ شبكةٍ**؛ عددُ الذهاباتِ هوَ الكلفةُ، لا المحرِّكُ."
      : "الحُكمُ: الدفعةُ أبطأُ من الواحدِ بفرقٍ مُعتَبَرٍ ⇒ للمحرِّكِ نصيبٌ يُفحَصُ.",
  );
}

if (argv.length === 0) {
  console.error("الاستعمالُ: --where | --tcp <host:port>… | --query");
  process.exit(2);
}
if (argv.includes("--where")) await measureWhere();
const tcpIndex = argv.indexOf("--tcp");
if (tcpIndex !== -1) {
  const targets = argv.slice(tcpIndex + 1).filter((a) => !a.startsWith("--"));
  console.log("زمنُ فتحِ اتّصالٍ (TCP):");
  await measureTcp(targets);
}
if (argv.includes("--query")) {
  console.log("تفكيكُ زمنِ الاستعلامِ:");
  await measureQuery();
}
