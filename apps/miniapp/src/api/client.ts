/**
 * Product API boundary.
 * Every product call requires a valid Waslah internal session (ADR 0035 checks).
 * No direct database access. No domain entity creation on the client.
 *
 * `F1-07` — تفريقُ **صنفَي الفشلِ** ههنا لا في الشاشات: ردٌّ وصل بحالةٍ غيرِ
 * ناجحةٍ (`ApiError`) وفشلٌ قبلَ أن يصل ردٌّ إطلاقاً (`ApiNetworkError`). وكان
 * الثاني يهرب `TypeError` خامّاً فتراه الشاشةُ خطأً مجهولاً، فلا تستطيع أن تقول
 * «الشبكةُ أم خدمتُنا؟» كما يوجب القسم 9.7. والتفريقُ في حدِّ API لأنه معرفةُ
 * الحدِّ وحدَه: الشاشةُ لا ترى `fetch` ولا ترويسةً.
 */

import { getSession, hasValidSession } from "../identity/session.ts";

/** الحدُّ الأعلى المعقولُ لثوانٍ في `Retry-After` — يومٌ واحد. ما فوقه يُهمَل. */
const MAX_RETRY_AFTER_SECONDS = 86_400;

/**
 * `WR-29` (ADR 0303) — استردادُ الجلسةِ بعدَ انتهائِها **أثناءَ الاستخدامِ**:
 * التجربةُ الميدانيّةُ (٣ نوفمبر ٢٠٢٦) أثبتت أنّ الراكبَ في رحلةٍ جاريةٍ قد
 * تنتهي جلستُهُ فلا يعودُ يجدُ رحلتَهُ. فكان القرارُ المالكِ: استردادٌ تلقائيٌّ
 * كاملٌ. والمسجِّلُ هو الهيكلُ (`shell/Shell.tsx`) — حدُّ النقلِ لا يعرفُ كيفَ
 * تُقامُ الجلسةُ، فقطَ **متى** يُنادى مَن يُقيمُها.
 *
 * سياسةُ المحاولةِ الواحدةِ (لا سلسلةَ ولا دورانَ): نداءٌ واحدٌ للاستردادِ،
 * فإن أقامَ جلسةً صالحةً أُعيدَ الطلبُ الأصليُّ مرّةً واحدةً لا غير. وإن فشلَ
 * رُدَّ الخطأُ الأصليُّ نفسُه — فشلُ الاستردادِ لا يُخفي رفضَ الخادمِ.
 */
export type SessionRecovery = () => Promise<boolean>;

let sessionRecovery: SessionRecovery | null = null;
let inflightRecovery: Promise<boolean> | null = null;
let recoveryCooldownUntilMs = 0;

/**
 * مهلةُ تهدئةٍ بعدَ فشلِ استردادٍ: نداءاتُ السطوحِ دوريّةٌ، فبلا مهلةٍ صارَ كلُّ
 * نداءٍ فاشلٍ يفتحُ إقامةَ جلسةٍ جديدةً (شبكةً وشيكاتِ توقيعٍ) في دائرةٍ محكومةٍ.
 * والنجاحُ يرفعُ التهدئةَ فوراً.
 */
const SESSION_RECOVERY_COOLDOWN_MS = 15_000;

export function registerSessionRecovery(recover: SessionRecovery | null): void {
  sessionRecovery = recover;
  // تسجيلٌ جديدٌ يبدأُ صفحةً بيضاءَ: لا طيراناً قائماً ولا تهدئةً — المسجِّلُ
  // ههنا واحدٌ (الهيكلُ) وتركيبُه الجديدُ جلسةٌ جديدةٌ لا بقايا القديمةِ.
  inflightRecovery = null;
  recoveryCooldownUntilMs = 0;
}

/**
 * محاولةُ استردادٍ واحدةٌ مُشفَعةٌ لكلِّ النداءاتِ المتزامنةِ: من يتجمّعونَ على
 * انتهاءِ جلسةٍ واحدةٍ يُقيمونَها إقامةً واحدةً. والفشلُ يُفعِلُ التهدئةَ لا
 * يُرمى: فشلُ الاستردادِ نتيجةٌ تُعاد، لا استثناءٌ يُخفي الرفضَ الأصليَّ.
 */
