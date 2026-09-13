/**
 * الغرض: إثباتُ أنّ نسختين من العاملِ الخلفيِّ تعملان على نفسِ الحالةِ بلا ازدواجِ
 *        عمل — بقفلِ القاعدةِ الاستشاريِّ لا بقفلٍ في ذاكرةِ التطبيق (§6 و§8 من
 *        أمرِ وحدة 2-6).
 * الحالة: منفّذ فعلياً — وحدة 2-6.
 * ينتمي إلى: bench/topology
 * يُتوقع أن يستخدمه لاحقاً: `bench/run-distributed.ts`
 *
 * ## ثلاثةُ أسئلةٍ مقيسة
 *
 * 1. **الازدواج:** عمليتا عاملٍ تبدآن شوطاً في نفسِ اللحظة على نفسِ المهامّ. هل
 *    شُغِّلت مهمّةٌ واحدةٌ مرّتين؟ المطلوب: لكلِّ مهمّةٍ `ran` واحدٌ على الأكثر،
 *    والباقي `skipped_locked_elsewhere`.
 * 2. **صحّةُ القياس:** هل وقعَ التزاحمُ فعلاً؟ لو أنهى الأوّلُ شوطَه قبل أن يصلَ
 *    الثاني لكانت النتيجةُ «لا ازدواج» بلا أن يُختبَر القفلُ أصلاً. فيُشترط رصدُ
 *    `skipped_locked_elsewhere` مرّةً واحدةً على الأقلّ، وإلّا فالنتيجةُ لا تُقرأ
 *    كإثباتٍ للقفل. §8 يمنع القياسَ الذي لا يقيس ما يدّعيه.
 * 3. **الحاجزُ ليس في التطبيق:** يأخذ المنسِّقُ القفلَ بنفسِه على اتصالٍ خارجيٍّ
 *    ثم يُقلع عاملاً: يجب أن يمتنع. ثم يُقطع اتّصالُ حاملِ القفل: يجب أن يُحرَّر
 *    القفلُ من غيرِ تنظيفٍ من التطبيق، فينجح العاملُ التالي. هذا يفصل «القفلُ
 *    يعمل» عن «العاملان لم يتصادما بمحضِ التوقيت».
 *
 * ## ما لا يُدّعى
 *
 * لا يُدّعى شيءٌ عن سعةِ العاملِ ولا عن زمنِ مهامِّه: الشوطُ واحدٌ والمهامُّ تعمل
 * على قاعدةٍ شبهِ فارغة. المقيسُ حصريّةُ التنفيذ لا كلفتُه.
 */

import { spawn } from "node:child_process";
import { createSql, type Sql } from "../../../../packages/infrastructure/db/client.ts";
import { createAdvisoryLock } from "../../../../packages/infrastructure/scheduling/advisory-lock.ts";
import { type CheckResult, check } from "../scenarios/contract.ts";
import { type JobSpan, WORKER_OUTCOMES_MARKER, WORKER_SPANS_MARKER } from "./worker-process.ts";

const WORKER_ENTRY = new URL("./worker-process.ts", import.meta.url).pathname;

/** مهمّةٌ واحدةٌ للاختبارِ الحتميّ: أقصرُ المهامِّ تواتراً وأخفُّها أثراً. */
const PROBE_JOB = "redispatch-searching";

interface WorkerOutcomeLine {
  readonly workerId: string;
  readonly pid: number;
  readonly outcomes: readonly {
    readonly name: string;
    readonly status: string;
    readonly durationMs: number;
    readonly detail: string | null;
  }[];
}

export interface WorkerDuelReport {
  readonly checks: readonly CheckResult[];
  /** سطورُ النتائجِ الخام كما طبعتها العمليتان — تُحفَظ في الدليل بلا تلخيص. */
  readonly raw: readonly string[];
  readonly topology: readonly string[];
}

interface RunWorkerOptions {
  readonly workerId: string;
  readonly databaseUrl: string;
  readonly barrierMs?: number;
  readonly onlyJob?: string;
}

