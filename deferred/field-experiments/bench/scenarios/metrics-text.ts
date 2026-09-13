/**
 * الغرض: قراءةُ قيمةِ عدّادٍ من نصِّ Prometheus المعروض — دالّةٌ نقيّةٌ تُختبَر بلا قاعدة.
 * الحالة: منفّذ فعلياً — وحدة 2-5.
 * ينتمي إلى: bench/scenarios
 * يُتوقع أن يستخدمه لاحقاً: المشغّل، والسيناريوهاتُ التي تُوكّد على حركةِ عدّاد.
 * ملاحظات مستقبلية: إن احتيج إلى المدرّجات (histograms) تُضاف قراءةٌ للـ`_sum`/`_count` هنا.
 *
 * وملفٌّ مستقلٌّ لا دالّةٌ داخلَ المشغّل: السيناريوهات تحتاجها والمشغّلُ يحتاجها،
 * ووضعُها في المشغّل كان سيجعل السيناريو يستورد من مُشغّله فتنشأ حلقةُ استيراد.
 */

/**
 * يجمع كلَّ سلاسلِ عدّادٍ واحد.
 *
 * ويُجمَع لا تُقرأ سلسلةٌ واحدة: العدّاداتُ هنا موسومةٌ (بالمدينة، بالبوت، بالنوع)،
 * فقراءةُ سلسلةٍ بعينها كانت ستُظهر «صفراً» متى تغيّر وسمٌ لا علاقةَ له بالمقيس.
 */
export function sumMetric(rendered: string, name: string): number {
  let total = 0;
  for (const rawLine of rendered.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (!line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    // يُستبعَد `name_bucket` و`name_sum` وما يبدأ بالاسمِ ويزيد عليه محرفاً معنويّاً.
    if (rest !== "" && !rest.startsWith("{") && !rest.startsWith(" ")) continue;
    const value = Number.parseFloat(line.slice(line.lastIndexOf(" ") + 1));
    if (Number.isFinite(value)) total += value;
  }
  return total;
}
