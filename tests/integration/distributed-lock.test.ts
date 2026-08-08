/**
 * الغرض: إثبات القفل الموزَّع على قاعدة PostgreSQL حقيقية باتصالين مستقلّين تماماً،
 *   أي بمحاكاة نسختَي عامل كما ستكونان على Render. المطلوب إثباته ثلاثة أشياء:
 *   (1) نسخة واحدة فقط تُنفّذ المهمّة في اللحظة نفسها، (2) القفل يُحرَّر حتى عند
 *   رمي المهمّة، (3) نسختان على مدينتين مختلفتين لا تتعطّل إحداهما بقفل الأخرى.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تغيير في تنفيذ القفل
 * ملاحظات مستقبلية: التجمّعان منفصلان عن قصد — قفلٌ يتقاسم تجمّع الاستعلامات
 *   يستنزفه، وقد وقع هذا فعلاً قبل الفصل فسقطت المهامّ بمهلة انتظار لا بخطأ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createJobRunner, type JobLogger } from "../../apps/workers/src/runner.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createAdvisoryLock,
  LOCK_NAMESPACE,
  lockKeyOf,
} from "../../packages/infrastructure/scheduling/advisory-lock.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** كل «نسخة» تجمّعُ اتصالاتٍ خاصٌّ بها، تماماً كعمليتين على خادمين مختلفين. */
let instanceA: Sql;
let instanceB: Sql;

