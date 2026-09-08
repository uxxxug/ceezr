/**
 * الغرض: إثباتُ أنّ مقاييسَ عمليّتَين منفصلتَين تُجمَعان في موضعٍ واحد — F5-07 (SCL-006).
 * الحالة: منفّذ فعلياً — عمليّتان حقيقيّتان بـBun.spawn ومُستقبِلٌ محلّيٌّ حقيقيّ.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: F5-04 (فصلُ العامل) وF5-06 (رفعُ عددِ النسخ)
 * ملاحظات مستقبلية: لا يلمس قاعدةَ بياناتٍ ولا Redis فيعمل في كلِّ بيئةٍ بلا شرط.
 *
 * **وما الذي يُثبِته هذا الملفُّ بالضبط؟** أنّ العطبَ الذي جاء `SCL-006` يمنعُه قد
 * زال: أنّ `GET /metrics` يعرض مقاييسَ **العمليّةِ التي أجابت** لا مقاييسَ النظام،
 * فما دامت نسخةٌ واحدةٌ فلا فرق، فإذا صارت نسختَين صار كلُّ كشطٍ يقرأ رقماً عشوائيّاً
 * من إحداهما ولا يوجد في الدنيا موضعٌ يُقرأ منه مجموعُ النظام.
 *
 * وطريقةُ الإثبات: عمليّتان **حقيقيّتان** (`Bun.spawn`) تدفعان إلى مُستقبِلٍ واحد،
 * ثم يُجمَع ما وصل ويُقارَن بالمجموعِ المعروفِ سلفاً. ومسجِّلانِ في عمليّةٍ واحدةٍ
 * ما كانا يُثبِتان شيئاً: يتشاركان الكومةَ ورقمَ العمليّة، فتمرّ حتى هويّةٌ مبنيّةٌ
 * على `pid` وحدَه — وهي الهويّةُ المعطوبة التي يجب أن يسقط الاختبارُ عندها.
 *
 * **وما لا يُثبِته:** أنّ مُجمِّعاً حقيقيّاً (OTel Collector أو Grafana) يقبل جسمَنا
 * ويعرضه — المُستقبِلُ هنا `Bun.serve` يفحص الجسمَ لا مُجمِّعٌ كامل. وأنّ الدفعَ
 * يعمل من داخلِ Render عبرَ شبكتِها. ذلك يبقى غيرَ مُثبَتٍ حتى يُنشَأ المُجمِّعُ
 * فعلاً (F5-06)، وهو مُدوَّنٌ في ملفِّ الشاهدِ حدّاً معروفاً لا نقصاً مسكوتاً عنه.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CHILD_COUNTER, CHILD_GAUGE, CHILD_HISTOGRAM } from "../support/metrics-push-child.ts";

const CHILD_SCRIPT = "tests/support/metrics-push-child.ts";
const INSTANCE_A = "instance-alpha";
const INSTANCE_B = "instance-beta";
const INCREMENTS_A = 7;
const INCREMENTS_B = 11;

interface ReceivedBody {
  readonly resourceMetrics: {
    readonly resource: {
      readonly attributes: { key: string; value: { stringValue?: string; intValue?: string } }[];
    };
    readonly scopeMetrics: {
      readonly metrics: {
        name: string;
        sum?: { dataPoints: { asDouble: number }[]; isMonotonic: boolean };
        gauge?: { dataPoints: { asDouble: number }[] };
        histogram?: { dataPoints: { count: string; bucketCounts: string[] }[] };
      }[];
    }[];
  }[];
}

/** مُجمِّعٌ صغيرٌ يقلّد ما يفعله مُجمِّعٌ حقيقيّ: يفصل بالهويّةِ ثم يجمع. */
class Collector {
  readonly bodies: ReceivedBody[] = [];

  private attribute(body: ReceivedBody, key: string): string | undefined {
    const attribute = body.resourceMetrics[0]?.resource.attributes.find((item) => item.key === key);
    return attribute?.value.stringValue ?? attribute?.value.intValue;
  }

  instanceIds(): string[] {
    return this.bodies
      .map((body) => this.attribute(body, "service.instance.id"))
      .filter((value): value is string => value !== undefined);
  }

  pids(): string[] {
    return this.bodies
      .map((body) => this.attribute(body, "process.pid"))
      .filter((value): value is string => value !== undefined);
  }

