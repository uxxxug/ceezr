/**
 * الغرض: إثباتُ حدّ العملية في مشغّل الحمل المفتوح: خادم HTTP حقيقي في عملية الاختبار
 *        ومولّد Bun فرعي مستقل يصل إليه عبر TCP ويكتب دليلاً كاملاً.
 * الحالة: منفّذ فعلياً — وحدة 2-3 من استعادة محيط القياس.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: تدقيق واجهة CLI وأثر الفصل بين المولّد والبوابة.
 * ملاحظات مستقبلية: هذا يثبت حد العملية والـ HTTP فقط، لا سعة النظام ولا صحة عمل المنتج.
 */

import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("مولّد الحمل يستهدف خادماً خارج عمليته ويحفظ PID مستقلّاً ودليل JSON", async () => {
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      requests += 1;
      return new Response(null, { status: 204 });
    },
  });
  const evidenceDir = await mkdtemp(join(tmpdir(), "waslah-open-loop-"));

  try {
    const child = Bun.spawn(
      [
        "bun",
        "run",
        "deferred/field-experiments/bench/run-open-loop.ts",
        "--target",
        `http://127.0.0.1:${server.port}/probe`,
        "--rate",
        "10",
        "--duration-ms",
        "200",
        "--evidence-dir",
        evidenceDir,
      ],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await child.exited;
    const stderr =
      child.stderr instanceof ReadableStream ? await new Response(child.stderr).text() : "";
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(requests).toBe(2);

    const entries = [...new Bun.Glob("*.json").scanSync(evidenceDir)];
    expect(entries).toHaveLength(1);
    const json = JSON.parse(await readFile(join(evidenceDir, entries[0] ?? ""), "utf8")) as {
      generator: { pid: number; topology: string };
      report: { scheduled: number; completed: number; statusCounts: Record<string, number> };
    };
    expect(json.generator.pid).not.toBe(process.pid);
    expect(json.generator.topology).toContain("Standalone generator process");
    expect(json.report.scheduled).toBe(2);
    expect(json.report.completed).toBe(2);
    expect(json.report.statusCounts).toEqual({ "204": 2 });
  } finally {
    server.stop(true);
    await rm(evidenceDir, { recursive: true, force: true });
  }
});
