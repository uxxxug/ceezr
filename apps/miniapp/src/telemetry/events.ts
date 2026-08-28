/**
 * الغرض: **تصنيفةُ أحداثِ القياسِ المغلقةُ ومُنقّيها** — البند `F1-08`: «قياسُ
 *   واجهةٍ (أحداثٌ وأخطاءٌ) مربوطٌ بـ`request-id`». والحدثُ ههنا **بنيةٌ مغلقةٌ
 *   بحقولٍ مسموحةٍ بالاسم**، لا كائنٌ حرٌّ يحمل ما يُلقى فيه.
 * الحالة: منفّذ فعلياً — البند `F1-08`.
 * ينتمي إلى: apps/miniapp/src/telemetry (حزمة «القياس» — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `telemetry.ts` (المنقّي يُنادى منه وحدَه)، و`api/client.ts`
 *   و`identity/boot.ts` و`shell/ErrorBoundary.tsx` بوصفِها مصادرَ الأحداث.
 * ملاحظات مستقبلية: إرسالُ الأحداثِ خارجَ الجهازِ **ليس ههنا ولا في هذا البند**
 *   (قرارُ مالكِ المنتج · ADR 0043): لا منصةَ قياسٍ مستقبِلةً اليومَ (`REQ-05`
 *   معلَّق · `F8-01`/`F8-02` لم تبدأ) ولا شاشةَ موافقةٍ (القسم 9.12). وحين
 *   يُقرَّر مستقبِلٌ، يُضاف مَصرِفٌ ينفّذ `TelemetrySink` ولا يُغيَّر شيءٌ ههنا.
 *
 * **قائمةُ مسموحٍ لا قائمةُ ممنوعٍ**: كلُّ حقلٍ في الحدثِ يمرُّ على قالبٍ ضيّقٍ،
 * وما لم يطابق القالبَ يصير `null` أو `:id`. وسببُه أنّ قائمةَ الممنوعِ تُنسى
 * ويُضاف إليها حقلٌ جديدٌ يحمل رقمَ هاتفٍ بعدَ سنةٍ، أمّا القالبُ الضيّقُ فيرفض
 * ما لم يُذكَر أصلاً. **فلا نصَّ حرٌّ في أيِّ حدثٍ**: لا رسالةَ خطأٍ، ولا مسارَ
 * مكوّناتٍ، ولا عنوانَ صفحةٍ، ولا `initData`، ولا رمزَ وصولٍ، ولا معرّفَ تيليجرام.
 */

/** صيغةُ معرّفِ الطلبِ كما يُصدِرها الخادمُ (ADR 0043 · `X-Request-Id`). */
const REQUEST_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;
/** رمزُ خطأٍ من عقدِ القسم 10: حروفٌ كبيرةٌ وشُرَطٌ سفليّةٌ وأرقامٌ. */
const CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,39}$/;
/** وسمُ موضعٍ في الشيفرة (`label` لحدِّ الخطأ): حروفٌ صغيرةٌ وشُرَطٌ. */
const LABEL_SHAPE = /^[a-z][a-z0-9-]{0,31}$/;
/** جزءُ مسارٍ ثابتٌ: ما ليس معرّفاً ولا رمزاً. */
const STATIC_SEGMENT_SHAPE = /^[a-z][a-z0-9-]{0,23}$/;

const METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export type TelemetryMethod = (typeof METHODS)[number] | "OTHER";

const MIN_STATUS = 100;
const MAX_STATUS = 599;
const MAX_PATH_SEGMENTS = 8;

/** نتيجةُ نداءِ حدِّ API — ثلاثٌ لا أكثر، وهي تفريقُ `F1-07` نفسُه. */
export type ApiOutcome =
  /** وصل ردٌّ ناجحٌ. */
  | "ok"
  /** وصل ردٌّ بحالةٍ غيرِ ناجحةٍ — الخادمُ تكلّم. */
  | "rejected"
  /** لم يصل ردٌّ إطلاقاً — فلا معرّفَ طلبٍ لهذا الحدثِ بطبيعتِه. */
  | "no_response"
  /**
   * لم يُرسَل الطلبُ أصلاً: حدُّ API رفضَه محلياً لغيابِ جلسةٍ صالحةٍ (ADR 0035
   * §2). وهو **ليس رفضاً من الخادمِ** ولا انقطاعَ شبكةٍ، وخلطُه بأحدِهما يجعل
   * قراءةَ القياسِ كذباً: فله وسمٌ رابعٌ لا يُدمَج بغيرِه.
   */
  | "not_attempted";

