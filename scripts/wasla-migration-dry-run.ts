#!/usr/bin/env bun
/**
 * الغرض: التشغيلُ الجافُّ لهجرتَي المهمّةِ والهويّةِ (`W-8`) — يقيسُ على قاعدةٍ
 *   حقيقيّةٍ **ماذا ستلمسُ الموجةُ**، ويُخرِجُ تقريراً معدوداً لكلِّ جدولٍ، ثمَّ
 *   يُسوّي كلَّ جدولٍ معَ طرفِه في CORE.
 *
 *   **ولا يستطيعُ الكتابةَ.** لا لأنَّه لا يكتبُ في نصِّه — ذاكَ وعدٌ — بل لأنَّ
 *   كلَّ مِسبارٍ يُشغَّلُ داخلَ `BEGIN TRANSACTION READ ONLY`، فمُحرِّكُ PostgreSQL
 *   نفسُه يردُّ أيَّ كتابةٍ بـ`25006` ولو كُتِبَت سهواً أو خُبثاً، ثمَّ تُلفُّ
 *   المُعاملةُ بـ`ROLLBACK` على كلِّ حالٍ. سبيلانِ مستقلّانِ لا سبيلٌ واحدٌ.
 *
 *   **ولا يستطيعُ أن يقولَ «مُسوّىً» زوراً.** طرفُ CORE يُمرَّرُ قارئاً؛ وما دامَ
 *   `DEP-CORE-007` مفتوحاً فلا قارئَ، فكلُّ سطرٍ `UNVERIFIABLE` — لا `RECONCILED`
 *   ولا `DIVERGED`، فالاختلافُ ادّعاءُ معرفةٍ بطرفٍ لم يُقرأْ.
 *
 * الحالة: منفّذ فعلياً — `W-8`. محروسٌ بـ`scripts/check-migration-dry-run.ts`،
 *   وثابتُ القراءةِ-فقط مَقيسٌ على PostgreSQL حقيقيٍّ في
 *   `tests/integration/migration-dry-run-read-only.test.ts`.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: `W-3` و`W-7` قبلَ أوّلِ صفٍّ يُلمَسُ، و`W-9` في
 *   تمرينِ التحوُّلِ والاستعادةِ.
 * ملاحظات مستقبلية: لا يُدمَجُ هذا الملفُّ بـ`scripts/migrate.ts` أبداً: ذاكَ
 *   المُطبِّقُ الوحيدُ المشروعُ (ADR-0068) ويكتبُ بحقٍّ، وهذا يُحرَّمُ عليهِ
 *   الكتابةُ. خلطُهما يجعلُ الأداةَ الآمنةَ ترثُ صلاحيّةَ الكتابةِ.
 */

import { createSql } from "../packages/infrastructure/db/client.ts";
import {
  buildProbeStatement,
  type CoreSide,
  DRY_RUN_BEGIN,
  DRY_RUN_PROBES,
  DRY_RUN_RESERVED_WAVES,
  DRY_RUN_STATEMENT_TIMEOUT_MS,
  deriveReconciliation,
  entryConditionOf,
  type MoveSide,
  type ProbeDefinition,
  probesForWave,
  type ReconciliationRecord,
} from "./lib/wasla-migration-dry-run.ts";

/** صفٌّ واحدٌ من تقريرِ المِسبارِ. */
export interface ProbeGroup {
  readonly keys: Record<string, string>;
  readonly rows: number;
}

export interface ProbeReport {
  readonly table: string;
  readonly measures: string;
  readonly statement: string;
  readonly groups: readonly ProbeGroup[];
  readonly totalRows: number;
}

/**
 * قارئُ طرفِ CORE. **يُمرَّرُ ولا يُفترَضُ**، ودالّةٌ تُعيدُ `undefined` تعني «لا
 * قراءةَ» لا «صفراً».
 */
export type CoreReader = (table: string) => Promise<CoreSide | undefined>;

/** لا قارئَ ما دامَ `DEP-CORE-007` مفتوحاً. وهذا هوَ الافتراضيُّ الصادقُ. */
export const NO_CORE_READER: CoreReader = async () => undefined;

