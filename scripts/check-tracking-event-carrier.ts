/**
 * الغرض: بوابة CI تفرض بندَ `F4-03` في الخارطة — «مجرى أحداثٍ مشتركٌ بديلٌ عن
 *    ناقلِ العمليةِ» — وهو نفسُه `SCL-004` في القسم 11-ب وقرارُ
 *    [ADR 0058](../docs/adr/0058-tracking-event-carrier-is-redis-streams.md).
 *    والفحصُ رباعيُّ الأثر، وكلُّه قراءةُ شيفرةٍ لا قراءةُ وثيقة:
 *      ١) مفتاحُ المجرى **مصدرُ حقيقةٍ واحدٌ**: الثابتُ
 *         `TRACKING_EVENT_STREAM_KEY` في وحدةِ الناقلِ وحدَها، ولا نصَّ حرفيّاً
 *         له في أيِّ شيفرةٍ أخرى.
 *      ٢) كلُّ عمليةٍ تبني ناقلاً محليّاً (`createTrackingEventBus`) **تُغلِّفُه**
 *         بـ`createRedisStreamTrackingEventBus` وتُشغِّلُ ماسحَه (`.start()`) في
 *         الملفِّ نفسِه — فلا عمليةٌ تكتفي بذاكرتِها.
 *      ٣) الناقلُ يُبنى في حاويةِ العمليةِ وحدَها (`container.ts`) لا في حوارٍ ولا
 *         مسارٍ — ومرّةً واحدةً: بانيانِ في عمليةٍ يعنيانِ مشتركَينِ لا يريانِ
 *         أحداثَ بعضِهما، وهو الخطأُ الذي يُحذِّرُ منه تعليقُ الحاويةِ أصلاً.
 *      ٤) `streamKey` المُمرَّرُ إلى الناقلِ الموزَّعِ هو ذاك الثابتُ لا سواه.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml · tests/unit
 * ملاحظات مستقبلية: إن حُمِلَ الحدثُ على الطابورِ الموحَّدِ (ADR 0061) بدلَ
 *    Streams، فالحاجزُ يبقى مطلوباً بمعناهُ: مجرى واحدٌ مُعرَّفٌ في موضعٍ واحدٍ
 *    وكلُّ عمليةٍ مشتركةٌ فيه — ويُعدَّلُ اسمُ الدالّةِ المُغلِّفةِ لا مبدأُ الفحص.
 *
 * لماذا فحصٌ لا اتفاق: المفتاحُ كانَ نصّاً حرفيّاً في حاويتَين. تعديلُه في واحدةٍ
 * دونَ الأخرى **لا يُخفِقُ ترجمةً ولا اختباراً**: العمليّتانِ تُقلعانِ خضراءَ،
 * وتنشرُ كلٌّ في مجراها، ولا يرى مشتركو اللوحةِ أحداثَ البوّابةِ أبداً. عطبٌ
 * صامتٌ في القناةِ الحرجةِ أسوأُ من انقطاعٍ مُعلَن — والحاجزُ يمنعُ عودتَه.
 *
 * **وحدُّ الحاجزِ مُعلَنٌ:** يقرأُ النصَّ لا الأثر. أنَّ الحدثَ يعبرُ فعلاً بينَ
 * نسختَينِ يُثبِتُه `tests/unit/redis-stream-event-bus.test.ts` واختباراتُ Redis
 * الحقيقيّ — لا هذا الملفّ.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** الجذورُ المفحوصة: شيفرةُ المستودعِ كلُّها بلا اعتماديات. */