function silentLog(): JobLogger & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (message) => lines.push(message),
    error: (message) => lines.push(`ERROR ${message}`),
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("القفل الموزَّع بين نسختَي عامل على قاعدة حقيقية", () => {
  beforeAll(() => {
    instanceA = createSql({ connectionString: DATABASE_URL ?? "", max: 4 });
    instanceB = createSql({ connectionString: DATABASE_URL ?? "", max: 4 });
  });

  afterAll(async () => {
    await instanceA.end({ timeout: 5 });
    await instanceB.end({ timeout: 5 });
  });

  /** عدد الأقفال المحتجزة فعلاً في القاعدة لمفتاح مهمّة بعينها. */
  async function heldLocks(jobName: string): Promise<number> {
    const objectId = lockKeyOf(jobName);
    // Postgres يخزّن الصيغة ذات الحقلين في classid/objid ويضع objsubid = 2.
    const rows = await instanceA<{ n: number }[]>`
      select count(*)::int as n
        from pg_locks
       where locktype = 'advisory'
         and classid  = ${LOCK_NAMESPACE >>> 0}::bigint::int
         and objid    = ${objectId >>> 0}::bigint::int
         and granted  = true
    `;
    return rows[0]?.n ?? 0;
  }

  it("مفتاح القفل حتمي ومستقلّ عن القاعدة، ومختلف لأسماء مختلفة", () => {
    expect(lockKeyOf("expire-subscriptions")).toBe(lockKeyOf("expire-subscriptions"));
    expect(lockKeyOf("expire-offers:city-a")).not.toBe(lockKeyOf("expire-offers:city-b"));
    expect(Number.isInteger(lockKeyOf("recompute-ratings"))).toBe(true);
  });

  it("نسخة واحدة فقط تُنفّذ المهمّة، والثانية تتخطّى بهدوء ولا تنتظر", async () => {
    const lockA = createAdvisoryLock(instanceA);
    const lockB = createAdvisoryLock(instanceB);
    const key = "probe-exclusive";

    let entered = 0;
    const gate: { release: (() => void) | null } = { release: null };
    const inside = new Promise<void>((resolve) => {
      gate.release = resolve;
    });

    // النسخة الأولى تدخل وتبقى داخل القفل حتى نفتح البوابة.
    const first = lockA.withLock(key, async () => {
      entered += 1;
      await inside;
      return "first";
    });

    // مهلة قصيرة حتى يُؤخذ القفل فعلاً قبل محاولة الثانية.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await heldLocks(key)).toBe(1);

    let secondEntered = false;
    const startedAt = Date.now();
    const second = await lockB.withLock(key, async () => {
      secondEntered = true;
      return "second";
    });
    const waitedMs = Date.now() - startedAt;

    expect(second.acquired).toBe(false);
    expect(secondEntered).toBe(false);
    // لا انتظار: التخطّي فوري. الانتظار كان سيراكم نسخاً عالقة حتى ينفد التجمّع.
    expect(waitedMs).toBeLessThan(1000);

    gate.release?.();
    const firstResult = await first;
    expect(firstResult).toEqual({ acquired: true, value: "first" });
    expect(entered).toBe(1);

    // وبعد انتهاء الأولى صار القفل متاحاً فعلاً للثانية.
    expect(await heldLocks(key)).toBe(0);
    const retry = await lockB.withLock(key, async () => "second-later");
    expect(retry).toEqual({ acquired: true, value: "second-later" });
  });

  it("القفل يُحرَّر حتى إذا رمت المهمّة استثناءً", async () => {
    const lockA = createAdvisoryLock(instanceA);
    const lockB = createAdvisoryLock(instanceB);
    const key = "probe-throwing";

    await expect(
      lockA.withLock(key, async () => {
        throw new Error("عطل مصطنع داخل المهمّة");
      }),
    ).rejects.toThrow("عطل مصطنع داخل المهمّة");

    // لو بقي القفل محتجزاً لكان عطلٌ عابرٌ عطّل المهمّة إلى نهاية عمر النسخة.
    expect(await heldLocks(key)).toBe(0);
    const after = await lockB.withLock(key, async () => "ok-after-throw");
    expect(after).toEqual({ acquired: true, value: "ok-after-throw" });
  });

  it("مهمّتان بمفتاحين مختلفين تعملان متزامنتين بلا تعطيل متبادل", async () => {
    const lockA = createAdvisoryLock(instanceA);
    const lockB = createAdvisoryLock(instanceB);

    const both = await Promise.all([
      lockA.withLock("expire-offers:city-one", async () => "one"),
      lockB.withLock("expire-offers:city-two", async () => "two"),
    ]);

    expect(both).toEqual([
      { acquired: true, value: "one" },
      { acquired: true, value: "two" },
    ]);
  });

  it("دورتان متتاليتان لنسختَي مشغّل: المهمّة تُنفَّذ مرّة واحدة في كل دورة لا مرّتين", async () => {
    const runs: string[] = [];
    const key = "probe-two-runners";

    /** مهمّة تُسجّل من نفّذها، وتبقى داخل القفل قدراً كافياً ليتراكب الشوطان. */
    const jobFor = (instance: string) => ({
      name: key,
      everySeconds: 1,
      runOnStart: true,
      run: async (): Promise<string> => {
        runs.push(instance);
        await new Promise((resolve) => setTimeout(resolve, 120));
        return instance;
      },
    });

    const logA = silentLog();
    const logB = silentLog();
    const clock = { now: () => new Date() };

    const runnerA = createJobRunner({
      jobs: [jobFor("A")],
      lock: createAdvisoryLock(instanceA),
      clock,
      log: logA,
    });
    const runnerB = createJobRunner({
      jobs: [jobFor("B")],
      lock: createAdvisoryLock(instanceB),
      clock,
      log: logB,
    });

    // الدورة الأولى: النسختان تنطلقان في اللحظة نفسها.
    const cycleOne = await Promise.all([runnerA.runDue(), runnerB.runDue()]);
    const statusesOne = cycleOne.flat().map((outcome) => outcome.status);

    expect(runs.length).toBe(1);
    expect(statusesOne.filter((status) => status === "ran").length).toBe(1);
    expect(statusesOne.filter((status) => status === "skipped_locked_elsewhere").length).toBe(1);

    // الدورة الثانية: بعد انقضاء الفاصل، وأيضاً في اللحظة نفسها.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const cycleTwo = await Promise.all([runnerA.runDue(), runnerB.runDue()]);
    const statusesTwo = cycleTwo.flat().map((outcome) => outcome.status);

    // المجموع اثنان لا أربعة: دورتان متتاليتان، تنفيذٌ واحد في كل دورة.
    expect(runs.length).toBe(2);
    expect(statusesTwo.filter((status) => status === "ran").length).toBe(1);

    // النسخة المتخطّية سجّلت السبب صراحةً: صمتٌ هنا كان سيبدو كعطل.
    const skipped = [...logA.lines, ...logB.lines].filter((line) =>
      line.includes("job.skipped_locked_elsewhere"),
    );
    expect(skipped.length).toBe(2);

    expect(await heldLocks(key)).toBe(0);
  });
});
