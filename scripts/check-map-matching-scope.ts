/**
 * الغرض: بوابة CI تفرض حدَّ نطاقِ ADR 0025 — **خدمةُ مطابقةِ المسار في OSRM
 *    (`/match`) لا تُستدعى من كودِ الإنتاج في هذا الإصدار**.
 * الحالة: منفّذ فعلياً — أداة تحقق، ليست منطق أعمال.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: .github/workflows/ci.yml
 * ملاحظات مستقبلية: حين تُستوفى شروطُ ADR 0025 الخمسة ويُعاد فتحُ المطابقة، يُحذف
 *    هذا الفحص **مع** تعديلِ ADR 0025 بقرارٍ ناسخ. حذفُه وحده يُسقط الإثبات لا القيد.
 *
 * لماذا فحصٌ لا سطرٌ في وثيقة: القياسُ في المرحلة ١٦ أثبت أن استدعاءَ `/match`
 * بالإعدادات البديهيّة **يزيد** الخطأ لا ينقصه — ٢٠م تشويشاً أنتج طولاً يخطئ
 * +١٣.٦٪ بينما الأثرُ الخام يخطئ −٨.٩٪ — وأن الخادمَ يردّ `Ok` مع ثقةٍ صفرٍ
 * تماماً في تلك الحالة. فالخطرُ ليس أن ينسى أحدٌ الميزة، بل أن يضيفها أحدٌ في
 * سطرين لأنها «مجرّدُ نقطةِ نهايةٍ أخرى في المزوّد» فتصير أرقامٌ أسوأُ من
 * السابق معروضةً بثقةٍ أكبر. المكتوبُ في وثيقةٍ يُنسى بين مطوّرَين وبين شهرين؛
 * البناءُ الساقطُ لا يُنسى.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * جذورُ كودِ الإنتاج، والثلاثةُ لازمةٌ لا تجميلٌ:
 *   - `packages` موطنُ المزوّد (`packages/maps/providers/osrm`) — أقربُ موضعٍ تُضاف فيه.
 *   - `apps` موطنُ المستهلِك — خريطةُ العمليات، وهي المطلبُ الأوّلُ للأثر.
 *   - `scripts` لأنّ سكربتَ صيانةٍ أو ملءٍ رجعيٍّ يستدعي المحرّكَ من خارجِ الطلب،
 *     فيفلت من أيّ حاجزٍ ينظر إلى مسارِ الطلب وحدَه.
 * و`tests/` مستثنى قصداً: القياسُ نفسُه يجب أن يبقى قابلاً للتشغيل.
 */
export const PRODUCTION_ROOTS = ["apps", "packages", "scripts"] as const;

/** هذا الملفّ نفسُه يذكر الأنماط ليفحصها، فيُستثنى من فحصِ نفسِه. */
export const SELF = "scripts/check-map-matching-scope.ts";

/**
 * الأنماطُ الدالّةُ على استعمالِ خدمةِ المطابقة، وكلٌّ منها لا يظهر إلا فيها:
 *   - `match/v1` مسارُ الخدمة في OSRM.
 *   - `matchings` و`tracepoints` حقلا الردّ، ولا يُقرآن إلا بعد نداءِ المطابقة.
 *   - `gaps=` و`tidy=` مُعاملان خاصّان بالمطابقة وحدها.
 * ولا يُفحَص لفظُ `match` مجرّداً: المستودعُ مملوءٌ بـ`matchOrder` و`matchAll`
 * و`match-order.ts`، فحاجزٌ يصرخ على كلّ منها يُلغى في أوّلِ أسبوع.
 *
 * و`matchings`/`tracepoints` بلا حدودِ كلمةٍ (`\b`) قصداً: فحصُ التحوير أرى أنّ
 * الحدودَ لم تحمِ شيئاً يمكن تسميتُه — ولا لفطَ مشروعاً في المستودع يحوي
 * أحدهما جزءاً — بل كانت تُفلِت أقربَ ما يُخشى: حقلٌ أو عمودٌ باسمِ
 * `driver_tracepoints` أو `route_matchings`، وهو بالضبط شكلُ مخزنِ الأثرِ الممنوع.
 */
const FORBIDDEN = [/match\/v1/, /matchings/, /tracepoints/, /[?&]gaps=/, /[?&]tidy=/] as const;

export interface ScopeViolation {
  readonly line: number;
  readonly text: string;
}

/**
 * أسطرُ المصدرِ التي تستعمل خدمةَ المطابقة. دالّةٌ نقيّةٌ لتُختبر بلا قرصٍ ولا عملية.
 */
export function findMatchServiceUses(source: string): ScopeViolation[] {
  const found: ScopeViolation[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    if (FORBIDDEN.some((p) => p.test(line))) {
      found.push({ line: i + 1, text: line.trim() });
    }
  }
  return found;
}

/**
 * ملفّاتُ الإنتاج التي تُفحَص. مُصَدّرةٌ ليمرّ الاختبارُ بالمسارِ نفسِه، فلا يصير
 * للسّاحةِ المفحوصة تعريفان يتباعدان.
 */
export function collectProductionFiles(): string[] {
  const files: string[] = [];
  for (const root of PRODUCTION_ROOTS) walk(root, files);
  return files;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(full) === ".ts" && !full.includes(".test.")) out.push(full);
  }
}

function main(): void {
  const files = collectProductionFiles();

  let scanned = 0;
  const violations: { file: string; violation: ScopeViolation }[] = [];
  for (const file of files) {
    if (file === SELF) continue;
    scanned += 1;
    for (const violation of findMatchServiceUses(readFileSync(file, "utf8"))) {
      violations.push({ file, violation });
    }
  }

  if (violations.length > 0) {
    console.error("❌ خدمةُ مطابقةِ المسار مُستدعاةٌ من كودِ الإنتاج — خارجُ نطاقِ الإصدار:");
    for (const { file, violation } of violations) {
      console.error(`  - ${file}:${violation.line}  ${violation.text}`);
    }
    console.error(
      "\nراجع docs/adr/0025-map-matching-is-out-of-release-scope.md. القياسُ هناك يبيّن\n" +
        "أن المطابقة بالإعدادات البديهيّة تُنتج أرقاماً أسوأَ من الأثرِ الخام. إن\n" +
        "استُوفيت الشروطُ الخمسة فاكتب قراراً ناسخاً ثمّ احذف هذا الفحص.",
    );
    process.exit(1);
  }

  console.log(`✅ ${scanned} ملفَّ إنتاجٍ: صفرُ استدعاءٍ لخدمةِ مطابقةِ المسار (حدُّ نطاقِ ADR 0025).`);
}

// الحماية تجعل الملفّ قابلاً للاستيراد في اختبار وحدة بلا تشغيل الفحص وإسقاط العملية.
if (import.meta.main) {
  main();
}
