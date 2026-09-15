/**
 * الغرض: منعُ اختبارٍ من تفعيل مدينةٍ بلا ضبطِ قروباتها الثلاثة في نفس العبارة،
 *   لأنّ نجاحَه حينها يتعلّق بترتيبِ اكتشافِ ملفّات الاختبار لا بصحّةِ ما يفحصه.
 * الحالة: منفّذ فعلياً — بوّابةُ CI.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml و`bun run ci`.
 * ملاحظات مستقبلية: القاعدةُ مقصورةٌ على `cities.is_active`؛ أيّ قيدٍ آخرَ من نوعِ
 *   «التفعيلُ يتطلّب حقولاً» يُضاف إلى `REQUIRED_WITH_ACTIVATION` لا إلى منطقٍ جديد.
 *
 * لماذا وُجِد هذا الفحص:
 *   قيدُ `cities_active_requires_groups` يمنع تفعيلَ مدينةٍ بلا قروباتها الثلاثة،
 *   ولا تبذُر أيّةُ هجرةٍ تلك القروبات. فكان خمسةُ ملفّاتِ اختبارٍ تُنفّذ
 *   `update cities set is_active = true` مجرّدةً، فتنجح فقط إن سبقها ملفٌّ آخرُ
 *   ضبطَ القروبات — وترتيبُ الاكتشاف يختلف بين الجهازِ المحلّيّ وآلةِ التكامل.
 *   فمرّت محلّياً وسقطت بعيداً، ثمّ سرَّب سقوطُها حاوياتٍ لم تُغلَق فأنفدَ
 *   اتّصالاتَ القاعدة وأسقطَ ملفّاتٍ لا علاقة لها بالعيب أصلاً. والعيبُ من هذا
 *   النوع لا يُكتشف بمراجعةِ الشيفرة لأنّه لا يظهر إلّا بترتيبٍ معيَّن.
 */
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { toPosixPath } from "./lib/repo-path.ts";

const TEST_ROOTS = ["tests/integration", "tests/e2e", "tests/unit"] as const;

/** الحقولُ التي يُلزم قيدُ القاعدة بوجودها كي يُقبل `is_active = true`. */
const REQUIRED_WITH_ACTIVATION = [
  "telegram_support_group_id",
  "telegram_escalation_group_id",
  "telegram_unsubscribed_drivers_group_id",
] as const;

/**
 * استثناءٌ واحدٌ مقصود: `pilot-city-activation` يفحص القيدَ نفسَه، فتفعيلُه
 * المجرَّدُ **هو** موضوعُ الاختبار ويُتوقَّع أن يُرفَض. اشتراطُ القروبات فيه
 * يُلغي ما يُثبته.
 */
const INTENTIONAL_BARE_ACTIVATION = new Set([
  "tests/integration/pilot-city-activation.test.ts",
  // `check-integration-city-precondition` حاجزٌ آخرُ، وحالاتُه السالبةُ **نصوصٌ
  // مُصنَّعةٌ** تُمرَّرُ إلى حَكَمٍ نقيٍّ في الذاكرةِ — لا عبارةٌ تُنفَّذُ على قاعدةٍ.
  // فقراءتُها شِفرةً حقيقيّةً إنذارٌ كاذبٌ يُبطِلُ برهانَ `ح-7` على ذلكَ الحاجزِ.
  //
  // وهذا الاستثناءُ **يكشفُ تكراراً في مصدرِ الحقيقةِ** لا يُصلَحُ ههنا: حاجزانِ
  // يحكُمانِ على تفعيلِ المدينةِ في الاختباراتِ بسجلَّي استثناءاتٍ منفصلينِ. وقد
  // حُجِزَ توحيدُهما في `OPS-020` بـ`ROADMAP.md` — ولا يُمسُّ في نطاقِ `OPS-019`.
  "tests/unit/check-integration-city-precondition.test.ts",
]);

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly statement: string;
  readonly missing: readonly string[];
}

