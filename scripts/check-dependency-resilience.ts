/**
 * الغرض: بوابة CI تفرض بندَ `F8-04` في الخارطة — «مهلة + إعادة محاولة محدودة +
 *    قاطع دائرة + bulkhead + بديل لكل اعتمادية» — وهو خطرُ السعةِ `CAP-006` في
 *    القسم 11-ج، وقرارُ ADR 0079. والفحصُ خمسيُّ الأثر:
 *      ١) لا `new Api(` من grammY إلا في المصنعِ الواحدِ
 *         `packages/infrastructure/notification/telegram-client.ts` — فالمهلةُ
 *         المُصرَّحُ بها وحدَّ التزامنِ المشتركُ لا يُنالانِ إلا من بابٍ واحدٍ.
 *      ٢) كلُّ عضوٍ في `DEPENDENCY_NAMES` له ميزانيّةٌ في `DEPENDENCY_BUDGETS`،
 *         وكلُّ ميزانيّةٍ لها عضوٌ — فلا اعتماديّةٌ مُسمّاةٌ بلا رقمٍ، ولا رقمٌ
 *         لاعتماديّةٍ لا وجودَ لها.
 *      ٣) كلُّ محوّلِ خروجٍ مُصرَّحٍ به ههنا يبني حاجزاً أو يقبلُ حاجزاً مَحقوناً.
 *      ٤) لا ثوابتَ مهلةٍ مكتوبةً رقماً في محوّلاتِ الخروجِ المُصرَّحِ بها: تُقرأُ
 *         من `DEPENDENCY_BUDGETS` — رقمانِ لمعنىً واحدٍ يفترقانِ بأوّلِ تعديلٍ.
 *      ٥) لا `fetch(` في محوّلِ خروجٍ مُصرَّحٍ به بلا `signal` في نفسِ النداءِ:
 *         مهلةٌ لا تُلغي النداءَ تردُّ المُنتَظِرَ وتترُكُ المقبسَ حيّاً.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه: .github/workflows/ff وسلسلةُ `bun run ci`.
 * ملاحظات مستقبلية: عندَ وصلِ أوّلِ محوّلِ نموذجٍ حقيقيٍّ في `packages/agent-core`
 *    (بدلَ `nullModel`) يُضافُ ملفُّه إلى `EGRESS_ADAPTERS` فيُلزَمَ بالحاجزِ —
 *    والقاعدةُ الثانيةُ تُبقي ميزانيّةَ `agent` مُعلَنةً حتّى ذلكَ الحين.
 *
 * لماذا فحصٌ لا اتفاق: `new Api(token)` سطرٌ واحدٌ صحيحٌ ظاهراً، وهوَ الذي ورَّثَ
 * سبعةَ مواضعَ مهلةَ grammY الافتراضيّةَ — خمسَمئةِ ثانيةٍ — بلا أن يُخفِقَ شيءٌ
 * ولا أن يُعلِنَ أحدٌ ذلك. والاتفاقُ يُنسى؛ والبناءُ الساقطُ لا يُنسى.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const ROOTS = ["apps", "packages", "scripts", "tests", "bench"] as const;
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

/** هذا الملفُّ نفسُه يذكر الأنماطَ نصّاً، فيُستثنى من مطابقتِها. */
export const SELF = "scripts/check-dependency-resilience.ts";
/**
 * واختبارُ هذا الحاجزِ يُغذّيه نصوصاً مخروقةً فيها `new Api(` نفسُه، فيُستثنى
 * كذلكَ. **والاستثناءُ ملفٌّ مُسمّىً لا مجلَّدٌ**: إعفاءُ `tests/` كلِّه كانَ
 * سيُتيحُ لأيِّ اختبارٍ أن يبنيَ واجهةً بلا مهلةٍ ثمَّ يُثبِّتَ ذلكَ سلوكاً.
 */
export const SELF_TEST = "tests/unit/check-dependency-resilience.test.ts";

/** المصنعُ الواحدُ لواجهةِ تلغرام: وحدَه له حقُّ بنائِها. */
export const TELEGRAM_FACTORY = "packages/infrastructure/notification/telegram-client.ts";

/** موضعُ الميزانيّاتِ والأسماءِ: مصدرُ الحقيقةِ الواحدُ. */
export const BUDGETS_FILE = "packages/shared/resilience/dependency-guard.ts";