async function recoverSession(): Promise<boolean> {
  const recover = sessionRecovery;
  if (recover === null) return false;
  if (inflightRecovery !== null) return inflightRecovery;
  if (Date.now() < recoveryCooldownUntilMs) return false;
  const attempt = recover().then(
    (ok) => {
      if (ok) recoveryCooldownUntilMs = 0;
      else recoveryCooldownUntilMs = Date.now() + SESSION_RECOVERY_COOLDOWN_MS;
      return ok;
    },
    () => {
      recoveryCooldownUntilMs = Date.now() + SESSION_RECOVERY_COOLDOWN_MS;
      return false;
    },
  );
  inflightRecovery = attempt;
  try {
    return await attempt;
  } finally {
    if (inflightRecovery === attempt) inflightRecovery = null;
  }
}

/**
 * رموزُ رفضِ الخادمِ التي معناها «الجلسةُ ذاتُها لا تُقبلُ» فتستحقُّ محاولةَ
 * استردادٍ — وسائرُ رموزِ `401` تُرمى كما هي.
 */
const SESSION_LOST_CODES = new Set(["SESSION_EXPIRED", "SESSION_INVALID"]);

/**
 * سياسةُ الاستردادِ داخلَ النداءِ الواحدِ: `"allow"` في النداءِ الأول، و`"deny"`
 * في إعادةِ المحاولةِ بعدَ استردادٍ ناجحٍ — فلا يستردَّ الطلبُ المُستردُّ مرّةً
 * ثانيةً مهما رُدَّ. معيارٌ داخليٌّ لا يمرّره المنادي الخارجيُّ أبداً.
 */
type SessionRecoveryPolicy = "allow" | "deny";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * `F1-08`: معرّفُ الطلبِ من رأسِ الردِّ إن وُجد — و`null` إن لم يُصدِره الخادمُ
   * (ردٌّ من وسيطٍ أمامَ التطبيقِ مثلاً). ولا يُخترَع، ولا يُولَّد في العميل.
   */
  readonly requestId: string | null;
  /**
   * `F1-07`: ثوانٍ من ترويسةِ `Retry-After` إن أرسلها الخادمُ ــ و`null` إن لم
   * يُرسِلها. ولا يُخترَع تقديرٌ عندَ غيابِها: «تقديرٌ زمنيٌّ **إن وُجد**» (9.7).
   */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
    requestId: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.requestId = requestId;
  }
}

/**
 * `F1-07`: لم يصل ردٌّ. سببُه شبكةُ الجهازِ أو الطريقُ أو الخدمةُ نفسُها — وهذا
 * الصنفُ **لا يزعم** أيَّها: التمييزُ قرارُ طبقةِ التشخيصِ لا طبقةِ النقل.
 */
export class ApiNetworkError extends Error {
  constructor(message = "لم يصل ردٌّ من الخادم") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

/**
 * قراءةُ `Retry-After` بصيغةِ الثواني وحدَها. والصيغةُ التاريخيةُ (HTTP-date)
 * مقبولةٌ في المعيارِ ولا تُقرأ ههنا عن قصد: ساعةُ الجهازِ قد تكون منحرفةً،
 * فتقديرٌ محسوبٌ عليها أسوأُ من لا تقديرٍ — و«الصدقُ في الحالة» (UX-8).
 */
function readRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_RETRY_AFTER_SECONDS) return null;
  return seconds;
}

/** صيغةُ معرّفِ الطلبِ كما يُصدِرها الخادمُ (ADR 0043) — وما خالفها يُهمَل. */
const REQUEST_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * `F1-08`: قراءةُ `X-Request-Id`. والشكلُ يُتحقَّق منه ههنا لا في الشاشة: رأسٌ
 * قادمٌ من الشبكةِ مُدخَلٌ، وقيمةٌ فيها محرفُ سطرٍ تفسد كلَّ ما يُبنى عليها.
 */
function readRequestId(header: string | null): string | null {
  if (header === null) return null;
  const trimmed = header.trim();
  return REQUEST_ID_SHAPE.test(trimmed) ? trimmed : null;
}

