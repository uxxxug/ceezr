#!/usr/bin/env bun
/**
 * الغرض: المنسّقُ العالميُّ لجولةِ الحملِ الموزَّعِ — عمليةٌ مستقلّةٌ لا تعرفُ
 *        المولّداتِ إلا عبرَ HTTP: تُسجِّلُ الانضمامَ، تُقسِّمُ الخطةَ تقسيماً
 *        حتميّاً، تفتحُ البوّابةَ حينَ يكتملُ العددُ المُعلَّنُ، تجمعُ التقاريرَ،
 *        وتُصدرَ الحُكمَ. المولّدُ الذي ماتَ أو غابَ يُفشِلُ الجولةَ باسمِهِ —
 *        لا خسارةَ صامتةَ في جولةِ قياسٍ.
 * الحالة: منفَّذ — الشقُّ المملوكُ للمستودَعِ من `F9-03` · `OPS-004`.
 * ينتمي إلى: bench/distributed
 * يُتوقع أن يستخدمه لاحقاً: `F10-01` (خطُّ الأساسِ) حين يُرفَعُ المولّدُ إلى
 *        مضيفينَ حقيقيّينَ منفصلينَ (`REQ-06`) — البروتوكولُ نفسُهُ لا يتغيّرُ.
 * ملاحظات مستقبلية: المهلةُ النهائيّةُ (deadline) جزءٌ من العقدِ لا رفاهيةٍ:
 *        جولةٌ لا يكتملُ عددُها تُحكَمُ فاشلةً بعدَ المهلةِ لا أن تُعلَّقَ إلى الأبد.
 *
 * الاستخدام:
 *   bun bench/distributed/coordinator.ts --target http://127.0.0.1:4301/health \
 *     --rate 30 --duration-ms 3000 --generators 3 --port 4300 \
 *     [--method GET] [--scheduling-lag-budget-ms 250] [--deadline-ms 30000] \
 *     [--evidence-dir docs/evidence/distributed]
 */

import { mkdir, writeFile } from "node:fs/promises";
import {
  computeDistributedLoadFingerprint,
  type DistributedLoadPlan,
  decideDistributedLoadVerdict,
  type GeneratorReport,
  partitionForGenerator,
} from "../../../../scripts/lib/bench-distributed-plan.ts";

interface CoordinatorOptions extends DistributedLoadPlan {
  readonly port: number;
  /** مهلةُ الجولةِ كلِّها: من إقلاعِ المنسّقِ حتى إصدارِ الحُكمِ شاءَت التقاريرُ أم شحت. */
  readonly deadlineMs: number;
  readonly evidenceDir: string;
}