/**
 * محوّلاتُ الخروجِ المُصرَّحُ بها: كلُّ ملفٍّ ههنا **يجب** أن يبنيَ حاجزاً أو
 * يقبلَ حاجزاً محقوناً، وأن يُمرِّرَ `signal` في كلِّ `fetch`، وألا يكتبَ مهلةً
 * رقماً. والتصريحُ يدويٌّ لا مُستنبَطٌ: استنباطُ «ما يخرجُ إلى الشبكةِ» بمطابقةِ
 * نصٍّ يُنتِجُ إمّا صمتاً عن محوّلٍ يستوردُ `fetch` بالتفافٍ، أو ضجيجاً على كلِّ
 * ملفٍّ يذكرُ الكلمةَ. والقائمةُ المكتوبةُ تُراجَعُ في الطلبِ ويُرى نقصُها.
 */
export const EGRESS_ADAPTERS = [
  TELEGRAM_FACTORY,
  "packages/infrastructure/redis/upstash.ts",
  "packages/maps/providers/osrm/osrm-provider.ts",
  "packages/infrastructure/financial/payment-guard.ts",
] as const;

export type Violation = {
  readonly file: string;
  readonly line: number | null;
  readonly why: string;
};

/**
 * قارئُ الملفّاتِ. **مُحقونٌ لا مُثبَّتٌ على القرصِ**: بلا حقنٍ لا سبيلَ إلى
 * إثباتِ أنَّ الحاجزَ **يُخفِقُ** على نصٍّ مخروقٍ إلا بإفسادِ المستودعِ نفسِه.
 */
export type Reader = (file: string) => string;

const diskReader: Reader = (file) => readFileSync(file, "utf8");

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(entry))) out.push(full);
  }
}

export function repoFiles(): readonly string[] {
  const out: string[] = [];
  for (const root of ROOTS) walk(root, out);
  return out;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** ١) بناءُ واجهةِ تلغرام في المصنعِ وحدَه. */