/**
 * `F1-08`: ما يُبلَّغ عن كلِّ نداءٍ منتهٍ. **حقولٌ مسموحةٌ بالاسمِ لا كائنٌ حرٌّ**:
 * لا جسمَ ردٍّ، ولا رسالةَ خطأٍ، ولا ترويسةَ تفويضٍ، ولا نصَّ استثناءٍ.
 */
export interface ApiObservation {
  readonly path: string;
  readonly method: string;
  /** `null` حين لم يصل ردٌّ. */
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  /**
   * `ok` وصل ردٌّ ناجحٌ · `rejected` وصل ردٌّ بحالةٍ غيرِ ناجحةٍ · `no_response`
   * لم يصل ردٌّ · `not_attempted` لم يُرسَل الطلبُ أصلاً (رفضٌ محليٌّ لغيابِ
   * جلسةٍ). والأربعةُ لا تُدمَج: كلُّ دمجٍ منها يجعل قراءةَ القياسِ كذباً.
   */
  readonly outcome: "ok" | "rejected" | "no_response" | "not_attempted";
}

export type ApiObserver = (observation: ApiObservation) => void;

export type ApiRequestInit = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /**
   * `WR-34` (ADR 0305): جسمٌ ثنائيٌّ خامٌ (صورةٌ أو تسجيلٌ) بنوعِه — بدلَ `body`. البوّابةُ
   * لا تثقُ بالنوعِ المصرَّح: تفحصُ البايتات، فالنوعُ هنا تلميحٌ للنقلِ فقط.
   */
  rawBody?: { readonly data: Blob; readonly contentType: string };
  idempotencyKey?: string;
  /**
   * When true, skip session check.
   *
   * `F1-07`: المسارات العامّةُ ثلاثةٌ لا أكثر، وكلُّها **ليست واجهةَ منتَجٍ**:
   * مبادلةُ الجلسةِ (`F1-03`) وتجديدُها (`F1-04`) وفحصُ الحياةِ `GET /health`
   * (القسم 10: «فحوصُ التشغيل | نظام»). وحدُّ ADR 0035 §2 قائمٌ كما هو: لا نداءَ
   * لواجهةِ المنتجِ بلا جلسةٍ صالحة.
   */
  public?: boolean;
  /**
   * `F1-08`: مُراقِبٌ يُنادى مرّةً واحدةً عندَ انتهاءِ النداء. وهو اختياريٌّ:
   * المنادي الذي لا يمرّره لا يتغيّر سلوكُه شعرةً، ولا شيءَ يُقاس بلا طالبٍ.
   */
  observe?: ApiObserver;
  /**
   * BOOT-DEADLINES: مهلةٌ اختياريّةٌ بالمللي ثانية **حتّى وصولِ الرأس**. انقضاؤها
   * يُلغي الطلبَ فيُرمى `ApiNetworkError` كأيِّ «لم يصل ردّ». **لا تُمرَّرُ إلّا لطلبٍ
   * إلغاؤه آمن**: التجديدُ بلا حالةٍ على الخادم فرمزُه القديمُ يبقى صالحًا. ولا تُمرَّرُ
   * لمبادلةِ `initData`: قد تصلُ فيستهلكُها حارسُ الإعادة.
   */
  timeoutMs?: number;
};

function apiBase(): string {
  const base = import.meta.env.VITE_WASLAH_API_BASE;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/$/, "");
  return "";
}

/**
 * Authenticated product API call.
 * Rejects before network if session is missing (ADR 0035 automated check #2).
 */
/**
 * `F1-08`: نداءُ المُراقِبِ **لا يُسقِط النداءَ أبداً**. مُراقِبٌ يرمي عيبُه لا
 * عيبُ الطلبِ، والمستخدمُ لا يخسر ردّاً وصل لأنّ عدّاداً انكسر.
 */
function notify(observe: ApiObserver | undefined, observation: ApiObservation): void {
  if (observe === undefined) return;
  try {
    observe(observation);
  } catch {
    /* القياسُ لا يُفشِل النقل */
  }
}