async function listTestFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  // النوعُ مكتوبٌ صراحةً: `Awaited<ReturnType<typeof readdir>>` يحلُّ إلى أوّلِ تحميلةٍ
  // لا إلى ما يردُّ مع `withFileTypes`، فينفجر الفحصُ لحظةَ يصير الملفُّ مستورداً.
  let entries: readonly Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = toPosixPath(join(root, entry.name));
    if (entry.isDirectory()) found.push(...(await listTestFiles(path)));
    else if (entry.name.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/**
 * يقتطع عبارةَ SQL المحيطة بموضعِ التفعيل: من أقربِ ``sql` `` قبله إلى أوّلِ
 * `` ` `` بعده. الحدُّ الأدنى الذي يكفي للحكم — فالقروباتُ إن ضُبطت ضُبطت في نفس
 * العبارة، وضبطُها في عبارةٍ منفصلةٍ بعدَها لا ينفع لأنّ القيدَ يُفحَص فوراً.
 */
export function statementAround(source: string, activationIndex: number): string {
  const opener = source.lastIndexOf("sql`", activationIndex);
  const start = opener === -1 ? Math.max(0, activationIndex - 400) : opener;
  const closer = source.indexOf("`", activationIndex);
  const end = closer === -1 ? Math.min(source.length, activationIndex + 400) : closer;
  return source.slice(start, end);
}

export function analyseSource(file: string, source: string): readonly Violation[] {
  // التوحيدُ هنا أيضاً لا في الجمعِ وحدَه: الدالّةُ مُصَدَّرةٌ ويستدعيها اختبارُ
  // وحدةٍ بمسارٍ من عندِه، فاستثناءٌ يعتمد على مَن جمعَ المسارَ استثناءٌ هشّ.
  if (INTENTIONAL_BARE_ACTIVATION.has(toPosixPath(file))) return [];
  const violations: Violation[] = [];
  const pattern = /is_active\s*=\s*true/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const statement = statementAround(source, match.index);
    // `update cities` وحدها معنيّة؛ جداولُ أخرى فيها `is_active` لا قيدَ لها.
    if (/update\s+cities/i.test(statement)) {
      const missing = REQUIRED_WITH_ACTIVATION.filter((column) => !statement.includes(column));
      if (missing.length > 0) {
        violations.push({
          file,
          line: source.slice(0, match.index).split("\n").length,
          statement: statement.replace(/\s+/g, " ").trim().slice(0, 160),
          missing,
        });
      }
    }
    match = pattern.exec(source);
  }
  return violations;
}

async function main(): Promise<void> {
  const files: string[] = [];
  for (const root of TEST_ROOTS) files.push(...(await listTestFiles(root)));

  const violations: Violation[] = [];
  for (const file of files.sort()) {
    violations.push(...analyseSource(file, await readFile(file, "utf8")));
  }

  if (violations.length === 0) {
    console.log(
      `✅ ${String(files.length)} ملفّ اختبار: لا تفعيلَ مدينةٍ يتعلّق نجاحُه بترتيبِ الملفّات.`,
    );
    return;
  }

  console.error("❌ تفعيلُ مدينةٍ بلا قروباتها في نفس العبارة — نجاحٌ معلَّقٌ على الترتيب:\n");
  for (const violation of violations) {
    console.error(`  ${violation.file}:${String(violation.line)}`);
    console.error(`    ناقص: ${violation.missing.join("، ")}`);
    console.error(`    العبارة: ${violation.statement}\n`);
  }
  console.error(
    "الإصلاح: اضبط القروباتَ الثلاثة في نفس عبارة `update cities` التي تُفعِّل المدينة،\n" +
      "مثل: telegram_support_group_id = coalesce(telegram_support_group_id, -1001)",
  );
  process.exit(1);
}

if (import.meta.main) await main();