export function checkTelegramFactory(
  files: readonly string[],
  read: Reader = diskReader,
): readonly Violation[] {
  const violations: Violation[] = [];
  const pattern = /\bnew\s+Api\s*\(/g;
  for (const file of files) {
    if (file === SELF || file === SELF_TEST || file === TELEGRAM_FACTORY) continue;
    const text = read(file);
    for (const match of text.matchAll(pattern)) {
      violations.push({
        file,
        line: lineOf(text, match.index),
        why: `بناءُ \`new Api(\` خارجَ المصنعِ الواحدِ: افتراضُ grammY \`timeoutSeconds: 500\` — ثمانِ دقائقَ — يُورَثُ صامتاً، ولا يُقاسُ التزامنُ في حاجزٍ واحدٍ. يُنادى \`createTelegramApi\` من \`${TELEGRAM_FACTORY}\` (ADR-0079 §١).`,
      });
    }
  }
  return violations;
}

/** ٢) تقابلٌ تامٌّ بينَ الأسماءِ والميزانيّاتِ. */
export function checkBudgetCoverage(read: Reader = diskReader): readonly Violation[] {
  const text = read(BUDGETS_FILE);

  const namesBlock = /DEPENDENCY_NAMES\s*=\s*\[([^\]]*)\]/.exec(text)?.[1];
  if (namesBlock === undefined) {
    return [
      {
        file: BUDGETS_FILE,
        line: null,
        why: "لا يُقرأُ `DEPENDENCY_NAMES`: الفحصُ **يُخفِقُ صراحةً** ولا يُمرِّرُ صمتاً — بوابةٌ لا تجدُ ما تفحصُه ليست بوابةً (الحاجزُ ح-٥).",
      },
    ];
  }
  const declared = new Set(
    [...namesBlock.matchAll(/"([a-z0-9_-]+)"/g)].map((match) => match[1] ?? ""),
  );

  const budgetsAt = text.indexOf("DEPENDENCY_BUDGETS");
  if (budgetsAt === -1) {
    return [
      {
        file: BUDGETS_FILE,
        line: null,
        why: "لا يُقرأُ `DEPENDENCY_BUDGETS`: الفحصُ يُخفِقُ صراحةً (الحاجزُ ح-٥).",
      },
    ];
  }
  const budgetsBody = text.slice(budgetsAt);
  const budgeted = new Set(
    [...budgetsBody.matchAll(/^\s{2}([a-z0-9_-]+):\s*\{/gm)].map((match) => match[1] ?? ""),
  );

  const violations: Violation[] = [];
  for (const name of declared) {
    if (!budgeted.has(name)) {
      violations.push({
        file: BUDGETS_FILE,
        line: null,
        why: `الاعتماديّةُ \`${name}\` مُسمّاةٌ بلا ميزانيّةٍ: اسمٌ بلا رقمٍ يُعطي حاجزاً بمهلةٍ \`undefined\` — أي بلا مهلةٍ (ADR-0079 §٢).`,
      });
    }
  }
  for (const name of budgeted) {
    if (!declared.has(name)) {
      violations.push({
        file: BUDGETS_FILE,
        line: null,
        why: `ميزانيّةُ \`${name}\` لا يقابلُها اسمٌ في \`DEPENDENCY_NAMES\`: رقمٌ لا يُنادى أحدٌ به يُقرأُ في المراجعةِ حمايةً غيرَ قائمةٍ (ADR-0079 §٢).`,
      });
    }
  }
  return violations;
}

/** ٣) و٤) و٥) شروطُ محوّلِ الخروجِ. */
export function checkEgressAdapters(
  read: Reader = diskReader,
  adapters: readonly string[] = EGRESS_ADAPTERS,
): readonly Violation[] {
  const violations: Violation[] = [];
  for (const file of adapters) {
    let text: string;
    try {
      text = read(file);
    } catch {
      violations.push({
        file,
        line: null,
        why: "محوّلُ خروجٍ مُصرَّحٌ به لا وجودَ له: إمّا نُقِلَ فيبقى غيرَ محميٍّ باسمِه الجديدِ، وإمّا حُذِفَ فيُحذَفُ من هذه القائمةِ صراحةً. والفحصُ يُخفِقُ ولا يتخطّى (الحاجزُ ح-٥).",
      });
      continue;
    }

    // ٣) حاجزٌ مبنيٌّ أو مَحقونٌ.
    const buildsGuard = /createDependencyGuard\s*\(/.test(text);
    const acceptsGuard = /guard\?\s*:\s*DependencyGuard/.test(text);
    if (!buildsGuard && !acceptsGuard) {
      violations.push({
        file,
        line: null,
        why: "محوّلُ خروجٍ بلا حاجزِ اعتماديّةٍ: لا قاطعَ دائرةٍ ولا حدَّ تزامنٍ، فعطلُ المزوّدِ يمرُّ إلينا كاملاً ونُواصلُ نداءَه (`CAP-006`).",
      });
    }

    // ٤) لا مهلةَ مكتوبةً رقماً.
    for (const match of text.matchAll(/\b([A-Z_]*TIMEOUT[A-Z_]*)\s*=\s*([0-9_]+)\s*;/g)) {
      violations.push({
        file,
        line: lineOf(text, match.index),
        why: `ثابتُ المهلةِ \`${match[1]}\` مكتوبٌ رقماً (\`${match[2]}\`): رقمانِ لمعنىً واحدٍ يفترقانِ بأوّلِ تعديلٍ فيصيرُ المُعلَنُ غيرَ المُطبَّقِ صامتاً. يُقرأُ من \`DEPENDENCY_BUDGETS\` (ADR-0079 §٤).`,
      });
    }

    // ٥) كلُّ `fetch(` بإشارةٍ.
    for (const match of text.matchAll(/\bfetch\s*\(/g)) {
      const at = match.index;
      // `typeof fetch` و`?? fetch` و`= fetch` مراجعُ لا نداءاتٌ — النمطُ يطلبُ
      // قوساً بعدَه، فلا يُطابِقُها أصلاً. وههنا يُقرأُ نصُّ النداءِ وحدَه.
      const call = text.slice(at, at + 700);
      const closes = call.indexOf("\n  });");
      const body = closes === -1 ? call : call.slice(0, closes);
      if (!body.includes("signal")) {
        violations.push({
          file,
          line: lineOf(text, at),
          why: "نداءُ `fetch(` بلا `signal`: المهلةُ التي لا تُلغي النداءَ تردُّ المُنتَظِرَ وتترُكُ المقبسَ حيّاً حتّى يقضيَ أجلَه — فالإعادةُ تُضاعِفُ المقابسَ ولا يُحسَبُ ذلكَ في أيِّ حدٍّ (ADR-0079 §٥).",
        });
      }
    }
  }
  return violations;
}

export function findViolations(
  files: readonly string[],
  read: Reader = diskReader,
  adapters: readonly string[] = EGRESS_ADAPTERS,
): readonly Violation[] {
  return [
    ...checkTelegramFactory(files, read),
    ...checkBudgetCoverage(read),
    ...checkEgressAdapters(read, adapters),
  ];
}

function main(): void {
  const files = repoFiles();
  const violations = findViolations(files);

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لصمودِ الاعتماديّاتِ (F8-04 · ADR-0079):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}${violation.line === null ? "" : `:${violation.line}`}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  console.log(
    `✓ صمودُ الاعتماديّاتِ مفروضٌ — ${EGRESS_ADAPTERS.length} محوّلَ خروجٍ بحاجزٍ ومهلةٍ مقروءةٍ وإشارةٍ مُمرَّرةٍ، ومصنعٌ واحدٌ لواجهةِ تلغرام في ${files.length} ملفاً مفحوصاً`,
  );
}

if (import.meta.main) main();
