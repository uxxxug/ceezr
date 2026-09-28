#!/usr/bin/env bun
/**
 * الغرض: مولّدُ حملٍ في عمليةٍ مستقلّةٍ — لا يعرفُ من الجولةِ إلا المنسّقَ
 *        (URL عبرَ HTTP) ولا يعرفُ الهدفَ إلا من تعيينِ المنسّقِ. هذا هو الدَّرزُ
 *        الذي يجعلُ المولّدَ قابلاً للسكنِ في مضيفٍ آخرَ دونَ تغييرِ حرفٍ: لا
 *        ذاكرةَ مشتركةَ ولا استيرادَ من عمليةِ الهدفِ — HTTP وحدَهُ.
 * الحالة: منفَّذ — الشقُّ المملوكُ للمستودَعِ من `F9-03`.
 * ينتمي إلى: bench/distributed
 * يُتوقع أن يستخدمه لاحقاً: رفعُهُ إلى مضيفينَ منفصلينَ (`REQ-06`) بلا تعديلٍ —
 *        يُعطى عنوانَ المنسّقِ فقط.
 * ملاحظات مستقبلية: إن كانت حصةُ هذا المولّدِ صفرَ محاولاتٍ (خطةٌ أصغرَ من
 *        عددِ المولّداتِ) فلا يُطلقُ شيئاً ويُبلِّغُ أصفاراً — الانضمامُ عقدٌ
 *        والعدمُ إخلالٌ.
 *
 * الاستخدام:
 *   bun bench/distributed/generator.ts --coordinator http://127.0.0.1:4300 --generator-id gen-1
 */

import { runOpenLoop } from "../open-loop.ts";

interface Assignment {
  readonly status: "start";
  readonly index: number;
  readonly partition: {
    readonly index: number;
    readonly arrivalRatePerSecond: number;
    readonly durationMs: number;
    readonly scheduledCount: number;
  };
  readonly fingerprint: string;
  readonly plan: {
    readonly target: string;
    readonly method: string;
  };
}

function parseArgs(argv: readonly string[]): { coordinator: URL; generatorId: string } {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help") {
      process.stdout.write(
        "الاستخدام: bun bench/distributed/generator.ts --coordinator http://host:port --generator-id NAME\n",
      );
      process.exit(0);
    }
    if (arg === undefined) throw new Error("وسيطٌ مجهولٌ ناقصٌ.");
    if (next === undefined) throw new Error(`وسيطٌ ناقصُ القيمةِ: ${arg}`);
    values[arg] = next;
    index += 1;
  }
  if (values["--coordinator"] === undefined || values["--generator-id"] === undefined) {
    throw new Error("--coordinator و--generator-id واجبانِ.");
  }
  const coordinator = new URL(values["--coordinator"]);
  if (coordinator.protocol !== "http:" && coordinator.protocol !== "https:") {
    throw new Error(`--coordinator يجبُ أن يكونَ http(s):// ووصلَ: ${values["--coordinator"]}`);
  }
  if (values["--generator-id"] === "") throw new Error("--generator-id لا يكونُ فارغاً.");
  return { coordinator, generatorId: values["--generator-id"] };
}

const options = parseArgs(process.argv.slice(2));

/** الانضمامُ حتى فتحِ البوّابةِ: المنسّقُ لا يفتحُها حتى يكتملَ العددُ المُعلَّنُ. */
async function join(): Promise<Assignment> {
  for (;;) {
    const response = await fetch(new URL("/join", options.coordinator), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generatorId: options.generatorId }),
    });
    if (!response.ok) throw new Error(`انضمامٌ مرفوضٌ (${response.status}).`);
    const body = (await response.json()) as
      | { status: "waiting"; joined: number; expected: number }
      | Assignment;
    if (body.status === "start") return body;
    await Bun.sleep(100);
  }
}

async function main(): Promise<void> {
  const assignment = await join();
  console.log(
    `[generator:${options.generatorId}] تعيينٌ: فهرسُ ${assignment.index} · ${assignment.partition.arrivalRatePerSecond}/ث · بصمةُ ${assignment.fingerprint}.`,
  );

  let report: {
    scheduled: number;
    launched: number;
    failed: number;
    schedulingLagP95Ms: number;
  };
  if (assignment.partition.scheduledCount === 0) {
    // حصةٌ صفريةٌ مُعلَنةٌ من التقسيمِ الحتميِّ — بلاغُ أصفارٍ لا صمتٌ.
    report = {
      scheduled: 0,
      launched: 0,
      failed: 0,
      schedulingLagP95Ms: 0,
    };
  } else {
    const openLoop = await runOpenLoop({
      arrivalRatePerSecond: assignment.partition.arrivalRatePerSecond,
      durationMs: assignment.partition.durationMs,
      workload: async () => {
        const response = await fetch(assignment.plan.target, { method: assignment.plan.method });
        await response.arrayBuffer();
        return { status: response.status };
      },
    });
    report = {
      scheduled: openLoop.scheduled,
      launched: openLoop.launched,
      failed: openLoop.failed,
      schedulingLagP95Ms: openLoop.schedulingLag.p95Ms,
    };
  }

  const response = await fetch(new URL("/report", options.coordinator), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generatorId: options.generatorId,
      index: assignment.index,
      fingerprint: assignment.fingerprint,
      ...report,
    }),
  });
  if (!response.ok) throw new Error(`بلاغٌ مرفوضٌ (${response.status}).`);
  console.log(
    `[generator:${options.generatorId}] بلاغٌ: مجدولٌ=${report.scheduled} مُطلَقٌ=${report.launched} فاشلٌ=${report.failed} p95 انزلاقٍ=${report.schedulingLagP95Ms.toFixed(3)}ms.`,
  );
}

try {
  await main();
} catch (error) {
  // الفشلُ هنا لا يُسكَتُ عنهُ: الخروجُ بغيرِ الصفرِ يقتلُهُ السائقُ ويُحاسِبُهُ
  // المنسّقُ غائباً — وهو المسارُ الذي يُثبِتُ السالبةُ المزروعةُ أنّهُ يُرى.
  process.stderr.write(
    `[generator:${options.generatorId}] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}
