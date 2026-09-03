/**
 * الغرض: بوابة CI تفحص كل مخطط SQL وترفض أي جدول بلا city_id أو بلا RLS.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: cities مستثنى من فحص المفتاح الأجنبي لأن عموده مولَّد من id نفسه.
 *   فحص RLS يجمع الأسماء من مصدرين (أمر مباشر، وحلقة foreach على مصفوفة أسماء) ثم
 *   يتحقق من العضوية اسماً باسم؛ الصيغة القديمة كانت تقبل وجود أيّ حلقة في أيّ ملف
 *   كدليل على تفعيل RLS لكل الجداول، وهي ثغرة نجاح كاذب لأي جدول مستقبلي.
 *
 * ## الاستثناءُ الوحيدُ من القاعدة 0.4 — مغلقٌ ومزدوجُ الشرطِ
 *
 * الملحقُ الحاكمُ 2026-09-04 في [`docs/MASTER_DIRECTIVE.md`](../docs/MASTER_DIRECTIVE.md)
 * أقرّ صنفاً واحداً مغلقاً اسمُه `domain-ingress receipt` يجوز له وحدَه ألّا يحمل
 * `city_id` لحظةَ الإنشاء. وهذا الحارسُ **لا يُضعَّف عموماً ولا يُفتَح فيه تجاوزٌ**:
 * الإعفاءُ يقتضي **شرطين معاً**، وسقوطُ أحدِهما مخالفةٌ:
 *
 *   ١) الاسمُ مُعلَنٌ في القائمةِ المغلقةِ `DOMAIN_INGRESS_RECEIPT_TABLES` في
 *      `packages/shared/config/domain-ingress.ts` — على نمطِ `EVENT_DISTRIBUTION_MECHANISMS`.
 *   ٢) الهجرةُ التي تُنشئ الجدولَ تُصرِّح انتماءَه بالصيغةِ الحرفيّةِ
 *      `-- domain-ingress-receipt: <table>` في نفسِ الملفّ.
 *
 * ويُرفَض كذلك: تصريحٌ لاسمٍ خارجَ القائمةِ (توسيعُ الصنفِ بتعليقٍ في هجرةٍ — وهو
 * ما نصَّ الملحقُ على منعِه صريحاً)، وتصريحٌ بلا `create table` يقابله، واسمٌ في
 * القائمةِ بلا جدولٍ ولا تصريح (مُدخلٌ ميّتٌ يوسّع الاستثناءَ بلا مقابلٍ يُقرأ).
 * و`RLS` تبقى مفروضةً على هذا الصنفِ كغيرِه: الإقرارُ يخصّ `city_id` وحدَه.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOMAIN_INGRESS_RECEIPT_DECLARATION_PREFIX,
  DOMAIN_INGRESS_RECEIPT_TABLES,
  isDomainIngressReceiptTable,
} from "../packages/shared/config/domain-ingress.ts";

const MIGRATIONS_DIR = "supabase/migrations";

interface Violation {
  readonly file: string;
  readonly table: string;
  readonly problem: string;
}

/**
 * أجسام تعريفات `create table` في نصّ الهجرات، مقرونةً بأسمائها.
 *
 * الاسم يُقبل مؤهّلاً بمخطّط (`public.orders`) ومقتبساً بعلامات مزدوجة
 * (`"orders"`)، ويُجرّد من المخطّط والعلامات ليطابق أسماء تفعيل RLS. الصيغة
 * الأولى كانت تقبل الاسم المجرّد وحده، فـ`create table public.foo (…)` يمرّ بلا
 * أي فحص لا لـcity_id ولا لـRLS — ثقب نجاحٍ كاذب لم يستغلّه أحد بعد، ولأنّه
 * لم يُستغلّ ما كان ليظهر في أي تشغيل — فسُدّ قبل أن يُستغلّ.
 */
export function findTableBlocks(sql: string): { name: string; body: string }[] {
  const blocks: { name: string; body: string }[] = [];
  const pattern =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    if (name === undefined) continue;

    // بداية جسم الجدول: مباشرة بعد القوس المفتوح الذي التقطه النمط
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      i += 1;
    }
    blocks.push({ name, body: sql.slice(bodyStart, i - 1) });
  }
  return blocks;
}