function usage(): string {
  return [
    "الاستخدام: bun bench/distributed/coordinator.ts --target URL --rate N --duration-ms N --generators N --port N",
    "  --method GET|POST|...              الافتراضي: GET",
    "  --scheduling-lag-budget-ms N       سقفُ p95 انزلاقِ الجدولةِ لكلِّ مولّدٍ (الافتراضي: 250)",
    "  --deadline-ms N                    مهلةُ الجولةِ كلِّها (الافتراضي: 30000)",
    "  --evidence-dir DIR                 موضعُ الدليل (الافتراضي: docs/evidence/distributed)",
    "  --help                             يطبع هذا النص",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): CoordinatorOptions {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === undefined) throw new Error("وسيطٌ مجهولٌ ناقصٌ.");
    if (next === undefined) throw new Error(`وسيطٌ ناقصُ القيمةِ: ${arg}`);
    values[arg] = next;
    index += 1;
  }
  const required = ["--target", "--rate", "--duration-ms", "--generators", "--port"] as const;
  for (const flag of required) {
    if (values[flag] === undefined) throw new Error(`${flag} واجبٌ.`);
  }
  const url = new URL(values["--target"] ?? "");
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--target يجبُ أن يبدأَ بـ http:// أو https:// ووصلَ: ${values["--target"]}`);
  }
  return {
    target: url.toString(),
    method: (values["--method"] ?? "GET").toUpperCase(),
    arrivalRatePerSecond: positiveNumber("--rate", values["--rate"] ?? ""),
    durationMs: positiveNumber("--duration-ms", values["--duration-ms"] ?? ""),
    generators: positiveInteger("--generators", values["--generators"] ?? ""),
    schedulingLagBudgetP95Ms: positiveNumber(
      "--scheduling-lag-budget-ms",
      values["--scheduling-lag-budget-ms"] ?? "250",
    ),
    port: positiveInteger("--port", values["--port"] ?? ""),
    deadlineMs: positiveNumber("--deadline-ms", values["--deadline-ms"] ?? "30000"),
    evidenceDir: values["--evidence-dir"] ?? "docs/evidence/distributed",
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

interface CoordinatorState {
  /** فهرسُ المولّدِ بالترتيبِ — أولُ من انضمَّ أخذَ ٠، والفهرسُ لا يُعادُ. */
  joinedIds: string[];
  reports: Map<number, GeneratorReport>;
  startGate: boolean;
  /** الحُكمُ بعدَ الإصدارِ — يُقرأُ من `/verdict` حتى يُنهيَ السائقُ العمليةَ. */
  verdict: ReturnType<typeof decideDistributedLoadVerdict> | null;
}

const options = parseArgs(process.argv.slice(2));
const fingerprint = computeDistributedLoadFingerprint(options);
const state: CoordinatorState = {
  joinedIds: [],
  reports: new Map(),
  startGate: false,
  verdict: null,
};
let finalized = false;
let deadline: ReturnType<typeof setTimeout> | null = null;

const server = Bun.serve({
  port: options.port,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/join") {
      return handleJoin(await request.json());
    }
    if (request.method === "POST" && url.pathname === "/report") {
      return handleReport(await request.json());
    }
    if (request.method === "GET" && url.pathname === "/verdict") {
      if (!finalized || state.verdict === null) {
        return Response.json({ status: "pending", fingerprint });
      }
      return Response.json({ status: "finalized", fingerprint, verdict: state.verdict });
    }
    return new Response("not found", { status: 404 });
  },
});

function handleJoin(body: unknown): Response {
  if (finalized) return Response.json({ status: "finalized" });
  const generatorId = readGeneratorId(body);
  if (!state.joinedIds.includes(generatorId)) state.joinedIds.push(generatorId);
  if (state.joinedIds.length < options.generators) {
    return Response.json({
      status: "waiting",
      joined: state.joinedIds.length,
      expected: options.generators,
    });
  }
  state.startGate = true;
  const index = state.joinedIds.indexOf(generatorId);
  const partition = partitionForGenerator(options, index);
  return Response.json({
    status: "start",
    index,
    partition,
    fingerprint,
    plan: {
      target: options.target,
      method: options.method,
      arrivalRatePerSecond: options.arrivalRatePerSecond,
      durationMs: options.durationMs,
      generators: options.generators,
      schedulingLagBudgetP95Ms: options.schedulingLagBudgetP95Ms,
    },
  });
}

function handleReport(body: unknown): Response {
  if (finalized) return Response.json({ status: "finalized" });
  const report = readGeneratorReport(body);
  state.reports.set(report.index, report);
  if (state.reports.size >= options.generators) {
    finalize();
    return Response.json({ status: "finalized" });
  }
  return Response.json({ status: "stored", received: state.reports.size });
}

function readGeneratorId(body: unknown): string {
  if (typeof body !== "object" || body === null) throw new Error("جسمُ الطلبِ ليس كائناً.");
  const id = (body as { generatorId?: unknown }).generatorId;
  if (typeof id !== "string" || id === "") throw new Error("generatorId واجبٌ نصّاً غيرَ فارغٍ.");
  return id;
}

function readGeneratorReport(body: unknown): GeneratorReport {
  if (typeof body !== "object" || body === null) throw new Error("جسمُ الطلبِ ليس كائناً.");
  const record = body as Record<string, unknown>;
  const report: GeneratorReport = {
    generatorId: String(record.generatorId ?? ""),
    index: Number(record.index),
    fingerprint: String(record.fingerprint ?? ""),
    scheduled: Number(record.scheduled),
    launched: Number(record.launched),
    failed: Number(record.failed),
    schedulingLagP95Ms: Number(record.schedulingLagP95Ms),
  };
  if (
    report.generatorId === "" ||
    !Number.isInteger(report.index) ||
    !Number.isFinite(report.scheduled) ||
    !Number.isFinite(report.launched) ||
    !Number.isFinite(report.failed) ||
    !Number.isFinite(report.schedulingLagP95Ms)
  ) {
    throw new Error("تقريرُ المولّدِ ناقصٌ أو مُشوَّهٌ.");
  }
  return report;
}