  /**
   * **أحدثُ جسمٍ لكلّ نسخةٍ لا كلُّ أجسامِها.**
   *
   * وهذا ليس تفصيلاً في الاختبار؛ هو دلالةُ `aggregationTemporality: 2`
   * (تراكميّة) التي نُعلِنُها: كلُّ دفعةٍ تحمل العدَّ **من أوّلِ الإقلاع**
   * لا ما جدَّ منذ الدفعةِ السابقة. فمُجمِّعٌ يجمع الدفعاتِ بعضَها فوقَ
   * بعضٍ يُنفخ الرقمَ بعددِ الدفعات — وهو ما وقع أوّلَ تشغيلٍ لهذا الملفّ:
   * قراءةُ ٣٦ حيث الصوابُ ١٨، لأنّ كلَّ عمليّةٍ تدفع مرّتَين (دورٌ ثمّ دفعةٌ
   * أخيرةٌ عند الإيقاف). ولو أُعلِنت الزمنيّةُ `1` (فرقيّة) لصار الجمعُ هو
   * الصوابَ والأخذُ بالأحدثِ خطأً. فهذا المُجمِّعُ يقرأ ما أعلَنّاه لا ما يحلو له.
   */
  private latestPerInstance(): ReceivedBody[] {
    const byInstance = new Map<string, ReceivedBody>();
    for (const body of this.bodies) {
      const instanceId = this.attribute(body, "service.instance.id");
      if (instanceId === undefined) continue;
      byInstance.set(instanceId, body);
    }
    return [...byInstance.values()];
  }

  private metric(body: ReceivedBody, name: string) {
    return body.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find((item) => item.name === name);
  }

  /** مجموعُ عدّادٍ عبرَ كلِّ النسخ — وهو الرقمُ الذي لا يوجد له موضعٌ بلا هذا البند. */
  sumCounterAcrossInstances(name: string): number {
    return this.latestPerInstance().reduce((total, body) => {
      const points = this.metric(body, name)?.sum?.dataPoints ?? [];
      return total + points.reduce((inner, point) => inner + point.asDouble, 0);
    }, 0);
  }

  /** مؤشّرُ نسخةٍ بعينِها: المؤشّراتُ لا تُجمَع بل تُقرأ لكلِّ نسخةٍ وحدَها. */
  gaugeForInstance(instanceId: string, name: string): number | undefined {
    const body = this.latestPerInstance().find(
      (candidate) => this.attribute(candidate, "service.instance.id") === instanceId,
    );
    if (body === undefined) return undefined;
    return this.metric(body, name)?.gauge?.dataPoints[0]?.asDouble;
  }

  sumHistogramCount(name: string): number {
    return this.latestPerInstance().reduce((total, body) => {
      const points = this.metric(body, name)?.histogram?.dataPoints ?? [];
      return total + points.reduce((inner, point) => inner + Number(point.count), 0);
    }, 0);
  }
}

const collector = new Collector();
let server: ReturnType<typeof Bun.serve> | null = null;
let endpoint = "";
const exitCodes: Record<string, number> = {};

async function runChild(instanceId: string, increments: number): Promise<number> {
  const child = Bun.spawn(["bun", CHILD_SCRIPT, endpoint, instanceId, `${increments}`], {
    env: { PATH: process.env.PATH ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    console.error(`[${instanceId}] ${await new Response(child.stderr).text()}`);
  }
  return exitCode;
}

beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (request.method !== "POST") return new Response("method", { status: 405 });
      if (request.headers.get("content-type") !== "application/json") {
        // المُجمِّعُ الحقيقيُّ يرفض ما ليس JSON، ورفضُه هنا يمنع اختباراً يمرّ
        // بجسمٍ ما كان مُجمِّعٌ حقيقيٌّ سيقبله.
        return new Response("content-type", { status: 415 });
      }
      collector.bodies.push((await request.json()) as ReceivedBody);
      return new Response("{}", { status: 200 });
    },
  });
  endpoint = `http://127.0.0.1:${server.port}/v1/metrics`;

  // بالتسلسلِ لا بالتوازي: ترتيبُ وصولِ الجسمَين لا يخصّ الإثباتَ، والتسلسلُ
  // يجعل رمزَ خروجِ كلِّ عمليّةٍ منسوباً إليها بلا لبس.
  exitCodes[INSTANCE_A] = await runChild(INSTANCE_A, INCREMENTS_A);
  exitCodes[INSTANCE_B] = await runChild(INSTANCE_B, INCREMENTS_B);
});

afterAll(() => {
  server?.stop(true);
});

