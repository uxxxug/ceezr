/**
 * الغرض: مقارنةُ لقطتَي حالةٍ محفوظتين في ملفّين، لأنّ السؤالَ «هل قاعدتان
 *   مُهيّأتان من الترحيلات نفسِها تبدآن من الحالة المنطقيّة نفسِها؟» لا يمكن أن
 *   يُجاب في عمليةٍ واحدةٍ متّصلةٍ بقاعدةٍ واحدة.
 * الحالة: منفّذ فعلياً — المرحلة 2 وحدة 2-4.1.
 * ينتمي إلى: bench
 * يُتوقع أن يستخدمه لاحقاً: مقارنةُ حالة القياس بين هذا المضيف وCI
 * ملاحظات مستقبلية: إن صارت اللقطةُ تُحفظ بصيغةٍ أخرى فهذا الملفُّ أوّلُ ما يُحدَّث.
 *
 * التشغيل: bun bench/compare-snapshots.ts <قبل.json> <بعد.json>
 *
 * ## ما يُعدّ فرقاً وما لا يُعدّ
 *
 * تُقارَن **البصمةُ المنقولة**: كلُّ معرّفٍ تُسنِده الترحيلاتُ عشوائياً يُستبدَل
 * قبل الحسبة باسمه المنطقيّ. فاختلافُ معرّفات المدن بين قاعدتين لا يُعلَن فرقاً
 * لأنّه ليس فرقاً في ما يقيسه القياس؛ ويُذكَر مع ذلك في بابه، لأنّ ظهورَه بين
 * لقطتين من **القاعدة نفسِها** يعني أنّ الجداول المملوكة للترحيلات أُعيد بذرُها.
 *
 * والخروجُ بـ1 عند وجود فرقٍ منطقيّ مقصود: هذا الملفُّ يُنادى من سكربتٍ أو CI،
 * ونتيجةٌ تُطبَع ولا تُغيّر رمزَ الخروج نتيجةٌ يسهل تجاهلُها.
 */

import { compareStates, formatComparison, type StateSnapshot } from "./state.ts";

const [beforePath, afterPath] = process.argv.slice(2);

if (beforePath === undefined || afterPath === undefined) {
  console.error("الاستخدام: bun bench/compare-snapshots.ts <قبل.json> <بعد.json>");
  process.exit(2);
}

const before = (await Bun.file(beforePath).json()) as StateSnapshot;
const after = (await Bun.file(afterPath).json()) as StateSnapshot;

/**
 * تُطبَع القاعدةُ ووقتُ الالتقاط لأنّ مقارنةً بلا هويّةِ طرفيها دليلٌ لا يُراجَع:
 * من يقرأ الدليلَ بعد شهرٍ يحتاج أن يعرف ما قُورن بما.
 */
console.log(`قبل : ${before.database} @ ${before.capturedAt} (${before.totalRows} صفّاً)`);
console.log(`بعد : ${after.database} @ ${after.capturedAt} (${after.totalRows} صفّاً)`);

const comparison = compareStates(before, after);
console.log(`\n${formatComparison(comparison)}`);

console.log(
  `\nفروقٌ منطقيّة: ${comparison.differences.length} — اختلافُ معرّفاتٍ مُسنَدة: ${comparison.identityOnly.length}`,
);
console.log(comparison.identical ? "✅ الحالتان متطابقتان منطقيّاً" : "❌ الحالتان مختلفتان");
process.exit(comparison.identical ? 0 : 1);