/**
 * أسماء الجداول التي فُعِّلت عليها RLS فعلياً في نصّ الهجرات.
 *
 * مصدران معترف بهما، وكلاهما يُنتج اسماً صريحاً:
 *   1) `alter table <name> enable row level security`
 *   2) `do $$ … foreach t in array array['a','b',…] loop … enable row level security … end loop`
 *
 * الحلقة تُقبل بشرطين: أن تكون على مصفوفة نصوص حرفية، وأن يظهر داخل جسمها فعلاً
 * أمر التفعيل. حلقة تُنفّذ شيئاً آخر (منح صلاحيات على دوالّ مثلاً) لا تُحتسب.
 * ما لا يُقبل عمداً: أسماء مبنية بجمع نصوص أو قادمة من استعلام — لأن فاحصاً ساكناً
 * لا يعرف قيمتها، وقبولها يعني الثقة بما لا يُقرأ.
 */
export function tablesWithRlsEnabled(sql: string): Set<string> {
  const enabled = new Set<string>();

  // الاسم هنا يُقبل مؤهّلاً بمخطّط ومقتبساً، مثل اسم الجدول في findTableBlocks:
  // لو قُبِل في أحدهما دون الآخر لاختلفت المجموعتان فأبلغ الحرس مخالفةً وهميّة.
  const direct =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:"?[a-z_][a-z0-9_]*"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi;
  for (const match of sql.matchAll(direct)) {
    const name = match[1];
    if (name !== undefined) enabled.add(name);
  }

  const loops =
    /foreach\s+[a-z_][a-z0-9_]*\s+in\s+array\s+array\s*\[([^\]]*)\]\s*loop([\s\S]*?)end\s+loop/gi;
  for (const match of sql.matchAll(loops)) {
    const arrayLiteral = match[1];
    const loopBody = match[2];
    if (arrayLiteral === undefined || loopBody === undefined) continue;
    if (!/enable\s+row\s+level\s+security/i.test(loopBody)) continue;

    for (const item of arrayLiteral.matchAll(/'([a-z_][a-z0-9_]*)'/gi)) {
      const name = item[1];
      if (name !== undefined) enabled.add(name);
    }
  }

  return enabled;
}

/**
 * أسماءُ الجداولِ المُصرَّحِ بانتمائها إلى صنفِ `domain-ingress receipt` في نصِّ هجرةٍ.
 *
 * تُقرأ من سطرِ تعليقٍ بالصيغةِ الحرفيّةِ وحدَها، فلا تُقبَل الصيغةُ مبنيّةً بجمعِ
 * نصوصٍ ولا مُستنتَجةً من شكلِ الجدول — والقصدُ أن يكون التصريحُ مقروءاً بالعينِ
 * كما يُقرأ بالفاحص، فمن أعفى جدولاً أعلن ذلك في الملفِّ نفسِه بسطرٍ لا يُخطئه أحد.
 */
export function declaredDomainIngressReceipts(sql: string): Set<string> {
  const declared = new Set<string>();
  const escapedPrefix = DOMAIN_INGRESS_RECEIPT_DECLARATION_PREFIX.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const pattern = new RegExp(`^\\s*${escapedPrefix}\\s+([a-z_][a-z0-9_]*)\\s*$`, "gim");
  for (const match of sql.matchAll(pattern)) {
    const name = match[1];
    if (name !== undefined) declared.add(name);
  }
  return declared;
}