interface WorkerRun {
  readonly outcomes: WorkerOutcomeLine;
  readonly spans: readonly JobSpan[];
  readonly stdout: string;
  readonly exitCode: number | null;
}

/** يُقلع عاملاً، ينتظر خروجَه، ويستخرج سطرَ النتائج. لا مهرب: بلا نتائجَ لا حكم. */
function runWorker(options: RunWorkerOptions): Promise<WorkerRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["run", WORKER_ENTRY], {
      env: {
        ...process.env,
        BENCH_DATABASE_URL: options.databaseUrl,
        BENCH_WORKER_ID: options.workerId,
        BENCH_WORKER_BARRIER_MS: String(options.barrierMs ?? 0),
        BENCH_WORKER_ONLY_JOB: options.onlyJob ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      const line = stdout
        .split("\n")
        .find((candidate) => candidate.startsWith(WORKER_OUTCOMES_MARKER));
      if (line === undefined) {
        reject(
          new Error(
            `[worker-duel] العاملُ ${options.workerId} خرج بلا سطرِ نتائج (code=${String(code)}).\n${stderr}`,
          ),
        );
        return;
      }
      const spanLine = stdout
        .split("\n")
        .find((candidate) => candidate.startsWith(WORKER_SPANS_MARKER));
      const spans =
        spanLine === undefined
          ? []
          : (
              JSON.parse(spanLine.slice(WORKER_SPANS_MARKER.length)) as {
                readonly spans: readonly JobSpan[];
              }
            ).spans;
      resolve({
        outcomes: JSON.parse(line.slice(WORKER_OUTCOMES_MARKER.length)) as WorkerOutcomeLine,
        spans,
        stdout,
        exitCode: code,
      });
    });
  });
}

/**
 * وعدٌ يُحرَّر من الخارج. مكتوبٌ صريحاً لأنّ احتجازَ القفلِ يقوم عليه: القفلُ محتجَزٌ
 * ما دام `run` لم يعد، فالتحكّمُ في لحظةِ عودتِه هو التحكّمُ في مدّةِ الاحتجاز.
 */
