#!/usr/bin/env bun
/**
 * الغرض: سائقُ جولةِ الحملِ الموزَّعِ في CI — يُقلعُ الهدفَ (بوّابةٌ حقيقيّةٌ)
 *        والمنسّقَ والمولّداتِ **عملياتِ نظامٍ حقيقيّةٍ منفصلةً**، يقرأُ حُكمَ
 *        المنسّقِ بعدَ اكتمالِ الجولةِ، ويخرجُ برمزِ الحُكمِ. ووضعُ السالبةِ
 *        المزروعةِ (`--negative missing-generator`) يُقلعُ مولّداً أقلَّ من
 *        المُعلَّنِ ويُثبتُ أنّ الغيابَ يُفشِلُ الجولةَ باسمِهِ لا أن يُسكَتَ عنهُ.
 * الحالة: منفَّذ — الشقُّ المملوكُ للمستودَعِ من `F9-03` (برهانُ CI).
 * ينتمي إلى: bench/distributed
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ CI `distributed-load`، ورفعُ المولّداتِ إلى
 *        مضيفينَ منفصلينَ يومَ يُفتحُ `REQ-06` — البروتوكولُ لا يتغيّرُ.
 * ملاحظات مستقبلية: «مضيفونَ منفصلونَ» في CI هم عملياتٌ على المُنفِّذِ نفسِهِ،
 *        والدَّرزُ بينَهم HTTP لا ذاكرةَ مشتركةَ — وهذا أقصى ما يُثبَتُ داخلَ
 *        المستودعِ، والمضيفُ الفعليُّ حاجزٌ خارجيٌّ مُعلَنٌ لا يُدَّعى.
 *
 * الاستخدام:
 *   BENCH_DATABASE_URL=postgres://… bun bench/distributed/run-distributed-load.ts \
 *     --rate 30 --duration-ms 3000 --generators 3 [--negative missing-generator]
 */

import { join as joinPath } from "node:path";

interface DriverOptions {
  readonly rate: number;
  readonly durationMs: number;
  readonly generators: number;
  readonly coordinatorPort: number;
  readonly targetPort: number;
  readonly method: string;
  readonly schedulingLagBudgetMs: number;
  readonly deadlineMs: number;
  readonly negative: "missing-generator" | "dead-mid-round" | null;
}

function parseArgs(argv: readonly string[]): DriverOptions {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--negative") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--negative يتبعه قيمتُه: missing-generator أو dead-mid-round");
      }
      if (value !== "missing-generator" && value !== "dead-mid-round") {
        throw new Error(`قيمةُ --negative غيرُ معروفةٍ: ${value}`);
      }
      flags.add(`${arg}=${value}`);
      index += 1;
      continue;
    }
    if (arg === undefined) throw new Error("وسيطٌ مجهولٌ ناقصٌ.");
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`وسيطٌ ناقصُ القيمةِ: ${arg}`);
    values[arg] = next;
    index += 1;
  }
  return {
    rate: positiveNumber("--rate", values["--rate"] ?? "30"),
    durationMs: positiveNumber("--duration-ms", values["--duration-ms"] ?? "3000"),
    generators: positiveInteger("--generators", values["--generators"] ?? "3"),
    coordinatorPort: positiveInteger("--port", values["--port"] ?? "4300"),
    targetPort: positiveInteger("--target-port", values["--target-port"] ?? "4301"),
    method: (values["--method"] ?? "GET").toUpperCase(),
    schedulingLagBudgetMs: positiveNumber(
      "--scheduling-lag-budget-ms",
      values["--scheduling-lag-budget-ms"] ?? "250",
    ),
    deadlineMs: positiveNumber("--deadline-ms", values["--deadline-ms"] ?? "30000"),
    negative: flags.has("--negative=missing-generator")
      ? "missing-generator"
      : flags.has("--negative=dead-mid-round")
        ? "dead-mid-round"
        : null,
  };
}

function positiveNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} يجبُ أن يكونَ رقماً موجباً منتهياً ووصلَ: ${raw}`);
  return value;
}

function positiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} يجبُ أن يكونَ عدداً صحيحاً موجباً ووصلَ: ${raw}`);
  return value;
}

const options = parseArgs(process.argv.slice(2));
const DATABASE_URL = process.env.BENCH_DATABASE_URL ?? "";
if (DATABASE_URL === "") {
  console.error("❌ عيّن BENCH_DATABASE_URL لقاعدةٍ بها كلُّ الهجراتِ مطبَّقةً.");
  process.exit(2);
}

const HERE = import.meta.dir;
const children: ReturnType<typeof Bun.spawn>[] = [];

function spawn(script: string, args: readonly string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["bun", "run", joinPath(HERE, script), ...args], {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(child);
  return child;
}

async function waitForHttp(url: string, timeoutMs: number, label: string): Promise<void> {
  const startedAt = performance.now();
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // لم يُقلعْ بعدُ — إعادةُ المحاولةِ حتى المهلةِ.
    }
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`مهلةُ انتظارِ ${label} على ${url}.`);
    }
    await Bun.sleep(250);
  }
}

interface VerdictResponse {
  readonly status: "pending" | "finalized";
  readonly fingerprint?: string;
  readonly verdict?: {
    readonly passed: boolean;
    readonly rules: readonly {
      readonly rule: string;
      readonly passed: boolean;
      readonly detail: string;
    }[];
  };
}

async function pollVerdict(timeoutMs: number): Promise<VerdictResponse> {
  const startedAt = performance.now();
  for (;;) {
    const response = await fetch(`http://127.0.0.1:${options.coordinatorPort}/verdict`);
    if (response.ok) {
      const body = (await response.json()) as VerdictResponse;
      if (body.status === "finalized" && body.verdict !== undefined) return body;
    }
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`مهلةُ انتظارِ حُكمِ المنسّقِ (${timeoutMs}ms).`);
    }
    await Bun.sleep(250);
  }
}

