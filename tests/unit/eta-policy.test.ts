/**
 * الغرض: إثبات أن سياسةَ زمنِ الوصول لا تُخرج رقماً إلاّ إذا كان جوابَ توجيهٍ
 *   يخصّ الموضعَ المسؤولَ عنه فعلاً — وأنّ كلّ امتناعٍ مُصنَّفٌ بسببه لا مُجمَّع.
 * الحالة: منفّذ فعلياً — المرحلة ١٥.
 * ينتمي إلى: tests/unit
 *
 * ولماذا هذا الملف موجود: العيبُ المقيس في المرحلة ١٥ لم يكن في حسابٍ خاطئ بل في
 * أنّ محرّك التوجيه **يُجيب بثقةٍ عن موضعٍ لم يُسأل عنه**: إحداثيةٌ في البحر
 * الأحمر أعادت `Ok` و٥٦ دقيقةً بإلصاقِ ٥١.٧ كم. فتُثبَّت هنا الحدودُ التي تمنع
 * ذلك الجوابَ من الوصول إلى سائقٍ، وتُثبَّت كلٌّ منها **وحدها** كي لا يُخفي
 * شرطٌ سليمٌ شرطاً مكسوراً.
 */

import { describe, expect, it } from "bun:test";
import {
  estimateEta,
  MAX_PLAUSIBLE_SECONDS,
  MAX_SNAP_METERS,
  MIN_DISPLAY_MINUTES,
} from "../../packages/domain/eta/index.ts";

/** إلصاقٌ صغيرٌ مشروع: أصغرُ ما قيس في جدّة كان 5.8 م. */
const ON_ROAD = { origin: 6, destination: 6 };

const routed = (durationSeconds: number, distanceMeters = 5000) =>
  estimateEta({ durationSeconds, distanceMeters, snapMeters: ON_ROAD });

describe("سياسة زمن الوصول: الحُكم الموجب", () => {
  it("مدّةُ توجيهٍ سليمةٌ تُنتج حُكماً مصدرُه معلَنٌ في الحُكم نفسه", () => {
    const v = routed(714.9, 11671.7);
    expect(v.kind).toBe("ROUTED");
    if (v.kind !== "ROUTED") return;
    expect(v.source).toBe("ROUTING");
  });

  it("الثواني تُحفظ كما أعطاها المحرّك بلا تدوير", () => {
    const v = routed(714.9);
    expect(v.kind === "ROUTED" && v.seconds).toBe(714.9);
  });

  it("المسافة تُنقَل كما هي: العرض يوسمها، والسياسة لا تُبدّلها", () => {
    const v = routed(714.9, 11671.7);
    expect(v.kind === "ROUTED" && v.distanceMeters).toBe(11671.7);
  });

  it("الدقائق تُدوَّر إلى أقربها لا تُقتطع", () => {
    // ٧١٤.٩ ثانية = 11.915 دقيقة. الاقتطاع يعطي ١١، والتدوير ١٢.
    expect(routed(714.9).kind === "ROUTED" && (routed(714.9) as { minutes: number }).minutes).toBe(
      12,
    );
  });
});

describe("سياسة زمن الوصول: الحدّ الأدنى للعرض", () => {
  /**
   * ولماذا يُفرَد هذا الشرط في اختباراتٍ ثلاثة: لأنّ «صفر دقيقة» يُقرأ **وصل**،
   * وهو توكيدٌ لا تملكه سياسةٌ تحسب مسافة. ومُحوِّرٌ يُبدّل `Math.max` بـ
   * `Math.round` وحده يمرّ من أي اختبارٍ يقيس مدّةً طويلة.
   */
  it("عشرُ ثوانٍ لا تُعرَض صفرَ دقيقة", () => {
    expect(routed(10).kind === "ROUTED" && (routed(10) as { minutes: number }).minutes).toBe(
      MIN_DISPLAY_MINUTES,
    );
  });

  it("صفرُ ثانيةٍ تُعرَض دقيقةً واحدة لا صفراً", () => {
    const v = routed(0);
    expect(v.kind === "ROUTED" && v.minutes).toBe(1);
  });

  it("والثواني تبقى صفراً: الحدُّ الأدنى للعرض لا يُزيّف المقياس", () => {
    const v = routed(0);
    expect(v.kind === "ROUTED" && v.seconds).toBe(0);
  });

  it("الحدُّ الأدنى موجبٌ فعلاً — وإلاّ فلا يحمي شيئاً", () => {
    expect(MIN_DISPLAY_MINUTES).toBeGreaterThan(0);
  });
});