const ROOTS = ["apps", "packages", "scripts", "tests", "bench", "probe"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

/** وحدةُ الناقلِ الموزَّعِ: موضعُ تعريفِ المفتاحِ الوحيد. */
export const CARRIER_MODULE = "packages/infrastructure/tracking/redis-stream-event-bus.ts";
/** اسمُ الثابتِ المُصدَّرِ للمفتاح. */
export const KEY_CONSTANT = "TRACKING_EVENT_STREAM_KEY";
/** قيمةُ المفتاحِ نصّاً — يُفحَصُ ألّا تظهرَ حرفيّاً خارجَ وحدةِ الناقل. */
export const KEY_LITERAL = "waslah:tracking:events";
/** بانيُ الناقلِ المحليّ داخلَ العملية. */
export const LOCAL_FACTORY = "createTrackingEventBus";
/** بانيُ الغلافِ الموزَّعِ فوقَ المحليّ. */
export const DISTRIBUTED_FACTORY = "createRedisStreamTrackingEventBus";
/** هذا الملفُّ نفسُه يذكر الأسماءَ والقيمةَ نصّاً، فيُستثنى من المطابقة. */
const SELF = "scripts/check-tracking-event-carrier.ts";

/** ملفٌّ واحدٌ بمسارِه ونصِّه — وحدةُ الفحصِ، تُصنَعُ في الاختبارِ بلا قرصٍ. */
export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

export interface Violation {
  readonly file: string;
  readonly line: number | null;
  readonly why: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

/** يقرأُ المستودعَ القائمَ ملفّاً ملفّاً — المُدخَلُ الحقيقيُّ للفحص. */
export function readSources(): readonly SourceFile[] {
  return ROOTS.flatMap((root) => walk(root))
    .filter((path) => path !== SELF)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

/**
 * صحيحٌ للسطرِ الذي هو تعليقٌ خالص. التعليقُ يجوز أن يذكرَ المفتاحَ نصّاً —
 * الشرحُ ليس تكراراً لمصدرِ الحقيقةِ، والمنعُ الأعمى كان سيُخرِسَ الوثائق.
 */
export function isCommentLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** عددُ مرّاتِ ظهورِ نداءِ دالّةٍ في نصٍّ (مطابقةُ `name(`). */
export function countCalls(source: string, name: string): number {
  return source.split(`${name}(`).length - 1;
}

export function findViolations(files: readonly SourceFile[]): readonly Violation[] {
  const violations: Violation[] = [];
  const carriers: string[] = [];

  for (const { path: file, source } of files) {
    const lines = source.split("\n");

    // ١) لا نصَّ حرفيّاً للمفتاحِ خارجَ وحدةِ الناقل (والتعليقاتُ مُستثناة).
    if (file !== CARRIER_MODULE) {
      for (const [index, text] of lines.entries()) {
        if (!text.includes(KEY_LITERAL)) continue;
        if (isCommentLine(text)) continue;
        violations.push({
          file,
          line: index + 1,
          why: `مفتاحُ المجرى نصّاً حرفيّاً — يُستوردُ \`${KEY_CONSTANT}\` من \`${CARRIER_MODULE}\` (F4-03 · SCL-004)`,
        });
      }
    }

    const localCalls = countCalls(source, LOCAL_FACTORY);
    if (localCalls === 0) continue;

    // بناءُ الناقلِ مسموحٌ في: وحدتِه، وحاوياتِ العمليّاتِ، والاختبارات.
    const isCarrierPackage = file.startsWith("packages/infrastructure/tracking/");
    const isContainer = file.endsWith("/container.ts");
    const isTest = file.startsWith("tests/");
    if (!isCarrierPackage && !isContainer && !isTest) {
      // ٣-أ) لا يُبنى الناقلُ في حوارٍ ولا مسارٍ ولا عاملٍ: الحاويةُ وحدَها.
      violations.push({
        file,
        line: null,
        why: `\`${LOCAL_FACTORY}\` يُبنى في حاويةِ العمليةِ (\`container.ts\`) وحدَها — بانٍ ثانٍ يعني مشتركينَ لا يريانِ أحداثَ بعضِهما (F4-03)`,
      });
      continue;
    }
    if (!isContainer) continue;

    carriers.push(file);

    // ٣-ب) بانٍ واحدٌ لكلِّ عملية.
    if (localCalls > 1) {
      violations.push({
        file,
        line: null,
        why: `\`${LOCAL_FACTORY}\` مُستدعىً ${localCalls} مرّاتٍ في العمليةِ نفسِها — الناقلُ **واحدٌ** للعمليةِ كلِّها (F4-03)`,
      });
    }

    // ٢) التغليفُ الموزَّعُ وتشغيلُ الماسحِ في الملفِّ نفسِه.
    if (countCalls(source, DISTRIBUTED_FACTORY) === 0) {
      violations.push({
        file,
        line: null,
        why: `ناقلٌ محليٌّ بلا غلافِ \`${DISTRIBUTED_FACTORY}\` — العمليةُ تعتمدُ ذاكرتَها وحدَها، وهو ما نقضَه \`SCL-004\` (ADR 0058)`,
      });
    } else if (!/\.start\(\)/.test(source)) {
      violations.push({
        file,
        line: null,
        why: "غلافٌ موزَّعٌ بلا `.start()` — بلا ماسحٍ لا تصلُ أحداثُ النسخِ الأخرى أبداً (F4-03)",
      });
    }

    // ٤) `streamKey` هو الثابتُ لا سواه.
    for (const [index, text] of lines.entries()) {
      const match = /streamKey\s*:\s*([^,\n})]+)/.exec(text);
      if (match === null) continue;
      if (match[1]?.trim() === KEY_CONSTANT) continue;
      violations.push({
        file,
        line: index + 1,
        why: `\`streamKey\` غيرُ \`${KEY_CONSTANT}\` — مجرىً ثانٍ يعني عمليّاتٍ لا تتشاركُ الأحداثَ (F4-03 · SCL-004)`,
      });
    }
  }

  // حاجزٌ أخضرُ على غيابِ الشيءِ يُطمئنُ زوراً (ح-5): لا ناقلَ = خرقٌ لا نجاح.
  if (carriers.length === 0) {
    violations.push({
      file: "apps/**/container.ts",
      line: null,
      why: "لم يُوجَد أيُّ ناقلِ أحداثِ تتبّعٍ في حاوياتِ العمليّاتِ — لا شيءَ ليُفحَص (ح-5)",
    });
  }

  return violations;
}

/** حاوياتُ العمليّاتِ التي بَنَت ناقلاً — للتقريرِ عندَ النجاح. */
export function carrierContainers(files: readonly SourceFile[]): readonly string[] {
  return files
    .filter(({ path, source }) => path.endsWith("/container.ts") && source.includes(LOCAL_FACTORY))
    .map(({ path }) => path);
}

function main(): void {
  const files = readSources();
  const violations = findViolations(files);

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} خرقاً لمجرى الأحداثِ المشتركِ (F4-03 · SCL-004):\n`);
    for (const violation of violations) {
      console.error(`  ${violation.file}${violation.line === null ? "" : `:${violation.line}`}`);
      console.error(`    ${violation.why}\n`);
    }
    process.exit(1);
  }

  const carriers = carrierContainers(files);
  console.log(
    `✓ مجرىً واحدٌ مشتركٌ (\`${KEY_CONSTANT}\`) وكلُّ حاويةٍ تُغلِّفُ ناقلَها وتُشغِّلُ ماسحَه — ${carriers.length} عمليّةً: ${carriers.join(" · ")}`,
  );
}

if (import.meta.main) main();
