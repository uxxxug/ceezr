/**
 * الغرض: عمليّةٌ منفصلةٌ تدفع مقاييسَها إلى مُجمِّعٍ ثم تخرج — طرفُ إثباتِ F5-07.
 * الحالة: منفّذ فعلياً — يُشغَّل من tests/integration/metrics-central-aggregation.test.ts
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: أيّ إثباتٍ يحتاج نسختَين حقيقيّتَين لا نسختَين في ذاكرةٍ واحدة
 * ملاحظات مستقبلية: يبقى مستقلّاً عن الحاوية — إقلاعُ حاويةٍ كاملةٍ يحتاج قاعدةً.
 *
 * ولماذا ملفٌّ منفصلٌ يُشغَّل بـ`Bun.spawn` لا دالّةٌ تُستدعى مرّتَين في الاختبار؟
 * لأنّ عطبَ `SCL-006` عطبُ **عمليّاتٍ** لا عطبُ كائنات. مسجِّلانِ في عمليّةٍ واحدةٍ
 * يتشاركان الكومةَ ورقمَ العمليّةِ وساعةَ الإقلاع، فيمرّ الاختبارُ ولو كانت الهويّةُ
 * مُشتقّةً من `process.pid` وحدَه — وهو بالضبط الخطأُ الذي يجب أن يُكشَف. فعمليّتان
 * حقيقيّتان بـ`pid` مختلفَين وساعتَي إقلاعٍ مختلفتَين هما وحدَهما ما يُثبِت أنّ
 * المُجمِّعَ يفصل بينهما ويجمعهما.
 *
 * المُعامَلات: `<الرابط> <معرّف النسخة> <عدد الزيادات>`
 * الخروج: `0` عند دفعٍ ناجح، `1` عند أيِّ فشل — فيقرأ الأبُ النتيجةَ من رمزِ الخروج
 * لا من نصٍّ يحلّله.
 */

import { createMetricsExporter } from "../../packages/infrastructure/observability/metrics-exporter.ts";
import { PrometheusRegistry } from "../../packages/infrastructure/observability/registry.ts";

/** أسماءٌ يقرؤها الاختبارُ والطفلُ معاً بلا نسخِ نصٍّ بينهما. */
export const CHILD_COUNTER = "waslah_child_rides_total";
export const CHILD_HISTOGRAM = "waslah_child_duration_seconds";
export const CHILD_GAUGE = "waslah_child_online_drivers";

async function main(): Promise<number> {
  const [endpoint, instanceId, rawIncrements] = process.argv.slice(2);
  if (endpoint === undefined || instanceId === undefined || rawIncrements === undefined) {
    console.error("الاستعمال: metrics-push-child.ts <endpoint> <instanceId> <increments>");
    return 1;
  }
  const increments = Number.parseInt(rawIncrements, 10);
  if (!Number.isInteger(increments) || increments < 0) {
    console.error("عددُ الزياداتِ يجب أن يكون عدداً صحيحاً غيرَ سالب");
    return 1;
  }

  const registry = new PrometheusRegistry();
  registry.defineCounter({ name: CHILD_COUNTER, help: "رحلاتٌ في هذه النسخة", labelNames: [] });
  registry.defineGauge({ name: CHILD_GAUGE, help: "سائقون متّصلون", labelNames: [] });
  registry.defineHistogram({
    name: CHILD_HISTOGRAM,
    help: "زمنُ المهمّة",
    labelNames: [],
    buckets: [0.1, 1],
  });

  for (let index = 0; index < increments; index += 1) {
    registry.increment(CHILD_COUNTER, {}, 1);
    registry.observe(CHILD_HISTOGRAM, {}, 0.05);
  }
  // مؤشّرٌ لحظيٌّ: لا يُجمَع بين النسخِ بل يُقرأ لكلِّ نسخةٍ وحدَها. وقيمتُه هنا
  // مشتقّةٌ من الزياداتِ كي يتأكّد الأبُ أنّه قرأ نسخةً بعينِها لا الأخرى.
  registry.setGauge(CHILD_GAUGE, {}, increments * 2);

  const exporter = createMetricsExporter({
    registry,
    endpoint,
    headers: {},
    resource: {
      serviceName: "waslah-child",
      serviceInstanceId: instanceId,
      deploymentEnvironment: "test",
      processTopology: "multi-process",
      processPid: process.pid,
    },
    intervalMs: 60_000,
  });

  const outcome = await exporter.exportOnce();
  await exporter.stop();
  if (outcome.outcome !== "exported") {
    console.error(`فشلَ الدفعُ: ${outcome.outcome} ${outcome.detail ?? ""}`);
    return 1;
  }
  return 0;
}

// ولماذا `import.meta.main`؟ لأنّ الاختبارَ يستورد الأسماءَ أعلاه من هذا
// الملفّ كي لا تُنسَخ نصّاً. وبلا هذا الحارسِ كان الاستيرادُ يُشغّل `main`
// بلا مُعامَلاتٍ فيُنهي عمليّةَ الاختبارِ نفسَها بـ`process.exit(1)` قبل أن
// يُقاس شيءٌ — وهو ما وقع أوّلَ تشغيل.
if (import.meta.main) process.exit(await main());