export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
  recovery: SessionRecoveryPolicy = "allow",
): Promise<T> {
  const method =
    init.method ?? (init.body !== undefined || init.rawBody !== undefined ? "POST" : "GET");

  if (!init.public && !hasValidSession()) {
    // `WR-29` (ADR 0303): الجلسةُ انتهت أثناءَ الاستخدامِ — استردادٌ صامتٌ واحدٌ
    // قبلَ رميِ الرفضِ المحليِّ، فإن أقامَ جلسةً مضى النداءُ في مسارِه ولم يُرمَ
    // شيءٌ. والنداءُ المُستردُّ (`recovery = "deny"`) لا يستردُّ مرّةً ثانيةً.
    if (recovery === "allow" && (await recoverSession()) && hasValidSession()) {
      return apiFetch<T>(path, init, "deny");
    }
    // `F1-08`: رفضٌ محليٌّ قبلَ الشبكةِ — يُسجَّل `not_attempted` لا `rejected`:
    // الخادمُ لم يُنادَ، فنسبةُ الرفضِ إليه كذبٌ في القياس.
    notify(init.observe, {
      path,
      method,
      status: null,
      code: "SESSION_REQUIRED",
      requestId: null,
      outcome: "not_attempted",
    });
    throw new ApiError(401, "SESSION_REQUIRED", "WASLA session required");
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (init.rawBody !== undefined) {
    headers["Content-Type"] = init.rawBody.contentType;
  } else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const session = getSession();
  if (session) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  if (init.idempotencyKey) {
    headers["Idempotency-Key"] = init.idempotencyKey;
  }

  // `body` is spread in conditionally rather than passed as `undefined`:
  // `exactOptionalPropertyTypes` is on, and `RequestInit.body` accepts
  // `BodyInit | null` — never the literal `undefined`.
  const abort =
    init.timeoutMs === undefined || typeof AbortController === "undefined"
      ? null
      : new AbortController();
  const timer = abort === null ? null : setTimeout(() => abort.abort(), init.timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      ...(init.rawBody !== undefined
        ? { body: init.rawBody.data }
        : init.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
      ...(abort === null ? {} : { signal: abort.signal }),
    });
  } catch {
    if (timer !== null) clearTimeout(timer);
    // `F1-07`: الرسالةُ الأصليةُ لا تُنقَل: نصُّ خطأِ المتصفّحِ يحمل أحياناً
    // العنوانَ كاملاً، والعنوانُ يحمل مسارَ الجلسة. ولا شيءَ يُسجَّل ههنا.
    notify(init.observe, {
      path,
      method,
      status: null,
      code: null,
      requestId: null,
      outcome: "no_response",
    });
    throw new ApiNetworkError();
  }

  if (timer !== null) clearTimeout(timer);
  const requestId = readRequestId(res.headers.get("x-request-id"));

  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = res.statusText;
    try {
      // ردودُ البوابةِ في `F1-03`..`F1-05` تحمل الرمزَ في `error`، وبعضُ الردودِ
      // الأقدمِ في `code`. فيُقرأ الاثنان — والرمزُ وحدَه يُقرأ، لا نصُّ رسالةٍ
      // يُبنى عليه قرار.
      const payload = (await res.json()) as { code?: string; error?: string; message?: string };
      if (payload.code) code = payload.code;
      if (!payload.code && typeof payload.error === "string" && payload.error.length > 0) {
        code = payload.error;
      }
      if (payload.message) message = payload.message;
    } catch {
      /* keep defaults */
    }
    notify(init.observe, {
      path,
      method,
      status: res.status,
      code,
      requestId,
      outcome: "rejected",
    });
    // `WR-29` (ADR 0303): الرفضُ واقعةٌ سُجِّلت كما هي، ثمّ — إن كان رفضاً
    // للجلسةِ ذاتِها — محاولةُ استردادٍ واحدةٌ تُعيدُ النداءَ مرّةً لا تُعيدُه
    // سلسلةً. والفشلُ يُرمي الرفضَ الأصليَّ نفسَهُ بلا تمويهٍ.
    if (
      recovery === "allow" &&
      !init.public &&
      res.status === 401 &&
      SESSION_LOST_CODES.has(code)
    ) {
      if ((await recoverSession()) && hasValidSession()) {
        return apiFetch<T>(path, init, "deny");
      }
    }
    throw new ApiError(
      res.status,
      code,
      message,
      readRetryAfterSeconds(res.headers.get("retry-after")),
      requestId,
    );
  }

  notify(init.observe, {
    path,
    method,
    status: res.status,
    code: null,
    requestId,
    outcome: "ok",
  });

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