/** أدنى واجهةٍ يحتاجُها التشغيلُ الجافُّ من القاعدةِ، كي يُختبَرَ بمزدوجٍ. */
export interface DryRunClient {
  unsafe(statement: string): Promise<unknown>;
}

/**
 * تجمُّعُ اتّصالاتٍ يُمكِنُ **حجزُ** اتّصالٍ واحدٍ منه. وهذا **ليسَ تفصيلاً
 * كمالياً بل شرطُ صدقِ الثابتِ نفسِه**: لو فُتِحَت `BEGIN … READ ONLY` على
 * اتّصالٍ ونُفِّذَ المِسبارُ على آخرَ من التجمُّعِ، لكانتِ القراءةُ-فقط **خاصّةَ
 * اتّصالٍ لا يجري عليهِ شيءٌ**، ولكانَ المِسبارُ يجري على اتّصالٍ **يستطيعُ
 * الكتابةَ** — ثابتٌ مُعلَنٌ وسلوكٌ مخالفٌ. وقد كشفَ ذلكَ القياسُ على قاعدةٍ
 * حقيقيّةٍ لا المراجعةُ: مكتبةُ `postgres` ردَّت `BEGIN` الخامَّ على تجمُّعٍ
 * بـ`UNSAFE_TRANSACTION`. فالإصلاحُ حجزُ اتّصالٍ واحدٍ لا تعطيلُ الحمايةِ.
 */
export interface ReservableClient extends DryRunClient {
  reserve(): Promise<DryRunClient & { release(): void }>;
}

/**
 * يُشغِّلُ مسابرَ موجةٍ داخلَ مُعاملةٍ للقراءةِ فقط، ويلفُّها دائماً.
 *
 * والترتيبُ مقصودٌ: `BEGIN … READ ONLY` **قبلَ** أوّلِ مِسبارٍ، و`ROLLBACK` في
 * `finally` فيُنفَّذُ ولو رمى مِسبارٌ. ولو أخفقَ `ROLLBACK` نفسُه لَبقيَتِ
 * المُعاملةُ للقراءةِ فقط فلا أثرَ لها تُثبِتُه.
 */
export async function runProbes(
  pool: ReservableClient,
  probes: readonly ProbeDefinition[],
): Promise<readonly ProbeReport[]> {
  const reports: ProbeReport[] = [];
  const client = await pool.reserve();
  await client.unsafe(DRY_RUN_BEGIN);
  try {
    await client.unsafe(`SET LOCAL statement_timeout = ${DRY_RUN_STATEMENT_TIMEOUT_MS}`);
    for (const probe of probes) {
      const statement = buildProbeStatement(probe);
      const raw = (await client.unsafe(statement)) as readonly Record<string, unknown>[];
      const groups: ProbeGroup[] = raw.map((row) => {
        const keys: Record<string, string> = {};
        for (const column of probe.groupBy) keys[column] = String(row[column] ?? "‹null›");
        return { keys, rows: Number(row.rows ?? 0) };
      });
      reports.push({
        table: probe.table,
        measures: probe.measures,
        statement,
        groups,
        totalRows: groups.reduce((sum, group) => sum + group.rows, 0),
      });
    }
  } finally {
    await client.unsafe("ROLLBACK");
    client.release();
  }
  return reports;
}

/** يُسوّي كلَّ جدولٍ قِيسَ، ولا يُسوّي جدولاً لم يُقَسْ. */
export async function reconcile(
  reports: readonly ProbeReport[],
  readCore: CoreReader,
): Promise<readonly ReconciliationRecord[]> {
  const records: ReconciliationRecord[] = [];
  for (const report of reports) {
    const move: MoveSide = { table: report.table, rows: report.totalRows };
    records.push(deriveReconciliation(move, await readCore(report.table)));
  }
  return records;
}

