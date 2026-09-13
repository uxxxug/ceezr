/**
 * الغرض: تشغيلُ مولّد حملٍ مفتوحٍ في عمليةٍ مستقلةٍ عن البوابة المستهدفة، بمعدل وصول
 *        معلَن، مع حفظ إعداد التجربة ونتائجها وانزلاق جدولة المولّد كدليلٍ قابل للمراجعة.
 * الحالة: منفّذ فعلياً — وحدة 2-3 من استعادة محيط القياس.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: أصغر baseline موثوق في وحدة 2-4 ثمّ مزيج حركةٍ معتمد.
 * ملاحظات مستقبلية: لا يُقلع هذا الملف بوابةً ولا يستورد تطبيقها؛ شغّله في عملية Bun
 *        مستقلة بعد إقلاع الهدف. HTTP 2xx لا يعني نجاح عمل المنتج، بل نتيجة النقل فقط.
 *
 * الاستخدام:
 *   bun bench/run-open-loop.ts --target http://127.0.0.1:3000/health --rate 20 --duration-ms 30000
 *   bun bench/run-open-loop.ts --target http://127.0.0.1:3000/webhook/telegram/rider --rate 5 \
 *     --duration-ms 60000 --method POST --body-file /tmp/update.json --header 'content-type: application/json'
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { type OpenLoopWorkload, runOpenLoop } from "./open-loop.ts";

interface CliOptions {
  readonly target: URL;
  readonly arrivalRatePerSecond: number;
  readonly durationMs: number;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly evidenceDir: string;
}

function usage(): string {
  return [
    "الاستخدام: bun bench/run-open-loop.ts --target URL --rate N --duration-ms N [خيارات]",
    "  --method GET|POST|...             الافتراضي: GET",
    "  --header 'الاسم: القيمة'          تكرّر لكل ترويسة لازمة",
    "  --body-file /مسار/الحمولة         جسم ثابت يُقرأ مرة قبل بدء القياس",
    "  --evidence-dir docs/evidence      موضع الدليل (الافتراضي)",
    "  --help                            يطبع هذا النص",
  ].join("\n");
}

async function parseArgs(argv: readonly string[]): Promise<CliOptions | "help"> {
  let target: URL | null = null;
  let arrivalRatePerSecond: number | null = null;
  let durationMs: number | null = null;
  let method = "GET";
  const headers: Record<string, string> = {};
  let bodyFile: string | null = null;
  let evidenceDir = "docs/evidence";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help") return "help";
    if (arg === "--target" && next !== undefined) {
      try {
        target = new URL(next);
      } catch {
        throw new Error(`--target ليس URL صالحاً: ${next}`);
      }
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        throw new Error(`--target يجب أن يبدأ بـ http:// أو https://، ووصل: ${target.protocol}`);
      }
      index += 1;
    } else if (arg === "--rate" && next !== undefined) {
      arrivalRatePerSecond = parsePositiveNumber("--rate", next);
      index += 1;
    } else if (arg === "--duration-ms" && next !== undefined) {
      durationMs = parsePositiveNumber("--duration-ms", next);
      index += 1;
    } else if (arg === "--method" && next !== undefined) {
      method = next.toUpperCase();
      index += 1;
    } else if (arg === "--header" && next !== undefined) {
      const separator = next.indexOf(":");
      if (separator <= 0) throw new Error(`--header يجب أن يكون «الاسم: القيمة»، ووصل: ${next}`);
      const name = next.slice(0, separator).trim().toLowerCase();
      const value = next.slice(separator + 1).trim();
      if (name === "" || value === "") throw new Error(`--header فارغ الاسم أو القيمة: ${next}`);
      headers[name] = value;
      index += 1;
    } else if (arg === "--body-file" && next !== undefined) {
      bodyFile = next;
      index += 1;
    } else if (arg === "--evidence-dir" && next !== undefined) {
      evidenceDir = next;
      index += 1;
    } else {
      throw new Error(`وسيط غير معروف أو ناقص القيمة: ${arg ?? ""}`);
    }
  }

  if (target === null || arrivalRatePerSecond === null || durationMs === null) {
    throw new Error("--target و--rate و--duration-ms حقول واجبة.");
  }
  const body = bodyFile === null ? undefined : await readFile(bodyFile, "utf8");
  return { target, arrivalRatePerSecond, durationMs, method, headers, body, evidenceDir };
}

function parsePositiveNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} يجب أن يكون رقماً موجباً منتهياً، ووصل: ${raw}`);
  return value;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function createHttpWorkload(options: CliOptions): OpenLoopWorkload {
  return async () => {
    const response = await fetch(options.target, {
      method: options.method,
      headers: options.headers,
      body: options.body,
    });
    // تُستهلك الاستجابة كي يدخل زمن نقل الجسم في زمن المحاولة ولا تبقى مقابس معلّقة.
    await response.arrayBuffer();
    return { status: response.status };
  };
}

function summarizeToText(
  options: CliOptions,
  report: Awaited<ReturnType<typeof runOpenLoop>>,
  evidencePath: string,
): string {
  return [
    "# دليل مولّد الحمل المفتوح — وحدة 2-3",
    "",
    `- مولّد الحمل: عملية Bun مستقلة (pid=${process.pid})؛ لا يقلع بوابة ولا يستورد تطبيقها.`,
    `- الهدف: ${options.method} ${options.target.toString()}`,
    `- معدل الوصول المعلن: ${options.arrivalRatePerSecond} محاولة/ثانية لمدة ${options.durationMs}ms.`,
    `- المحاولات: مجدولة=${report.scheduled}، أُطلقت=${report.launched}، اكتملت=${report.completed}، أخفقت=${report.failed}.`,
    `- أقصى طلبات قيد التنفيذ: ${report.maxInFlight}.`,
    `- معدل الإطلاق المرصود: ${report.observedLaunchRatePerSecond.toFixed(3)} محاولة/ثانية.`,
    `- انزلاق الجدولة: p50=${report.schedulingLag.p50Ms.toFixed(3)}ms، p95=${report.schedulingLag.p95Ms.toFixed(3)}ms، p99=${report.schedulingLag.p99Ms.toFixed(3)}ms، max=${report.schedulingLag.maxMs.toFixed(3)}ms.`,
    `- زمن طلب النقل: p50=${report.latency.p50Ms.toFixed(3)}ms، p95=${report.latency.p95Ms.toFixed(3)}ms، p99=${report.latency.p99Ms.toFixed(3)}ms، max=${report.latency.maxMs.toFixed(3)}ms.`,
    `- حالات HTTP: ${JSON.stringify(report.statusCounts)}.`,
    `- أخطاء النقل: ${JSON.stringify(report.errors)}.`,
    "",
    `> التصنيف: هذا الدليل يثبت سلوك المولّد ومخرجات النقل إلى الهدف المعلن فقط. لا يثبت نجاح عمل المنتج، ولا سعة الإنتاج، ولا تسليم تيليجرام، ولا سلوك Upstash أو Supabase أو موزّع حمل حقيقي. JSON الكامل: ${evidencePath}`,
    "",
  ].join("\n");
}

async function main(): Promise<number> {
  const options = await parseArgs(process.argv.slice(2));
  if (options === "help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const report = await runOpenLoop({
    arrivalRatePerSecond: options.arrivalRatePerSecond,
    durationMs: options.durationMs,
    workload: createHttpWorkload(options),
  });
  const runStamp = stamp();
  await mkdir(options.evidenceDir, { recursive: true });
  const jsonPath = `${options.evidenceDir}/phase2-unit3-${runStamp}-open-loop.json`;
  const textPath = `${options.evidenceDir}/phase2-unit3-${runStamp}-open-loop.md`;
  const envelope = {
    unit: "2-3",
    generator: {
      pid: process.pid,
      runtime: `Bun ${Bun.version}`,
      topology:
        "Standalone generator process; target server is external and reached only through HTTP.",
    },
    workload: {
      target: options.target.toString(),
      method: options.method,
      headers: Object.keys(options.headers).sort(),
      bodyBytes: options.body === undefined ? 0 : Buffer.byteLength(options.body),
      arrivalRatePerSecond: options.arrivalRatePerSecond,
      durationMs: options.durationMs,
    },
    classification:
      "generator measurement only; NOT business correctness, NOT production capacity, NOT real Telegram/Upstash/Supabase/load-balancer validation",
    report,
  };
  await writeFile(jsonPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await writeFile(textPath, summarizeToText(options, report, jsonPath), "utf8");

  process.stdout.write(`الدليل: ${jsonPath}\n        ${textPath}\n`);
  process.stdout.write(
    `النتيجة: ${report.launched} محاولة، ${report.failed} خطأ نقل، p95 انزلاق=${report.schedulingLag.p95Ms.toFixed(3)}ms\n`,
  );
  return report.failed === 0 ? 0 : 1;
}

try {
  process.exit(await main());
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n\n${usage()}\n`);
  process.exit(2);
}