describe("سياسة زمن الوصول: الإلصاق خارج الطريق", () => {
  it("الإلصاقُ المجهول امتناعٌ لا صفر", () => {
    const v = estimateEta({ durationSeconds: 600, distanceMeters: 5000, snapMeters: null });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "SNAP_UNKNOWN" });
  });

  it("إلصاقُ ٥١.٧ كم — وهو ما قيس فعلاً في البحر الأحمر — يُرفض", () => {
    const v = estimateEta({
      durationSeconds: 3360,
      distanceMeters: 61600,
      snapMeters: { origin: 24.8, destination: 51705.4 },
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "OFF_ROAD" });
  });

  it("والبعدُ في نقطة البداية يُرفض كذلك لا في المقصد وحده", () => {
    const v = estimateEta({
      durationSeconds: 600,
      distanceMeters: 5000,
      snapMeters: { origin: 51705.4, destination: 24.8 },
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "OFF_ROAD" });
  });

  it("مطارُ جدّة (513.2 م) — أبعدُ موضعٍ مشروعٍ قيس — يُقبَل", () => {
    const v = estimateEta({
      durationSeconds: 2355.6,
      distanceMeters: 26654.4,
      snapMeters: { origin: 24.8, destination: 513.2 },
    });
    expect(v.kind).toBe("ROUTED");
  });

  it("الحدُّ نفسه مقبولٌ لا مرفوض: الحدود تُختبَر عندها لا حولها", () => {
    const v = estimateEta({
      durationSeconds: 600,
      distanceMeters: 5000,
      snapMeters: { origin: MAX_SNAP_METERS, destination: MAX_SNAP_METERS },
    });
    expect(v.kind).toBe("ROUTED");
  });

  it("وما فوقه بمترٍ واحدٍ مرفوض", () => {
    const v = estimateEta({
      durationSeconds: 600,
      distanceMeters: 5000,
      snapMeters: { origin: MAX_SNAP_METERS + 1, destination: 6 },
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "OFF_ROAD" });
  });

  it("الحدُّ يقع فوق كلّ موضعٍ مشروعٍ قيس ودون أصغرِ موضعٍ زائفٍ قيس", () => {
    // أعلى موضعٍ مشروع: المطار 513.2 م. أصغر زائف: مصر 2500 م.
    expect(MAX_SNAP_METERS).toBeGreaterThan(513.2);
    expect(MAX_SNAP_METERS).toBeLessThan(2500);
  });

  it("إلصاقٌ غيرُ عدديّ لا يمرّ بصمتٍ من المقارنة", () => {
    const v = estimateEta({
      durationSeconds: 600,
      distanceMeters: 5000,
      snapMeters: { origin: Number.NaN, destination: 6 },
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "SNAP_UNKNOWN" });
  });
});

describe("سياسة زمن الوصول: المعقوليّة", () => {
  it("مدّةٌ فوق السقف تُرفض ولو كان الإلصاق سليماً", () => {
    const v = estimateEta({
      durationSeconds: MAX_PLAUSIBLE_SECONDS + 1,
      distanceMeters: 900_000,
      snapMeters: ON_ROAD,
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "IMPLAUSIBLE" });
  });

  it("والسقفُ نفسه مقبول", () => {
    const v = estimateEta({
      durationSeconds: MAX_PLAUSIBLE_SECONDS,
      distanceMeters: 900_000,
      snapMeters: ON_ROAD,
    });
    expect(v.kind).toBe("ROUTED");
  });

  it("رحلةُ جدّة ← مكّة المقيسة (٦١.٦ دقيقة) دون السقف بفارقٍ واسع", () => {
    expect(61.6 * 60).toBeLessThan(MAX_PLAUSIBLE_SECONDS);
  });

  /**
   * الترتيبُ يُختبَر صراحةً: مدّةٌ خارجَ المعقول **و** إلصاقٌ بعيد. والسببُ
   * `OFF_ROAD` لا `IMPLAUSIBLE`، لأنّ الأول يقول «راجِع الموقع» والثاني «راجِع
   * الخادم» — ومُحوِّرٌ يقلب الترتيب لا يُكشَف بأيّ اختبارٍ يقيس سبباً واحداً.
   */
  it("عند تحقّق السببين معاً يُقال «خارج الطريق» لا «غير معقول»", () => {
    const v = estimateEta({
      durationSeconds: 1373 * 60,
      distanceMeters: 1_905_000,
      snapMeters: { origin: 24.8, destination: 2500 },
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "OFF_ROAD" });
  });
});

describe("سياسة زمن الوصول: أرقامٌ غير عدديّة", () => {
  it("مدّةٌ NaN لا تصير «NaN دقيقة» في رسالةٍ", () => {
    const v = estimateEta({
      durationSeconds: Number.NaN,
      distanceMeters: 5000,
      snapMeters: ON_ROAD,
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });

  it("مدّةٌ لا نهائيّة تُرفض قبل أن تُقارَن بالسقف", () => {
    const v = estimateEta({
      durationSeconds: Number.POSITIVE_INFINITY,
      distanceMeters: 5000,
      snapMeters: ON_ROAD,
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });

  it("مسافةٌ NaN تُرفض ولو كانت المدّة سليمة", () => {
    const v = estimateEta({
      durationSeconds: 600,
      distanceMeters: Number.NaN,
      snapMeters: ON_ROAD,
    });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });

  it("مدّةٌ سالبة تُرفض", () => {
    const v = estimateEta({ durationSeconds: -1, distanceMeters: 5000, snapMeters: ON_ROAD });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });

  it("مسافةٌ سالبة تُرفض", () => {
    const v = estimateEta({ durationSeconds: 600, distanceMeters: -1, snapMeters: ON_ROAD });
    expect(v).toEqual({ kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" });
  });
});