/** يُصيّرُ التقريرَ نصّاً يُقرأُ في مراجعةٍ، لا JSON خاماً. */
export function renderReport(
  wave: number,
  reports: readonly ProbeReport[],
  records: readonly ReconciliationRecord[],
): string {
  const lines: string[] = [];
  lines.push(`# تشغيلٌ جافٌّ — الموجةُ ${wave}`);
  lines.push("");
  lines.push(`**شرطُ الدخولِ المُعلَنُ**: ${entryConditionOf(wave) ?? "‹لا موجةَ بهذا الرقمِ›"}`);
  lines.push("");
  lines.push(
    "**ولا صفَّ لُمِسَ**: كلُّ مِسبارٍ شُغِّلَ داخلَ `BEGIN TRANSACTION READ ONLY` " +
      "ولُفَّت المُعاملةُ بـ`ROLLBACK`. والقراءةُ-فقط خاصّةُ الجلسةِ في المحرِّكِ لا " +
      "وعدٌ في هذا الملفِّ.",
  );
  lines.push("");
  for (const report of reports) {
    lines.push(`## \`${report.table}\` — ${report.totalRows} صفّاً`);
    lines.push("");
    lines.push(report.measures);
    lines.push("");
    lines.push("```sql");
    lines.push(report.statement);
    lines.push("```");
    lines.push("");
    if (report.groups.length === 0) {
      lines.push("لا صفَّ في هذا الجدولِ عندَ لحظةِ القياسِ.");
    } else {
      const columns = Object.keys(report.groups[0]?.keys ?? {});
      lines.push(`| ${columns.join(" | ")} | صفوفٌ |`);
      lines.push(`|${columns.map(() => "---|").join("")}---|`);
      for (const group of report.groups) {
        lines.push(
          `| ${columns.map((column) => group.keys[column] ?? "").join(" | ")} | ${group.rows} |`,
        );
      }
    }
    lines.push("");
  }
  lines.push("## التسويةُ");
  lines.push("");
  lines.push("| الجدولُ | الحالةُ | MOVE | CORE | لماذا |");
  lines.push("|---|---|---|---|---|");
  for (const record of records) {
    lines.push(
      `| \`${record.table}\` | \`${record.status}\` | ${record.moveRows} | ${record.coreRows ?? "‹لا قراءةَ›"} | ${record.reason} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const waveArgument = process.argv[2];
  const wave = Number(waveArgument);
  if (waveArgument === undefined || !Number.isInteger(wave)) {
    process.stderr.write(
      `الاستعمالُ: bun run scripts/wasla-migration-dry-run.ts <رقمُ الموجةِ>\nوالموجاتُ المحجوزةُ لهذا البندِ: ${DRY_RUN_RESERVED_WAVES.join(", ")}\n`,
    );
    process.exit(2);
  }
  if (!DRY_RUN_RESERVED_WAVES.includes(wave as (typeof DRY_RUN_RESERVED_WAVES)[number])) {
    process.stderr.write(
      `الموجةُ ${wave} خارجَ نطاقِ \`W-8\` (هجرتا المهمّةِ والهويّةِ: ${DRY_RUN_RESERVED_WAVES.join(", ")}).\n` +
        "ولا تُوسَّعُ الأداةُ ههنا: البندُ الذي يملكُ الموجةَ هوَ الذي يُضيفُ مِسبارَها ويحجزُهُ.\n",
    );
    process.exit(2);
  }
  const connectionString = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    process.stderr.write(
      "لا `DATABASE_URL` ولا `TEST_DATABASE_URL`. والتشغيلُ الجافُّ يقيسُ قاعدةً حقيقيّةً؛\n" +
        "ولا يُستعاضُ عنها بتقديرٍ: تقريرٌ بلا قاعدةٍ روايةٌ لا قياسٌ.\n",
    );
    process.exit(2);
  }
  const probes = probesForWave(wave);
  const scoped =
    probes.length > 0
      ? probes
      : DRY_RUN_PROBES.filter((probe) => probe.table === "operational_jobs");
  const sql = createSql({ connectionString });
  try {
    const reports = await runProbes(sql as unknown as ReservableClient, scoped);
    const records = await reconcile(reports, NO_CORE_READER);
    process.stdout.write(renderReport(wave, reports, records));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  await main();
}