async function finalize(): Promise<void> {
  if (finalized) return;
  finalized = true;
  if (deadline !== null) clearTimeout(deadline);
  const verdict = decideDistributedLoadVerdict(options, [...state.reports.values()]);
  state.verdict = verdict;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir(options.evidenceDir, { recursive: true });
  const jsonPath = `${options.evidenceDir}/f9-03-${stamp}-distributed-load.json`;
  const envelope = {
    item: "F9-03 (repo-owned half)",
    classification:
      "distributed load generator architecture proof: separate processes coordinated over HTTP with a fingerprinted plan; NOT a capacity number, NOT production load, NOT multi-region hosts",
    plan: options,
    fingerprint,
    coordinator: { pid: process.pid, port: options.port, runtime: `Bun ${Bun.version}` },
    generators: [...state.reports.values()].sort((left, right) => left.index - right.index),
    verdict,
  };
  await writeFile(jsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  const lines = [
    "# دليلُ جولةِ الحملِ الموزَّعِ — F9-03 (الشقُّ المملوكُ للمستودَعِ)",
    "",
    `- الخطةُ: ${options.method} ${options.target} بمعدلِ ${options.arrivalRatePerSecond}/ث لمدةِ ${options.durationMs}ms على ${options.generators} مولّداتٍ.`,
    `- البصمةُ: ${fingerprint}.`,
    `- المولّداتُ المُبلِّغةُ: ${state.reports.size}/${options.generators}.`,
    ...verdict.rules.map((rule) => `- ${rule.passed ? "✅" : "❌"} ${rule.rule}: ${rule.detail}`),
    "",
    `> التصنيفُ: هذا الدليلُ يُثبتُ بنيةَ التوليدِ الموزَّعِ (عملياتٌ منفصلةٌ عبرَ منسّقٍ عالميٍّ بخطةٍ مُبصَّمةٍ) لا رقمَ سعةٍ. مضيفونَ حقيقيّونَ منفصلونَ (≥٣ مناطقٍ) حاجزٌ خارجيٌّ (REQ-06). JSON الكاملُ: ${jsonPath}`,
    "",
  ];
  await writeFile(
    `${options.evidenceDir}/f9-03-${stamp}-distributed-load.md`,
    lines.join("\n"),
    "utf8",
  );
  console.log(`[coordinator] الحُكمُ: ${verdict.passed ? "ناجح" : "فاشل"}`);
  for (const rule of verdict.rules) {
    console.log(`  ${rule.passed ? "✅" : "❌"} ${rule.rule}: ${rule.detail}`);
  }
  // لا خروجَ هنا: السائقُ يقرأُ الحُكمَ من `/verdict` ثم يُنهي هذهِ العمليةَ.
}

/**
 * المهلةُ النهائيّةُ: جولةٌ لم يكتملْ عددُ مولّداتِها أو لم تُبلِّغْ تقاريرَها
 * تُحكَمُ فاشلةً بعدَ المهلةِ — لا تعليقَ إلى الأبدِ ولا نجاحٌ بالصمتِ.
 */
deadline = setTimeout(() => {
  console.error(
    `[coordinator] انقضتْ مهلةُ الجولةِ (${options.deadlineMs}ms) — الحُكمُ على ما وصلَ من تقاريرَ، والغائبُ يُفشِلُ قاعدةَ البلاغِ.`,
  );
  void finalize();
}, options.deadlineMs);

process.on("SIGTERM", () => {
  if (deadline !== null) clearTimeout(deadline);
  server.stop(true);
  process.exit(0);
});

console.log(
  `[coordinator] المنسّقُ العالميُّ على ${server.url} — ينتظرُ ${options.generators} مولّداتٍ (البصمةُ ${fingerprint}).`,
);