export type BootOutcome = "existing" | "renewed" | "exchanged" | "failed";

export type TelemetryEvent =
  | {
      readonly kind: "boot";
      readonly outcome: BootOutcome;
      /** سببُ الفشلِ من `BootFailureReason` — و`null` عندَ النجاح. */
      readonly reason: string | null;
      readonly requestId: string | null;
    }
  | {
      readonly kind: "api";
      /** مسارٌ **مُقولَبٌ** لا مسارٌ فعليٌّ: `/v1/rides/:id` لا `/v1/rides/42`. */
      readonly path: string;
      readonly method: TelemetryMethod;
      readonly status: number | null;
      readonly code: string | null;
      readonly outcome: ApiOutcome;
      readonly requestId: string | null;
    }
  | {
      readonly kind: "ui_error";
      /** وسمُ موضعِ حدِّ الخطأِ — لا رسالةُ الاستثناءِ ولا مسارُ المكوّنات. */
      readonly label: string | null;
      readonly requestId: string | null;
    };

function cleanRequestId(value: unknown): string | null {
  return typeof value === "string" && REQUEST_ID_SHAPE.test(value) ? value : null;
}

function cleanCode(value: unknown): string | null {
  return typeof value === "string" && CODE_SHAPE.test(value) ? value : null;
}

function cleanLabel(value: unknown): string | null {
  return typeof value === "string" && LABEL_SHAPE.test(value) ? value : null;
}

function cleanStatus(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= MIN_STATUS && value <= MAX_STATUS ? value : null;
}

function cleanMethod(value: unknown): TelemetryMethod {
  return METHODS.find((method) => method === value) ?? "OTHER";
}

/**
 * **تقويلُ المسار**: يُقتَطع ما بعدَ `?` و`#` كلَّه (المُعامِلاتُ تحمل بحثاً أو
 * إحداثيّاتٍ)، ويُستبدَل كلُّ جزءٍ ليس ثابتاً معروفَ الشكلِ بـ`:id` — فالمعرّفاتُ
 * أرقامٌ أو UUID أو رموزٌ طويلةٌ، وكلُّها تُشير إلى شخصٍ أو رحلةٍ بعينِها.
 * والمسارُ الفارغُ أو الغريبُ يصير `/` لا نصّاً مجهولاً.
 */
export function normalizePath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  const withoutQuery = raw.split("?")[0]?.split("#")[0] ?? "";
  const segments = withoutQuery.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return "/";
  const kept = segments
    .slice(0, MAX_PATH_SEGMENTS)
    .map((segment) => (STATIC_SEGMENT_SHAPE.test(segment) ? segment : ":id"));
  return `/${kept.join("/")}`;
}

/**
 * المنقّي: يُنادى **قبلَ كلِّ تسجيلٍ** بلا استثناءٍ (في `telemetry.ts`)، فلا يصل
 * مَصرِفاً حدثٌ لم يمرَّ عليه. وهو نقيٌّ: لا وقتَ، ولا عشوائيةَ، ولا حالةَ.
 */
export function sanitizeEvent(event: TelemetryEvent): TelemetryEvent {
  if (event.kind === "api") {
    // ما لم يصل فيه ردٌّ (لا-ردَّ أو لم يُرسَل) لا معرّفَ طلبٍ له ولا حالةَ ولا
    // رمزَ — والصدقُ في الحالةِ (UX-8) يمنع أن يحمل الحدثُ معرّفاً مُستعاراً من
    // نداءٍ آخر، أو حالةً «401» تُقرأ رفضاً من خادمٍ لم يُنادَ.
    const noResponse = event.outcome === "no_response" || event.outcome === "not_attempted";
    return {
      kind: "api",
      path: normalizePath(event.path),
      method: cleanMethod(event.method),
      status: noResponse ? null : cleanStatus(event.status),
      code: noResponse ? null : cleanCode(event.code),
      outcome: event.outcome,
      requestId: noResponse ? null : cleanRequestId(event.requestId),
    };
  }
  if (event.kind === "boot") {
    return {
      kind: "boot",
      outcome: event.outcome,
      reason: event.outcome === "failed" ? cleanCode(event.reason) : null,
      requestId: cleanRequestId(event.requestId),
    };
  }
  return {
    kind: "ui_error",
    label: cleanLabel(event.label),
    requestId: cleanRequestId(event.requestId),
  };
}