describe("SCL-006: التجميعُ المركزيُّ لمقاييسِ عمليّاتٍ منفصلة", () => {
  test("كلتا العمليّتَين دفعت ونجحت — بدليلِ رمزِ الخروج", () => {
    // رمزُ الخروجِ لا نصُّ السجلّ: نصٌّ يُطبَع قد يُطبَع في مسارِ فشلٍ أيضاً،
    // ورمزُ الخروجِ `0` لا يُكتَب إلا بعدَ ردٍّ ناجحٍ من المُستقبِل.
    expect(exitCodes[INSTANCE_A]).toBe(0);
    expect(exitCodes[INSTANCE_B]).toBe(0);
  });

  test("وصل من كلِّ عمليّةٍ دفعةٌ دورٍ ودفعةٌ أخيرةٌ عند الإيقاف", () => {
    // أربعةٌ لا اثنان: كلُّ عمليّةٍ دفعت دفعةً ثمّ دفعت أخيرةً عند `stop`.
    // وهذا هو ما يُنقِذ العدَّ عند إعادةِ النشر، وهو نفسُه ما يُفسِد
    // الرقمَ إن جمعَهُما مُجمِّعٌ لا يحترم الزمنيّةَ التراكميّة.
    expect(collector.bodies).toHaveLength(4);
    expect(new Set(collector.instanceIds()).size).toBe(2);
  });

  test("المُجمِّعُ يفصل النسختَين بـservice.instance.id", () => {
    // هذه هي العقدةُ: بلا هويّةٍ فارقةٍ تدهس سلاسلُ نسخةٍ سلاسلَ أختِها في
    // المُجمِّعِ، فيُقرأ رقمُ آخرِ دافعٍ ويُظنُّ أنّه مجموعُ النظام.
    expect(new Set(collector.instanceIds())).toEqual(new Set([INSTANCE_A, INSTANCE_B]));
  });

  test("العمليّتان مختلفتا رقمِ العمليّةِ فعلاً — لا نسختان في ذاكرةٍ واحدة", () => {
    const pids = collector.pids();
    // لو كان هذا الاختبارُ يشغّل مسجِّلَين في عمليّةٍ واحدةٍ لتساوى الرقمان،
    // ولمرّت هويّةٌ مبنيّةٌ على `pid` وحدَه وهي معطوبة.
    expect(new Set(pids).size).toBe(2);
  });

  test("مجموعُ العدّادِ عبرَ النسختَين يساوي المجموعَ المعروفَ سلفاً", () => {
    // ١٨ = ٧ + ١١. وهذا هو الرقمُ الذي لم يكن له موضعٌ في الدنيا قبلَ هذا البند:
    // لا `/metrics` الأولى تعرفه ولا الثانية.
    expect(collector.sumCounterAcrossInstances(CHILD_COUNTER)).toBe(INCREMENTS_A + INCREMENTS_B);
  });

  test("العدّادُ مُعلَنٌ تصاعديّاً فلا يُقرأ منحنياً هابطاً عند إعادةِ النشر", () => {
    const body = collector.bodies[0];
    const metric = body?.resourceMetrics[0]?.scopeMetrics[0]?.metrics.find(
      (item) => item.name === CHILD_COUNTER,
    );
    expect(metric?.sum?.isMonotonic).toBe(true);
  });

  test("مؤشّرُ كلِّ نسخةٍ يُقرأ وحدَه ولا يُجمَع مع أختِه", () => {
    // المؤشّرُ لحظيٌّ: جمعُ «سائقين متّصلين» من نسختَين تريان الجدولَ نفسَه
    // يُضاعِف الرقمَ. فالفصلُ بالهويّةِ هو ما يجعل القراءةَ الصحيحةَ ممكنة.
    expect(collector.gaugeForInstance(INSTANCE_A, CHILD_GAUGE)).toBe(INCREMENTS_A * 2);
    expect(collector.gaugeForInstance(INSTANCE_B, CHILD_GAUGE)).toBe(INCREMENTS_B * 2);
  });

  test("مجموعُ عدِّ المُدرَّجِ عبرَ النسختَين صحيحٌ كذلك", () => {
    expect(collector.sumHistogramCount(CHILD_HISTOGRAM)).toBe(INCREMENTS_A + INCREMENTS_B);
  });

  test("كلُّ جسمٍ يحمل مقاييسَ الدفعِ الذاتيّةَ فتُقاس صحّةُ الرصدِ من الرصدِ نفسِه", () => {
    // الدفعةُ الأولى تُدفَع قبلَ أن يُسجَّل نجاحُها، فتظهر مقاييسُ المحاولاتِ في
    // الجسمِ الثاني (الدفعةُ الأخيرةُ عند `stop`) لا في الأول. والمهمُّ أنّ
    // المُجمِّعَ يرى مِن دافِعٍ حالةَ دفعِه لا أن يبقى الانقطاعُ غيرَ مرئيّ.
    const names = collector.bodies.flatMap((body) =>
      (body.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []).map((metric) => metric.name),
    );
    expect(names).toContain("waslah_metrics_export_attempts_total");
    expect(names).toContain("waslah_metrics_export_last_success_timestamp_seconds");
  });
});