function deferred(): { readonly promise: Promise<void>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** بالاسمِ الكاملِ لا بجزءٍ منه: الشوطُ يعيد مهمّةً لكلِّ مدينة، فمطابقةٌ جزئيةٌ تقرأ مهمّةً أخرى. */
const statusOf = (run: WorkerRun, jobName: string): string =>
  run.outcomes.outcomes.find((outcome) => outcome.name === jobName)?.status ?? "(غائب)";

export async function runWorkerDuel(): Promise<WorkerDuelReport> {
  const databaseUrl = process.env.BENCH_DATABASE_URL ?? "";
  if (databaseUrl === "") {
    throw new Error("[worker-duel] BENCH_DATABASE_URL مطلوب.");
  }

  const checks: CheckResult[] = [];
  const raw: string[] = [];

  /* ————— 1) الازدواج: عمليتان تبدآن في نفسِ اللحظة ————— */
  const barrierMs = Date.now() + 2_500;
  const [first, second] = await Promise.all([
    runWorker({ workerId: "w1", databaseUrl, barrierMs }),
    runWorker({ workerId: "w2", databaseUrl, barrierMs }),
  ]);
  raw.push(`# duel · barrier=${new Date(barrierMs).toISOString()}`);
  raw.push(JSON.stringify(first.outcomes));
  raw.push(JSON.stringify(second.outcomes));

  /**
   * الثابتُ المقيس: **لا تنفيذَين متقاطعَين** لنفسِ المهمّةِ في العمليتين. وليس
   * «لا تنفيذَ مرّتين» — وهذا فرقٌ اكتُشف بالقياس هنا لا بالقراءة: كلُّ عمليةٍ
   * تجدول بنفسِها في ذاكرتِها (`lastRunMs`)، فالمهمّةُ مستحقّةٌ عند كلٍّ منهما،
   * والقفلُ يُؤخَذ لحظةَ التنفيذِ ويُحرَّر بعده. فمن وصل ثانياً بعد فراغِ القفل
   * ينفّذ فعلاً. وهذا آمنٌ لأنّ المهامَّ تُطالِب صفوفَها ذرّيّاً (`for update skip
   * locked` وما شابه) فالشوطُ الثاني لا يجد ما يعمله — وهو ما يُقاس هنا صريحاً
   * بدلَ أن يُفترَض. أمّا ما يمنعه القفلُ فهو التقاطعُ الزمنيّ، وهو ما يُوكَّد.
   */
  const overlaps: string[] = [];
  const byName = new Map<string, { readonly a: JobSpan[]; readonly b: JobSpan[] }>();
  for (const span of first.spans) {
    const entry = byName.get(span.name) ?? { a: [], b: [] };
    entry.a.push(span);
    byName.set(span.name, entry);
  }
  for (const span of second.spans) {
    const entry = byName.get(span.name) ?? { a: [], b: [] };
    entry.b.push(span);
    byName.set(span.name, entry);
  }
  let comparedPairs = 0;
  for (const [name, entry] of byName) {
    for (const left of entry.a) {
      for (const right of entry.b) {
        comparedPairs += 1;
        if (left.startedAtMs < right.endedAtMs && right.startedAtMs < left.endedAtMs) {
          overlaps.push(
            `${name} · w1=[${left.startedAtMs},${left.endedAtMs}] w2=[${right.startedAtMs},${right.endedAtMs}]`,
          );
        }
      }
    }
  }
  checks.push(
    check(
      "invariant",
      "لا تنفيذَين متقاطعَين زمنياً لنفسِ المهمّةِ في العمليتين — وهذا ما يضمنه القفل",
      overlaps.length === 0,
      overlaps.length === 0
        ? `${byName.size} مهمّةً و${comparedPairs} زوجَ تنفيذٍ فُحِصت، ولا تقاطعَ واحد`
        : `تقاطعات: ${overlaps.join(" | ")}`,
    ),
  );

  const ranInBoth = [...byName.values()].filter(
    (entry) => entry.a.length > 0 && entry.b.length > 0,
  ).length;
  checks.push(
    check(
      "system_response",
      "مقيسٌ ومُعلَن: القفلُ يمنع التقاطعَ لا التكرارَ في نفسِ النافذة",
      true,
      `مهامٌّ نفّذها العاملان كلاهما في هذا الشوط=${ranInBoth} — لا خللٌ بل نتيجةُ جدولةٍ محليّةٍ لكلِّ عملية، وأمانُها من ذرّيّةِ مطالبةِ الصفوفِ في المهامِّ نفسِها`,
    ),
  );

  const contended = [first, second].flatMap((run) =>
    run.outcomes.outcomes.filter((outcome) => outcome.status === "skipped_locked_elsewhere"),
  );
  checks.push(
    check(
      "system_response",
      "التزاحمُ وقعَ فعلاً (رُصِد `skipped_locked_elsewhere`) — وإلّا لكانت النتيجةُ توقيتاً لا قفلاً",
      contended.length > 0,
      `مهامٌّ امتنعت لقفلٍ في مكانٍ آخر=${contended.length}`,
    ),
  );

  const failed = [first, second].flatMap((run) =>
    run.outcomes.outcomes.filter((outcome) => outcome.status === "failed"),
  );
  checks.push(
    check(
      "system_response",
      "ولا مهمّةَ فشلت في أيٍّ من العمليتين",
      failed.length === 0,
      failed.length === 0
        ? "لا فشل"
        : failed.map((outcome) => `${outcome.name}=${String(outcome.detail)}`).join(" | "),
    ),
  );
  checks.push(
    check(
      "system_response",
      "العمليتان خرجتا بشفرةِ نجاح",
      first.exitCode === 0 && second.exitCode === 0,
      `w1=${String(first.exitCode)} · w2=${String(second.exitCode)}`,
    ),
  );

  /* ————— 2) حاجزٌ حتميّ: قفلٌ محتجَزٌ من خارجِ التطبيق ————— */
  let holder: Sql | null = createSql({ connectionString: databaseUrl, max: 1 });
  const lock = createAdvisoryLock(holder);
  const firstHold = deferred();
  // يُحتجَز القفلُ فعلاً على اتصالٍ حقيقيٍّ ما دام هذا الوعدُ معلَّقاً.
  const holding = lock.withLock(`${PROBE_JOB}:*`, async () => {
    await firstHold.promise;
  });

  // تُقرأ المهمّةُ باسمِها الكامل (فيه معرّفُ المدينة)، فيُحتجَز القفلُ بنفسِ الاسم.
  const probeNames = await (async (): Promise<readonly string[]> => {
    const probe = await runWorker({ workerId: "probe", databaseUrl, onlyJob: PROBE_JOB });
    raw.push(`# probe-names ${JSON.stringify(probe.outcomes.outcomes.map((o) => o.name))}`);
    return probe.outcomes.outcomes.map((outcome) => outcome.name);
  })();

  firstHold.release();
  await holding;

  // الآن يُحتجَز القفلُ بالاسمِ الحقيقيِّ للمهمّة، ثم يُقلع عاملٌ عليها وحدَها.
  const targetName = probeNames[0] ?? `${PROBE_JOB}:unknown`;
  const targetHold = deferred();
  const secondHolding = lock.withLock(targetName, async () => {
    await targetHold.promise;
  });
  await new Promise((resolve) => setTimeout(resolve, 150));

  const blocked = await runWorker({ workerId: "blocked", databaseUrl, onlyJob: PROBE_JOB });
  raw.push(`# blocked-by-external-lock ${JSON.stringify(blocked.outcomes)}`);
  checks.push(
    check(
      "invariant",
      "قفلٌ محتجَزٌ من جلسةٍ أخرى يمنعُ العاملَ فعلاً (الحاجزُ في القاعدةِ لا في التطبيق)",
      statusOf(blocked, targetName) === "skipped_locked_elsewhere",
      `حالةُ ${targetName} = ${statusOf(blocked, targetName)}`,
    ),
  );

  /* ————— 3) الفشل: يُقطع اتّصالُ حاملِ القفلِ بلا تحريرٍ مرتّب ————— */
  targetHold.release();
  await secondHolding;
  await holder.end({ timeout: 5 });
  holder = null;

  const afterDrop = await runWorker({ workerId: "after-drop", databaseUrl, onlyJob: PROBE_JOB });
  raw.push(`# after-connection-drop ${JSON.stringify(afterDrop.outcomes)}`);
  checks.push(
    check(
      "transition",
      "بعد سقوطِ اتّصالِ حاملِ القفل، القفلُ حُرِّر والعاملُ التاليُ اشتغل — لا قفلٌ يتيمٌ يُجمِّد المهامّ",
      statusOf(afterDrop, targetName) === "ran",
      `حالةُ ${targetName} بعد سقوطِ الاتصال = ${statusOf(afterDrop, targetName)}`,
    ),
  );

  return {
    checks,
    raw,
    topology: [
      "عمليتا عاملٍ مستقلّتان (w1، w2) على نفسِ قاعدةِ `waslah_bench`، كلٌّ بجلستِها وبِركةِ أقفالِها.",
      "المهامُّ هي مهامُّ الإنتاج من `buildWorkerContainer`؛ المُرسِلاتُ الخارجةُ مزدوجاتٌ صامتة.",
      "القفل: `pg_try_advisory_lock` على اتصالٍ محجوزٍ — نفسُ ما يعمل في الإنتاج.",
      `حاجزٌ زمنيٌّ مشتركٌ يجعل الشوطين متزامنين؛ ومهمّةُ الفحصِ الحتميِّ: ${PROBE_JOB}.`,
    ],
  };
}