function main(): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const violations: Violation[] = [];
  const allTables: string[] = [];
  const rlsEnabled = new Set<string>();
  /** ما صُرِّح به فعلاً، وفي أيِّ ملفٍّ — كي يُرى المُدخلُ الميّتُ والتصريحُ اليتيم. */
  const declaredReceipts = new Map<string, string>();
  const exemptedTables: string[] = [];

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const name of tablesWithRlsEnabled(sql)) rlsEnabled.add(name);

    const declaredHere = declaredDomainIngressReceipts(sql);
    for (const name of declaredHere) {
      declaredReceipts.set(name, file);
      if (!isDomainIngressReceiptTable(name)) {
        violations.push({
          file,
          table: name,
          problem:
            "صُرِّح كـdomain-ingress receipt وليس في القائمة المغلقة " +
            "DOMAIN_INGRESS_RECEIPT_TABLES — والصنفُ لا يُوسَّع بتعليقٍ في هجرة " +
            "(الملحق الحاكم 2026-09-04)",
        });
      }
    }

    for (const { name, body } of findTableBlocks(sql)) {
      allTables.push(name);

      if (!/\bcity_id\b/.test(body)) {
        // الإعفاءُ مزدوجُ الشرطِ: إعلانٌ في القائمةِ المغلقةِ، وتصريحٌ في هذا الملفِّ.
        if (isDomainIngressReceiptTable(name) && declaredHere.has(name)) {
          exemptedTables.push(name);
          continue;
        }
        violations.push({ file, table: name, problem: "لا يحمل عمود city_id (القاعدة 0.4)" });
        continue;
      }
      if (name !== "cities" && !/city_id[^,]*references\s+cities\s*\(/i.test(body)) {
        violations.push({ file, table: name, problem: "city_id بلا مفتاح أجنبي إلى cities" });
      }
      if (name !== "cities" && !/city_id\s+uuid\s+not\s+null/i.test(body)) {
        violations.push({ file, table: name, problem: "city_id يجب أن يكون NOT NULL" });
      }
    }
  }

  for (const table of allTables) {
    if (!rlsEnabled.has(table)) {
      violations.push({
        file: "—",
        table,
        problem: "RLS غير مفعّلة: لا أمر مباشر ولا عضوية في مصفوفة حلقة تفعيل",
      });
    }
  }

  // اسم في قائمة التفعيل بلا جدول يقابله يعني إمّا خطأ كتابي أو جدولاً حُذف
  // ونُسي اسمه في الحلقة — وكلاهما يستحقّ أن يُرى لا أن يُتجاهل.
  for (const table of rlsEnabled) {
    if (!allTables.includes(table)) {
      violations.push({
        file: "—",
        table,
        problem: "مذكور في تفعيل RLS بلا create table يقابله",
      });
    }
  }

  // تصريحٌ بلا جدولٍ يقابله: إعفاءٌ معلَّقٌ في الهواء يبقى مقروءاً كرخصةٍ سارية.
  for (const [table, file] of declaredReceipts) {
    if (!allTables.includes(table)) {
      violations.push({
        file,
        table,
        problem: "صُرِّح كـdomain-ingress receipt بلا create table يقابله",
      });
    }
  }

  // مُدخلٌ في القائمةِ المغلقةِ بلا تصريحٍ في أيِّ هجرة: توسيعٌ للاستثناءِ بلا مقابلٍ
  // يُقرأ. والقائمةُ تُقرأ رخصةً، فرخصةٌ بلا مرخَّصٍ له تبقى بابَ نجاحٍ كاذبٍ لجدولٍ
  // مستقبليٍّ يحمل الاسمَ نفسَه.
  for (const table of DOMAIN_INGRESS_RECEIPT_TABLES) {
    if (!declaredReceipts.has(table)) {
      violations.push({
        file: "packages/shared/config/domain-ingress.ts",
        table,
        problem: "مُعلَن في القائمة المغلقة بلا تصريحٍ في أيّ هجرة (مُدخلٌ ميّت)",
      });
    }
  }

  if (violations.length > 0) {
    console.error("❌ مخالفات في المخططات:");
    for (const v of violations) {
      console.error(`  - [${v.file}] ${v.table}: ${v.problem}`);
    }
    process.exit(1);
  }

  const exemptNote =
    exemptedTables.length === 0
      ? ""
      : ` · وإعفاءُ city_id مقصورٌ على ${exemptedTables.length} جدولٍ من صنفِ domain-ingress receipt` +
        ` بشرطَيه (${exemptedTables.join(", ")})`;
  console.log(
    `✅ ${allTables.length} جدولاً: كلها تحمل city_id و RLS مفعّلة باسمها صراحةً (${rlsEnabled.size} اسماً في قائمة التفعيل)${exemptNote}.`,
  );
}

// الحماية تجعل الملفّ قابلاً للاستيراد في اختبار وحدة بلا تشغيل الفحص وإسقاط العملية.
if (import.meta.main) {
  main();
}