function cleanup(): void {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // عمليةٌ ماتتْ أصلًا — لا شيءَ يُنتظَرُ منها.
    }
  }
  // مهلةٌ قصيرةٌ للخروجِ الرشيقِ ثم قتلٌ قاسٍ لمن بقيَ: اليتيمُ على المنفذِ يُفسدُ
  // الجولةَ التاليةَ (EADDRINUSE) فلا يُترَكُ حيًّا.
  const deadlineAt = performance.now() + 2_000;
  while (children.some((child) => child.exitCode === null) && performance.now() < deadlineAt) {
    // انتظارٌ نشطٌ قصيرٌ — الأطفالُ قليلونَ والخروجُ الرشيقُ سريعٌ.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  for (const child of children) {
    if (child.exitCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ماتَ بينَ الفحصِ والقتلِ.
      }
    }
  }
}

async function main(): Promise<number> {
  const target = `http://127.0.0.1:${options.targetPort}/health`;
  console.log(
    `[driver] جولةٌ: ${options.generators} مولّداتٍ · ${options.rate}/ث · ${options.durationMs}ms${options.negative === null ? "" : ` · سالبةٌ مزروعةٌ (${options.negative})`}.`,
  );

  spawn("target-gateway.ts", ["--port", String(options.targetPort)], {
    BENCH_DATABASE_URL: DATABASE_URL,
  });
  await waitForHttp(target, 30_000, "البوّابةِ الهدفِ");

  spawn("coordinator.ts", [
    "--target",
    target,
    "--method",
    options.method,
    "--rate",
    String(options.rate),
    "--duration-ms",
    String(options.durationMs),
    "--generators",
    String(options.generators),
    "--port",
    String(options.coordinatorPort),
    "--scheduling-lag-budget-ms",
    String(options.schedulingLagBudgetMs),
    "--deadline-ms",
    String(options.deadlineMs),
  ]);
  await waitForHttp(`http://127.0.0.1:${options.coordinatorPort}/verdict`, 15_000, "المنسّقِ");

  // السالباتُ المزروعةُ: الغيابُ أو الموتُ وسطَ الجولةِ يجبُ أن يُفشِلَ الجولةَ باسمِ الغائبِ.
  const generatorsToStart =
    options.negative === "missing-generator" ? options.generators - 1 : options.generators;
  const generatorChildren: ReturnType<typeof spawn>[] = [];
  for (let index = 0; index < generatorsToStart; index += 1) {
    generatorChildren.push(
      spawn("generator.ts", [
        "--coordinator",
        `http://127.0.0.1:${options.coordinatorPort}`,
        "--generator-id",
        `gen-${index + 1}`,
      ]),
    );
  }
  if (options.negative === "dead-mid-round") {
    // البوّابةُ تُفتحُ فورَ اكتمالِ الانضمامِ، فالقتلُ بعدَ ثانيةٍ ونصفٍ يقعُ في وسطِ
    // نافذةِ الإطلاقِ: مولّدٌ ماتَ بعدَ أن جدَّلَ وقبلَ أن يُبلِّغَ — والآخرونَ يُبلِّغونَ.
    const victim = generatorChildren[generatorChildren.length - 1];
    if (victim === undefined) throw new Error("لا ضحيّةَ للسالبةِ — عدُّ المولّداتِ صفرٌ.");
    await Bun.sleep(Math.min(1_500, Math.floor(options.durationMs / 2)));
    victim.kill("SIGKILL");
    console.log("[driver] السالبةُ: قتلُ المولّدِ الأخيرِ (SIGKILL) وسطَ نافذةِ الإطلاقِ.");
  }

  const body = await pollVerdict(options.deadlineMs + 30_000);
  const verdict = body.verdict;
  if (verdict === undefined) throw new Error("حُكمٌ بلا قواعدَ — مُشوَّهٌ.");
  for (const rule of verdict.rules) {
    console.log(`  ${rule.passed ? "✅" : "❌"} ${rule.rule}: ${rule.detail}`);
  }

  if (options.negative !== null) {
    const missingRule = verdict.rules.find((rule) => rule.rule === "all-generators-reported");
    if (verdict.passed) {
      console.error("❌ السالبةُ المزروعةُ: جولةٌ ناقصةٌ المولّداتِ حُكِمَت ناجحةً — الحَكَمُ أعمى.");
      return 1;
    }
    if (missingRule === undefined || missingRule.passed) {
      console.error(
        "❌ السالبةُ المزروعةُ: فشلَ الحُكمُ لكنَّ قاعدةَ البلاغِ لم تُرَ — فشلٌ لسببٍ آخرَ لا الغيابَ.",
      );
      return 1;
    }
    console.log("✅ السالبةُ المزروعةُ: المولّدُ الغائبُ أفسدَ الجولةَ بقاعدةِ البلاغِ — لا خسارةَ صامتةَ.");
    return 0;
  }

  return verdict.passed ? 0 : 1;
}

let exitCode = 2;
try {
  exitCode = await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  exitCode = 2;
} finally {
  // التنظيفُ قبلَ الخروجِ لا بعدهُ: `process.exit` لا يُنفِّذُ finally، فالخروجُ
  // مؤجَّلٌ إلى ما بعدَ قتلِ الأطفالِ — واليتيمُ على المنفذِ يُفسدُ الجولةَ التاليةَ.
  cleanup();
}
process.exit(exitCode);
